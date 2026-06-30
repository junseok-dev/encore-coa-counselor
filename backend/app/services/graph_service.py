from typing import Literal, TypedDict

from langgraph.graph import END, StateGraph

from app.services.document_service import search_documents
from app.services.openai_service import STANDARD_REFUSAL, client, get_ai_response
from app.services.response_formatter import format_chat_response

from app.config import get_settings

# 임계값은 .env로 조정 가능 (임베딩 모델 교체 시 재튜닝). 기동 시점에 로드된다.
_settings = get_settings()
VERIFY_THRESHOLD = _settings.verify_threshold
REJECT_THRESHOLD = _settings.reject_threshold  # (재설계 후 미사용: 하드 거절 폐지 → LLM이 핵심 사실 시트로 처리. 호환 위해 정의만 유지)
VERIFY_MODEL = "gpt-5.4-nano"

OUT_OF_SCOPE_ANSWER = (
    "그건 제가 도와드리긴 어려워요. 저는 엔코아 AI 캠퍼스 교육 상담을 도와드리는 챗봇이거든요 🙂\n\n"
    "과정·비용·일정·선발·취업 지원 같은 건 편하게 물어봐 주세요!"
)

VERIFY_PROMPT = (
    "다음 [참고 문서]를 기준으로 [생성된 답변]을 검토하세요.\n"
    "문서에 없는 내용이나 사실과 다른 내용이 있으면 수정하세요.\n"
    "문제가 없으면 그대로 반환하세요.\n"
    "수정된 최종 답변만 출력하세요. 설명이나 주석은 달지 마세요."
)


class GraphState(TypedDict):
    query: str
    search_query: str
    context: str
    chunks: list[str]
    history: list[dict]
    draft_answer: str
    final_answer: str
    llm_cost: float
    source: str
    needs_verification: bool
    out_of_scope: bool
    channel_talk_url: str | None


def retrieve_node(state: GraphState) -> dict:
    # intent classifier가 만든 요약 쿼리가 있으면 검색에 사용, 없으면 원문.
    search_query = state.get("search_query") or state["query"]
    result = search_documents(search_query)
    # 재설계: 검색 점수가 낮아도 하드 거절하지 않는다. 핵심 사실 시트(CANONICAL_FACTS)가 시스템
    # 프롬프트에 상주하므로, LLM이 사실+상식 추론으로 답하거나(대화체·단답·추론형 질문) 모르면 프롬프트
    # 가드대로 솔직히 넘긴다. 진짜 범위 밖 질문은 라우터의 out_of_scope 핸들러가 rag 이전에 이미 걸러낸다.
    has_context = bool(result.context)
    return {
        "context": result.context,
        "chunks": result.chunks,
        "source": "document" if has_context else "ai",
        "needs_verification": has_context and result.top_score < VERIFY_THRESHOLD,
        "out_of_scope": False,
    }


def reject_node(state: GraphState) -> dict:
    return {
        "draft_answer": OUT_OF_SCOPE_ANSWER,
        "final_answer": format_chat_response(OUT_OF_SCOPE_ANSWER, max_bubbles=3),
        "llm_cost": 0.0,
    }


async def generate_node(state: GraphState) -> dict:
    answer, cost = await get_ai_response(
        state["query"],
        state["context"],
        state["history"],
        state.get("channel_talk_url"),
    )
    return {
        "draft_answer": answer,
        "final_answer": answer,
        "llm_cost": cost,
    }


async def verify_node(state: GraphState) -> dict:
    if client is None or not state["context"]:
        return {"final_answer": state["draft_answer"]}

    user_content = (
        f"{VERIFY_PROMPT}\n\n"
        f"[참고 문서]\n{state['context']}\n\n"
        f"[생성된 답변]\n{state['draft_answer']}"
    )
    try:
        response = await client.chat.completions.create(
            model=VERIFY_MODEL,
            messages=[{"role": "user", "content": user_content}],
            max_completion_tokens=1024,
        )
        verified = (response.choices[0].message.content or "").strip()
        final = format_chat_response(verified) if verified else state["draft_answer"]
    except Exception:
        final = state["draft_answer"]
    return {"final_answer": final}


def route_after_retrieve(state: GraphState) -> Literal["reject", "generate"]:
    return "reject" if state.get("out_of_scope") else "generate"


def should_verify(state: GraphState) -> Literal["verify", "__end__"]:
    return "verify" if state.get("needs_verification") else "__end__"


_builder = StateGraph(GraphState)
_builder.add_node("retrieve", retrieve_node)
_builder.add_node("reject", reject_node)
_builder.add_node("generate", generate_node)
_builder.add_node("verify", verify_node)
_builder.set_entry_point("retrieve")
_builder.add_conditional_edges("retrieve", route_after_retrieve, {"reject": "reject", "generate": "generate"})
_builder.add_edge("reject", END)
_builder.add_conditional_edges("generate", should_verify, {"verify": "verify", "__end__": END})
_builder.add_edge("verify", END)

rag_graph = _builder.compile()


async def run_rag_graph(
    query: str,
    history: list[dict],
    channel_talk_url: str | None = None,
    search_query: str | None = None,
) -> tuple[str, float, str, list[str]]:
    initial: GraphState = {
        "query": query,
        "search_query": search_query or "",
        "context": "",
        "chunks": [],
        "history": history,
        "draft_answer": "",
        "final_answer": format_chat_response(STANDARD_REFUSAL),
        "llm_cost": 0.0,
        "source": "ai",
        "needs_verification": False,
        "out_of_scope": False,
        "channel_talk_url": channel_talk_url,
    }
    result = await rag_graph.ainvoke(initial)
    return result["final_answer"], result["llm_cost"], result["source"], result["chunks"]