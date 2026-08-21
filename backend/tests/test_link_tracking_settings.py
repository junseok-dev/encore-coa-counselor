import unittest

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.models import AppSetting
from app.services import link_tracking_settings


class LinkTrackingSettingsTest(unittest.TestCase):
    def setUp(self):
        engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        AppSetting.__table__.create(engine)
        self.session_factory = sessionmaker(bind=engine)

    def test_current_four_links_are_defaults_before_admin_saves(self):
        with self.session_factory() as db:
            links = link_tracking_settings.get_link_tracking_urls(db)

        self.assertEqual(4, len(links))
        self.assertEqual("코스 허브페이지", links[0]["label"])
        self.assertIn("utm_campaign=course", links[0]["url"])

    def test_admin_can_add_edit_and_delete_links(self):
        links = [
            {
                "label": "새 과정",
                "url": "https://encorecampus.ai/new-course?utm_source=chatbot&utm_medium=referral&utm_campaign=new-course",
            }
        ]
        with self.session_factory() as db:
            saved = link_tracking_settings.set_link_tracking_urls(db, links)
            loaded = link_tracking_settings.get_link_tracking_urls(db)

        self.assertEqual(links, saved)
        self.assertEqual(links, loaded)

    def test_invalid_host_and_duplicate_paths_are_rejected(self):
        with self.assertRaises(ValueError):
            link_tracking_settings.validate_tracking_links(
                [{"label": "외부", "url": "https://example.com/course?utm_source=chatbot"}]
            )
        with self.assertRaises(ValueError):
            link_tracking_settings.validate_tracking_links(
                [
                    {"label": "과정 A", "url": "https://encorecampus.ai/course?utm_campaign=a"},
                    {"label": "과정 B", "url": "https://encorecampus.ai/course?utm_campaign=b"},
                ]
            )


if __name__ == "__main__":
    unittest.main()
