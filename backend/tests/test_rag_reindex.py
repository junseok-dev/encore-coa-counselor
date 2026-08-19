import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException
from langchain_core.embeddings import Embeddings
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.database import Base
from app.db.models import DocumentRecord
from app.routers import admin
from app.services import rag_service, storage_service


class DeterministicEmbeddings(Embeddings):
    def __init__(self):
        self.document_calls = 0

    @staticmethod
    def _vector(text: str) -> list[float]:
        values = [0.0] * 8
        for index, char in enumerate(text):
            values[index % len(values)] += (ord(char) % 97) / 97.0
        return values

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        self.document_calls += 1
        return [self._vector(text) for text in texts]

    def embed_query(self, text: str) -> list[float]:
        return self._vector(text)


class RagReindexTest(unittest.TestCase):
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
        self.index_dir = self.root / "faiss_index"
        self.index_patches = [
            patch.object(rag_service, "FAISS_DIR", self.index_dir),
            patch.object(storage_service, "FAISS_DIR", self.index_dir),
            patch.object(rag_service, "upload_faiss_to_s3", return_value=None),
        ]
        for item in self.index_patches:
            item.start()

    def tearDown(self):
        for item in reversed(self.index_patches):
            item.stop()
        self.db.close()
        self.engine.dispose()
        self.temp_dir.cleanup()

    def _service(self) -> rag_service.RAGService:
        service = rag_service.RAGService(api_key="")
        service._embeddings = DeterministicEmbeddings()
        return service

    def test_reindex_builds_persists_and_reloads_verified_vectors(self):
        md_path = self.root / "guide.md"
        md_path.write_text(
            "# 수강 신청 안내\n\n수강 신청은 공식 홈페이지의 과정 상세 페이지에서 진행합니다. "
            "지원서를 제출한 뒤 담당자의 안내에 따라 다음 절차를 진행해 주세요.",
            encoding="utf-8",
        )
        self.db.add(DocumentRecord(
            logical_name="guide",
            version=1,
            original_filename="guide.md",
            md_path=str(md_path),
            parser_type="markdown",
            status="ready",
            is_active=True,
            is_deleted=False,
        ))
        self.db.commit()

        service = self._service()
        result = service.index_all(self.db)

        self.assertEqual(1, result["document_count"])
        self.assertEqual(result["chunk_count"], result["vector_count"])
        self.assertGreater(result["vector_count"], 0)
        self.assertTrue((self.index_dir / "index.faiss").is_file())
        self.assertTrue((self.index_dir / "index.pkl").is_file())
        self.assertTrue((self.index_dir / "manifest.json").is_file())
        self.assertIn("수강 신청", service.search("수강 신청 방법", top_k=1))

    def test_unreadable_active_document_keeps_existing_index_files(self):
        self.index_dir.mkdir(parents=True)
        (self.index_dir / "index.faiss").write_bytes(b"existing-faiss")
        (self.index_dir / "index.pkl").write_bytes(b"existing-pickle")
        self.db.add(DocumentRecord(
            logical_name="missing",
            version=1,
            original_filename="missing.md",
            md_path=str(self.root / "missing.md"),
            parser_type="markdown",
            status="ready",
            is_active=True,
            is_deleted=False,
        ))
        self.db.commit()

        service = self._service()
        with self.assertRaisesRegex(RuntimeError, "기존 인덱스를 유지"):
            service.index_all(self.db)

        self.assertEqual(b"existing-faiss", (self.index_dir / "index.faiss").read_bytes())
        self.assertEqual(b"existing-pickle", (self.index_dir / "index.pkl").read_bytes())

    def test_other_worker_reloads_when_manifest_version_changes(self):
        md_path = self.root / "worker-guide.md"
        md_path.write_text(
            "# 기존 안내\n\n기존 과정 안내를 확인하는 테스트 문서입니다. "
            "검색 인덱스의 워커 갱신 여부를 확인하기 위해 충분한 길이로 작성합니다.",
            encoding="utf-8",
        )
        self.db.add(DocumentRecord(
            logical_name="worker-guide",
            version=1,
            original_filename="worker-guide.md",
            md_path=str(md_path),
            parser_type="markdown",
            status="ready",
            is_active=True,
            is_deleted=False,
        ))
        self.db.commit()

        builder = self._service()
        builder.index_all(self.db)
        other_worker = self._service()
        self.assertIn("기존 안내", other_worker.search("기존 안내", top_k=1))

        md_path.write_text(
            "# 변경된 장학 안내\n\n장학 지원 절차가 새롭게 변경되었습니다. "
            "운영 인덱스 버전 교체 후 다른 워커도 이 최신 문장을 읽어야 합니다.",
            encoding="utf-8",
        )
        builder.index_all(self.db)

        self.assertIn("변경된 장학 안내", other_worker.search("변경된 장학 안내", top_k=1))

    def test_missing_embedding_configuration_is_an_explicit_error(self):
        service = rag_service.RAGService(api_key="")

        with self.assertRaisesRegex(RuntimeError, "API 키"):
            service.index_all(self.db)

    def test_unchanged_corpus_is_previewed_and_skipped_without_embedding_cost(self):
        md_path = self.root / "unchanged.md"
        md_path.write_text(
            "# 변경 없는 안내\n\n승인된 내용이 이전과 같다면 임베딩을 다시 호출하지 않아야 합니다. "
            "실수로 버튼을 눌러도 비용이 발생하지 않는지 확인합니다.",
            encoding="utf-8",
        )
        self.db.add(DocumentRecord(
            logical_name="unchanged",
            version=1,
            original_filename="unchanged.md",
            md_path=str(md_path),
            parser_type="markdown",
            status="ready",
            is_active=True,
            is_deleted=False,
        ))
        self.db.commit()

        service = self._service()
        first = service.index_all(self.db)
        embedding_calls = service._embeddings.document_calls
        preview = service.preview_reindex(self.db)
        second = service.index_all(self.db)

        self.assertEqual("rebuilt", first["status"])
        self.assertFalse(preview["changed"])
        self.assertEqual("skipped", second["status"])
        self.assertFalse(second["changed"])
        self.assertEqual(embedding_calls, service._embeddings.document_calls)
        self.assertEqual(first["version"], second["version"])

    def test_reindex_lock_rejects_concurrent_execution(self):
        self.index_dir.mkdir(parents=True)
        (self.index_dir / ".reindex.lock").write_text("another-worker", encoding="utf-8")
        service = self._service()

        with self.assertRaisesRegex(rag_service.ReindexInProgressError, "진행 중"):
            service.index_all(self.db)

        self.assertEqual("another-worker", (self.index_dir / ".reindex.lock").read_text(encoding="utf-8"))

    def test_changed_source_after_preview_requires_a_new_preview(self):
        md_path = self.root / "preview.md"
        md_path.write_text(
            "# 사전 점검 안내\n\n사전 점검 직후 승인 데이터가 달라지면 이전 확인 결과로 재구성하면 안 됩니다. "
            "최신 데이터 기준으로 다시 확인해야 합니다.",
            encoding="utf-8",
        )
        self.db.add(DocumentRecord(
            logical_name="preview",
            version=1,
            original_filename="preview.md",
            md_path=str(md_path),
            parser_type="markdown",
            status="ready",
            is_active=True,
            is_deleted=False,
        ))
        self.db.commit()

        service = self._service()
        preview = service.preview_reindex(self.db)
        md_path.write_text(
            "# 점검 후 변경됨\n\n운영자가 승인 데이터를 수정했으므로 기존 지문은 더 이상 유효하지 않습니다. "
            "재구성 전에 새로운 사전 점검이 필요합니다.",
            encoding="utf-8",
        )

        with self.assertRaisesRegex(rag_service.ReindexSourceChangedError, "다시 점검"):
            service.index_all(self.db, expected_fingerprint=preview["fingerprint"])
        self.assertEqual(0, service._embeddings.document_calls)
        self.assertFalse((self.index_dir / ".reindex.lock").exists())

    def test_admin_reindex_returns_verified_counts_and_clear_error(self):
        verified = {
            "version": "v1",
            "status": "rebuilt",
            "changed": True,
            "corpus_fingerprint": "fingerprint",
            "document_count": 2,
            "faq_count": 3,
            "chunk_count": 7,
            "vector_count": 7,
            "storage": "local",
        }
        with (
            patch.object(admin, "full_reindex", return_value=verified),
            patch.object(admin, "create_audit_log"),
        ):
            response = admin.reindex(admin.ReindexRequest(), self.db, None)
        self.assertEqual("full_rebuild_verified", response["strategy"])
        self.assertEqual(7, response["vector_count"])

        with patch.object(admin, "full_reindex", side_effect=RuntimeError("인덱스 검증 실패")):
            with self.assertRaises(HTTPException) as context:
                admin.reindex(admin.ReindexRequest(), self.db, None)
        self.assertEqual(503, context.exception.status_code)
        self.assertIn("검증 실패", context.exception.detail)

    def test_s3_publish_switches_pointer_after_all_version_files(self):
        source_dir = self.root / "publish"
        source_dir.mkdir()
        (source_dir / "index.faiss").write_bytes(b"faiss")
        (source_dir / "index.pkl").write_bytes(b"pickle")
        (source_dir / "manifest.json").write_text(json.dumps({"version": "version-1"}), encoding="utf-8")

        calls = []

        class FakeS3Client:
            @staticmethod
            def upload_file(local_path, bucket, key):
                calls.append(("upload", key))

            @staticmethod
            def put_object(**kwargs):
                calls.append(("pointer", kwargs["Key"]))

        settings = SimpleNamespace(aws_s3_prefix="app", aws_s3_bucket="bucket")
        with patch.object(storage_service, "_get_s3_client", return_value=(FakeS3Client(), settings)):
            version = storage_service.upload_faiss_to_s3(source_dir)

        self.assertEqual("version-1", version)
        self.assertEqual(
            [
                ("upload", "app/faiss/versions/version-1/index.faiss"),
                ("upload", "app/faiss/versions/version-1/index.pkl"),
                ("upload", "app/faiss/versions/version-1/manifest.json"),
                ("pointer", "app/faiss/current.json"),
            ],
            calls,
        )


if __name__ == "__main__":
    unittest.main()
