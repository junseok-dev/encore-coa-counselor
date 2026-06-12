"""하이브리드 라우터 — "명백한 건 결정적, 애매한 건 LLM".

흐름:
  1) 결정적 패스: is_schedule_query(명백 시점), 버튼/질문 정확일치(compact==compact)
  2) LLM 라우터: handler + faq_id(의미로 선택) + search_query + slots
  3) LLM 실패/장애 → 키워드 fallback

운영(chat.py)에서 쓰되, 의존성(faqs/client/model)을 주입할 수 있어 오프라인 테스트도 가능.
기존 키워드 점수 매칭의 의미 충돌(취업↔선발)을 LLM 의미 선택으로 해소하는 게 핵심.
"""
import json
from dataclasses import dataclass, field
from typing import Optional

from app.config import get_settings
from app.services.faq_service import (
    _compact,
    _get_faq_data,
    is_guide_query,
    is_schedule_query,
    match_faq,
)

HANDLERS = (
    "greeting", "schedule", "faq", "rag",
    "cancel", "handoff", "out_of_scope", "guide",
)


@dataclass
class RouteDecision:
    handler: str
    faq_id: Optional[str] = None
    search_query: Optional[str] = None
    slots: dict = field(default_factory=dict)
    via: str = "llm"          # deterministic | llm | fallback
    confidence: float = 0.0


def _direct_faqs(faqs: list[dict]) -> list[dict]:
    return [f for f in faqs if f.get("direct_answer")]


def _valid_faq_ids(faqs: list[dict]) -> set[str]:
    return {f.get("id") for f in _direct_faqs(faqs)}


def _exact_button_faq(message: str, faqs: list[dict]) -> Optional[str]:
    """질문/alias와 compact 완전일치 → 버튼 클릭 수준의 확실한 매칭(결정적)."""
    cq = _compact(message)
    if not cq:
        return None
    for f in _direct_faqs(faqs):
        if _compact(f.get("question", "")) == cq:
            return f.get("id")
        for a in (f.get("aliases") or []):
            if _compact(a) == cq:
                return f.get("id")
    return None


ROUTER_PROMPT_TEMPLATE = """당신은 엔코아 AI 캠퍼스 챗봇의 라우터입니다.
사용자 메시지(직전 대화 맥락 포함)를 보고 어떤 처리기(handler)로 보낼지 결정하세요.

[handler 종류]
- "greeting": 단순 인사.
- "schedule": 개강/모집 '시점'을 묻는 질문(언제 개강, 다음 기수 언제 등).
- "faq": 아래 FAQ 후보 중 의미가 정확히 맞는 직접답변이 있을 때. 이때 faq_id를 채우세요.
- "rag": 과정 상세·커리큘럼·캠퍼스 위치 등 문서를 찾아 설명해야 하는데 딱 맞는 FAQ가 없을 때. search_query를 채우세요.
- "cancel": 수강 취소·환불·일정 변경을 '요청'하는 경우(정보 질문이 아니라 처리 요청).
- "handoff": 사람(상담 매니저)과 직접 상담하고 싶다는 요청. 강한 불만/항의도 여기.
- "out_of_scope": 교육과 무관(날씨·일반상식·코드 자문 등). 법률(정의·해석·적용)도 여기 — 법 내용 자체는 안내하지 않음.
- "guide": "뭘 물어볼 수 있어?"처럼 메뉴/카테고리를 묻거나, 너무 모호해 무엇을 도울지 되물어야 할 때.

[FAQ 후보 — faq일 때 이 중에서 faq_id를 고르세요. 의미가 정확히 맞지 않으면 faq 말고 rag]
{faq_list}

[출력 — 반드시 valid JSON, 다른 텍스트 금지]
{{
  "handler": "greeting|schedule|faq|rag|cancel|handoff|out_of_scope|guide",
  "faq_id": "위 후보 id 중 하나 (faq일 때만, 아니면 null)",
  "search_query": "rag일 때 검색어(맥락 반영해 재작성), 아니면 null",
  "slots": {{"course": "과정명 있으면", "campus": "캠퍼스명 있으면"}},
  "confidence": 0.0
}}

[중요 규칙]
- '취업 지원/취업 도와줘/일자리 연결/수료 후 취업' = faq_btn_005(취업지원). '선발 과정/어떻게 뽑아/들어가려면 뭐부터' = faq_btn_004(선발). 둘을 섞지 마세요.
- '취업률 몇 %/취업 퍼센트' 처럼 수치만 묻는 것 = faq_btn_002b(취업률). 그 외 '취업 지원'은 faq_btn_005.
- '교육 프로그램/과정 소개해줘, 어떤 과정 있어' = faq_btn_002(프로그램 소개). 취업률(002b)과 헷갈리지 마세요.
- '세 과정 차이/비교/뭐가 달라' = rag(문서 비교). guide가 아님.
- 'AI 오케스트레이션/머신러닝/MLOps 과정 알려줘/소개/커리큘럼/어떤 사람한테 맞아' = 직접 FAQ가 아니므로 rag(과정 상세는 문서에서). 단 '과정 일정/개강'은 schedule.
- '환불 규정/중도포기하면?/돈 돌려받아?' = 정보 질문 → faq(faq_031). '환불해줘/취소할래' = 처리 요청 → cancel.
- guide는 사용자가 "무엇을 물어볼 수 있는지(메뉴/카테고리)"를 물을 때만. 구체적 주제(과정·선발·취업·환불 등)가 조금이라도 있으면 guide로 보내지 말고 해당 faq/rag로.
- 직전 대화 맥락을 반영하세요. 예: 직전이 'AI 오케스트레이션 과정'인데 '그거 수강료는?' → rag, search_query="AI 오케스트레이션 과정 수강료", slots.course="AI 오케스트레이션".
- 직전이 개강 일정인데 '서초 캠퍼스는?' → rag, search_query="서초 캠퍼스 위치/정보", slots.campus="서초".
- 애매하면 faq로 단정하지 말고 rag 또는 guide.

[예시]
"안녕!" → {{"handler":"greeting","faq_id":null,"search_query":null,"slots":{{}},"confidence":0.95}}
"취업은 어떻게 지원해줘?" → {{"handler":"faq","faq_id":"faq_btn_005","search_query":null,"slots":{{}},"confidence":0.9}}
"AI 오케스트레이션 과정 알려줘" → {{"handler":"rag","faq_id":null,"search_query":"AI 오케스트레이션 과정 소개 커리큘럼","slots":{{"course":"AI 오케스트레이션"}},"confidence":0.85}}
"환불 규정 알려줘" → {{"handler":"faq","faq_id":"faq_031","search_query":null,"slots":{{}},"confidence":0.85}}
"환불해줘" → {{"handler":"cancel","faq_id":null,"search_query":null,"slots":{{}},"confidence":0.9}}
"상담사랑 통화할래" → {{"handler":"handoff","faq_id":null,"search_query":null,"slots":{{}},"confidence":0.95}}
"오늘 날씨 어때?" → {{"handler":"out_of_scope","faq_id":null,"search_query":null,"slots":{{}},"confidence":0.9}}
"""


