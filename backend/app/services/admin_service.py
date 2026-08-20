from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy.orm import Session

from app.config import get_settings
from app.db.models import AdminAuditLog, ChunkRecord, DocumentRecord, FaqRecord, ProcessingLog
from app.services.faq_service import sync_faqs_to_file
from app.services.model_settings import get_active_embedding_model
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
    parse_s3_uri,
    read_text_from_storage,
    safe_unlink,
    upload_file_to_s3,
    upload_json_to_s3,
    upload_text_to_s3,
)
from app.services.transformation_service import (
    convert_markdown_to_faq_items_with_report,
    validate_faq_items,
)
from app.utils.crypto import decrypt_if_needed
from app.utils.pdf_converter import convert_pdf_to_md


def _slugify(value: str) -> str:
    lowered = re.sub(r"[^\w]+", "_", Path(value).stem.lower()).strip("_")
    return lowered or "document"


def _artifact_key(logical_name: str, version: int, filename: str) -> str:
    return build_s3_key("documents", logical_name, f"v{version}", filename)


def _write_text_artifact(
    content: str,
    current_path: str | None,
    local_path: Path,
    storage_key: str,
    content_type: str = "text/plain; charset=utf-8",
) -> str:
    if is_s3_uri(current_path):
        _, current_key = parse_s3_uri(current_path or "")
        stored_uri = upload_text_to_s3(content, current_key, content_type=content_type)
        if not stored_uri:
            raise RuntimeError("S3 문서 저장소에 연결할 수 없습니다.")
        return stored_uri

    target_path = Path(current_path) if current_path else local_path
    target_path.parent.mkdir(parents=True, exist_ok=True)
    target_path.write_text(content, encoding="utf-8")
    stored_uri = upload_text_to_s3(content, storage_key, content_type=content_type)
    if stored_uri:
        safe_unlink(str(target_path))
        return stored_uri
    return str(target_path)


