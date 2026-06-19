import asyncio
import json
import re

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db.crud import get_or_create_session, save_message
from app.db.database import get_db
from app.db.models import CancelRequest, ChatLog
from app.models.chat import ChatRequest, ChatResponse, SuggestedQuestionsResponse
from app.services.document_service import search_documents
from app.services.faq_service import get_faq_answer_by_id, get_schedule_faq_answer, get_suggested_questions, is_guide_query, is_schedule_query, match_button_faq, match_faq_general, search_faq
from app.services.graph_service import OUT_OF_SCOPE_ANSWER, REJECT_THRESHOLD, run_rag_graph
from app.services.guardrail_service import check as guardrail_check
from app.services.intent_service import classify_intent
from app.services.openai_service import stream_ai_response
from app.services.router_service import route
from app.services.prompt_service import get_prompt_value
from app.services.response_formatter import apply_link_tracking, course_link_for, format_chat_response, _strip_meta_disclaimer
from app.utils.crypto import maybe_encrypt

router = APIRouter()


def _normalize_intent_text(message: str) -> str:
    return "".join((message or "").lower().split())


_CHANNEL_MARKDOWN_LINK = re.compile(
    r"\s*\[[^\]]*?(?:채널톡|상담\s*매니저\s*연결)[^\]]*?\]\([^)]+\)\s*"
)


def _sanitize_and_promote(answer: str, current_source: str) -> tuple[str, str]:
    """LLM 본문에서 채널톡 URL/마크다운 링크를 제거하고, 채널톡 안내가 있으면 source를 handoff로 승격."""
    cleaned = answer or ""
    detected = False

    if _CHANNEL_MARKDOWN_LINK.search(cleaned):
        cleaned = _CHANNEL_MARKDOWN_LINK.sub(" ", cleaned)
        detected = True

    url = (get_settings().channel_talk_url or "").strip()
    if url and url in cleaned:
        cleaned = cleaned.replace(url, "")
        detected = True

    if "채널톡" in cleaned:
        detected = True

    cleaned = re.sub(r"[ \t]+", " ", cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned).strip()

    new_source = "handoff" if detected else current_source
    return cleaned, new_source


def _clean_stream_segment(text: str) -> str:
    """스트리밍 중 한 조각(라인)에서 채널톡 마크다운 링크/URL만 제거한다.
    (채널톡 언급 감지에 따른 handoff 승격은 전체 누적 텍스트로 별도 판단)"""
    cleaned = _CHANNEL_MARKDOWN_LINK.sub(" ", text or "")
    url = (get_settings().channel_talk_url or "").strip()
    if url and url in cleaned:
        cleaned = cleaned.replace(url, "")
    cleaned = _strip_meta_disclaimer(cleaned)  # 금지된 '자료 확인 한계' 프레이밍 제거(라인 경계에서 처리)
    return apply_link_tracking(cleaned)  # encorecampus.ai 링크에 트래킹 파라미터 자동 부착(설정 시)


def _faq_answer_for(message: str) -> str | None:
    """FAQ 직접답변을 '원문' 기준으로만 매칭한다.
    의도 요약(summary)은 직전 대화 맥락이 섞여, 후속 질문(예: 개강 얘기 뒤 '서초 캠퍼스는?')을
    엉뚱한 FAQ(일정)로 끌어가 정적 답변이 반복되는 문제가 있어 직접매칭엔 쓰지 않는다.
    직접 일정 질문은 is_schedule_query가, 맥락이 필요한 후속 질문은 RAG가 summary로 검색해 LLM으로 처리한다."""
    return match_button_faq(message) or match_faq_general(message)


GREETING_ANSWER = (
    "안녕하세요!\n\n"
    "엔코아 AI 캠퍼스 상담봇 코아예요 😊 반갑습니다.\n\n"
    "**과정**, **수강 조건**, **비용**, **취업 지원**처럼 궁금한 내용을 편하게 물어봐 주세요."
)

# 어떤 라우팅 경로도 실제 텍스트를 만들지 못했을 때(빈 LLM 응답·빈 프롬프트 등)
# 빈 말풍선이 사용자에게 노출되는 것을 막는 최후 폴백.
EMPTY_FALLBACK_ANSWER = (
    "죄송해요, 방금 답변을 제대로 준비하지 못했어요. 😢\n\n"
    "질문을 조금만 바꿔서 다시 한 번 물어봐 주시겠어요? "
    "**과정·비용·일정·취업 지원** 등 무엇이든 도와드릴게요."
)


