import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.database import Base
from app.db.migrations import migrate_database
from app.db.models import AdminAuditLog, ChunkRecord, DocumentRecord, FaqRecord, ProcessingLog
from app.services import admin_service


class DocumentPermanentDeleteTest(unittest.TestCase):
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

    def test_permanent_delete_removes_assets_rows_and_rebuilds_index(self):
        with tempfile.TemporaryDirectory() as directory:
            paths = []
            for filename in ("source.pdf", "converted.md", "data.json", "chunks.json", "embedding.json"):
                path = Path(directory) / filename
                path.write_text("test", encoding="utf-8")
                paths.append(path)

            document = DocumentRecord(
                logical_name="delete-target",
                version=1,
                original_filename="source.pdf",
                pdf_path=str(paths[0]),
                md_path=str(paths[1]),
                json_path=str(paths[2]),
                chunk_path=str(paths[3]),
                embedding_path=str(paths[4]),
                status="deleted",
                is_active=False,
                is_deleted=True,
            )
            self.db.add(document)
            self.db.commit()
            self.db.refresh(document)
            document_id = document.id
            self.db.add_all(
                [
                    ChunkRecord(document_id=document_id, chunk_index=0, content="chunk"),
                    ProcessingLog(
                        document_id=document_id,
                        log_type="document",
                        status="deleted",
                        message="soft deleted",
                    ),
                ]
            )
            self.db.commit()

            admin_service.hard_delete_document(self.db, document)

            self.assertEqual(0, self.db.query(DocumentRecord).filter_by(id=document_id).count())
            self.assertEqual(0, self.db.query(ChunkRecord).filter_by(document_id=document_id).count())
            self.assertEqual(0, self.db.query(ProcessingLog).filter_by(document_id=document_id).count())
            self.assertEqual(
                1,
                self.db.query(AdminAuditLog)
                .filter_by(action="document_permanently_deleted", target_id=str(document_id))
                .count(),
            )
            self.assertTrue(all(not path.exists() for path in paths))

    def test_permanent_delete_requires_soft_deleted_document(self):
        document = DocumentRecord(
            logical_name="active-document",
            version=1,
            original_filename="active.md",
            status="review",
            is_active=False,
            is_deleted=False,
        )
        self.db.add(document)
        self.db.commit()

        with self.assertRaisesRegex(ValueError, "삭제 상태"):
            admin_service.hard_delete_document(self.db, document)

        self.assertEqual(1, self.db.query(DocumentRecord).filter_by(id=document.id).count())

    def test_restore_returns_document_to_state_before_soft_delete(self):
        document = DocumentRecord(
            logical_name="ready-document",
            version=1,
            original_filename="ready.md",
            status="ready",
            is_active=True,
            is_deleted=False,
            review_note="approved note",
        )
        self.db.add(document)
        self.db.commit()

        with patch.object(admin_service, "full_reindex"):
            admin_service.soft_delete_document(self.db, document, "delete note")

        self.assertTrue(document.is_deleted)
        self.assertEqual("ready", document.pre_delete_status)
        self.assertTrue(document.pre_delete_is_active)
        self.assertEqual("approved note", document.pre_delete_review_note)

        with patch.object(admin_service, "full_reindex") as reindex:
            restored = admin_service.restore_document(self.db, document)

        self.assertFalse(restored.is_deleted)
        self.assertEqual("ready", restored.status)
        self.assertTrue(restored.is_active)
        self.assertEqual("approved note", restored.review_note)
        self.assertIsNone(restored.pre_delete_status)
        self.assertIsNone(restored.pre_delete_is_active)
        self.assertIsNone(restored.pre_delete_review_note)
        reindex.assert_called_once_with(self.db)

    def test_permanent_delete_removes_faq_rows_created_from_document(self):
        with tempfile.TemporaryDirectory() as directory:
            json_path = Path(directory) / "faq.json"
            json_path.write_text('[{"id": "faq-from-document"}]', encoding="utf-8")
            document = DocumentRecord(
                logical_name="faq-document",
                version=1,
                original_filename="faq.md",
                json_path=str(json_path),
                parser_type="faq_json",
                status="deleted",
                is_active=False,
                is_deleted=True,
            )
            self.db.add_all(
                [
                    document,
                    FaqRecord(
                        faq_key="faq-from-document",
                        category="test",
                        question="question",
                        answer="answer",
                        keywords_json="[]",
                        aliases_json="[]",
                        search_hints_json="[]",
                        source_files_json="[]",
                        is_active=False,
                    ),
                ]
            )
            self.db.commit()

            with patch.object(admin_service, "sync_faqs_to_file") as sync_faqs:
                admin_service.hard_delete_document(self.db, document)

            self.assertEqual(0, self.db.query(FaqRecord).filter_by(faq_key="faq-from-document").count())
            self.assertFalse(json_path.exists())
            sync_faqs.assert_called_once_with(self.db)

    def test_migration_adds_restore_state_columns_to_existing_documents_table(self):
        legacy_engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        try:
            with legacy_engine.begin() as connection:
                connection.execute(
                    text(
                        "CREATE TABLE documents ("
                        "id INTEGER PRIMARY KEY, "
                        "original_filename TEXT NOT NULL, "
                        "is_deleted BOOLEAN NOT NULL DEFAULT FALSE"
                        ")"
                    )
                )

            migrate_database(legacy_engine)

            columns = {column["name"] for column in inspect(legacy_engine).get_columns("documents")}
            self.assertTrue(
                {"pre_delete_status", "pre_delete_is_active", "pre_delete_review_note"}.issubset(columns)
            )
        finally:
            legacy_engine.dispose()

    def test_approval_rejects_document_that_is_not_waiting_for_review(self):
        document = DocumentRecord(
            logical_name="failed-document",
            version=1,
            original_filename="failed.pdf",
            status="failed",
            is_active=False,
            is_deleted=False,
        )
        self.db.add(document)
        self.db.commit()

        with self.assertRaisesRegex(ValueError, "검토 대기 상태"):
            admin_service.approve_document(self.db, document)

        self.assertEqual("failed", document.status)
        self.assertFalse(document.is_active)


if __name__ == "__main__":
    unittest.main()