def _build_prompt(faqs: list[dict]) -> str:
    lines = [
        f'- {f.get("id")}: {f.get("question", "")}  [{f.get("category", "")}]'
        for f in _direct_faqs(faqs)
    ]
    return ROUTER_PROMPT_TEMPLATE.format(faq_list="\n".join(lines))


def _format_history(history: Optional[list[dict]]) -> str:
    if not history:
        return ""
    recent = history[-4:]
    return "\n".join(f"{h.get('role', 'user')}: {h.get('content', '')}" for h in recent)


async def _route_llm(message, history, faqs, client, model) -> Optional[RouteDecision]:
    history_text = _format_history(history)
    user_content = (
        f"[직전 대화]\n{history_text}\n\n[새 메시지]\n{message}"
        if history_text else f"[메시지]\n{message}"
    )
    try:
        resp = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": _build_prompt(faqs)},
                {"role": "user", "content": user_content},
            ],
            response_format={"type": "json_object"},
            max_completion_tokens=300,
            temperature=0,
        )
    except Exception:
        return None

    raw = (resp.choices[0].message.content or "").strip()
    if not raw:
        return None
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return None

    handler = data.get("handler")
    if handler not in HANDLERS:
        return None

    faq_id = data.get("faq_id") or None
    # faq인데 유효하지 않은 id면 rag로 강등(환각 방지)
    if handler == "faq" and faq_id not in _valid_faq_ids(faqs):
        handler, faq_id = "rag", None
    if handler != "faq":
        faq_id = None

    try:
        confidence = float(data.get("confidence", 0.0))
    except (TypeError, ValueError):
        confidence = 0.0

    return RouteDecision(
        handler=handler,
        faq_id=faq_id,
        search_query=(data.get("search_query") or None),
        slots=data.get("slots") or {},
        via="llm",
        confidence=confidence,
    )


def _fallback(message: str, faqs: list[dict]) -> RouteDecision:
    """LLM 실패 시 키워드 안전망(기존 동작 근사)."""
    if is_schedule_query(message):
        return RouteDecision("schedule", via="fallback", confidence=0.5)
    matched = match_faq(message)
    if matched:
        score, faq = matched
        if faq.get("direct_answer") and score >= 10.0:
            return RouteDecision("faq", faq_id=faq.get("id"), via="fallback", confidence=0.5)
    return RouteDecision("rag", search_query=message, via="fallback", confidence=0.3)


async def route(
    message: str,
    history: Optional[list[dict]] = None,
    *,
    faqs: Optional[list[dict]] = None,
    client=None,
    model: Optional[str] = None,
) -> RouteDecision:
    """하이브리드 라우팅 결정. (guardrail은 호출 전 단계에서 별도 처리)"""
    if faqs is None:
        faqs = _get_faq_data().get("faqs", [])

    # 1) 결정적 패스
    if is_schedule_query(message):
        return RouteDecision("schedule", via="deterministic", confidence=1.0)
    exact = _exact_button_faq(message, faqs)
    if exact:
        return RouteDecision("faq", faq_id=exact, via="deterministic", confidence=1.0)

    # 2) LLM 라우터
    if client is None:
        try:
            from app.services.openai_service import client as _client
            client = _client
        except Exception:
            client = None
    if model is None:
        model = get_settings().intent_model_name

    if client is not None:
        decision = await _route_llm(message, history, faqs, client, model)
        if decision is not None:
            # 후속 답변이 메뉴(guide)로 잘못 빠지는 것 방지: 대화 맥락이 있고 명시적
            # '뭘 물어볼 수 있어?'(is_guide_query)가 아니면 guide 대신 직전 주제를 rag로 이어간다.
            # (예: 코아가 "토/일 둘 다?"라고 되물은 뒤 사용자가 "둘다 알바야"라고 답한 경우)
            if decision.handler == "guide" and history and not is_guide_query(message):
                decision.handler = "rag"
                decision.search_query = decision.search_query or message
            return decision

    # 3) 키워드 fallback
    return _fallback(message, faqs)
