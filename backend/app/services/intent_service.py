import json
from dataclasses import dataclass
from typing import Literal, Optional

from langsmith import traceable

from app.config import get_settings
from app.services.openai_service import client

IntentLabel = Literal["greeting", "cancel", "handoff", "guide", "specific", "out_of_scope"]
_VALID_INTENTS: tuple[IntentLabel, ...] = (
    "greeting",
    "cancel",
    "handoff",
    "guide",
    "specific",
    "out_of_scope",
)

INTENT_PROMPT = """당신은 엔코아 AI 캠퍼스 챗봇의 라우터입니다.
사용자 메시지(직전 대화 맥락 포함)를 보고 의도를 분류하고, "specific"일 때는 핵심 질문을 한 줄로 요약하세요.

[의도 카테고리]
- "greeting": 인사 (안녕, 하이, 처음 봬요 등).
- "cancel": 수강 취소·환불 요청·일정 변경·인터뷰/면접 시간 변경 같은 명시적 요청.
- "handoff": 상담 매니저/사람과 직접 상담하고 싶다는 명시 요청 (상담원 연결, 사람한테 물어볼래 등).
- "guide": "뭘 물어볼 수 있어?", "어떤 카테고리 있어?"처럼 **무엇을 물어볼 수 있는지(메뉴·카테고리)**를 묻는 요청만 해당. '교육 프로그램/과정을 소개해 주세요', '커리큘럼 알려줘'처럼 실제 내용을 소개·설명해 달라는 요청은 guide가 아니라 specific.
- "specific": 엔코아 AI 캠퍼스 교육·과정·운영규정·캠퍼스·취업·비용·일정 등에 대한 구체적 질문.
- "out_of_scope": 교육과 무관한 영역 (법률 자문, 일반 상식, 외부 컨설팅·코드 자문, 다른 도메인 서비스 등). **법률(개인정보보호법·표시광고법 등)의 정의·내용·해석·적용을 묻는 질문**(예: "허위광고란 뭐야?", "개인정보 보관기간 지나면?")도 여기에 포함 — 법 내용 자체는 안내하지 않는다.

[출력 — 반드시 valid JSON, 다른 텍스트 절대 금지]
{
  "intent": "greeting|cancel|handoff|guide|specific|out_of_scope",
  "summary": "specific일 때만 핵심 질문 한 줄. 다른 intent는 빈 문자열.",
  "confidence": 0.0-1.0
}

[중요 규칙]
- summary는 RAG 검색에 사용됩니다. 노이즈 빼고 검색에 잘 걸리는 키워드 중심으로 정리하세요.
- 직전 대화에서 맥락이 있으면 반영. 예: 이전에 "멀티 에이전트 AI 오케스트레이션 캠프" 얘기 중인데 "기간 얼마야?"라면 summary = "멀티 에이전트 AI 오케스트레이션 캠프 기간".
- "환불 받고 싶어요" → cancel. "환불 정책은 어떻게 돼?" → specific (정책 정보 질문).
- 한 메시지에 cancel + specific이 섞이면 cancel 우선 (사람 상담 필요).
- "안녕? 비용 알려줘"처럼 인사+질문이면 → specific (실제 질문 처리가 우선).

[예시]
"안녕!" → {"intent":"greeting","summary":"","confidence":0.95}
"환불받고 싶어요" → {"intent":"cancel","summary":"","confidence":0.92}
"수강료 얼마야?" → {"intent":"specific","summary":"수강료 비용","confidence":0.9}
"동작·서초·g벨리 캠퍼스 과정 뭐 있어?" → {"intent":"specific","summary":"캠퍼스별 과정 종류","confidence":0.9}
"엔코아 AI 캠퍼스 정보 뭐 물어보면 돼?" → {"intent":"guide","summary":"","confidence":0.9}
"교육 프로그램을 소개해 주세요" → {"intent":"specific","summary":"교육 프로그램 과정 소개","confidence":0.9}
"상담원이랑 직접 통화하고 싶어" → {"intent":"handoff","summary":"","confidence":0.95}
"파이썬 코드 짜줘" → {"intent":"out_of_scope","summary":"","confidence":0.9}
"허위·과장 광고란 뭐예요?" → {"intent":"out_of_scope","summary":"","confidence":0.92}
"개인정보 보관 기간이 지나면 어떻게 처리해?" → {"intent":"out_of_scope","summary":"","confidence":0.9}
"""


@dataclass
class IntentResult:
    intent: IntentLabel
    summary: str
    confidence: float


def _format_history(history: list[dict] | None) -> str:
    if not history:
        return ""
    # 최근 4개만 사용 (토큰 절약). user/assistant 외 role은 그대로 표시.
    recent = history[-4:]
    lines = [f"{item.get('role', 'user')}: {item.get('content', '')}" for item in recent]
    return "\n".join(lines)


@traceable(name="의도 분류", run_type="llm")
async def classify_intent(message: str, history: list[dict] | None = None) -> Optional[IntentResult]:
    """LLM 기반 의도 분류 + 질문 요약.

    실패 시 (client 없음 / API 오류 / JSON 파싱 실패 / 알 수 없는 intent) None 반환.
    호출자는 None일 때 기존 키워드 dispatcher로 fallback해야 한다.
    """
    if client is None or not message.strip():
        return None

    history_text = _format_history(history)
    user_content = (
        f"[직전 대화]\n{history_text}\n\n[새 메시지]\n{message}"
        if history_text
        else f"[메시지]\n{message}"
    )

    try:
        response = await client.chat.completions.create(
            model=get_settings().intent_model_name,
            messages=[
                {"role": "system", "content": INTENT_PROMPT},
                {"role": "user", "content": user_content},
            ],
            response_format={"type": "json_object"},
            max_completion_tokens=200,
            temperature=0,  # 결정적 분류 — 같은 질문이 매번 같은 의도로 가도록(라우팅 흔들림 방지)
        )
    except Exception:
        return None

    raw = (response.choices[0].message.content or "").strip()
    if not raw:
        return None

    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return None

    intent = data.get("intent")
    if intent not in _VALID_INTENTS:
        return None

    summary = (data.get("summary") or "").strip()
    try:
        confidence = float(data.get("confidence", 0.0))
    except (TypeError, ValueError):
        confidence = 0.0

    return IntentResult(intent=intent, summary=summary, confidence=confidence)