def is_greeting(message: str) -> bool:
    normalized = _normalize_intent_text(message)
    signals = ["안녕", "하이", "헬로", "반가워", "반갑", "처음뵙", "안녕하세요", "안녕하십"]
    return any(s in normalized for s in signals) and len(normalized) <= 20


def is_training_cost_query(message: str) -> bool:
    normalized = _normalize_intent_text(message)
    cost_signals = ["훈련비", "교육비", "수강료", "본인부담금", "비용", "얼마", "돈"]
    return any(signal in normalized for signal in cost_signals)


def is_intake_count_query(message: str) -> bool:
    normalized = _normalize_intent_text(message)
    count_signals = ["몇명", "몇명뽑", "모집인원", "정원", "교육생수", "수강생수", "몇자리"]
    return any(signal in normalized for signal in count_signals)


def is_employment_rate_query(message: str) -> bool:
    normalized = _normalize_intent_text(message)
    rate_signals = ["취업률", "취업율", "취업잘", "취업잘되", "취업어때", "취업은어때"]
    return any(signal in normalized for signal in rate_signals)


TRAINING_COST_ANSWER = (
    "훈련비는 본인부담금 0원으로 안내돼요.\n\n"
    "K-디지털 트레이닝 과정이라 교육비 부담 없이 참여하는 구조입니다.\n\n"
    "훈련장려금은 출석과 조건에 따라 달라질 수 있어요."
)


INTAKE_COUNT_ANSWER = (
    "과정별 정원은 30명 기준으로 안내돼요.\n\n"
    "인기 과정은 조기 마감될 수 있어서 관심 과정은 먼저 확인해보시는 게 좋아요."
)


EMPLOYMENT_RATE_ANSWER = (
    "취업률 수치는 지금 바로 확정해서 안내하긴 어려워요.\n\n"
    "대신 이력서, 포트폴리오, 면접 준비 같은 취업 지원이 함께 제공돼요.\n\n"
    "관심 과정 알려주시면 확인 가능한 자료 기준으로 더 정확히 안내드릴게요."
)


GUIDE_ANSWER = (
    "엔코아 AI 캠퍼스 상담봇 코아가 다음 카테고리의 질문을 도와드릴 수 있어요.\n\n"
    "- **인터뷰/선발**: 면접 방식, 선발 기준, 추가선발 대기 안내\n"
    "- **운영규정**: 수강 규정, 출결 기준, 수료 조건, 훈련장려금, 환불 정책\n"
    "- **과정 상세**: 커리큘럼, 교육 기간, 비용, 취업 지원, 프리코스\n"
    "- **엔코아 ai 캠퍼스 정보**: 캠퍼스 위치·운영시간, 모집 일정, 기관 소개\n\n"
    "궁금하신 내용을 구체적으로 질문해 주시면 더 정확하게 안내드릴게요!"
)


def is_handoff_request(message: str) -> bool:
    normalized = _normalize_intent_text(message)
    direct_handoff_signals = [
        # 명시적 연결 요청
        "상담연결", "상담원연결", "사람상담", "사람이랑",
        "매니저연결", "매니저에게", "매니저한테",
        "담당자연결", "담당자에게", "담당자한테",
        "직원연결", "직원에게", "직원한테",
        "문의연결",
        # 채널톡 연결 명시적 요청
        "채널톡연결", "채널톡으로연결", "채널톡으로문의", "채널톡통해",
        # 직접 문의/연락 의사
        "직접문의", "직접연락", "직접물어",
        "문의하고싶", "문의드리고싶", "문의하고싶어", "문의하려고",
        "연락하고싶", "연락드리고싶",
        "연락처", "전화번호", "이메일주소",
        # 사람과 대화 요청
        "사람과", "사람한테", "실제사람",
    ]
    return any(signal in normalized for signal in direct_handoff_signals)


