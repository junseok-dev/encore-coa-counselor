from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path

from sqlalchemy.orm import Session

from app.config import get_settings
from app.db.models import AdminAuditLog, DocumentRecord, FaqRecord, ProcessingLog
from app.services.faq_service import seed_faqs, sync_faqs_to_file
from app.services.rag_service import get_rag_service
from app.services.storage_service import (
    MANAGED_CHUNKS_DIR,
    MANAGED_DOCS_DIR,
    MANAGED_EMBEDDINGS_DIR,
    MANAGED_JSON_DIR,
    PDF_DIR,
    build_s3_key,
    delete_storage_path,
    delete_s3_key,
    ensure_storage_dirs,
    is_s3_uri,
    read_text_from_storage,
    safe_unlink,
    upload_file_to_s3,
    upload_json_to_s3,
    upload_text_to_s3,
)
from app.services.transformation_service import convert_markdown_to_faq_items
from app.utils.crypto import maybe_encrypt
from app.utils.pdf_converter import convert_pdf_to_md


def _slugify(value: str) -> str:
    lowered = re.sub(r"[^\w]+", "_", Path(value).stem.lower()).strip("_")
    return lowered or "document"


def _artifact_key(logical_name: str, version: int, filename: str) -> str:
    return build_s3_key("documents", logical_name, f"v{version}", filename)


def _next_version(db: Session, logical_name: str) -> int:
    existing = (
        db.query(DocumentRecord)
        .filter(DocumentRecord.logical_name == logical_name)
        .order_by(DocumentRecord.version.desc())
        .first()
    )
    return (existing.version if existing else 0) + 1


def create_processing_log(
    db: Session,
    log_type: str,
    status: str,
    message: str,
    document_id: int | None = None,
    detail: str | None = None,
) -> None:
    db.add(
        ProcessingLog(
            document_id=document_id,
            log_type=log_type,
            status=status,
            message=maybe_encrypt(message),
            detail=maybe_encrypt(detail),
        )
    )
    db.commit()


def create_audit_log(
    db: Session,
    action: str,
    target_type: str,
    target_id: str | None = None,
    detail: str | None = None,
    actor: str = "admin",
) -> None:
    db.add(
        AdminAuditLog(
            actor=actor,
            action=action,
            target_type=target_type,
            target_id=target_id,
            detail=maybe_encrypt(detail),
        )
    )
    db.commit()


def _deactivate_previous_versions(db: Session, logical_name: str, current_id: int) -> None:
    rows = (
        db.query(DocumentRecord)
        .filter(
            DocumentRecord.logical_name == logical_name,
            DocumentRecord.id != current_id,
            DocumentRecord.is_active.is_(True),
            DocumentRecord.is_deleted.is_(False),
        )
        .all()
    )
    for row in rows:
        row.is_active = False
        row.status = "archived"
    db.commit()


def _upsert_faq_from_payload(db: Session, payload: dict) -> None:
    faq_key = payload.get("id")
    if not faq_key:
        return
    row = db.query(FaqRecord).filter(FaqRecord.faq_key == faq_key).first()
    values = {
        "category": maybe_encrypt(payload.get("category", "")),
        "question": maybe_encrypt(payload.get("question", "")),
        "answer": maybe_encrypt(payload.get("answer", "")),
        "keywords_json": maybe_encrypt(json.dumps(payload.get("keywords", []), ensure_ascii=False)),
        "aliases_json": maybe_encrypt(json.dumps(payload.get("aliases", []), ensure_ascii=False)),
        "search_hints_json": maybe_encrypt(json.dumps(payload.get("search_hints", []), ensure_ascii=False)),
        "source_files_json": maybe_encrypt(json.dumps(payload.get("source_files", []), ensure_ascii=False)),
        "direct_answer": bool(payload.get("direct_answer", False)),
        "top_k": int(payload.get("top_k", 4) or 4),
        "is_active": True,
    }
    if row:
        for key, value in values.items():
            setattr(row, key, value)
    else:
        db.add(FaqRecord(faq_key=faq_key, **values))
    db.commit()


