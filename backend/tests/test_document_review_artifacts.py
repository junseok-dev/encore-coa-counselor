import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException
from langchain_core.documents import Document
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.database import Base
from app.db.models import DocumentRecord, FaqRecord
from app.routers import admin
from app.services.transformation_service import (
    convert_markdown_to_faq_items_with_report,
    validate_faq_items,
)


class DocumentReviewArtifactTest(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.session_factory = sessionmaker(bind=self.engine)
        self.db = self.session_factory()
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)

    def tearDown(self):
        self.db.close()
        self.engine.dispose()
        self.temp_dir.cleanup()

    def _create_faq_document(self) -> DocumentRecord:
        md_path = self.root / "faq.md"
        json_path = self.root / "faq.json"
        md_path.write_text("# 신청 방법\n\n온라인 신청 페이지에서 접수합니다.", encoding="utf-8")
        json_path.write_text(
            json.dumps(
                [{"id": "apply", "category": "입과", "question": "어떻게 신청하나요?", "answer": "온라인으로 신청합니다."}],
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        record = DocumentRecord(
            logical_name="faq",
            version=1,
            original_filename="faq.md",
            md_path=str(md_path),
            json_path=str(json_path),
            parser_type="faq_json",
            status="review",
            is_active=False,
            is_deleted=False,
        )
        self.db.add(record)
        self.db.commit()
        self.db.refresh(record)
        return record

    def test_faq_validation_rejects_duplicate_ids_and_missing_answers(self):
        with self.assertRaisesRegex(ValueError, "중복된 FAQ id"):
            validate_faq_items([
                {"id": "same", "question": "질문 1", "answer": "답변 1"},
                {"id": "same", "question": "질문 2", "answer": "답변 2"},
            ])

        with self.assertRaisesRegex(ValueError, "answer"):
            validate_faq_items([{"id": "missing", "question": "질문"}])

    def test_artifact_route_validates_and_persists_operator_edits(self):
        record = self._create_faq_document()
        payload = [
            {
                "id": "apply",
                "category": "입과",
                "question": "신청은 어디서 하나요?",
                "answer": "공식 신청 페이지에서 접수합니다.",
                "top_k": 5,
            }
        ]
        with patch("app.services.admin_service.upload_text_to_s3", return_value=None):
            result = admin.update_document_artifacts_route(
                record.id,
                admin.DocumentArtifactUpdateRequest(
                    md_content="# 신청 방법\n\n공식 신청 페이지에서 접수합니다.",
                    json_content=json.dumps(payload, ensure_ascii=False),
                ),
                self.db,
                None,
            )

        saved = json.loads(result["json_content"])
        self.assertEqual("신청은 어디서 하나요?", saved[0]["question"])
        self.assertEqual(5, saved[0]["top_k"])
        self.assertEqual("review", result["document"]["status"])

    def test_editing_an_active_faq_document_removes_old_faq_from_live_index(self):
        record = self._create_faq_document()
        record.status = "ready"
        record.is_active = True
        self.db.add(FaqRecord(
            faq_key="apply",
            category="입과",
            question="기존 질문",
            answer="기존 답변",
            is_active=True,
            top_k=4,
        ))
        self.db.commit()

        replacement = [{"id": "apply-new", "question": "새 질문", "answer": "새 답변"}]
        with (
            patch("app.services.admin_service.upload_text_to_s3", return_value=None),
            patch("app.services.admin_service.sync_faqs_to_file") as sync_mock,
            patch("app.services.admin_service.full_reindex") as reindex_mock,
        ):
            admin.update_document_artifacts_route(
                record.id,
                admin.DocumentArtifactUpdateRequest(
                    md_content="# 새 질문\n\n새 답변입니다.",
                    json_content=json.dumps(replacement, ensure_ascii=False),
                ),
                self.db,
                None,
            )

        old_faq = self.db.query(FaqRecord).filter(FaqRecord.faq_key == "apply").one()
        self.assertFalse(old_faq.is_active)
        sync_mock.assert_called_once_with(self.db)
        reindex_mock.assert_called_once_with(self.db)

    def test_artifact_route_reports_json_line_and_column(self):
        record = self._create_faq_document()
        with patch("app.services.admin_service.upload_text_to_s3", return_value=None):
            with self.assertRaises(HTTPException) as context:
                admin.update_document_artifacts_route(
                    record.id,
                    admin.DocumentArtifactUpdateRequest(md_content="정상 MD", json_content="[{]"),
                    self.db,
                    None,
                )

        self.assertEqual(400, context.exception.status_code)
        self.assertIn("줄 1", context.exception.detail)

    def test_normal_document_edit_rebuilds_review_artifacts(self):
        md_path = self.root / "guide.md"
        json_path = self.root / "guide.json"
        md_path.write_text("기존 문서 내용입니다. 충분한 길이의 기존 문서 본문입니다.", encoding="utf-8")
        json_path.write_text(
            json.dumps({"title": "운영 안내", "category": "운영", "chunk_count": 1}, ensure_ascii=False),
            encoding="utf-8",
        )
        record = DocumentRecord(
            logical_name="guide",
            version=1,
            original_filename="guide.md",
            md_path=str(md_path),
            json_path=str(json_path),
            parser_type="markdown",
            status="review",
            is_active=False,
            is_deleted=False,
        )
        self.db.add(record)
        self.db.commit()
        self.db.refresh(record)

        class FakeRag:
            @staticmethod
            def build_chunks_for_markdown(content, metadata):
                return [Document(page_content=content, metadata=metadata)]

            @staticmethod
            def replace_document_chunks(db, document_id, chunks):
                return None

        patches = [
            patch("app.services.admin_service.get_rag_service", return_value=FakeRag()),
            patch("app.services.admin_service.upload_text_to_s3", return_value=None),
            patch("app.services.admin_service.MANAGED_CHUNKS_DIR", self.root / "chunks"),
            patch("app.services.admin_service.MANAGED_EMBEDDINGS_DIR", self.root / "embeddings"),
        ]
        for item in patches:
            item.start()
        try:
            result = admin.update_document_artifacts_route(
                record.id,
                admin.DocumentArtifactUpdateRequest(
                    md_content="# 변경된 운영 안내\n\n운영자가 검토하고 수정한 최신 본문입니다."
                ),
                self.db,
                None,
            )
        finally:
            for item in reversed(patches):
                item.stop()

        metadata = json.loads(result["json_content"])
        self.assertEqual(1, result["chunk_count"])
        self.assertEqual("운영 안내", metadata["title"])
        self.assertEqual("review", metadata["status"])
        self.assertIn("변경된 운영 안내", result["md_content"])

    def test_pdf_endpoint_returns_original_file(self):
        pdf_path = self.root / "original.pdf"
        pdf_path.write_bytes(b"%PDF-1.4 test")
        record = DocumentRecord(
            logical_name="original",
            version=1,
            original_filename="원본.pdf",
            pdf_path=str(pdf_path),
            status="review",
            is_active=False,
            is_deleted=False,
        )
        self.db.add(record)
        self.db.commit()
        self.db.refresh(record)

        response = admin.get_document_pdf(record.id, self.db, None)

        self.assertEqual(b"%PDF-1.4 test", response.body)
        self.assertEqual("application/pdf", response.media_type)

    def test_conversion_report_discloses_fallback(self):
        settings = SimpleNamespace(openai_api_key="", model_name="unused")
        with patch("app.services.transformation_service.get_settings", return_value=settings):
            result = asyncio.run(convert_markdown_to_faq_items_with_report("# 신청 방법\n\n온라인으로 신청합니다."))

        self.assertEqual("fallback", result["method"])
        self.assertTrue(result["warnings"])
        self.assertTrue(result["items"])


if __name__ == "__main__":
    unittest.main()
