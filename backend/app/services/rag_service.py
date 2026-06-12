import json
import math
import re
from pathlib import Path
from typing import Optional

from langchain_community.vectorstores import FAISS
from langchain_core.documents import Document
from langchain_openai import OpenAIEmbeddings
from langchain_text_splitters import Language, RecursiveCharacterTextSplitter
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db.database import SessionLocal
from app.db.models import ChunkRecord, DocumentRecord, FaqRecord
from app.services.storage_service import download_faiss_from_s3, read_text_from_storage, upload_faiss_to_s3
from app.utils.crypto import decrypt_if_needed, maybe_encrypt

ROOT = Path(__file__).resolve().parent.parent.parent.parent
FAISS_DIR = ROOT / "data" / "faiss_index"
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
        settings = get_settings()
        self._embeddings = OpenAIEmbeddings(
            model=settings.embedding_model,
            api_key=api_key,
        ) if api_key else None
        self._splitter = RecursiveCharacterTextSplitter.from_language(
            language=Language.MARKDOWN,
            chunk_size=1200,
            chunk_overlap=150,
        )
        self._vectorstore = None
        self._documents: list[Document] = []
        self._keyword_index: list[tuple[Document, set[str], str]] = []
        self._doc_position_map: dict[int, int] = {}
        faiss_path = FAISS_DIR / "index.faiss"
        if self._embeddings and not faiss_path.exists():
            download_faiss_from_s3()
        if self._embeddings and faiss_path.exists():
            self._vectorstore = FAISS.load_local(
                str(FAISS_DIR),
                self._embeddings,
                allow_dangerous_deserialization=True,
            )
            self._documents = self._load_documents_from_vectorstore()
            self._keyword_index = self._build_keyword_index(self._documents)
            self._doc_position_map = self._build_position_map()

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
        if self._vectorstore is None:
            return []
        docstore_dict = getattr(getattr(self._vectorstore, "docstore", None), "_dict", {})
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

    def index_all(self, db: Session | None = None) -> None:
        if not self._embeddings:
            self._vectorstore = None
            self._documents = []
            self._keyword_index = []
            self._doc_position_map = {}
            return

        owns_session = db is None
        db = db or SessionLocal()
        try:
            documents: list[Document] = []
            active_docs = (
                db.query(DocumentRecord)
                .filter(DocumentRecord.is_active.is_(True), DocumentRecord.status == "ready")
                .order_by(DocumentRecord.created_at.asc())
                .all()
            )
            for item in active_docs:
                if not item.md_path:
                    continue
                content = read_text_from_storage(item.md_path)
                if not content:
                    continue
                metadata = {
                    "file": item.logical_name,
                    "title": decrypt_if_needed(item.original_filename) or item.logical_name,
                    "category": "document",
                    "document_id": item.id,
                    "source_type": "document",
                }
                documents.extend(self.build_chunks_for_markdown(content, metadata))

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

            if not documents:
                self._vectorstore = None
                self._documents = []
                self._keyword_index = []
                self._doc_position_map = {}
                return

            self._vectorstore = FAISS.from_documents(documents, self._embeddings)
            self._documents = documents
            self._keyword_index = self._build_keyword_index(documents)
            self._doc_position_map = self._build_position_map()
            self._vectorstore.save_local(str(FAISS_DIR))
            upload_faiss_to_s3()
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
                        content=maybe_encrypt(chunk.page_content),
                        metadata_json=maybe_encrypt(json.dumps(chunk.metadata, ensure_ascii=False)),
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
