import unittest
from types import SimpleNamespace
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.models import AppSetting
from app.services import channel_talk_settings


class ChannelTalkSettingsTest(unittest.TestCase):
    def setUp(self):
        engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        AppSetting.__table__.create(engine)
        self.session_factory = sessionmaker(bind=engine)

    def test_environment_value_is_used_before_admin_saves_setting(self):
        with (
            self.session_factory() as db,
            patch.object(
                channel_talk_settings,
                "get_settings",
                return_value=SimpleNamespace(channel_talk_url="https://example.channel.io/fallback"),
            ),
        ):
            self.assertEqual(
                "https://example.channel.io/fallback",
                channel_talk_settings.get_channel_talk_url(db),
            )

    def test_saved_database_value_takes_precedence(self):
        with self.session_factory() as db:
            channel_talk_settings.set_channel_talk_url(db, "https://example.channel.io/current")
            with patch.object(
                channel_talk_settings,
                "get_settings",
                return_value=SimpleNamespace(channel_talk_url="https://example.channel.io/fallback"),
            ):
                self.assertEqual(
                    "https://example.channel.io/current",
                    channel_talk_settings.get_channel_talk_url(db),
                )

    def test_saved_blank_disables_link_instead_of_restoring_fallback(self):
        with self.session_factory() as db:
            channel_talk_settings.set_channel_talk_url(db, "")
            with patch.object(
                channel_talk_settings,
                "get_settings",
                return_value=SimpleNamespace(channel_talk_url="https://example.channel.io/fallback"),
            ):
                self.assertEqual("", channel_talk_settings.get_channel_talk_url(db))

    def test_only_valid_https_urls_are_accepted(self):
        invalid_values = [
            "http://example.channel.io/path",
            "javascript:alert(1)",
            "https://",
            "https://example.channel.io/a path",
        ]
        for value in invalid_values:
            with self.subTest(value=value):
                with self.assertRaises(ValueError):
                    channel_talk_settings.normalize_channel_talk_url(value)

    def test_initial_url_is_seeded_only_when_setting_is_missing(self):
        with self.session_factory() as db:
            self.assertTrue(channel_talk_settings.seed_initial_channel_talk_url(db))
            self.assertEqual(
                "https://encoreaicampus.channel.io/home",
                channel_talk_settings.get_channel_talk_url(db),
            )

            channel_talk_settings.set_channel_talk_url(db, "https://example.channel.io/replaced")
            self.assertFalse(channel_talk_settings.seed_initial_channel_talk_url(db))
            self.assertEqual(
                "https://example.channel.io/replaced",
                channel_talk_settings.get_channel_talk_url(db),
            )


if __name__ == "__main__":
    unittest.main()
