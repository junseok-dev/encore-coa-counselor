import json
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.database import Base
from app.db.migrations import migrate_database
from app.db.models import ChatLog, ChatMessage, ChatSession, OperationsAiMessage, OperationsAlert, PromptConfig, PromptVersion
from app.routers import admin
from app.services import openai_service
from app.services.admin_ai_service import _parse_json_object
from app.services.prompt_service import RESPONSE_IMPROVEMENT_PROMPT_KEY, get_response_improvement_prompt, seed_prompt_configs


class AdminAiWorkflowTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.session_factory = sessionmaker(bind=self.engine)
        self.db = self.session_factory()
        seed_prompt_configs(self.db)
        self.db.add(ChatSession(id="session-1", message_count=2))
        self.db.add_all([
            ChatMessage(session_id="session-1", role="user", content="과정 추천해줘", source="user"),
            ChatMessage(session_id="session-1", role="assistant", content="상담원에게 문의하세요", source="handoff"),
        ])
        chat_log = ChatLog(
            session_id="session-1",
            question="과정 추천해줘",
            answer="상담원에게 문의하세요",
            source="handoff",
            processing_status="handoff",
        )
        self.db.add(chat_log)
        self.db.flush()
        self.alert = OperationsAlert(
            chat_log_id=chat_log.id,
            session_id="session-1",
            signal_type="quality",
            severity="medium",
            reason="답변이 원하는 방향과 다름",
            status="open",
        )
        self.db.add(self.alert)
        self.db.commit()
        self.db.refresh(self.alert)

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    async def test_ai_suggestion_draft_preview_publish_and_rollback(self):
        suggestion = {
            "reply": "상담 연결 전에 확인 가능한 과정 정보를 먼저 안내하는 것이 좋습니다.",
            "root_cause": "prompt",
            "confidence": 0.91,
            "summary": "상담 연결을 너무 일찍 선택했습니다.",
            "recommendation": "확인 가능한 과정 정보를 먼저 답하세요.",
            "expected_answer": "현재 확인 가능한 과정부터 안내해 드릴게요.",
            "target_prompt": RESPONSE_IMPROVEMENT_PROMPT_KEY,
            "suggested_prompt": "과정 정보를 먼저 답한 뒤 필요한 경우에만 상담 연결을 제안하세요.",
            "test_questions": ["과정 추천해줘"],
        }
        with (
            patch.object(admin, "analyze_improvement_case", new=AsyncMock(return_value=suggestion)),
            patch.object(admin, "maybe_encrypt", side_effect=lambda value: value),
        ):
            result = await admin.assist_operations_alert(
                self.alert.id,
                admin.OperationsAiAssistRequest(message="원인을 분석해줘"),
                self.db,
                "admin@example.com",
            )
        self.assertEqual("prompt", result["root_cause"])
        self.assertEqual(2, self.db.query(OperationsAiMessage).filter_by(alert_id=self.alert.id).count())
        assistant_message = self.db.query(OperationsAiMessage).filter_by(
            alert_id=self.alert.id,
            role="assistant",
        ).one()
        self.assertIn("현재 확인 가능한 과정부터 안내해 드릴게요.", assistant_message.content)

        draft = suggestion["suggested_prompt"]
        admin.save_operations_prompt_draft(
            self.alert.id,
            admin.OperationsPromptDraftRequest(content=draft),
            self.db,
            "admin@example.com",
        )

        observed_override = []

        async def fake_preview(*_args, **_kwargs):
            observed_override.append(get_response_improvement_prompt())
            return SimpleNamespace(answer="과정 정보를 먼저 안내합니다.", source="ai")

        with patch.object(admin, "run_chat_preview", side_effect=fake_preview):
            preview = await admin.preview_operations_prompt(
                self.alert.id,
                admin.OperationsPromptPreviewRequest(question="과정 추천해줘", content=draft),
                self.db,
                "admin@example.com",
            )
        self.assertEqual([draft], observed_override)
        self.assertEqual("상담원에게 문의하세요", preview["before"]["answer"])
        self.assertEqual("과정 정보를 먼저 안내합니다.", preview["after"]["answer"])

        initial_published = self.db.query(PromptVersion).filter_by(
            prompt_key=RESPONSE_IMPROVEMENT_PROMPT_KEY,
            status="published",
        ).one()
        published = admin.publish_operations_prompt(
            self.alert.id,
            admin.OperationsPromptPublishRequest(change_reason="품질 개선"),
            self.db,
            "admin@example.com",
        )
        self.assertEqual(draft, published["prompt"]["content"])
        self.assertEqual("archived", self.db.get(PromptVersion, initial_published.id).status)

        restored = admin.rollback_prompt_version(
            RESPONSE_IMPROVEMENT_PROMPT_KEY,
            initial_published.id,
            self.db,
            "admin@example.com",
        )
        self.assertEqual(initial_published.content, restored["prompt"]["content"])
        self.assertEqual("published", restored["version"]["status"])

    def test_manual_quality_review_is_idempotent(self):
        other_log = ChatLog(
            session_id="session-1",
            question="질문",
            answer="이상한 답변",
            source="ai",
            processing_status="ready",
        )
        self.db.add(other_log)
        self.db.commit()
        self.db.refresh(other_log)

        first = admin.create_manual_operations_review(
            other_log.id,
            admin.ManualOperationsReviewRequest(),
            self.db,
            "admin@example.com",
        )
        second = admin.create_manual_operations_review(
            other_log.id,
            admin.ManualOperationsReviewRequest(),
            self.db,
            "admin@example.com",
        )

        self.assertIn("등록했습니다", first["message"])
        self.assertIn("이미", second["message"])
        self.assertEqual(1, self.db.query(OperationsAlert).filter_by(chat_log_id=other_log.id).count())

    def test_admin_ai_follow_up_can_return_a_customer_facing_answer(self):
        result = _parse_json_object(json.dumps({
            "reply": "네. 고객에게는 아래처럼 답하면 됩니다.",
            "root_cause": "retrieval",
            "confidence": 0.86,
            "summary": "예약 지식이 검색되지 않았습니다.",
            "recommendation": "예약 정책 문서를 보강하세요.",
            "expected_answer": "현재 선택 가능한 방문 일정이 보이지 않는 상태군요. 다음 일정은 확인 후 안내드리겠습니다.",
            "target_prompt": "",
            "suggested_prompt": "이 값은 안전하게 무시되어야 합니다.",
            "test_questions": ["예약 가능한 날짜가 없어요"],
        }, ensure_ascii=False))

        self.assertEqual("네. 고객에게는 아래처럼 답하면 됩니다.", result["reply"])
        self.assertIn("방문 일정", result["expected_answer"])
        self.assertEqual("", result["target_prompt"])
        self.assertEqual("", result["suggested_prompt"])

    def test_publish_requires_preview_of_the_current_draft(self):
        admin.save_operations_prompt_draft(
            self.alert.id,
            admin.OperationsPromptDraftRequest(content="새 운영 지침"),
            self.db,
            "admin@example.com",
        )

        with self.assertRaises(HTTPException) as context:
            admin.publish_operations_prompt(
                self.alert.id,
                admin.OperationsPromptPublishRequest(change_reason="미리보기 없음"),
                self.db,
                "admin@example.com",
            )

        self.assertEqual(400, context.exception.status_code)
        self.assertIn("변경 전·후", context.exception.detail)


class AdminAiMigrationTest(unittest.TestCase):
    def test_existing_operations_alerts_get_prompt_workspace_columns(self):
        engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        with engine.begin() as connection:
            connection.execute(text("CREATE TABLE operations_alerts (id INTEGER PRIMARY KEY)"))

        migrate_database(engine)

        columns = {column["name"] for column in inspect(engine).get_columns("operations_alerts")}
        self.assertTrue({
            "draft_prompt_key",
            "draft_prompt_content",
            "draft_updated_by",
            "draft_updated_at",
            "draft_preview_hash",
            "draft_previewed_at",
            "published_prompt_version_id",
        }.issubset(columns))
        engine.dispose()

    def test_live_response_prompt_combines_protected_rules_and_operator_guidance(self):
        with patch.object(openai_service, "get_response_improvement_prompt", return_value="과정 정보를 먼저 답하세요."):
            system_prompt = openai_service._response_system_prompt()

        self.assertIn("보호된 기본 상담·안전 규칙", system_prompt)
        self.assertIn("보호된 핵심 사실", system_prompt)
        self.assertIn("과정 정보를 먼저 답하세요.", system_prompt)


if __name__ == "__main__":
    unittest.main()
