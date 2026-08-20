import asyncio
import json
import unittest
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.database import Base
from app.db.models import ChatLog, ChatSession
from app.services.response_review_service import (
    detect_explicit_bot_complaint,
    evaluate_chat_log,
    parse_review_decision,
)


class ResponseReviewServiceTest(unittest.TestCase):
    def test_explicit_chatbot_answer_complaint_is_flagged(self):
        decision = detect_explicit_bot_complaint("방금 답변이 제 질문과 전혀 안 맞아요")

        self.assertIsNotNone(decision)
        self.assertTrue(decision.needs_review)
        self.assertEqual("user_complaint", decision.issue_type)

    def test_course_policy_complaint_is_not_treated_as_bot_complaint(self):
        self.assertIsNone(detect_explicit_bot_complaint("환불 정책이 너무 불합리해요"))

    def test_ai_result_requires_supported_type_and_high_confidence(self):
        low = parse_review_decision(json.dumps({
            "needs_review": True,
            "issue_type": "context_mismatch",
            "confidence": 0.7,
            "reason": "질문과 답변이 다름",
        }))
        unknown = parse_review_decision(json.dumps({
            "needs_review": True,
            "issue_type": "normal_refund",
            "confidence": 0.99,
            "reason": "정상 환불 문의",
        }))
        flagged = parse_review_decision(json.dumps({
            "needs_review": True,
            "issue_type": "repeated_failure",
            "confidence": 0.94,
            "reason": "같은 질문에 같은 무관한 답변이 반복됨",
        }))

        self.assertFalse(low.needs_review)
        self.assertFalse(unknown.needs_review)
        self.assertTrue(flagged.needs_review)
        self.assertEqual("repeated_failure", flagged.issue_type)

    def test_evaluation_persists_explicit_complaint_decision(self):
        engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(engine)
        local_session = sessionmaker(bind=engine)
        db = local_session()
        db.add(ChatSession(id="public-review", message_count=1, is_internal=False))
        row = ChatLog(
            session_id="public-review",
            question="방금 답변이 제 질문과 안 맞아요",
            answer="다시 설명해 드릴게요.",
            source="faq",
            processing_status="ready",
        )
        db.add(row)
        db.commit()
        row_id = row.id
        db.close()

        with patch("app.services.response_review_service.SessionLocal", local_session):
            asyncio.run(evaluate_chat_log(row_id))

        verify_db = local_session()
        reviewed = verify_db.get(ChatLog, row_id)
        self.assertEqual("flagged", reviewed.response_review_status)
        self.assertEqual("user_complaint", reviewed.response_review_type)
        verify_db.close()
        engine.dispose()


if __name__ == "__main__":
    unittest.main()