def _write_json_artifact(
    payload: object,
    current_path: str | None,
    local_path: Path,
    storage_key: str,
) -> str:
    return _write_text_artifact(
        json.dumps(payload, ensure_ascii=False, indent=2),
        current_path,
        local_path,
        storage_key,
        content_type="application/json; charset=utf-8",
    )


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
            message=message,
            detail=detail,
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
            detail=detail,
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
        "category": payload.get("category", ""),
        "question": payload.get("question", ""),
        "answer": payload.get("answer", ""),
        "keywords_json": json.dumps(payload.get("keywords", []), ensure_ascii=False),
        "aliases_json": json.dumps(payload.get("aliases", []), ensure_ascii=False),
        "search_hints_json": json.dumps(payload.get("search_hints", []), ensure_ascii=False),
        "source_files_json": json.dumps(payload.get("source_files", []), ensure_ascii=False),
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
        original_filename=filename,
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
            "embedding_model": get_active_embedding_model(),
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
        record.error_message = str(exc)
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
) -> tuple[DocumentRecord, list[dict], dict]:
    ensure_storage_dirs()
    md_content = content.decode("utf-8")
    logical_name = _slugify(Path(filename).stem)
    version = _next_version(db, logical_name)

    managed_md_path = MANAGED_DOCS_DIR / f"{logical_name}_v{version}.md"
    managed_md_path.write_text(md_content, encoding="utf-8")
    md_storage = upload_text_to_s3(md_content, _artifact_key(logical_name, version, "document.md"))
    if md_storage:
        safe_unlink(str(managed_md_path))

    conversion = await convert_markdown_to_faq_items_with_report(md_content, category=category)
    faq_items = conversion["items"]
    managed_json_path = MANAGED_JSON_DIR / f"{logical_name}_v{version}.faq.json"
    managed_json_path.write_text(json.dumps(faq_items, ensure_ascii=False, indent=2), encoding="utf-8")
    faq_json_storage = upload_json_to_s3(faq_items, _artifact_key(logical_name, version, "faq.json"))
    if faq_json_storage:
        safe_unlink(str(managed_json_path))

    record = DocumentRecord(
        logical_name=logical_name,
        version=version,
        original_filename=filename,
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
    create_processing_log(
        db,
        "faq_import",
        "review",
        f"{filename} FAQ JSON 변환 검토 대기 ({conversion['method']})",
        document_id=record.id,
        detail="; ".join(conversion["warnings"]) or None,
    )
    create_audit_log(db, "faq_document_uploaded", "document", str(record.id), f"{logical_name} v{version}")
    return record, faq_items, conversion


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
        original_filename=filename,
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
            "embedding_model": get_active_embedding_model(),
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
        record.error_message = str(exc)
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
    db.query(ChunkRecord).filter(ChunkRecord.document_id == record.id).delete(synchronize_session=False)
    db.query(ProcessingLog).filter(ProcessingLog.document_id == record.id).delete(synchronize_session=False)
    db.commit()


def _delete_document_faq_records(db: Session, record: DocumentRecord) -> bool:
    if record.parser_type != "faq_json":
        return False
    try:
        payload = json.loads(read_text_from_storage(record.json_path) or "[]")
    except json.JSONDecodeError:
        return False
    if not isinstance(payload, list):
        return False
    faq_keys = [str(item.get("id") or "").strip() for item in payload if isinstance(item, dict)]
    faq_keys = [key for key in faq_keys if key]
    if not faq_keys:
        return False
    db.query(FaqRecord).filter(FaqRecord.faq_key.in_(faq_keys)).delete(synchronize_session=False)
    return True


def hard_delete_document(db: Session, record: DocumentRecord) -> None:
    if not record.is_deleted:
        raise ValueError("복구 가능한 삭제 상태의 문서만 영구 삭제할 수 있습니다.")
    document_id = record.id
    logical_name = record.logical_name
    faq_records_deleted = _delete_document_faq_records(db, record)
    delete_document_assets(db, record)
    db.delete(record)
    db.commit()
    if faq_records_deleted:
        sync_faqs_to_file(db)
    create_audit_log(
        db,
        "document_permanently_deleted",
        "document",
        str(document_id),
        logical_name,
    )


def retry_document_processing(db: Session, record: DocumentRecord) -> DocumentRecord:
    if not record.pdf_path:
        raise ValueError("원본 PDF 경로가 없습니다.")
    if not is_s3_uri(record.pdf_path) and not Path(record.pdf_path).exists():
        raise FileNotFoundError("원본 PDF 파일을 찾을 수 없습니다.")
    record.status = "uploaded"
    record.error_message = None
    db.commit()
    return record


def preview_reindex(db: Session) -> dict[str, object]:
    return get_rag_service().preview_reindex(db)


def full_reindex(
    db: Session,
    *,
    force: bool = False,
    expected_fingerprint: str | None = None,
) -> dict[str, object]:
    # 런타임에는 DB를 기준 데이터로 사용한다. 오래된 파일을 DB로 다시 시드하면
    # 방금 비활성화한 FAQ가 되살아날 수 있으므로 DB → 파일 방향만 동기화한다.
    sync_faqs_to_file(db)
    return get_rag_service().index_all(
        db,
        force=force,
        expected_fingerprint=expected_fingerprint,
    )


def _deactivate_faq_items(db: Session, payload: object) -> None:
    if not isinstance(payload, list):
        return
    faq_keys = [str(item.get("id") or "").strip() for item in payload if isinstance(item, dict)]
    faq_keys = [key for key in faq_keys if key]
    if faq_keys:
        db.query(FaqRecord).filter(FaqRecord.faq_key.in_(faq_keys)).update(
            {FaqRecord.is_active: False},
            synchronize_session=False,
        )


def update_document_artifacts(
    db: Session,
    record: DocumentRecord,
    md_content: str,
    json_content: str | None = None,
) -> tuple[DocumentRecord, int]:
    if getattr(record, "is_deleted", False):
        raise ValueError("삭제된 문서는 수정할 수 없습니다.")
    if not md_content.strip():
        raise ValueError("MD 내용은 비워둘 수 없습니다.")

    ensure_storage_dirs()
    previous_json_payload: object = []
    if record.json_path:
        previous_json_text = read_text_from_storage(record.json_path)
        if previous_json_text:
            try:
                previous_json_payload = json.loads(previous_json_text)
            except json.JSONDecodeError:
                previous_json_payload = []

    faq_payload: list[dict] | None = None
    if record.parser_type == "faq_json":
        if json_content is None:
            raise ValueError("FAQ 문서는 JSON 내용도 함께 저장해야 합니다.")
        try:
            raw_payload = json.loads(json_content)
        except json.JSONDecodeError as exc:
            raise ValueError(f"FAQ JSON 문법 오류: {exc.msg} (줄 {exc.lineno}, 열 {exc.colno})") from exc
        faq_payload = validate_faq_items(raw_payload)

    logical_name = record.logical_name
    version = record.version
    old_metadata = previous_json_payload if isinstance(previous_json_payload, dict) else {}
    title = str(old_metadata.get("title") or logical_name)
    category = str(old_metadata.get("category") or "document")
    chunks = []
    if record.parser_type != "faq_json":
        chunks = get_rag_service().build_chunks_for_markdown(
            md_content,
            {
                "file": logical_name,
                "title": title,
                "category": category,
                "document_id": record.id,
                "source_type": "document",
            },
        )
        if not chunks:
            raise ValueError("MD 내용에서 검색에 사용할 수 있는 청크가 생성되지 않았습니다.")

    md_path = _write_text_artifact(
        md_content,
        record.md_path,
        MANAGED_DOCS_DIR / f"{logical_name}_v{version}.md",
        _artifact_key(logical_name, version, "document.md"),
    )

    chunk_count = 0
    if record.parser_type == "faq_json":
        json_path = _write_json_artifact(
            faq_payload or [],
            record.json_path,
            MANAGED_JSON_DIR / f"{logical_name}_v{version}.faq.json",
            _artifact_key(logical_name, version, "faq.json"),
        )
    else:
        rag = get_rag_service()
        rag.replace_document_chunks(db, record.id, chunks)
        chunk_count = len(chunks)

        metadata_payload = {
            **old_metadata,
            "document_id": record.id,
            "logical_name": logical_name,
            "version": version,
            "original_filename": old_metadata.get("original_filename") or decrypt_if_needed(record.original_filename) or logical_name,
            "title": title,
            "category": category,
            "status": "review",
            "chunk_count": chunk_count,
        }
        json_path = _write_json_artifact(
            metadata_payload,
            record.json_path,
            MANAGED_JSON_DIR / f"{logical_name}_v{version}.json",
            _artifact_key(logical_name, version, "document.json"),
        )

        chunk_payload = [
            {"index": index, "content": chunk.page_content, "metadata": chunk.metadata}
            for index, chunk in enumerate(chunks)
        ]
        record.chunk_path = _write_json_artifact(
            chunk_payload,
            record.chunk_path,
            MANAGED_CHUNKS_DIR / f"{logical_name}_v{version}.json",
            _artifact_key(logical_name, version, "chunks.json"),
        )
        embedding_payload = {
            "document_id": record.id,
            "embedding_model": get_active_embedding_model(),
            "strategy": "full_rebuild_on_approval",
            "chunk_count": chunk_count,
        }
        record.embedding_path = _write_json_artifact(
            embedding_payload,
            record.embedding_path,
            MANAGED_EMBEDDINGS_DIR / f"{logical_name}_v{version}.json",
            _artifact_key(logical_name, version, "embedding.json"),
        )

    was_active = bool(record.is_active)
    if was_active and record.parser_type == "faq_json":
        _deactivate_faq_items(db, previous_json_payload)

    record.md_path = md_path
    record.json_path = json_path
    record.status = "review"
    record.is_active = False
    record.approved_at = None
    record.rejected_at = None
    record.error_message = None
    db.commit()

    if was_active and record.parser_type == "faq_json":
        sync_faqs_to_file(db)
    if was_active:
        full_reindex(db)
    create_processing_log(db, "document", "review", "변환 결과 수정 후 재검토 대기", document_id=record.id)
    create_audit_log(db, "document_artifacts_updated", "document", str(record.id), f"chunks={chunk_count}")
    db.refresh(record)
    return record, chunk_count


async def reconvert_faq_document(
    db: Session,
    record: DocumentRecord,
    category: str | None = None,
) -> tuple[DocumentRecord, dict]:
    if record.parser_type != "faq_json":
        raise ValueError("FAQ JSON 문서만 다시 변환할 수 있습니다.")
    markdown = read_text_from_storage(record.md_path)
    if not markdown or not markdown.strip():
        raise ValueError("변환할 MD 내용을 찾을 수 없습니다.")

    if not category and record.json_path:
        try:
            current_payload = json.loads(read_text_from_storage(record.json_path) or "[]")
            if isinstance(current_payload, list) and current_payload and isinstance(current_payload[0], dict):
                category = str(current_payload[0].get("category") or "").strip() or None
        except json.JSONDecodeError:
            category = None

    result = await convert_markdown_to_faq_items_with_report(markdown, category=category)
    updated, _ = update_document_artifacts(
        db,
        record,
        markdown,
        json.dumps(result["items"], ensure_ascii=False, indent=2),
    )
    create_processing_log(
        db,
        "faq_import",
        "review",
        f"FAQ JSON 재변환 완료 ({result['method']})",
        document_id=record.id,
        detail="; ".join(result["warnings"]) or None,
    )
    return updated, result


def approve_document(db: Session, record: DocumentRecord, review_note: str | None = None) -> DocumentRecord:
    if getattr(record, "is_deleted", False):
        raise ValueError("삭제된 문서는 승인할 수 없습니다.")
    if record.status not in {"review", "rejected"}:
        raise ValueError("검토 대기 상태의 문서만 승인할 수 있습니다.")

    if record.parser_type == "faq_json":
        raw_payload = json.loads(read_text_from_storage(record.json_path) or "[]") if record.json_path else []
        payload = validate_faq_items(raw_payload)
        for item in payload:
            _upsert_faq_from_payload(db, item)
        sync_faqs_to_file(db)
    else:
        _deactivate_previous_versions(db, record.logical_name, record.id)

    record.status = "ready"
    record.is_active = True
    record.review_note = review_note
    record.approved_at = datetime.now(timezone.utc)
    record.rejected_at = None
    db.commit()
    full_reindex(db)
    create_processing_log(db, "document", "approved", "문서 승인 및 반영 완료", document_id=record.id)
    create_audit_log(db, "document_approved", "document", str(record.id), review_note or record.logical_name)
    db.refresh(record)
    return record


def reject_document(db: Session, record: DocumentRecord, review_note: str | None = None) -> DocumentRecord:
    was_active = bool(record.is_active)
    if was_active and record.parser_type == "faq_json":
        try:
            _deactivate_faq_items(db, json.loads(read_text_from_storage(record.json_path) or "[]"))
        except json.JSONDecodeError:
            pass
        sync_faqs_to_file(db)
    record.status = "rejected"
    record.is_active = False
    record.review_note = review_note
    record.rejected_at = datetime.now(timezone.utc)
    db.commit()
    if was_active:
        full_reindex(db)
    create_processing_log(db, "document", "rejected", "문서 반려", document_id=record.id, detail=review_note)
    create_audit_log(db, "document_rejected", "document", str(record.id), review_note or record.logical_name)
    db.refresh(record)
    return record


def soft_delete_document(db: Session, record: DocumentRecord, review_note: str | None = None) -> DocumentRecord:
    if record.is_deleted:
        return record
    record.pre_delete_status = record.status
    record.pre_delete_is_active = bool(record.is_active)
    record.pre_delete_review_note = record.review_note
    if record.parser_type == "faq_json":
        try:
            _deactivate_faq_items(db, json.loads(read_text_from_storage(record.json_path) or "[]"))
        except json.JSONDecodeError:
            pass
        sync_faqs_to_file(db)
    record.is_deleted = True
    record.is_active = False
    record.status = "deleted"
    record.deleted_at = datetime.now(timezone.utc)
    record.review_note = review_note
    db.commit()
    full_reindex(db)
    create_processing_log(db, "document", "deleted", "문서 소프트 삭제", document_id=record.id, detail=review_note)
    create_audit_log(db, "document_deleted", "document", str(record.id), review_note or record.logical_name)
    db.refresh(record)
    return record


def restore_document(db: Session, record: DocumentRecord) -> DocumentRecord:
    if not record.is_deleted:
        return record
    restored_status = record.pre_delete_status or "review"
    restored_is_active = bool(record.pre_delete_is_active)
    restored_review_note = record.pre_delete_review_note
    if restored_is_active and record.parser_type == "faq_json":
        try:
            for item in json.loads(read_text_from_storage(record.json_path) or "[]"):
                _upsert_faq_from_payload(db, item)
        except json.JSONDecodeError:
            restored_status = "review"
            restored_is_active = False
        sync_faqs_to_file(db)
    record.is_deleted = False
    record.deleted_at = None
    record.status = restored_status
    record.is_active = restored_is_active
    record.review_note = restored_review_note
    record.pre_delete_status = None
    record.pre_delete_is_active = None
    record.pre_delete_review_note = None
    db.commit()
    if restored_is_active:
        full_reindex(db)
    create_processing_log(db, "document", "restored", "문서 복구", document_id=record.id)
    create_audit_log(db, "document_restored", "document", str(record.id), record.logical_name)
    db.refresh(record)
    return record
