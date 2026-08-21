import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.database import Base
from app.routers import admin


class SecurityVaultEnvironmentTest(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.db = sessionmaker(bind=self.engine)()
        self.temp_dir = tempfile.TemporaryDirectory()
        self.env_path = Path(self.temp_dir.name) / ".env"
        self.env_path.write_text("UNRELATED_VALUE='keep-me'\nAWS_REGION='ap-northeast-2'\n", encoding="utf-8")
        self.original_environment = {
            key: os.environ.get(key)
            for key in (
                "AWS_REGION",
                "CUSTOM_SERVICE_TOKEN",
                "ENCRYPTION_KEY",
                "JWT_SECRET",
                "ADMIN_PASSWORD",
            )
        }
        os.environ["AWS_REGION"] = "ap-northeast-2"
        self.path_patch = patch.object(admin, "ENV_PATH", self.env_path)
        self.token_patch = patch.object(admin, "_require_vault_token")
        self.path_patch.start()
        self.token_patch.start()

    def tearDown(self):
        self.token_patch.stop()
        self.path_patch.stop()
        for key, value in self.original_environment.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        admin.get_settings.cache_clear()
        self.temp_dir.cleanup()
        self.db.close()
        self.engine.dispose()

    def test_updates_and_deletes_built_in_environment_value(self):
        updated = admin.update_security_vault_environment(
            "AWS_REGION",
            admin.VaultEnvironmentPayload(label="무시되는 이름", value="us-east-1", sensitive=False),
            x_vault_token="token",
            db=self.db,
            current_user="owner@example.com",
        )

        item = next(row for row in updated["environment"] if row["key"] == "AWS_REGION")
        self.assertEqual("AWS 리전", item["label"])
        self.assertEqual("us-east-1", item["value"])
        self.assertFalse(item["custom"])
        self.assertIn("UNRELATED_VALUE='keep-me'", self.env_path.read_text(encoding="utf-8"))

        deleted = admin.delete_security_vault_environment(
            "AWS_REGION",
            x_vault_token="token",
            db=self.db,
            current_user="owner@example.com",
        )

        item = next(row for row in deleted["environment"] if row["key"] == "AWS_REGION")
        self.assertFalse(item["configured"])
        self.assertEqual("", item["value"])
        self.assertNotIn("AWS_REGION=", self.env_path.read_text(encoding="utf-8"))

    def test_creates_updates_and_removes_custom_environment_item(self):
        created = admin.create_security_vault_environment(
            admin.VaultEnvironmentCreatePayload(
                key="custom_service_token",
                label="외부 서비스 토큰",
                value="first-token",
                sensitive=False,
            ),
            x_vault_token="token",
            db=self.db,
            current_user="owner@example.com",
        )

        item = next(row for row in created["environment"] if row["key"] == "CUSTOM_SERVICE_TOKEN")
        self.assertTrue(item["custom"])
        self.assertTrue(item["sensitive"])
        self.assertEqual("first-token", item["value"])

        updated = admin.update_security_vault_environment(
            "CUSTOM_SERVICE_TOKEN",
            admin.VaultEnvironmentPayload(label="외부 API 토큰", value="second-token", sensitive=True),
            x_vault_token="token",
            db=self.db,
            current_user="owner@example.com",
        )
        item = next(row for row in updated["environment"] if row["key"] == "CUSTOM_SERVICE_TOKEN")
        self.assertEqual("외부 API 토큰", item["label"])
        self.assertEqual("second-token", item["value"])

        deleted = admin.delete_security_vault_environment(
            "CUSTOM_SERVICE_TOKEN",
            x_vault_token="token",
            db=self.db,
            current_user="owner@example.com",
        )
        self.assertFalse(any(row["key"] == "CUSTOM_SERVICE_TOKEN" for row in deleted["environment"]))
        self.assertNotIn("CUSTOM_SERVICE_TOKEN=", self.env_path.read_text(encoding="utf-8"))

    def test_protected_environment_key_cannot_be_created(self):
        with self.assertRaises(HTTPException) as context:
            admin.create_security_vault_environment(
                admin.VaultEnvironmentCreatePayload(
                    key="JWT_SECRET",
                    label="JWT",
                    value="do-not-change",
                    sensitive=True,
                ),
                x_vault_token="token",
                db=self.db,
                current_user="owner@example.com",
            )

        self.assertEqual(400, context.exception.status_code)

    def test_protected_environment_keys_are_visible_as_sensitive_built_ins(self):
        values = {
            "ENCRYPTION_KEY": "encryption-value",
            "JWT_SECRET": "jwt-value",
            "ADMIN_PASSWORD": "password-value",
        }
        os.environ.update(values)

        items = {item["key"]: item for item in admin._vault_environment_items(self.db)}

        for key, value in values.items():
            self.assertEqual(value, items[key]["value"])
            self.assertTrue(items[key]["configured"])
            self.assertTrue(items[key]["sensitive"])
            self.assertFalse(items[key]["custom"])


if __name__ == "__main__":
    unittest.main()
