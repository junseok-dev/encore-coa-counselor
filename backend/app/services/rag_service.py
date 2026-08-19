import hashlib
import json
import math
import os
import re
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Optional
from uuid import uuid4

from langchain_community.vectorstores import FAISS
from langchain_core.documents import Document
from langchain_openai import OpenAIEmbeddings
from langchain_text_splitters import Language, RecursiveCharacterTextSplitter
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db.database import SessionLocal
from app.db.models import ChunkRecord, DocumentRecord, FaqRecord
from app.services.model_settings import get_active_embedding_model
from app.services.storage_service import (
    FAISS_DIR,
    clear_faiss_storage,
    download_faiss_from_s3,
    install_faiss_artifacts,
    read_text_from_storage,
    upload_faiss_to_s3,
)
from app.utils.crypto import decrypt_if_needed

INDEX_SCHEMA_VERSION = 2
REINDEX_LOCK_STALE_SECONDS = 6 * 60 * 60


class ReindexInProgressError(RuntimeError):
    pass


class ReindexSourceChangedError(ValueError):
    pass


@contextmanager
def _reindex_lock():
    FAISS_DIR.mkdir(parents=True, exist_ok=True)
    lock_path = FAISS_DIR / ".reindex.lock"
    lock_token = uuid4().hex

    for attempt in range(2):
        try:
            descriptor = os.open(str(lock_path), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError as exc:
            try:
                is_stale = time.time() - lock_path.stat().st_mtime > REINDEX_LOCK_STALE_SECONDS
            except FileNotFoundError:
                continue
            if is_stale and attempt == 0:
                try:
                    lock_path.unlink()
                except FileNotFoundError:
                    pass
                continue
            raise ReindexInProgressError("이미 다른 FAISS 인덱스 재구성이 진행 중입니다.") from exc
        else:
            with os.fdopen(descriptor, "w", encoding="utf-8") as lock_file:
                lock_file.write(lock_token)
            break
    else:  # pragma: no cover - defensive fallback
        raise ReindexInProgressError("FAISS 인덱스 재구성 잠금을 얻지 못했습니다.")

    try:
        yield
    finally:
        try:
            if lock_path.read_text(encoding="utf-8") == lock_token:
                lock_path.unlink()
        except (OSError, UnicodeDecodeError):
            pass

STOPWORDS = {
    "과정",
    "관련",
    "문의",
    "무엇",
    "설명",
    "안내",
    "정보",
    "이용",
    "어떤",
    "얼마",
}


def _normalize_text(text: str) -> str:
    lowered = (text or "").lower()
    cleaned = re.sub(r"[^0-9a-zA-Z가-힣\s]", " ", lowered)
    return re.sub(r"\s+", " ", cleaned).strip()


def _compact_text(text: str) -> str:
    return _normalize_text(text).replace(" ", "")


def _tokenize(text: str) -> list[str]:
    normalized = _normalize_text(text)
    return [token for token in normalized.split() if len(token) >= 2 and token not in STOPWORDS]


def _cosine_similarity(vec_a: list[float], vec_b: list[float]) -> float:
    dot = sum(a * b for a, b in zip(vec_a, vec_b))
    norm_a = math.sqrt(sum(a * a for a in vec_a))
    norm_b = math.sqrt(sum(b * b for b in vec_b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


class RAGService:
    def __init__(self, api_key: str):
        FAISS_DIR.mkdir(parents=True, exist_ok=True)
        self._api_key = api_key
        self._embedding_model = get_active_embedding_model()
        self._embeddings = self._create_embeddings(self._embedding_model)
        self._splitter = RecursiveCharacterTextSplitter.from_language(
            language=Language.MARKDOWN,
            chunk_size=1200,
            chunk_overlap=150,
        )
        self._vectorstore = None
        self._documents: list[Document] = []
        self._keyword_index: list[tuple[Document, set[str], str]] = []
        self._doc_position_map: dict[int, int] = {}
        self._manifest_mtime_ns: int | None = None
        self._index_version: str | None = None
        faiss_path = FAISS_DIR / "index.faiss"
        if self._embeddings and not faiss_path.exists():
            download_faiss_from_s3()
        if self._embeddings and faiss_path.exists():
            manifest_model = str(self._read_current_manifest().get("embedding_model") or "").strip()
            if manifest_model and manifest_model != self._embedding_model:
                self._embedding_model = manifest_model
                self._embeddings = self._create_embeddings(manifest_model)
            self._vectorstore = FAISS.load_local(
                str(FAISS_DIR),
                self._embeddings,
                allow_dangerous_deserialization=True,
            )
            self._documents = self._load_documents_from_vectorstore()
            self._keyword_index = self._build_keyword_index(self._documents)
            self._doc_position_map = self._build_position_map()
            self._remember_loaded_manifest()

    def _create_embeddings(self, model_name: str):
        if not self._api_key:
            return None
        return OpenAIEmbeddings(model=model_name, api_key=self._api_key)

    def _remember_loaded_manifest(self) -> None:
        manifest_path = FAISS_DIR / "manifest.json"
        if not manifest_path.is_file():
            self._manifest_mtime_ns = None
            self._index_version = None
            return
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            self._manifest_mtime_ns = manifest_path.stat().st_mtime_ns
            self._index_version = str(manifest.get("version") or "") or None
        except (OSError, json.JSONDecodeError):
            self._manifest_mtime_ns = None
            self._index_version = None

    def _reload_local_index_if_changed(self) -> None:
        if not self._embeddings:
            return
        faiss_path = FAISS_DIR / "index.faiss"
        manifest_path = FAISS_DIR / "manifest.json"
        if not faiss_path.is_file():
            if self._vectorstore is not None:
                self._vectorstore = None
                self._documents = []
                self._keyword_index = []
                self._doc_position_map = {}
                self._remember_loaded_manifest()
            return
        if not manifest_path.is_file():
            return
        try:
            current_mtime_ns = manifest_path.stat().st_mtime_ns
            current_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            current_version = str(current_manifest.get("version") or "") or None
        except (OSError, json.JSONDecodeError):
            return
        if current_mtime_ns == self._manifest_mtime_ns and current_version == self._index_version:
            return
        manifest_model = str(current_manifest.get("embedding_model") or self._embedding_model).strip()
        embeddings = self._embeddings
        if manifest_model != self._embedding_model:
            embeddings = self._create_embeddings(manifest_model)
            if embeddings is None:
                return
        try:
            vectorstore = FAISS.load_local(
                str(FAISS_DIR),
                embeddings,
                allow_dangerous_deserialization=True,
            )
            documents = self._load_documents_from_store(vectorstore)
        except Exception:
            # 교체 중인 순간에는 기존 메모리 인덱스를 유지하고 다음 요청에서 다시 시도한다.
            return
        self._embedding_model = manifest_model
        self._embeddings = embeddings
        self._vectorstore = vectorstore
        self._documents = documents
        self._keyword_index = self._build_keyword_index(documents)
        self._doc_position_map = self._build_position_map()
        self._remember_loaded_manifest()

    def build_chunks_for_markdown(self, content: str, metadata: dict) -> list[Document]:
        chunks = self._splitter.create_documents([content], metadatas=[metadata])
        documents: list[Document] = []
        for chunk in chunks:
            if len(chunk.page_content.strip()) < 50:
                continue
            title = metadata.get("title", metadata.get("file", ""))
            source_type = metadata.get("source_type", "document")
            header_lines = [f"source_type: {source_type}"]
            if title:
                header_lines.append(f"title: {title}")
            if metadata.get("category"):
                header_lines.append(f"category: {metadata['category']}")
            chunk.page_content = "\n".join(header_lines) + "\n\n" + chunk.page_content.strip()
            documents.append(chunk)
        return documents

    def _load_documents_from_vectorstore(self) -> list[Document]:
        return self._load_documents_from_store(self._vectorstore)

    @staticmethod
    def _load_documents_from_store(vectorstore) -> list[Document]:
        if vectorstore is None:
            return []
        docstore_dict = getattr(getattr(vectorstore, "docstore", None), "_dict", {})
        return [doc for doc in docstore_dict.values() if isinstance(doc, Document)]

    def _build_position_map(self) -> dict[int, int]:
        # FAISS 인덱스에 저장된 임베딩을 매 요청마다 재계산하지 않고 재사용하기 위한 매핑.
        # id(doc)이 안전한 이유: vector/mmr/keyword 경로 모두 docstore._dict의 동일 객체 참조를 반환.
        if self._vectorstore is None:
            return {}
        docstore_dict = getattr(getattr(self._vectorstore, "docstore", None), "_dict", {})
        index_to_id = getattr(self._vectorstore, "index_to_docstore_id", {}) or {}
        position_map: dict[int, int] = {}
        for position, docstore_id in index_to_id.items():
            doc = docstore_dict.get(docstore_id)
            if isinstance(doc, Document):
                position_map[id(doc)] = position
        return position_map

    def _build_keyword_index(self, documents: list[Document]) -> list[tuple[Document, set[str], str]]:
        index = []
        for doc in documents:
            metadata_text = " ".join(str(doc.metadata.get(key, "")) for key in ("title", "category", "file"))
            combined_text = f"{metadata_text} {doc.page_content}".strip()
            tokens = set(_tokenize(combined_text))
            index.append((doc, tokens, _normalize_text(combined_text)))
        return index

    def _matches_filter(self, doc: Document, files: set[str] | None = None) -> bool:
        if not files:
            return True
        return doc.metadata.get("file") in files

    def _filter_documents(self, docs: list[Document], files: set[str] | None = None) -> list[Document]:
        return [doc for doc in docs if self._matches_filter(doc, files)]

    def _unique_documents(self, docs: list[Document], top_k: int) -> list[Document]:
        seen = set()
        unique_docs = []
        for doc in docs:
            key = (doc.metadata.get("file"), doc.page_content[:200])
            if key in seen:
                continue
            seen.add(key)
            unique_docs.append(doc)
            if len(unique_docs) >= top_k:
                break
        return unique_docs

    def _vector_search(
        self,
        query: str,
        top_k: int,
        files: set[str] | None = None,
        query_embedding: list[float] | None = None,
    ) -> list[Document]:
        if self._vectorstore is None:
            return []
        try:
            if query_embedding is not None:
                docs = self._vectorstore.similarity_search_by_vector(
                    query_embedding, k=max(top_k * 4, 10)
                )
            else:
                docs = self._vectorstore.similarity_search(query, k=max(top_k * 4, 10))
        except Exception:
            return []
        return self._unique_documents(self._filter_documents(docs, files), max(top_k * 3, top_k))

    def _mmr_search(
        self,
        query: str,
        top_k: int,
        files: set[str] | None = None,
        query_embedding: list[float] | None = None,
    ) -> list[Document]:
        if self._vectorstore is None:
            return []
        try:
            if query_embedding is not None:
                docs = self._vectorstore.max_marginal_relevance_search_by_vector(
                    query_embedding,
                    k=max(top_k * 3, 8),
                    fetch_k=max(top_k * 5, 16),
                )
            else:
                docs = self._vectorstore.max_marginal_relevance_search(
                    query,
                    k=max(top_k * 3, 8),
                    fetch_k=max(top_k * 5, 16),
                )
        except Exception:
            return self._vector_search(query, top_k, files, query_embedding=query_embedding)
        return self._unique_documents(self._filter_documents(docs, files), max(top_k * 3, top_k))

    def _keyword_search(self, query: str, top_k: int, files: set[str] | None = None) -> list[Document]:
        if not self._keyword_index:
            return []

        query_tokens = set(_tokenize(query))
        compact_query = _compact_text(query)
        scored: list[tuple[float, Document]] = []

        for doc, doc_tokens, normalized_content in self._keyword_index:
            if files and doc.metadata.get("file") not in files:
                continue

            overlap = len(query_tokens & doc_tokens)
            phrase_bonus = 0.0
            if compact_query and compact_query in normalized_content.replace(" ", ""):
                phrase_bonus += 3.0
            if overlap == 0 and phrase_bonus == 0:
                continue
            score = overlap * 2.0 + phrase_bonus
            scored.append((score, doc))

        scored.sort(key=lambda item: item[0], reverse=True)
        docs = [doc for _, doc in scored]
        return self._unique_documents(docs, max(top_k * 3, top_k))

    def _fuse_ranked_lists(self, ranked_lists: list[list[Document]], top_k: int) -> list[Document]:
        scores: dict[tuple[str, str], float] = {}
        documents: dict[tuple[str, str], Document] = {}

        for ranked in ranked_lists:
            for rank, doc in enumerate(ranked, start=1):
                key = (doc.metadata.get("file", ""), doc.page_content[:200])
                scores[key] = scores.get(key, 0.0) + 1.0 / (rank + 50)
                documents[key] = doc

        fused = sorted(scores.items(), key=lambda item: item[1], reverse=True)
        return [documents[key] for key, _ in fused[: max(top_k * 4, top_k)]]

    def _lookup_doc_embedding(self, doc: Document) -> list[float]:
        # FAISS 인덱싱 시 저장된 임베딩을 reconstruct로 회수. 매핑이 없으면 빈 벡터(코사인 점수 0 처리).
        if self._vectorstore is None or not self._doc_position_map:
            return []
        position = self._doc_position_map.get(id(doc))
        if position is None:
            return []
        try:
            vec = self._vectorstore.index.reconstruct(position)
        except Exception:
            return []
        return vec.tolist() if hasattr(vec, "tolist") else list(vec)

    def _rerank_documents(
        self,
        query: str,
        docs: list[Document],
        top_k: int,
        query_embedding: list[float] | None = None,
    ) -> tuple[list[Document], float]:
        if not docs:
            return [], 0.0
        query_tokens = set(_tokenize(query))
        compact_query = _compact_text(query)
        if query_embedding is None:
            query_embedding = self._compute_query_embedding(query)

        scored_docs: list[tuple[float, Document]] = []
        for doc in docs:
            content = doc.page_content
            normalized_content = _normalize_text(content)
            compact_content = normalized_content.replace(" ", "")
            content_tokens = set(_tokenize(content))
            title = str(doc.metadata.get("title", ""))
            category = str(doc.metadata.get("category", ""))
            header_text = f"{title} {category} {doc.metadata.get('file', '')}"

            if query_embedding:
                doc_embedding = self._lookup_doc_embedding(doc)
                score = _cosine_similarity(query_embedding, doc_embedding) * 5.0 if doc_embedding else 0.0
            else:
                score = 0.0
            score += len(query_tokens & content_tokens) * 1.8
            if compact_query and compact_query in compact_content:
                score += 3.0
            if any(token in header_text.lower() for token in _normalize_text(query).split()):
                score += 1.2
            scored_docs.append((score, doc))

        scored_docs.sort(key=lambda item: item[0], reverse=True)
        top_score = scored_docs[0][0] if scored_docs else 0.0
        reranked = [doc for _, doc in scored_docs]
        return self._unique_documents(reranked, top_k), top_score

    def _collect_index_documents(
        self,
        db: Session,
    ) -> tuple[list[Document], list[DocumentRecord], list[FaqRecord]]:
        documents: list[Document] = []
        active_docs = (
            db.query(DocumentRecord)
            .filter(DocumentRecord.is_active.is_(True), DocumentRecord.status == "ready")
            .order_by(DocumentRecord.created_at.asc(), DocumentRecord.id.asc())
            .all()
        )
        unreadable_documents: list[str] = []
        for item in active_docs:
            if not item.md_path:
                unreadable_documents.append(f"{item.logical_name}: MD 경로 없음")
                continue
            content = read_text_from_storage(item.md_path)
            if not content or not content.strip():
                unreadable_documents.append(f"{item.logical_name}: MD를 읽을 수 없음")
                continue
            metadata = {
                "file": item.logical_name,
                "title": decrypt_if_needed(item.original_filename) or item.logical_name,
                "category": "document",
                "document_id": item.id,
                "source_type": "document",
            }
            document_chunks = self.build_chunks_for_markdown(content, metadata)
            if not document_chunks:
                unreadable_documents.append(f"{item.logical_name}: 생성된 청크 없음")
                continue
            documents.extend(document_chunks)

        if unreadable_documents:
            joined = ", ".join(unreadable_documents)
            raise RuntimeError(f"활성 문서를 모두 읽지 못해 기존 인덱스를 유지했습니다. {joined}")

        active_faqs = db.query(FaqRecord).filter(FaqRecord.is_active.is_(True)).order_by(FaqRecord.id.asc()).all()
        for faq in active_faqs:
            faq_question = decrypt_if_needed(faq.question) or ""
            faq_answer = decrypt_if_needed(faq.answer) or ""
            faq_text = f"FAQ 질문: {faq_question}\nFAQ 답변: {faq_answer}"
            metadata = {
                "file": f"faq::{faq.faq_key}",
                "title": faq_question,
                "category": decrypt_if_needed(faq.category) or "",
                "source_type": "faq",
            }
            documents.extend(self.build_chunks_for_markdown(faq_text, metadata))
        return documents, active_docs, active_faqs

    @staticmethod
    def _read_current_manifest() -> dict:
        manifest_path = FAISS_DIR / "manifest.json"
        if not manifest_path.is_file():
            return {}
        try:
            payload = json.loads(manifest_path.read_text(encoding="utf-8"))
            return payload if isinstance(payload, dict) else {}
        except (OSError, json.JSONDecodeError):
            return {}

    @staticmethod
    def _corpus_fingerprint(documents: list[Document], embedding_model: str) -> str:
        digest = hashlib.sha256()
        digest.update(f"schema={INDEX_SCHEMA_VERSION}\n".encode("utf-8"))
        digest.update(f"embedding={embedding_model}\n".encode("utf-8"))
        for document in documents:
            digest.update(document.page_content.encode("utf-8"))
            digest.update(b"\x00")
            digest.update(json.dumps(document.metadata, ensure_ascii=False, sort_keys=True).encode("utf-8"))
            digest.update(b"\x00")
        return digest.hexdigest()

    def preview_reindex(self, db: Session | None = None) -> dict[str, object]:
        owns_session = db is None
        db = db or SessionLocal()
        try:
            documents, active_docs, active_faqs = self._collect_index_documents(db)
            embedding_model = get_active_embedding_model()
            fingerprint = self._corpus_fingerprint(documents, embedding_model)
            manifest = self._read_current_manifest()
            index_files_ready = all((FAISS_DIR / filename).is_file() for filename in ("index.faiss", "index.pkl"))
            any_index_file = any((FAISS_DIR / filename).is_file() for filename in ("index.faiss", "index.pkl"))
            unchanged = bool(
                (not documents and not any_index_file)
                or (
                    documents
                    and index_files_ready
                    and manifest.get("corpus_fingerprint") == fingerprint
                    and manifest.get("index_schema_version") == INDEX_SCHEMA_VERSION
                )
            )
            return {
                "changed": not unchanged,
                "can_rebuild": bool(self._api_key) or (
                    self._embeddings is not None and embedding_model == self._embedding_model
                ),
                "fingerprint": fingerprint,
                "current_version": manifest.get("version"),
                "embedding_model": embedding_model,
                "indexed_embedding_model": manifest.get("embedding_model"),
                "document_count": len(active_docs),
                "faq_count": len(active_faqs),
                "chunk_count": len(documents),
                "current_vector_count": int(manifest.get("vector_count") or 0),
                "reason": "변경 사항 없음" if unchanged else "승인 데이터 또는 인덱스 설정이 변경됨",
            }
        finally:
            if owns_session:
                db.close()

    def index_all(
        self,
        db: Session | None = None,
        *,
        force: bool = False,
        expected_fingerprint: str | None = None,
    ) -> dict[str, object]:
        embedding_model = get_active_embedding_model()
        embeddings = self._embeddings
        if embedding_model != self._embedding_model:
            embeddings = self._create_embeddings(embedding_model)
        if not embeddings:
            raise RuntimeError("OpenAI API 키가 없어 FAISS 임베딩을 생성할 수 없습니다.")

        owns_session = db is None
        db = db or SessionLocal()
        try:
            with _reindex_lock():
                documents, active_docs, active_faqs = self._collect_index_documents(db)
                fingerprint = self._corpus_fingerprint(documents, embedding_model)
                if expected_fingerprint and expected_fingerprint != fingerprint:
                    raise ReindexSourceChangedError(
                        "사전 점검 이후 승인 데이터가 변경되었습니다. 다시 점검해 주세요."
                    )

                manifest = self._read_current_manifest()
                index_files_ready = all((FAISS_DIR / filename).is_file() for filename in ("index.faiss", "index.pkl"))
                any_index_file = any((FAISS_DIR / filename).is_file() for filename in ("index.faiss", "index.pkl"))
                unchanged = bool(
                    (not documents and not any_index_file)
                    or (
                        documents
                        and index_files_ready
                        and manifest.get("corpus_fingerprint") == fingerprint
                        and manifest.get("index_schema_version") == INDEX_SCHEMA_VERSION
                    )
                )
                if unchanged and not force:
                    return {
                        **manifest,
                        "version": manifest.get("version"),
                        "status": "skipped",
                        "changed": False,
                        "corpus_fingerprint": fingerprint,
                        "document_count": len(active_docs),
                        "faq_count": len(active_faqs),
                        "chunk_count": len(documents),
                        "vector_count": int(manifest.get("vector_count") or 0),
                        "storage": "existing",
                    }

                if not documents:
                    clear_faiss_storage()
                    self._vectorstore = None
                    self._documents = []
                    self._keyword_index = []
                    self._doc_position_map = {}
                    self._remember_loaded_manifest()
                    return {
                        "version": None,
                        "status": "cleared",
                        "changed": True,
                        "corpus_fingerprint": fingerprint,
                        "document_count": len(active_docs),
                        "faq_count": len(active_faqs),
                        "chunk_count": 0,
                        "vector_count": 0,
                        "storage": "cleared",
                    }

                version = f"{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}-{uuid4().hex[:8]}"
                FAISS_DIR.parent.mkdir(parents=True, exist_ok=True)
                with TemporaryDirectory(prefix="faiss-build-", dir=str(FAISS_DIR.parent)) as temp_dir_value:
                    temp_dir = Path(temp_dir_value)
                    new_vectorstore = FAISS.from_documents(documents, embeddings)
                    new_vectorstore.save_local(str(temp_dir))
                    vector_count = int(new_vectorstore.index.ntotal)
                    if vector_count != len(documents):
                        raise RuntimeError(
                            f"FAISS 검증 실패: 청크 {len(documents)}건과 벡터 {vector_count}건이 일치하지 않습니다."
                        )

                    manifest = {
                        "version": version,
                        "status": "rebuilt",
                        "changed": True,
                        "created_at": datetime.now(timezone.utc).isoformat(),
                        "embedding_model": embedding_model,
                        "index_schema_version": INDEX_SCHEMA_VERSION,
                        "corpus_fingerprint": fingerprint,
                        "document_count": len(active_docs),
                        "faq_count": len(active_faqs),
                        "chunk_count": len(documents),
                        "vector_count": vector_count,
                        "document_ids": [item.id for item in active_docs],
                    }
                    (temp_dir / "manifest.json").write_text(
                        json.dumps(manifest, ensure_ascii=False, indent=2),
                        encoding="utf-8",
                    )

                    # 저장한 결과가 실제로 다시 열리는지 확인한 뒤에만 운영 인덱스를 교체한다.
                    verified_vectorstore = FAISS.load_local(
                        str(temp_dir),
                        embeddings,
                        allow_dangerous_deserialization=True,
                    )
                    if int(verified_vectorstore.index.ntotal) != vector_count:
                        raise RuntimeError("저장된 FAISS 인덱스 재로딩 검증에 실패했습니다.")

                    s3_version = upload_faiss_to_s3(temp_dir)
                    install_faiss_artifacts(temp_dir)

                self._embedding_model = embedding_model
                self._embeddings = embeddings
                self._vectorstore = verified_vectorstore
                self._documents = self._load_documents_from_vectorstore()
                self._keyword_index = self._build_keyword_index(self._documents)
                self._doc_position_map = self._build_position_map()
                self._remember_loaded_manifest()
                return {
                    **manifest,
                    "storage": "local+s3" if s3_version else "local",
                }
        finally:
            if owns_session:
                db.close()

    def replace_document_chunks(self, db: Session, document_id: int, chunks: list[Document]) -> None:
        db.query(ChunkRecord).filter(ChunkRecord.document_id == document_id).delete()
        for index, chunk in enumerate(chunks):
            db.add(
                    ChunkRecord(
                        document_id=document_id,
                        chunk_index=index,
                        content=chunk.page_content,
                        metadata_json=json.dumps(chunk.metadata, ensure_ascii=False),
                    )
                )
        db.commit()

    def _get_candidates(
        self,
        query: str,
        top_k: int,
        strategy: str,
        file_filter: set[str],
        query_embedding: list[float] | None = None,
    ) -> list[Document]:
        if strategy == "semantic":
            return self._vector_search(query, top_k, file_filter, query_embedding=query_embedding)
        if strategy == "keyword":
            return self._keyword_search(query, top_k, file_filter)
        if strategy == "mmr":
            return self._mmr_search(query, top_k, file_filter, query_embedding=query_embedding)
        vector_docs = self._vector_search(query, top_k, file_filter, query_embedding=query_embedding)
        keyword_docs = self._keyword_search(query, top_k, file_filter)
        mmr_docs = self._mmr_search(query, top_k, file_filter, query_embedding=query_embedding)
        return self._fuse_ranked_lists([keyword_docs, vector_docs, mmr_docs], top_k)

    def _compute_query_embedding(self, query: str) -> list[float] | None:
        if self._embeddings is None:
            return None
        try:
            return self._embeddings.embed_query(query)
        except Exception:
            return None

    def search_documents(
        self,
        query: str,
        top_k: int = 4,
        strategy: str = "hybrid",
        files: list[str] | None = None,
    ) -> list[Document]:
        self._reload_local_index_if_changed()
        if self._vectorstore is None and not self._keyword_index:
            return []
        query_embedding = self._compute_query_embedding(query)
        candidates = self._get_candidates(query, top_k, strategy, set(files or []), query_embedding=query_embedding)
        docs, _ = self._rerank_documents(query, candidates, top_k, query_embedding=query_embedding)
        return docs

    def search_documents_scored(
        self,
        query: str,
        top_k: int = 4,
        strategy: str = "hybrid",
        files: list[str] | None = None,
    ) -> tuple[list[Document], float]:
        self._reload_local_index_if_changed()
        if self._vectorstore is None and not self._keyword_index:
            return [], 0.0
        query_embedding = self._compute_query_embedding(query)
        candidates = self._get_candidates(query, top_k, strategy, set(files or []), query_embedding=query_embedding)
        return self._rerank_documents(query, candidates, top_k, query_embedding=query_embedding)

    def search(self, query: str, top_k: int = 4, strategy: str = "hybrid", files: list[str] | None = None) -> str:
        docs = self.search_documents(query=query, top_k=top_k, strategy=strategy, files=files)
        return "\n\n---\n\n".join(doc.page_content for doc in docs) if docs else ""


_instance: Optional[RAGService] = None


def get_rag_service() -> RAGService:
    global _instance
    if _instance is None:
        _instance = RAGService(get_settings().openai_api_key)
    return _instance