def is_cancel_request(message: str) -> bool:
    normalized = _normalize_intent_text(message)

    direct_signals = [
        "취소",
        "환불",
        "환급",
        "철회",
        "해지",
        "포기",
        "그만둘래",
        "안들을래",
        "수강안할래",
        "등록취소",
        "신청취소",
        "접수취소",
        "결제취소",
        "수강취소",
        "등록철회",
        "환불문의",
        "환불요청",
        "취소요청",
        "취소문의",
    ]
    if any(signal in normalized for signal in direct_signals):
        return True

    schedule_signals = [
        "일정변경",
        "일정바꾸",
        "날짜변경",
        "날짜바꾸",
        "개강변경",
        "개강바꾸",
        "연기",
        "미루고",
        "다음기수",
        "다른기수",
        "변경하고싶",
        "바꾸고싶",
        "바꿀수있",
        "옮기고싶",
        "인터뷰시간변경",
        "인터뷰시간바꾸",
        "면접시간변경",
        "면접시간바꾸",
    ]
    if any(signal in normalized for signal in schedule_signals):
        return True

    combined_topics = ["수강", "등록", "신청", "결제", "과정", "교육", "개강", "기수", "인터뷰", "면접"]
    combined_actions = ["취소", "환불", "철회", "해지", "연기", "변경", "바꾸", "옮기", "미루"]
    return any(topic in normalized for topic in combined_topics) and any(
        action in normalized for action in combined_actions
    )


@router.post("", response_model=ChatResponse)
async def chat(request: ChatRequest, db: Session = Depends(get_db)):
    get_or_create_session(db, request.session_id, None)
    save_message(db, request.session_id, "user", request.message, source="user")

    retrieval_chunks: list[str] = []
    source = "fallback"
    answer = get_prompt_value("fallback_prompt")
    llm_cost = 0.0
    error_message = None
    processing_status = "ready"
    history = [{"role": h.role, "content": h.content} for h in request.history]

    async def _run_rag(search_query: str | None = None) -> None:
        nonlocal answer, llm_cost, source, retrieval_chunks, processing_status, error_message
        try:
            channel_talk_url = (get_settings().channel_talk_url or "").strip() or None
            answer, llm_cost, source, retrieval_chunks = await run_rag_graph(
                request.message, history, channel_talk_url, search_query=search_query
            )
            answer, source = _sanitize_and_promote(answer, source)
            if source == "handoff":
                # 답변 본문이 '채널톡' 언급으로 승격된 경우(=봇이 권유) — 사용자가 명시 요청한
                # cancel/handoff(_set_cancel/_set_handoff: "handoff")와 구분해 지표 오염을 막는다.
                processing_status = "handoff_offer"
        except Exception as exc:
            answer = get_prompt_value("fallback_prompt")
            source = "fallback"
            processing_status = "failed"
            error_message = str(exc)

    def _set_cancel() -> None:
        nonlocal answer, source, processing_status
        answer = get_prompt_value("cancel_prompt")
        source = "handoff"
        processing_status = "handoff"
        db.add(CancelRequest(session_id=request.session_id, message=request.message, status="requested"))
        db.commit()

    def _set_handoff() -> None:
        nonlocal answer, source, processing_status
        answer = get_prompt_value("handoff_prompt")
        source = "handoff"
        processing_status = "handoff"

    blocked = guardrail_check(request.message)
    if blocked:
        answer = blocked
        source = "guardrail"
    elif is_employment_rate_query(request.message):
        # 취업률은 표시·광고법 민감 영역 → LLM/RAG 우회, 확정 수치 없는 안전 답변(결정적 가드).
        answer = EMPLOYMENT_RATE_ANSWER
        source = "faq"
    else:
        # 하이브리드 라우터: 결정적(일정·버튼) + LLM(의미) 단일 결정 → handler 분기
        decision = await route(request.message, history)
        h = decision.handler
        if h == "greeting":
            answer = GREETING_ANSWER
            source = "faq"
        elif h == "schedule":
            answer = get_schedule_faq_answer() or GUIDE_ANSWER
            source = "faq"
        elif h == "faq":
            if ans := get_faq_answer_by_id(decision.faq_id):
                answer = ans
                source = "faq"
            else:  # 유효 답변 없으면 RAG로 안전 강등
                await _run_rag(search_query=decision.search_query or None)
        elif h == "cancel":
            _set_cancel()
        elif h == "handoff":
            _set_handoff()
        elif h == "out_of_scope":
            answer = OUT_OF_SCOPE_ANSWER
            source = "fallback"
        elif h == "guide":
            answer = GUIDE_ANSWER
            source = "faq"
        else:  # "rag" 및 그 외
            await _run_rag(search_query=decision.search_query or None)

    answer = format_chat_response(answer, max_bubbles=10 if source == "faq" else 8)
    # 특정 과정 질문이면 해당 과정 상세페이지 링크를 '포맷 후' 마지막에 덧붙임(말풍선 캡에 잘리지 않게). 차단만 제외.
    if source != "guardrail":
        if _cl := course_link_for(request.message, answer):
            answer = f"{answer}\n\n{apply_link_tracking(_cl)}"
    if not (answer or "").strip():
        # 빈 말풍선 방지: 어떤 경로도 실제 답변을 만들지 못하면 안전 폴백으로 대체
        if source != "handoff":
            source = "fallback"
        answer = format_chat_response(EMPTY_FALLBACK_ANSWER, max_bubbles=2)
    save_message(db, request.session_id, "assistant", answer, source=source)
    db.add(
        ChatLog(
            session_id=request.session_id,
            question=maybe_encrypt(request.message),
            retrieval_chunks=maybe_encrypt(json.dumps(retrieval_chunks, ensure_ascii=False)),
            answer=maybe_encrypt(answer),
            source=source,
            error=maybe_encrypt(error_message),
            processing_status=processing_status,
            embedding_cost=0.0,
            llm_cost=llm_cost,
        )
    )
    db.commit()

    handoff_url: str | None = None
    if source == "handoff":
        url = get_settings().channel_talk_url
        handoff_url = url if url else None

    return ChatResponse(
        answer=answer,
        source=source,
        session_id=request.session_id,
        handoff_url=handoff_url,
    )


