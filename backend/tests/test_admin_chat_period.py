import unittest
from datetime import date, datetime, timezone

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.database import Base
from app.db.models import ChatLog, ChatSession
from app.routers import admin


class AdminChatPeriodTest(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.session_factory = sessionmaker(bind=self.engine)
        self.db = self.session_factory()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def test_period_uses_korea_calendar_day_for_sessions_and_logs(self):
        timestamps = {
            "before": datetime(2026, 8, 18, 14, 59, tzinfo=timezone.utc),
            "start": datetime(2026, 8, 18, 15, 0, tzinfo=timezone.utc),
            "end": datetime(2026, 8, 19, 14, 59, tzinfo=timezone.utc),
            "after": datetime(2026, 8, 19, 15, 0, tzinfo=timezone.utc),
        }
        for label, created_at in timestamps.items():
            self.db.add(ChatSession(id=label, message_count=1, created_at=created_at))
            self.db.add(
                ChatLog(
                    session_id=label,
                    question=f"question-{label}",
                    answer=f"answer-{label}",
                    source="faq",
                    created_at=created_at,
                )
            )
        self.db.commit()

        selected_day = date(2026, 8, 19)
        session_result = admin.list_sessions(1, 20, selected_day, selected_day, self.db, None)
        log_result = admin.list_chat_logs(selected_day, selected_day, None, self.db, None)

        self.assertEqual({"start", "end"}, {item.id for item in session_result.sessions})
        self.assertEqual({"start", "end"}, {item["session_id"] for item in log_result["chat_logs"]})

    def test_sessions_are_paginated_with_total_and_last_page(self):
        for index in range(25):
            self.db.add(
                ChatSession(
                    id=f"session-{index:02d}",
                    message_count=index,
                    created_at=datetime(2026, 8, 1, 0, index, tzinfo=timezone.utc),
                )
            )
        self.db.commit()

        result = admin.list_sessions(3, 10, None, None, self.db, None)

        self.assertEqual(25, result.total)
        self.assertEqual(3, result.total_pages)
        self.assertEqual(3, result.page)
        self.assertEqual(5, len(result.sessions))
        self.assertEqual("session-04", result.sessions[0].id)

    def test_rejects_an_inverted_period(self):
        with self.assertRaises(HTTPException) as context:
            admin.list_sessions(1, 20, date(2026, 8, 20), date(2026, 8, 19), self.db, None)

        self.assertEqual(400, context.exception.status_code)


if __name__ == "__main__":
    unittest.main()
