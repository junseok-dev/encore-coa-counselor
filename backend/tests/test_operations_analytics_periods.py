import unittest
from datetime import date, datetime

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.database import Base
from app.db.models import BillingDailyCostRecord, CancelRequest, ChatLog, ChatSession
from app.routers import admin


class OperationsAnalyticsPeriodTest(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.db = sessionmaker(bind=self.engine)()
        created_at = datetime(2026, 8, 19, 14, 0)
        self.db.add(ChatSession(id="session-period", message_count=3, created_at=created_at))
        self.db.add_all([
            ChatLog(
                session_id="session-period",
                question="상담사와 연결해줘",
                answer="상담을 연결합니다.",
                source="handoff",
                processing_status="handoff",
                embedding_cost=0.001,
                llm_cost=0.009,
                created_at=created_at,
            ),
            ChatLog(
                session_id="session-period",
                question="예약 가능한 날짜가 없어요",
                answer="상담 연결을 원하시면 알려주세요.",
                source="ai",
                processing_status="handoff_offer",
                embedding_cost=0.002,
                llm_cost=0.008,
                created_at=datetime(2026, 8, 19, 15, 0),
            ),
            ChatLog(
                session_id="session-period",
                question="홈페이지 주소 알려줘",
                answer="홈페이지 안내",
                source="faq",
                processing_status="ready",
                embedding_cost=0.001,
                llm_cost=0,
                created_at=datetime(2026, 8, 19, 16, 0),
            ),
        ])
        self.db.add(CancelRequest(
            session_id="session-period",
            message="수강 취소 요청",
            status="requested",
            created_at=datetime(2026, 8, 19, 17, 0),
        ))
        self.db.add(BillingDailyCostRecord(
            usage_date=date(2026, 8, 19),
            account_id="account-1",
            account_name="AWS",
            service_name="EC2",
            amount_krw=12000,
        ))
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def analytics(self, period_mode: str):
        return admin.get_operations_analytics(
            selected_year=None,
            selected_month=None,
            period_mode=period_mode,
            anchor_date=date(2026, 8, 19),
            db=self.db,
            _=None,
        )

    def test_week_period_splits_connection_and_consultation_request(self):
        result = self.analytics("week")

        self.assertEqual("2026-08-17", result["period_start"])
        self.assertEqual("2026-08-23", result["period_end"])
        self.assertEqual(7, len(result["daily"]))
        self.assertEqual(1, result["period_summary"]["visitors"])
        self.assertEqual(3, result["period_summary"]["chats"])
        self.assertEqual(1, result["period_summary"]["handoffs"])
        self.assertEqual(1, result["period_summary"]["consultation_requests"])
        self.assertEqual(1, result["period_summary"]["cancels"])
        self.assertEqual(12000, result["cost_summary"]["aws_cost_krw"])
        self.assertAlmostEqual(0.021, result["cost_summary"]["openai_estimated_usd"])

    def test_day_period_returns_hourly_signal_metrics(self):
        result = self.analytics("day")

        self.assertEqual(24, len(result["hourly"]))
        self.assertEqual(1, result["hourly"][14]["handoffs"])
        self.assertEqual(1, result["hourly"][15]["consultation_requests"])
        self.assertEqual(1, result["hourly"][17]["cancels"])
        self.assertEqual(12000, result["daily"][0]["aws_cost_krw"])

    def test_year_period_returns_twelve_months(self):
        result = self.analytics("year")

        self.assertEqual(12, len(result["monthly"]))
        self.assertIn(2026, result["available_years"])
        self.assertIn(date.today().year, result["available_years"])
        self.assertIn(date.today().year + 1, result["available_years"])
        august = result["monthly"][7]
        self.assertEqual("2026-08", august["month"])
        self.assertEqual(3, august["chats"])
        self.assertEqual(12000, august["aws_cost_krw"])


if __name__ == "__main__":
    unittest.main()