async def _process_md_content(
    db: Session,
    filename: str,
    md_content: str,
    title: str,
    category: str,
) -> DocumentRecord:
    logical_name = _slugify(Path(filename).stem)
    version = _next_version(db, logical_name)

    managed_md_path = MANAGED_DOCS_DIR / f"{logical_name}_v{version}.md"
    managed_md_path.write_text(md_content, encoding="utf-8")
    md_storage = upload_text_to_s3(md_content, _artifact_key(logical_name, version, "document.md"))
    if md_storage:
        safe_unlink(str(managed_md_path))

    record = DocumentRecord(
        logical_name=logical_name,
        version=version,
        original_filename=maybe_encrypt(filename),
        storage_key=None,
        md_path=md_storage or str(managed_md_path),
        parser_type="markdown",
        status="embedding",
        is_active=False,
        is_deleted=False,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    create_processing_log(db, "document", "uploaded", f"{filename} MD 업로드 완료", document_id=record.id)

    try:
        rag = get_rag_service()
        chunks = rag.build_chunks_for_markdown(
            md_content,
            {
                "file": logical_name,
                "title": title,
                "category": category,
                "document_id": record.id,
                "source_type": "document",
            },
        )
        rag.replace_document_chunks(db, record.id, chunks)

        json_path = MANAGED_JSON_DIR / f"{logical_name}_v{version}.json"
        json_payload = {
            "document_id": record.id,
            "logical_name": logical_name,
            "version": version,
            "original_filename": filename,
            "title": title,
            "category": category,
            "status": "review",
            "chunk_count": len(chunks),
        }
        json_path.write_text(json.dumps(json_payload, ensure_ascii=False, indent=2), encoding="utf-8")
        json_storage = upload_json_to_s3(json_payload, _artifact_key(logical_name, version, "document.json"))
        if json_storage:
            safe_unlink(str(json_path))

        chunk_path = MANAGED_CHUNKS_DIR / f"{logical_name}_v{version}.json"
        chunk_payload = [{"index": i, "content": chunk.page_content, "metadata": chunk.metadata} for i, chunk in enumerate(chunks)]
        chunk_path.write_text(json.dumps(chunk_payload, ensure_ascii=False, indent=2), encoding="utf-8")
        chunk_storage = upload_json_to_s3(chunk_payload, _artifact_key(logical_name, version, "chunks.json"))
        if chunk_storage:
            safe_unlink(str(chunk_path))

        embedding_path = MANAGED_EMBEDDINGS_DIR / f"{logical_name}_v{version}.json"
        embedding_payload = {
            "document_id": record.id,
            "embedding_model": get_settings().embedding_model,
            "strategy": "full_rebuild",
            "chunk_count": len(chunks),
        }
        embedding_path.write_text(json.dumps(embedding_payload, ensure_ascii=False, indent=2), encoding="utf-8")
        embedding_storage = upload_json_to_s3(embedding_payload, _artifact_key(logical_name, version, "embedding.json"))
        if embedding_storage:
            safe_unlink(str(embedding_path))

        record.json_path = json_storage or str(json_path)
        record.chunk_path = chunk_storage or str(chunk_path)
        record.embedding_path = embedding_storage or str(embedding_path)
        record.status = "review"
        record.error_message = None
        db.commit()
        create_processing_log(db, "document", "review", "문서 검토 대기", document_id=record.id)
        create_audit_log(db, "document_uploaded", "document", str(record.id), f"{logical_name} v{version}")
        db.refresh(record)
        return record
    except Exception as exc:
        record.status = "failed"
        record.error_message = maybe_encrypt(str(exc))
        db.commit()
        create_processing_log(db, "document", "failed", "문서 처리 실패", document_id=record.id, detail=str(exc))
        raise


async def process_uploaded_md(
    db: Session,
    filename: str,
    content: bytes,
    title: str | None = None,
    category: str | None = None,
) -> DocumentRecord:
    md_content = content.decode("utf-8")
    return await _process_md_content(
        db,
        filename=filename,
        md_content=md_content,
        title=title or Path(filename).stem,
        category=category or "document",
    )


async def process_uploaded_faq_md(
    db: Session,
    filename: str,
    content: bytes,
    category: str | None = None,
) -> tuple[DocumentRecord, list[dict]]:
    ensure_storage_dirs()
    md_content = content.decode("utf-8")
    logical_name = _slugify(Path(filename).stem)
    version = _next_version(db, logical_name)

    managed_md_path = MANAGED_DOCS_DIR / f"{logical_name}_v{version}.md"
    managed_md_path.write_text(md_content, encoding="utf-8")
    md_storage = upload_text_to_s3(md_content, _artifact_key(logical_name, version, "document.md"))
    if md_storage:
        safe_unlink(str(managed_md_path))

    faq_items = await convert_markdown_to_faq_items(md_content, category=category)
    managed_json_path = MANAGED_JSON_DIR / f"{logical_name}_v{version}.faq.json"
    managed_json_path.write_text(json.dumps(faq_items, ensure_ascii=False, indent=2), encoding="utf-8")
    faq_json_storage = upload_json_to_s3(faq_items, _artifact_key(logical_name, version, "faq.json"))
    if faq_json_storage:
        safe_unlink(str(managed_json_path))

    record = DocumentRecord(
        logical_name=logical_name,
        version=version,
        original_filename=maybe_encrypt(filename),
        storage_key=None,
        md_path=md_storage or str(managed_md_path),
        json_path=faq_json_storage or str(managed_json_path),
        parser_type="faq_json",
        status="review",
        is_active=False,
        is_deleted=False,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    create_processing_log(db, "faq_import", "review", f"{filename} FAQ JSON 변환 검토 대기", document_id=record.id)
    create_audit_log(db, "faq_document_uploaded", "document", str(record.id), f"{logical_name} v{version}")
    return record, faq_items


async def process_catalog_import(
    db: Session,
    catalog: dict,
    md_files: dict[str, bytes],
) -> list[DocumentRecord]:
    records = []
    entries = catalog.get("documents", [])
    for entry in entries:
        path = entry.get("path", "")
        filename = Path(path).name
        if filename not in md_files:
            continue
        title = entry.get("title") or Path(filename).stem
        category = entry.get("category") or "document"
        try:
            record = await _process_md_content(
                db,
                filename=filename,
                md_content=md_files[filename].decode("utf-8"),
                title=title,
                category=category,
            )
            records.append(record)
        except Exception as exc:
            create_processing_log(db, "document", "failed", f"{filename} 처리 실패: {exc}")
    return records


async def process_uploaded_pdf(db: Session, filename: str, content: bytes) -> DocumentRecord:
    ensure_storage_dirs()
    logical_name = _slugify(filename)
    version = _next_version(db, logical_name)
    stored_filename = f"{logical_name}_v{version}.pdf"
    pdf_path = PDF_DIR / stored_filename
    pdf_path.write_bytes(content)

    settings = get_settings()
    storage_key = f"{settings.aws_s3_prefix.rstrip('/')}/pdf/{stored_filename}" if settings.aws_s3_bucket else None
    uploaded_pdf_uri = upload_file_to_s3(pdf_path, storage_key) if storage_key else None

    record = DocumentRecord(
        logical_name=logical_name,
        version=version,
        original_filename=maybe_encrypt(filename),
        storage_key=storage_key,
        pdf_path=uploaded_pdf_uri or str(pdf_path),
        status="uploaded",
        is_active=False,
        is_deleted=False,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    create_processing_log(db, "document", "uploaded", f"{filename} 업로드 완료", document_id=record.id)

    try:
        record.status = "parsing"
        db.commit()
        create_processing_log(db, "document", "parsing", "PDF 파싱 시작", document_id=record.id)
        generated_md_path = await convert_pdf_to_md(pdf_path)

        managed_md_path = MANAGED_DOCS_DIR / f"{logical_name}_v{version}.md"
        markdown = generated_md_path.read_text(encoding="utf-8")
        managed_md_path.write_text(markdown, encoding="utf-8")
        md_storage = upload_text_to_s3(markdown, _artifact_key(logical_name, version, "document.md"))
        safe_unlink(str(generated_md_path))
        if md_storage:
            safe_unlink(str(managed_md_path))

        record.md_path = md_storage or str(managed_md_path)
        record.parser_type = "markdown"
        create_processing_log(db, "document", "parsing", "PDF 파싱 성공", document_id=record.id)

        record.status = "embedding"
        db.commit()
        create_processing_log(db, "document", "embedding", "chunk/embedding 생성 시작", document_id=record.id)

        rag = get_rag_service()
        chunks = rag.build_chunks_for_markdown(
            markdown,
            {
                "file": logical_name,
                "title": filename,
                "category": "document",
                "document_id": record.id,
                "source_type": "document",
            },
        )
        rag.replace_document_chunks(db, record.id, chunks)

        json_path = MANAGED_JSON_DIR / f"{logical_name}_v{version}.json"
        json_payload = {
            "document_id": record.id,
            "logical_name": logical_name,
            "version": version,
            "original_filename": filename,
            "status": "review",
            "chunk_count": len(chunks),
        }
        json_path.write_text(json.dumps(json_payload, ensure_ascii=False, indent=2), encoding="utf-8")
        json_storage = upload_json_to_s3(json_payload, _artifact_key(logical_name, version, "document.json"))

        chunk_path = MANAGED_CHUNKS_DIR / f"{logical_name}_v{version}.json"
        chunk_payload = [{"index": index, "content": chunk.page_content, "metadata": chunk.metadata} for index, chunk in enumerate(chunks)]
        chunk_path.write_text(json.dumps(chunk_payload, ensure_ascii=False, indent=2), encoding="utf-8")
        chunk_storage = upload_json_to_s3(chunk_payload, _artifact_key(logical_name, version, "chunks.json"))
        if chunk_storage:
            safe_unlink(str(chunk_path))

        embedding_path = MANAGED_EMBEDDINGS_DIR / f"{logical_name}_v{version}.json"
        embedding_payload = {
            "document_id": record.id,
            "embedding_model": get_settings().embedding_model,
            "strategy": "full_rebuild",
            "chunk_count": len(chunks),
        }
        embedding_path.write_text(json.dumps(embedding_payload, ensure_ascii=False, indent=2), encoding="utf-8")
        embedding_storage = upload_json_to_s3(embedding_payload, _artifact_key(logical_name, version, "embedding.json"))
        if embedding_storage:
            safe_unlink(str(embedding_path))

        record.json_path = json_storage or str(json_path)
        record.chunk_path = chunk_storage or str(chunk_path)
        record.embedding_path = embedding_storage or str(embedding_path)
        record.status = "review"
        record.error_message = None
        db.commit()
        create_processing_log(db, "document", "review", "문서 검토 대기", document_id=record.id)
        create_audit_log(db, "document_uploaded", "document", str(record.id), f"{logical_name} v{version}")
        db.refresh(record)
        return record
    except Exception as exc:
        record.status = "failed"
        record.error_message = maybe_encrypt(str(exc))
        db.commit()
        create_processing_log(db, "document", "failed", "문서 처리 실패", document_id=record.id, detail=str(exc))
        raise


def delete_document_assets(db: Session, record: DocumentRecord) -> None:
    delete_storage_path(record.pdf_path)
    delete_storage_path(record.md_path)
    delete_storage_path(record.json_path)
    delete_storage_path(record.chunk_path)
    delete_storage_path(record.embedding_path)
    delete_s3_key(record.storage_key)

    record.is_active = False
    record.status = "deleted"
    db.query(ProcessingLog).filter(ProcessingLog.document_id == record.id).delete(synchronize_session=False)
    db.commit()


def hard_delete_document(db: Session, record: DocumentRecord) -> None:
    delete_document_assets(db, record)
    db.delete(record)
    db.commit()
    get_rag_service().index_all(db)


def retry_document_processing(db: Session, record: DocumentRecord) -> DocumentRecord:
    if not record.pdf_path:
        raise ValueError("원본 PDF 경로가 없습니다.")
    if not is_s3_uri(record.pdf_path) and not Path(record.pdf_path).exists():
        raise FileNotFoundError("원본 PDF 파일을 찾을 수 없습니다.")
    record.status = "uploaded"
    record.error_message = None
    db.commit()
    return record


def full_reindex(db: Session) -> None:
    seed_faqs(db)
    sync_faqs_to_file(db)
    get_rag_service().index_all(db)


def approve_document(db: Session, record: DocumentRecord, review_note: str | None = None) -> DocumentRecord:
    if getattr(record, "is_deleted", False):
        raise ValueError("삭제된 문서는 승인할 수 없습니다.")

    if record.parser_type == "faq_json":
        payload = json.loads(read_text_from_storage(record.json_path) or "[]") if record.json_path else []
        for item in payload:
            _upsert_faq_from_payload(db, item)
        sync_faqs_to_file(db)
    else:
        _deactivate_previous_versions(db, record.logical_name, record.id)

    record.status = "ready"
    record.is_active = True
    record.review_note = maybe_encrypt(review_note)
    record.approved_at = datetime.utcnow()
    record.rejected_at = None
    db.commit()
    full_reindex(db)
    create_processing_log(db, "document", "approved", "문서 승인 및 반영 완료", document_id=record.id)
    create_audit_log(db, "document_approved", "document", str(record.id), review_note or record.logical_name)
    db.refresh(record)
    return record


def reject_document(db: Session, record: DocumentRecord, review_note: str | None = None) -> DocumentRecord:
    record.status = "rejected"
    record.is_active = False
    record.review_note = maybe_encrypt(review_note)
    record.rejected_at = datetime.utcnow()
    db.commit()
    create_processing_log(db, "document", "rejected", "문서 반려", document_id=record.id, detail=review_note)
    create_audit_log(db, "document_rejected", "document", str(record.id), review_note or record.logical_name)
    db.refresh(record)
    return record


def soft_delete_document(db: Session, record: DocumentRecord, review_note: str | None = None) -> DocumentRecord:
    record.is_deleted = True
    record.is_active = False
    record.status = "deleted"
    record.deleted_at = datetime.utcnow()
    record.review_note = maybe_encrypt(review_note)
    db.commit()
    full_reindex(db)
    create_processing_log(db, "document", "deleted", "문서 소프트 삭제", document_id=record.id, detail=review_note)
    create_audit_log(db, "document_deleted", "document", str(record.id), review_note or record.logical_name)
    db.refresh(record)
    return record


def restore_document(db: Session, record: DocumentRecord) -> DocumentRecord:
    record.is_deleted = False
    record.deleted_at = None
    record.status = "review"
    record.is_active = False
    db.commit()
    create_processing_log(db, "document", "restored", "문서 복구", document_id=record.id)
    create_audit_log(db, "document_restored", "document", str(record.id), record.logical_name)
    db.refresh(record)
    return record
