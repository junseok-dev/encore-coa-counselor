import unittest

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.database import Base
from app.routers import admin


class OpenAiManualCostsTest(unittest.TestCase):
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

    def test_monthly_cost_is_created_and_updated_without_duplicates(self):
        created = admin.save_manual_openai_cost(
            "2026-08",
            admin.OpenAiMonthlyCostPayload(amount_usd=21.3456789, note="first"),
            db=self.db,
            current_user="operator@example.com",
        )
        updated = admin.save_manual_openai_cost(
            "2026-08",
            admin.OpenAiMonthlyCostPayload(amount_usd=22.5, note="updated"),
            db=self.db,
            current_user="operator@example.com",
        )
        result = admin.get_manual_openai_costs("2026-08", db=self.db, _=None)

        self.assertEqual(21.345679, created["record"]["amount_usd"])
        self.assertEqual(22.5, updated["record"]["amount_usd"])
        self.assertEqual(22.5, result["total_usd"])
        self.assertEqual("updated", result["record"]["note"])
        self.assertEqual(1, len(result["monthly_history"]))

    def test_all_period_sums_monthly_records(self):
        for month, amount in (("2026-08", 10.25), ("2026-09", 11.75)):
            admin.save_manual_openai_cost(
                month,
                admin.OpenAiMonthlyCostPayload(amount_usd=amount),
                db=self.db,
                current_user="admin",
            )

        result = admin.get_manual_openai_costs("all", db=self.db, _=None)

        self.assertTrue(result["is_all_period"])
        self.assertEqual(22.0, result["total_usd"])
        self.assertIsNone(result["record"])
        self.assertEqual(2, len(result["monthly_history"]))

    def test_negative_cost_is_rejected(self):
        with self.assertRaisesRegex(Exception, "0 이상의"):
            admin.save_manual_openai_cost(
                "2026-08",
                admin.OpenAiMonthlyCostPayload(amount_usd=-1),
                db=self.db,
                current_user="admin",
            )


if __name__ == "__main__":
    unittest.main()
