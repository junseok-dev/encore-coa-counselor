import unittest
from types import SimpleNamespace
from unittest.mock import patch

from cryptography.fernet import Fernet
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.database import Base
from app.db import migrations
from app.db import crud
from app.db.models import (
    CancelRequest,
    ChatLog,
    ChatMessage,
    ChatSession,
    ChunkRecord,
    DocumentRecord,
    FaqRecord,
    PromptConfig,
)
from app.routers import admin
from app.utils import crypto


class EncryptionScopeTest(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.session_factory = sessionmaker(bind=self.engine)
        self.db = self.session_factory()
        self.key = Fernet.generate_key().decode()
        self.settings = SimpleNamespace(encryption_key=self.key)

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def test_only_conversation_plaintext_is_bulk_encrypted(self):
        self.db.add_all([
            ChatSession(id="session-1", encrypted_user_name="홍길동", message_count=1),
            ChatMessage(session_id="session-1", role="user", content="상담 메시지", source="document"),
            ChatLog(session_id="session-1", question="질문", answer="답변"),
            CancelRequest(session_id="session-1", message="취소 요청", status="requested"),
        ])
        self.db.commit()

        before = admin.get_encryption_settings(self.db, None)["categories"][0]
        self.assertEqual(5, before["plain_count"])
        self.assertEqual(0, before["encrypted_count"])

        with patch.object(crypto, "get_settings", return_value=self.settings):
            result = admin.migrate_encryption(
                admin.EncryptionMigrateRequest(category="conversation", direction="encrypt"),
                self.db,
                None,
            )

        self.assertEqual(5, result["count"])
        after = admin.get_encryption_settings(self.db, None)["categories"][0]
        self.assertEqual(0, after["plain_count"])
        self.assertEqual(5, after["encrypted_count"])

        with self.assertRaises(HTTPException) as context:
            admin.migrate_encryption(
                admin.EncryptionMigrateRequest(category="conversation", direction="decrypt"),
                self.db,
                None,
            )
        self.assertEqual(400, context.exception.status_code)

    def test_new_session_and_messages_are_encrypted_on_write(self):
        with patch.object(crypto, "get_settings", return_value=self.settings):
            session = crud.create_session(self.db, "session-new", "operator-user")
            message = crud.save_message(
                self.db,
                "session-new",
                "user",
                "private conversation",
                "user",
            )

        self.assertTrue(session.encrypted_user_name.startswith(crypto.ENCRYPTED_PREFIX))
        self.assertTrue(message.content.startswith(crypto.ENCRYPTED_PREFIX))
        with patch.object(crypto, "get_settings", return_value=self.settings):
            self.assertEqual("operator-user", crypto.decrypt_if_needed(session.encrypted_user_name))
            self.assertEqual("private conversation", crypto.decrypt_if_needed(message.content))

    def test_legacy_non_conversation_ciphertext_is_decrypted_but_chat_stays_encrypted(self):
        with patch.object(crypto, "get_settings", return_value=self.settings):
            encrypted = crypto.encrypt("운영 데이터")
            encrypted_chat = crypto.encrypt("대화 데이터")

        self.db.add_all([
            FaqRecord(
                faq_key="faq-1",
                category=encrypted,
                question=encrypted,
                answer=encrypted,
                keywords_json="[]",
                aliases_json="[]",
                search_hints_json="[]",
                source_files_json="[]",
            ),
            PromptConfig(prompt_key="prompt-1", label="프롬프트", content=encrypted),
            DocumentRecord(
                logical_name="document-1",
                version=1,
                original_filename=encrypted,
                review_note=encrypted,
            ),
            ChunkRecord(document_id=1, chunk_index=0, content=encrypted, metadata_json=encrypted),
            ChatMessage(session_id="session-1", role="user", content=encrypted_chat, source="document"),
        ])
        self.db.commit()

        with (
            patch.object(migrations, "get_settings", return_value=self.settings),
            patch.object(crypto, "get_settings", return_value=self.settings),
        ):
            migrations._decrypt_non_conversation_content(self.engine)

        self.db.expire_all()
        self.assertEqual("운영 데이터", self.db.query(FaqRecord).one().answer)
        self.assertEqual("운영 데이터", self.db.query(PromptConfig).one().content)
        self.assertEqual("운영 데이터", self.db.query(DocumentRecord).one().original_filename)
        self.assertEqual("운영 데이터", self.db.query(DocumentRecord).one().review_note)
        self.assertEqual("운영 데이터", self.db.query(ChunkRecord).one().content)
        self.assertEqual(encrypted_chat, self.db.query(ChatMessage).one().content)


if __name__ == "__main__":
    unittest.main()