@router.post("/stream")
async def chat_stream(request: ChatRequest, db: Session = Depends(get_db)):
    get_or_create_session(db, request.session_id, None)
    save_message(db, request.session_id, "user", request.message, source="user")
    db.commit()

    async def generate():
        source = "fallback"
        full_answer = ""
        error_message = None
        processing_status = "ready"
        retrieval_chunks: list[str] = []
        history = [{"role": h.role, "content": h.content} for h in request.history]

        def _sse(data: dict) -> str:
            return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"

        async def _stream_static(text: str, max_bubbles: int = 8):
            nonlocal full_answer
            full_answer = format_chat_response(text, max_bubbles=max_bubbles)
            bubbles = full_answer.split("\n\n")
            for bubble_index, bubble in enumerate(bubbles):
                if bubble_index > 0:
                    yield _sse({"token": "\n\n"})
                    await asyncio.sleep(1.0)
                yield _sse({"token": bubble})

        async def _stream_rag(search_query: str | None = None):
            nonlocal full_answer, source, retrieval_chunks, processing_status, error_message
            channel_talk_url = (get_settings().channel_talk_url or "").strip() or None
            try:
                # 검색 + reject 판단을 먼저 수행 (여기서 막히면 LLM 호출/스트리밍 없음)
                result = search_documents(search_query or request.message)
                retrieval_chunks = result.chunks
                if (not result.context) or (result.top_score < REJECT_THRESHOLD):
                    source = "fallback"
                    async for chunk in _stream_static(OUT_OF_SCOPE_ANSWER, max_bubbles=3):
                        yield chunk
                    return

                # 통과 → LLM 토큰을 실시간 스트리밍. 라인 경계에서 채널톡 링크를 정화 후 전송.
                # (verify 재검증은 이미 보낸 토큰을 되돌릴 수 없어 스트리밍 경로에서는 생략)
                source = "document"
                pending = ""
                async for delta in stream_ai_response(request.message, result.context, history, channel_talk_url):
                    pending += delta
                    while "\n" in pending:
                        line, pending = pending.split("\n", 1)
                        seg = _clean_stream_segment(line) + "\n"
                        full_answer += seg
                        yield _sse({"token": seg})
                if pending:
                    seg = _clean_stream_segment(pending)
                    full_answer += seg
                    yield _sse({"token": seg})

                full_answer = full_answer.strip()
                # 본문에 채널톡 언급이 있으면 상담 매니저 연결(handoff)로 승격 → 버튼 노출.
                # 단 사용자가 명시 요청한 cancel/handoff("handoff")와 구분해 지표 오염 방지("handoff_offer").
                if "채널톡" in full_answer or _CHANNEL_MARKDOWN_LINK.search(full_answer):
                    source = "handoff"
                    processing_status = "handoff_offer"
            except Exception as exc:
                fallback = get_prompt_value("fallback_prompt")
                source = "fallback"
                processing_status = "failed"
                error_message = str(exc)
                full_answer = ""
                async for chunk in _stream_static(fallback):
                    yield chunk

        def _set_cancel_db() -> None:
            db.add(CancelRequest(session_id=request.session_id, message=request.message, status="requested"))
            db.commit()

        blocked = guardrail_check(request.message)
        if blocked:
            source = "guardrail"
            async for chunk in _stream_static(blocked):
                yield chunk
        elif is_employment_rate_query(request.message):
            # 취업률은 표시·광고법 민감 영역 → LLM/RAG 우회, 확정 수치 없는 안전 답변(결정적 가드).
            source = "faq"
            async for chunk in _stream_static(EMPLOYMENT_RATE_ANSWER, max_bubbles=10):
                yield chunk
        else:
            # 하이브리드 라우터: 결정적(일정·버튼) + LLM(의미) 단일 결정 → handler 분기
            decision = await route(request.message, history)
            h = decision.handler
            if h == "greeting":
                source = "faq"
                async for chunk in _stream_static(GREETING_ANSWER):
                    yield chunk
            elif h == "schedule":
                source = "faq"
                async for chunk in _stream_static(get_schedule_faq_answer() or GUIDE_ANSWER, max_bubbles=10):
                    yield chunk
            elif h == "faq":
                if ans := get_faq_answer_by_id(decision.faq_id):
                    source = "faq"
                    async for chunk in _stream_static(ans, max_bubbles=10):
                        yield chunk
                else:  # 유효 답변 없으면 RAG로 안전 강등
                    async for chunk in _stream_rag(search_query=decision.search_query or None):
                        yield chunk
            elif h == "cancel":
                source = "handoff"
                processing_status = "handoff"
                _set_cancel_db()
                async for chunk in _stream_static(get_prompt_value("cancel_prompt")):
                    yield chunk
            elif h == "handoff":
                source = "handoff"
                processing_status = "handoff"
                async for chunk in _stream_static(get_prompt_value("handoff_prompt")):
                    yield chunk
            elif h == "out_of_scope":
                source = "fallback"
                async for chunk in _stream_static(OUT_OF_SCOPE_ANSWER, max_bubbles=3):
                    yield chunk
            elif h == "guide":
                source = "faq"
                async for chunk in _stream_static(GUIDE_ANSWER, max_bubbles=10):
                    yield chunk
            else:  # "rag" 및 그 외
                async for chunk in _stream_rag(search_query=decision.search_query or None):
                    yield chunk

        # 특정 과정 질문이면 해당 과정 상세페이지 링크를 마지막에 덧붙임(핸들러 무관, 결정적). 차단/범위밖만 제외.
        if source != "guardrail":
            if _cl := course_link_for(request.message, full_answer):
                seg = "\n\n" + apply_link_tracking(_cl)
                full_answer += seg
                yield _sse({"token": seg})

        # 빈 말풍선 방지: 어떤 경로도 실제 텍스트를 만들지 못했으면 안전 폴백을 스트리밍한다.
        # (RAG LLM이 빈 응답을 주거나 프롬프트 값이 비어 있는 경우 등)
        if not (full_answer or "").strip():
            if source != "handoff":
                source = "fallback"
            async for chunk in _stream_static(EMPTY_FALLBACK_ANSWER, max_bubbles=2):
                yield chunk

        handoff_url: str | None = None
        if source == "handoff":
            url = get_settings().channel_talk_url
            handoff_url = url if url else None

        yield _sse({"done": True, "source": source, "handoff_url": handoff_url})

        save_message(db, request.session_id, "assistant", full_answer, source=source)
        db.add(
            ChatLog(
                session_id=request.session_id,
                question=maybe_encrypt(request.message),
                retrieval_chunks=maybe_encrypt(json.dumps(retrieval_chunks, ensure_ascii=False)),
                answer=maybe_encrypt(full_answer),
                source=source,
                error=maybe_encrypt(error_message),
                processing_status=processing_status,
                embedding_cost=0.0,
                llm_cost=0.0,
            )
        )
        db.commit()

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/suggested", response_model=SuggestedQuestionsResponse)
def get_suggested():
    return SuggestedQuestionsResponse(questions=get_suggested_questions())
