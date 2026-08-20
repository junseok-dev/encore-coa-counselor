from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from datetime import datetime, timezone

from openai import AsyncOpenAI

from app.config import get_settings
from app.db.database import SessionLocal
from app.db.models import ChatLog, ChatSession
from app.utils.crypto import decrypt_if_needed, maybe_encrypt


logger = logging.getLogger("app.response_review")

REVIEW_TYPES = {
    "intent_deviation",
    "context_mismatch",
    "user_complaint",
    "repeated_failure",
    "safety_failure",
}

_BOT_COMPLAINT_PATTERNS = (
    re.compile(r"(?:방금|아까|이전|지금).{0,12}(?:답변|대답).{0,12}(?:이상|틀|안 맞|엉뚱|이해 안|말이 안|못 알아)", re.I),
    re.compile(r"(?:챗봇|봇|너|답변).{0,12}(?:왜 이래|이상해|도움이 안|제대로|못 알아|말귀)", re.I),
    re.compile(r"(?:내 질문|질문).{0,10}(?:안 읽|못 알아|다르|답이 아니)", re.I),
)


@dataclass(frozen=True)
class ReviewDecision:
    needs_review: bool
    issue_type: str | None = None
    confidence: float = 0.0
    reason: str | None = None


def detect_explicit_bot_complaint(question: str) -> ReviewDecision | None:
    normalized = " ".join((question or "").split())
    if any(pattern.search(normalized) for pattern in _BOT_COMPLAINT_PATTERNS):
        return ReviewDecision(
            True,
            "user_complaint",
            0.99,
            "사용자가 챗봇의 직전 답변이 맞지 않거나 이해되지 않는다고 명시했습니다.",
        )
    return None


def parse_review_decision(payload: str) -> ReviewDecision:
    try:
        parsed = json.loads(payload or "{}")
    except (TypeError, json.JSONDecodeError):
        return ReviewDecision(False)
    issue_type = str(parsed.get("issue_type") or "").strip()
    try:
        confidence = max(0.0, min(1.0, float(parsed.get("confidence") or 0)))
    except (TypeError, ValueError):
        confidence = 0.0
    needs_review = bool(parsed.get("needs_review")) and issue_type in REVIEW_TYPES and confidence >= 0.88
    reason = re.sub(r"[\r\n\t]+", " ", str(parsed.get("reason") or "")).strip()[:240] or None
    if not needs_review:
        return ReviewDecision(False, confidence=confidence)
    return ReviewDecision(True, issue_type, confidence, reason or "답변 흐름에 즉시 확인할 문제가 감지되었습니다.")


def _build_prompt(current: ChatLog, prior_logs: list[ChatLog]) -> str:
    conversation = [
        {
            "question": decrypt_if_needed(row.question) or "",
            "answer": decrypt_if_needed(row.answer) or "",
            "source": row.source,
            "processing_status": row.processing_status,
        }
        for row in [*prior_logs, current]
    ]
    return json.dumps(conversation, ensure_ascii=False)


async def _judge_with_ai(current: ChatLog, prior_logs: list[ChatLog]) -> ReviewDecision:
    settings = get_settings()
    if not settings.openai_api_key:
        return ReviewDecision(False)
    system_prompt = """당신은 교육 상담 챗봇의 긴급 답변 품질 심사자입니다.
대화의 마지막 챗봇 답변을 검토하여 지금 운영자가 확인하지 않으면 상담 품질 문제가 이어질 가능성이 높은 경우만 표시하세요.

표시 가능한 유형:
- intent_deviation: 교육 과정 상담이라는 서비스 의도에서 벗어난 답변
- context_mismatch: 사용자의 질문 또는 앞선 맥락과 맞지 않는 답변
- user_complaint: 사용자가 챗봇 답변 자체에 불만을 표현했고 마지막 답변도 이를 충분히 해소하지 못함
- repeated_failure: 같은 질문이나 설명 요구가 반복되는데도 같은 실패가 이어짐
- safety_failure: 위험 신호를 놓쳤거나 부적절하게 대응함

다음은 표시하지 마세요.
- 정상적으로 답변된 수강 문의, 취소 또는 환불 문의
- 정책이나 과정 자체에 대한 사용자의 불만
- 적절한 안전 가드레일 차단 또는 정상적인 상담원 연결
- 단순히 더 친절하게 다듬을 수 있는 정도의 답변
- 사용자의 주제 이탈에 챗봇이 적절히 범위를 안내한 경우

애매하면 needs_review=false로 판정하세요. confidence 0.88 이상인 명확한 문제만 true입니다.
반드시 JSON만 반환하세요:
{"needs_review":false,"issue_type":"none","confidence":0.0,"reason":"짧고 구체적인 한국어 근거"}"""
    async with AsyncOpenAI(api_key=settings.openai_api_key) as client:
        response = await client.chat.completions.create(
            model=settings.intent_model_name,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": _build_prompt(current, prior_logs)},
            ],
            response_format={"type": "json_object"},
            max_completion_tokens=300,
            temperature=0,
        )
    return parse_review_decision(response.choices[0].message.content or "{}")


async def evaluate_chat_log(chat_log_id: int) -> None:
    db = SessionLocal()
    try:
        current = db.get(ChatLog, chat_log_id)
        if current is None:
            return
        session = db.get(ChatSession, current.session_id)
        if session and session.is_internal:
            current.response_review_status = "excluded"
            current.response_reviewed_at = datetime.now(timezone.utc)
            db.commit()
            return

        question = decrypt_if_needed(current.question) or ""
        decision = detect_explicit_bot_complaint(question)
        if decision is None:
            prior_logs = (
                db.query(ChatLog)
                .filter(ChatLog.session_id == current.session_id, ChatLog.id < current.id)
                .order_by(ChatLog.id.desc())
                .limit(3)
                .all()
            )
            prior_logs.reverse()
            decision = await _judge_with_ai(current, prior_logs)

        current.response_review_status = "flagged" if decision.needs_review else "clear"
        current.response_review_type = decision.issue_type
        current.response_review_reason = maybe_encrypt(decision.reason)
        current.response_review_confidence = decision.confidence
        current.response_reviewed_at = datetime.now(timezone.utc)
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("chat log response review failed: chat_log_id=%s", chat_log_id)
    finally:
        db.close()
