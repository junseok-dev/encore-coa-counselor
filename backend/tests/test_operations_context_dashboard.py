import unittest
from datetime import date, datetime, timedelta

from fastapi import HTTPException
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.database import Base
from app.db.migrations import migrate_database
from app.db.models import ChatLog, ChatSession, CourseLinkEvent, InternalAnalyticsClient, OperationsAlert
from app.routers import admin, chat


class OperationsContextDashboardTest(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.db = sessionmaker(bind=self.engine)()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def test_analytics_counts_course_interest_by_session_context_and_real_link_click(self):
        created_at = datetime(2026, 8, 19, 10, 0)
        self.db.add(ChatSession(id="course-session", message_count=2, created_at=created_at))
        self.db.add_all([
            ChatLog(
                session_id="course-session",
                question="비전공자도 머신러닝 과정을 수강할 수 있나요?",
                answer="지원 자격과 과정을 안내해 드릴게요.",
                source="document",
                processing_status="ready",
                question_category="admission",
                question_category_label="지원 자격·선발",
                question_category_source="rule",
                created_at=created_at,
            ),
            ChatLog(
                session_id="course-session",
                question="상담 연결은 하지 않을게요.",
                answer="과정 정보만 확인하셔도 됩니다.",
                source="faq",
                processing_status="ready",
                question_category="counseling",
                question_category_label="상담·문의 연결",
                question_category_source="rule",
                created_at=created_at + timedelta(minutes=2),
            ),
        ])
        self.db.add(CourseLinkEvent(
            session_id="course-session",
            url="https://encorecampus.ai/ml",
            course_slug="ml",
            created_at=created_at + timedelta(minutes=3),
        ))
        self.db.commit()

        result = admin.get_operations_analytics(
            selected_year=None,
            selected_month=None,
            period_mode="day",
            anchor_date=date(2026, 8, 19),
            db=self.db,
            _=None,
        )

        self.assertEqual(1, result["period_summary"]["course_inquiries"])
        self.assertEqual(1, result["period_summary"]["course_page_views"])
        self.assertEqual(0, result["period_summary"]["handoffs"])

        reviewed_log = self.db.query(ChatLog).filter_by(session_id="course-session").first()
        self.db.add(OperationsAlert(
            chat_log_id=reviewed_log.id,
            session_id=reviewed_log.session_id,
            signal_type="quality",
            severity="medium",
            reason="관리자가 선택한 답변 개선 검토",
            status="open",
        ))
        self.db.commit()
        dashboard = admin.get_operations_dashboard(days=30, attention_limit=500, db=self.db, _=None)
        signal_types = {item["type"] for item in dashboard["attention"]}
        self.assertNotIn("enrollment", signal_types)
        self.assertIn("quality", signal_types)

    def test_internal_admin_and_test_sessions_are_excluded_everywhere(self):
        created_at = datetime(2026, 8, 19, 11, 0)
        self.db.add_all([
            ChatSession(id="public-session", message_count=1, is_internal=False, created_at=created_at),
            ChatSession(id="internal-session", message_count=1, is_internal=True, created_at=created_at),
        ])
        self.db.add_all([
            ChatLog(
                session_id="public-session",
                question="머신러닝 과정이 궁금해요",
                answer="과정을 안내합니다.",
                source="document",
                processing_status="ready",
                question_category="curriculum",
                created_at=created_at,
            ),
            ChatLog(
                session_id="internal-session",
                question="환불 테스트 중 오류",
                answer="안전 안내",
                source="guardrail",
                processing_status="failed",
                error="test error",
                question_category="cancel",
                created_at=created_at,
            ),
        ])
        self.db.commit()

        analytics = admin.get_operations_analytics(
            selected_year=None,
            selected_month=None,
            period_mode="day",
            anchor_date=date(2026, 8, 19),
            db=self.db,
            _=None,
        )
        dashboard = admin.get_operations_dashboard(days=30, attention_limit=500, db=self.db, _=None)

        self.assertEqual(1, analytics["period_summary"]["visitors"])
        self.assertEqual(1, analytics["period_summary"]["chats"])
        self.assertEqual(0, analytics["period_summary"]["safety"])
        self.assertNotIn("internal-session", {item["session_id"] for item in dashboard["attention"]})

    def test_admin_can_mark_existing_browser_sessions_internal(self):
        self.db.add(ChatSession(id="my-old-chat", message_count=1, is_internal=False))
        self.db.commit()

        result = admin.mark_internal_sessions(
            admin.InternalSessionsRequest(session_ids=["my-old-chat", "missing"]),
            self.db,
            "admin@example.com",
        )

        self.assertEqual(1, result["updated"])
        self.assertTrue(self.db.get(ChatSession, "my-old-chat").is_internal)
        self.assertTrue(chat._is_internal_session("test-dashboard"))
        self.assertFalse(chat._is_internal_session("normal-session"))

    def test_registered_admin_browser_is_permanently_separated(self):
        client_id = "browser-client-1234"
        self.db.add(ChatSession(
            id="before-admin-login",
            analytics_client_id=client_id,
            message_count=1,
            is_internal=False,
        ))
        self.db.add(ChatLog(
            session_id="before-admin-login",
            question="test question",
            answer="test answer",
            source="document",
            processing_status="ready",
        ))
        self.db.commit()

        result = admin.register_internal_analytics_client(
            admin.InternalAnalyticsClientRequest(
                client_id=client_id,
                session_ids=[],
            ),
            self.db,
            "admin@example.com",
        )

        self.assertTrue(result["registered"])
        self.assertEqual(1, result["updated"])
        self.assertIsNotNone(self.db.get(InternalAnalyticsClient, client_id))
        self.assertTrue(self.db.get(ChatSession, "before-admin-login").is_internal)
        self.assertEqual([], admin._filter_chat_logs(self.db))
        sessions = admin.list_sessions(
            page=1,
            page_size=20,
            start_date=None,
            end_date=None,
            db=self.db,
            _=None,
        )
        self.assertEqual([], sessions.sessions)

        future_session = ChatSession(id="after-admin-login", message_count=0, is_internal=False)
        self.db.add(future_session)
        self.db.commit()
        chat._sync_session_analytics_scope(self.db, future_session, client_id)
        self.assertTrue(future_session.is_internal)
        self.assertEqual(client_id, future_session.analytics_client_id)

    def test_only_failed_safety_handling_and_errors_stay_in_review_until_resolved(self):
        old_at = datetime.now() - timedelta(days=365)
        self.db.add(ChatSession(id="old-risk", message_count=2, created_at=old_at))
        self.db.add_all([
            ChatLog(
                session_id="old-risk",
                question="위험한 질문",
                answer="안전 안내",
                source="guardrail",
                processing_status="ready",
                created_at=old_at,
            ),
            ChatLog(
                session_id="old-risk",
                question="위험 신호가 포함된 질문",
                answer="부적절한 답변",
                source="document",
                processing_status="ready",
                response_review_status="flagged",
                response_review_type="safety_failure",
                response_review_reason="위험 신호를 놓치고 일반 답변을 제공했습니다.",
                response_review_confidence=0.97,
                created_at=old_at + timedelta(seconds=30),
            ),
            ChatLog(
                session_id="old-risk",
                question="과정 신청 중 오류가 났어요",
                answer="다시 시도해 주세요.",
                source="fallback",
                processing_status="failed",
                error="generation failed",
                created_at=old_at + timedelta(minutes=1),
            ),
        ])
        self.db.commit()

        result = admin.get_operations_dashboard(days=7, attention_limit=500, db=self.db, _=None)

        self.assertEqual({"safety_failure", "error"}, {item["type"] for item in result["attention"]})
        self.assertTrue(all(item["status"] == "open" for item in result["attention"]))

        safety_alert = self.db.query(OperationsAlert).filter_by(signal_type="safety_failure").one()
        safety_alert.status = "resolved"
        self.db.commit()
        refreshed = admin.get_operations_dashboard(days=7, attention_limit=500, db=self.db, _=None)
        resolved = next(item for item in refreshed["attention"] if item["type"] == "safety_failure")
        self.assertEqual("resolved", resolved["status"])

    def test_normal_cancel_refund_and_guardrail_are_not_improvement_items(self):
        created_at = datetime.now()
        self.db.add(ChatSession(id="normal-operations", message_count=3, created_at=created_at))
        self.db.add_all([
            ChatLog(
                session_id="normal-operations",
                question="수강 취소 방법을 알려주세요",
                answer="취소 접수 방법을 안내해 드릴게요.",
                source="handoff",
                processing_status="handoff",
                created_at=created_at,
            ),
            ChatLog(
                session_id="normal-operations",
                question="위험한 요청",
                answer="도와드릴 수 없는 요청입니다.",
                source="guardrail",
                processing_status="ready",
                created_at=created_at + timedelta(minutes=1),
            ),
        ])
        self.db.commit()

        result = admin.get_operations_dashboard(days=7, attention_limit=500, db=self.db, _=None)

        self.assertEqual([], result["attention"])

    def test_review_ignores_historical_logs_but_includes_new_logs(self):
        created_at = datetime.now()
        self.db.add_all([
            ChatSession(id="historical-review", message_count=1, created_at=created_at),
            ChatSession(id="new-review", message_count=1, created_at=created_at),
            ChatLog(
                session_id="historical-review",
                question="과거 처리 오류",
                answer="다시 시도해 주세요.",
                source="fallback",
                processing_status="failed",
                error="historical failure",
                review_eligible=False,
                created_at=created_at,
            ),
            ChatLog(
                session_id="new-review",
                question="신규 처리 오류",
                answer="다시 시도해 주세요.",
                source="fallback",
                processing_status="failed",
                error="new failure",
                created_at=created_at,
            ),
        ])
        self.db.commit()

        result = admin.get_operations_dashboard(days=7, attention_limit=500, db=self.db, _=None)

        self.assertEqual({"new-review"}, {item["session_id"] for item in result["attention"]})
        new_log = self.db.query(ChatLog).filter_by(session_id="new-review").one()
        self.assertTrue(new_log.review_eligible)

    def test_course_link_event_only_accepts_campus_domain(self):
        result = chat.record_course_link_event(
            chat.CourseLinkEventRequest(session_id="session-1", url="https://encorecampus.ai/orchestration"),
            self.db,
        )
        self.assertTrue(result["recorded"])
        with self.assertRaises(HTTPException):
            chat.record_course_link_event(
                chat.CourseLinkEventRequest(session_id="session-1", url="https://example.com/course"),
                self.db,
            )

    def test_legacy_chat_sessions_gain_internal_analytics_flag(self):
        legacy_engine = create_engine("sqlite://", poolclass=StaticPool)
        with legacy_engine.begin() as connection:
            connection.execute(text("CREATE TABLE chat_sessions (id VARCHAR(64) PRIMARY KEY, message_count INTEGER)"))
        migrate_database(legacy_engine)
        columns = {column["name"] for column in inspect(legacy_engine).get_columns("chat_sessions")}
        self.assertIn("is_internal", columns)
        self.assertIn("analytics_client_id", columns)
        legacy_engine.dispose()

    def test_legacy_chat_logs_gain_response_review_columns(self):
        legacy_engine = create_engine("sqlite://", poolclass=StaticPool)
        with legacy_engine.begin() as connection:
            connection.execute(text("CREATE TABLE chat_logs (id INTEGER PRIMARY KEY)"))
            connection.execute(text("INSERT INTO chat_logs (id) VALUES (1)"))
        migrate_database(legacy_engine)
        columns = {column["name"] for column in inspect(legacy_engine).get_columns("chat_logs")}
        self.assertTrue({
            "response_review_status",
            "response_review_type",
            "response_review_reason",
            "response_review_confidence",
            "response_reviewed_at",
            "review_eligible",
        }.issubset(columns))
        with legacy_engine.connect() as connection:
            historical_review_eligible = connection.execute(
                text("SELECT review_eligible FROM chat_logs WHERE id = 1")
            ).scalar_one()
        self.assertFalse(bool(historical_review_eligible))
        legacy_engine.dispose()


if __name__ == "__main__":
    unittest.main()
