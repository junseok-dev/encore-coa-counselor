import csv
import io
import json
from datetime import date, datetime, time
from pathlib import Path

import jwt
from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Query, UploadFile
from fastapi.responses import Response
from openai import AsyncOpenAI
from openpyxl import Workbook
from pydantic import BaseModel
from sqlalchemy import inspect as sa_inspect, text
from sqlalchemy.orm import Session

from app.config import ENV_FILE_PATH, get_settings
from app.db.crud import get_all_sessions, get_session_messages
from app.db.database import get_db
from app.db.models import AdminAuditLog, AdminUser, ChatLog, ChatSession, CustomColumn, CustomTable, DocumentRecord, FaqRecord, ProcessingLog, PromptConfig
from app.models.session import MessageDetail, SessionDetail, SessionSummary
from app.services.admin_service import (
    approve_document,
    create_audit_log,
    full_reindex,
    process_catalog_import,
    process_uploaded_faq_md,
    process_uploaded_md,
    process_uploaded_pdf,
    reject_document,
    restore_document,
    soft_delete_document,
)
from app.services.faq_service import _serialize_faq, seed_faqs, sync_faqs_to_file
from app.services.model_settings import get_active_model, set_active_model
from app.services.prompt_service import PROMPT_DEFAULTS, seed_prompt_configs, serialize_prompt
from app.services.storage_service import read_text_from_storage, storage_exists
from app.utils.crypto import ENCRYPTED_PREFIX, decrypt_if_needed, encrypt, maybe_encrypt

router = APIRouter()

ENV_PATH = ENV_FILE_PATH
PROTECTED_PROMPTS = set(PROMPT_DEFAULTS.keys())

TABLE_DESCRIPTIONS: dict[str, str] = {
    "chat_sessions": "사용자 채팅 세션 목록 — 세션 ID, 생성 시간, 메시지 수 등",
    "chat_messages": "채팅 메시지 내역 — 역할(user/assistant), 소스, 생성 시간 등",
    "chat_logs": "RAG 처리 로그 — 질문, 검색 청크, 답변, LLM 비용 등",
    "documents": "문서 관리 — 업로드·파싱·임베딩·승인 상태 추적",
    "chunks": "문서 청크 — RAG 검색에 사용되는 텍스트 조각",
    "cancel_requests": "취소 요청 내역",
    "processing_logs": "문서 처리 로그 — 파싱, 임베딩 등 단계별 처리 결과",
    "prompt_configs": "LLM 프롬프트 설정 — 시스템 프롬프트, 스타일 가이드 등",
    "faqs": "FAQ 데이터 — 질문, 답변, 키워드, 카테고리",
    "admin_audit_logs": "관리자 감사 로그 — 누가, 무엇을, 언제 수행했는지",
    "custom_tables": "사용자 정의 테이블 메타데이터 (데이터 관리 탭에서 생성한 테이블 목록)",
    "custom_columns": "사용자 정의 테이블 컬럼 정의",
}


def verify_admin(authorization: str = Header(None)) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="인증이 필요합니다.")
    token = authorization[7:]
    try:
        payload = jwt.decode(token, get_settings().jwt_secret, algorithms=["HS256"])
        return payload["sub"]
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="세션이 만료되었습니다. 다시 로그인해주세요.")
    except Exception:
        raise HTTPException(status_code=401, detail="인증에 실패했습니다.")


class PasswordChangeRequest(BaseModel):
    new_password: str


class ModelChangeRequest(BaseModel):
    model_name: str


class ReviewRequest(BaseModel):
    note: str | None = None


class FaqItemPayload(BaseModel):
    id: str
    category: str
    question: str
    answer: str
    keywords: list[str] = []
    aliases: list[str] = []
    search_hints: list[str] = []
    source_files: list[str] = []
    direct_answer: bool = False
    top_k: int = 4


class PromptPayload(BaseModel):
    prompt_key: str
    label: str
    content: str


def _serialize_document(record: DocumentRecord) -> dict:
    return {
        "id": record.id,
        "logical_name": record.logical_name,
        "version": record.version,
        "original_filename": decrypt_if_needed(record.original_filename) or "",
        "status": record.status,
        "parser_type": record.parser_type,
        "is_active": record.is_active,
        "is_deleted": getattr(record, "is_deleted", False),
        "review_note": decrypt_if_needed(getattr(record, "review_note", None)),
        "approved_at": getattr(record, "approved_at", None),
        "rejected_at": getattr(record, "rejected_at", None),
        "deleted_at": getattr(record, "deleted_at", None),
        "error_message": decrypt_if_needed(record.error_message),
        "created_at": record.created_at,
        "updated_at": record.updated_at,
        "has_md": storage_exists(record.md_path),
        "has_json": storage_exists(record.json_path),
        "has_pdf": storage_exists(record.pdf_path) or bool(record.storage_key),
    }


def _read_optional_text(path_value: str | None) -> str | None:
    return read_text_from_storage(path_value)


def _serialize_processing_log(row: ProcessingLog) -> dict:
    return {
        "id": row.id,
        "document_id": row.document_id,
        "log_type": row.log_type,
        "status": row.status,
        "message": decrypt_if_needed(row.message) or "",
        "detail": decrypt_if_needed(row.detail),
        "created_at": row.created_at,
    }


def _serialize_chat_log(row: ChatLog) -> dict:
    retrieval_chunks = decrypt_if_needed(row.retrieval_chunks) or "[]"
    return {
        "id": row.id,
        "session_id": row.session_id,
        "question": decrypt_if_needed(row.question) or "",
        "retrieval_chunks": json.loads(retrieval_chunks or "[]"),
        "answer": decrypt_if_needed(row.answer) or "",
        "source": row.source,
        "error": decrypt_if_needed(row.error),
        "processing_status": row.processing_status,
        "embedding_cost": row.embedding_cost,
        "llm_cost": row.llm_cost,
        "created_at": row.created_at,
    }


def _serialize_audit_log(row: AdminAuditLog) -> dict:
    return {
        "id": row.id,
        "actor": row.actor,
        "action": row.action,
        "target_type": row.target_type,
        "target_id": row.target_id,
        "detail": decrypt_if_needed(row.detail),
        "created_at": row.created_at,
    }


def _crypt_value(value: str | None, should_encrypt: bool) -> str | None:
    if value is None:
        return None
    if not value:
        return value
    if should_encrypt:
        return maybe_encrypt(value)
    if value.startswith(ENCRYPTED_PREFIX):
        return decrypt_if_needed(value)
    return value


def _upsert_faq_row(db: Session, payload: FaqItemPayload) -> FaqRecord:
    row = db.query(FaqRecord).filter(FaqRecord.faq_key == payload.id).first()
    enc = get_settings().encrypt_faq
    values = {
        "category": _crypt_value(payload.category, enc),
        "question": _crypt_value(payload.question, enc),
        "answer": _crypt_value(payload.answer, enc),
        "keywords_json": _crypt_value(json.dumps(payload.keywords, ensure_ascii=False), enc),
        "aliases_json": _crypt_value(json.dumps(payload.aliases, ensure_ascii=False), enc),
        "search_hints_json": _crypt_value(json.dumps(payload.search_hints, ensure_ascii=False), enc),
        "source_files_json": _crypt_value(json.dumps(payload.source_files, ensure_ascii=False), enc),
        "direct_answer": payload.direct_answer,
        "top_k": payload.top_k,
        "is_active": True,
    }
    if row:
        for key, value in values.items():
            setattr(row, key, value)
    else:
        row = FaqRecord(faq_key=payload.id, **values)
        db.add(row)
    db.commit()
    db.refresh(row)
    create_audit_log(db, "faq_saved", "faq", payload.id, payload.question)
    return row


def _build_workbook(rows: list[dict]) -> bytes:
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "chat_logs"
    sheet.append(["session_id", "question", "answer", "source", "processing_status", "embedding_cost", "llm_cost", "created_at"])
    for row in rows:
        sheet.append(
            [
                row["session_id"],
                row["question"],
                row["answer"],
                row["source"],
                row["processing_status"],
                row["embedding_cost"],
                row["llm_cost"],
                row["created_at"].isoformat() if row["created_at"] else "",
            ]
        )
    buffer = io.BytesIO()
    workbook.save(buffer)
    buffer.seek(0)
    return buffer.getvalue()


def _filter_chat_logs(db: Session, start_date: date | None = None, end_date: date | None = None, session_id: str | None = None, limit: int | None = 500) -> list[ChatLog]:
    query = db.query(ChatLog)
    if start_date:
        query = query.filter(ChatLog.created_at >= datetime.combine(start_date, time.min))
    if end_date:
        query = query.filter(ChatLog.created_at <= datetime.combine(end_date, time.max))
    if session_id:
        query = query.filter(ChatLog.session_id == session_id)
    query = query.order_by(ChatLog.created_at.desc())
    if limit is not None:  # limit=None이면 전량 (엑셀 내보내기용)
        query = query.limit(limit)
    return query.all()


@router.get("/sessions", response_model=list[SessionSummary])
def list_sessions(skip: int = 0, limit: int = 50, db: Session = Depends(get_db), _: None = Depends(verify_admin)):
    sessions = get_all_sessions(db, skip=skip, limit=limit)
    result = []
    for session in sessions:
        summary = SessionSummary.model_validate(session)
        summary.user_name = decrypt_if_needed(session.encrypted_user_name) if session.encrypted_user_name else None
        result.append(summary)
    return result


@router.get("/sessions/{session_id}", response_model=SessionDetail)
def get_session_detail(session_id: str, db: Session = Depends(get_db), _: None = Depends(verify_admin)):
    session = db.query(ChatSession).filter(ChatSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다.")
    messages = get_session_messages(db, session_id)
    summary = SessionSummary.model_validate(session)
    summary.user_name = decrypt_if_needed(session.encrypted_user_name) if session.encrypted_user_name else None
    decrypted_messages = []
    for message in messages:
        detail = MessageDetail.model_validate(message)
        detail.content = decrypt_if_needed(message.content) or ""
        decrypted_messages.append(detail)
    return SessionDetail(session=summary, messages=decrypted_messages)


@router.post("/upload-md")
async def upload_md(file: UploadFile = File(...), title: str = Form(None), category: str = Form(None), db: Session = Depends(get_db), _: None = Depends(verify_admin)):
    if not file.filename or not file.filename.lower().endswith(".md"):
        raise HTTPException(status_code=400, detail="MD 파일만 업로드할 수 있습니다.")
    record = await process_uploaded_md(db, file.filename, await file.read(), title=title, category=category)
    return {"message": "MD 업로드 후 검토 대기 상태로 저장했습니다.", "document": _serialize_document(record)}


@router.post("/upload-faq-md")
async def upload_faq_md(file: UploadFile = File(...), category: str = Form(None), db: Session = Depends(get_db), _: None = Depends(verify_admin)):
    if not file.filename or not file.filename.lower().endswith(".md"):
        raise HTTPException(status_code=400, detail="MD 파일만 업로드할 수 있습니다.")
    record, faq_items = await process_uploaded_faq_md(db, file.filename, await file.read(), category=category)
    return {
        "message": "FAQ 변환 결과를 생성했고, 아직 운영 반영 전입니다.",
        "document": _serialize_document(record),
        "faqs": faq_items,
    }


@router.post("/import-catalog")
async def import_catalog(catalog: UploadFile = File(...), files: list[UploadFile] = File(...), db: Session = Depends(get_db), _: None = Depends(verify_admin)):
    if not catalog.filename or not catalog.filename.lower().endswith(".json"):
        raise HTTPException(status_code=400, detail="catalog는 JSON 파일이어야 합니다.")
    catalog_data = json.loads(await catalog.read())
    md_files = {f.filename: await f.read() for f in files if f.filename and f.filename.lower().endswith(".md")}
    records = await process_catalog_import(db, catalog_data, md_files)
    return {"message": f"{len(records)}개 문서를 검토 대기 상태로 가져왔습니다.", "documents": [_serialize_document(r) for r in records]}


@router.post("/upload-pdf")
async def upload_pdf(file: UploadFile = File(...), db: Session = Depends(get_db), _: None = Depends(verify_admin)):
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="PDF 파일만 업로드할 수 있습니다.")
    record = await process_uploaded_pdf(db, file.filename, await file.read())
    return {"message": "PDF 업로드와 MD 변환이 완료되었고, 현재 검토 대기 상태입니다.", "document": _serialize_document(record)}


@router.get("/documents")
def list_documents(
    parser_type: str | None = Query(default=None),
    include_deleted: bool = Query(default=False),
    status: str | None = Query(default=None),
    db: Session = Depends(get_db),
    _: None = Depends(verify_admin),
):
    query = db.query(DocumentRecord).order_by(DocumentRecord.created_at.desc())
    if parser_type:
        query = query.filter(DocumentRecord.parser_type == parser_type)
    if not include_deleted:
        query = query.filter(DocumentRecord.is_deleted.is_(False))
    if status:
        query = query.filter(DocumentRecord.status == status)
    return {"documents": [_serialize_document(row) for row in query.all()]}


@router.get("/documents/{document_id}")
def get_document_detail(document_id: int, db: Session = Depends(get_db), _: None = Depends(verify_admin)):
    record = db.query(DocumentRecord).filter(DocumentRecord.id == document_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="문서를 찾을 수 없습니다.")
    return {"document": _serialize_document(record), "md_content": _read_optional_text(record.md_path), "json_content": _read_optional_text(record.json_path)}


@router.post("/documents/{document_id}/approve")
def approve_document_route(document_id: int, body: ReviewRequest, db: Session = Depends(get_db), _: None = Depends(verify_admin)):
    record = db.query(DocumentRecord).filter(DocumentRecord.id == document_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="문서를 찾을 수 없습니다.")
    updated = approve_document(db, record, body.note)
    return {"message": "문서를 승인해 운영 데이터에 반영했습니다.", "document": _serialize_document(updated)}


@router.post("/documents/{document_id}/reject")
def reject_document_route(document_id: int, body: ReviewRequest, db: Session = Depends(get_db), _: None = Depends(verify_admin)):
    record = db.query(DocumentRecord).filter(DocumentRecord.id == document_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="문서를 찾을 수 없습니다.")
    updated = reject_document(db, record, body.note)
    return {"message": "문서를 반려했습니다.", "document": _serialize_document(updated)}


@router.post("/documents/{document_id}/restore")
def restore_document_route(document_id: int, db: Session = Depends(get_db), _: None = Depends(verify_admin)):
    record = db.query(DocumentRecord).filter(DocumentRecord.id == document_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="문서를 찾을 수 없습니다.")
    updated = restore_document(db, record)
    return {"message": "문서를 복구해 다시 검토 대기 상태로 돌렸습니다.", "document": _serialize_document(updated)}


@router.delete("/documents/{document_id}")
def delete_document(document_id: int, note: str | None = Query(default=None), db: Session = Depends(get_db), _: None = Depends(verify_admin)):
    record = db.query(DocumentRecord).filter(DocumentRecord.id == document_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="문서를 찾을 수 없습니다.")
    updated = soft_delete_document(db, record, note)
    return {"message": "문서를 삭제 처리했습니다.", "document": _serialize_document(updated)}


@router.post("/documents/{document_id}/retry")
def retry_document(document_id: int, db: Session = Depends(get_db), _: None = Depends(verify_admin)):
    record = db.query(DocumentRecord).filter(DocumentRecord.id == document_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="문서를 찾을 수 없습니다.")
    if record.status != "failed":
        return {"message": "현재 문서는 재처리 대상이 아닙니다."}
    return {"message": "재처리는 같은 파일을 다시 업로드하는 방식으로 진행합니다."}


@router.post("/reindex")
def reindex(db: Session = Depends(get_db), _: None = Depends(verify_admin)):
    full_reindex(db)
    create_audit_log(db, "reindex", "system", "global", "full_rebuild")
    return {"message": "전체 인덱스를 다시 생성했습니다.", "strategy": "full_rebuild"}


@router.get("/faqs")
def get_faqs(db: Session = Depends(get_db), _: None = Depends(verify_admin)):
    seed_faqs(db)
    rows = db.query(FaqRecord).filter(FaqRecord.is_active.is_(True)).order_by(FaqRecord.id.asc()).all()
    return {"faqs": [_serialize_faq(row) for row in rows]}


@router.post("/faqs")
def create_faq(body: FaqItemPayload, db: Session = Depends(get_db), _: None = Depends(verify_admin)):
    row = _upsert_faq_row(db, body)
    sync_faqs_to_file(db)
    full_reindex(db)
    return {"message": "FAQ를 추가했습니다.", "faq": _serialize_faq(row)}


@router.put("/faqs/{faq_key}")
def update_faq(faq_key: str, body: FaqItemPayload, db: Session = Depends(get_db), _: None = Depends(verify_admin)):
    if faq_key != body.id:
        raise HTTPException(status_code=400, detail="FAQ 키가 일치하지 않습니다.")
    row = _upsert_faq_row(db, body)
    sync_faqs_to_file(db)
    full_reindex(db)
    return {"message": "FAQ를 수정했습니다.", "faq": _serialize_faq(row)}


@router.delete("/faqs/{faq_key}")
def delete_faq(faq_key: str, db: Session = Depends(get_db), _: None = Depends(verify_admin)):
    row = db.query(FaqRecord).filter(FaqRecord.faq_key == faq_key).first()
    if not row:
        raise HTTPException(status_code=404, detail="FAQ를 찾을 수 없습니다.")
    row.is_active = False
    db.commit()
    sync_faqs_to_file(db)
    full_reindex(db)
    create_audit_log(db, "faq_deleted", "faq", faq_key)
    return {"message": "FAQ를 삭제했습니다."}


@router.get("/prompts")
def get_prompts(db: Session = Depends(get_db), _: None = Depends(verify_admin)):
    seed_prompt_configs(db)
    prompts = db.query(PromptConfig).order_by(PromptConfig.id.asc()).all()
    return {"prompts": [serialize_prompt(row) for row in prompts]}


@router.post("/prompts")
def create_prompt(body: PromptPayload, db: Session = Depends(get_db), _: None = Depends(verify_admin)):
    existing = db.query(PromptConfig).filter(PromptConfig.prompt_key == body.prompt_key).first()
    if existing:
        raise HTTPException(status_code=409, detail="같은 키의 프롬프트가 이미 있습니다.")
    enc = get_settings().encrypt_prompt
    stored_content = encrypt(body.content) if enc else body.content
    row = PromptConfig(prompt_key=body.prompt_key, label=body.label, content=stored_content)
    db.add(row)
    db.commit()
    db.refresh(row)
    create_audit_log(db, "prompt_created", "prompt", body.prompt_key, body.label)
    return {"message": "프롬프트를 추가했습니다.", "prompt": serialize_prompt(row)}


@router.put("/prompts/{prompt_key}")
def update_prompt(prompt_key: str, body: PromptPayload, db: Session = Depends(get_db), _: None = Depends(verify_admin)):
    if prompt_key != body.prompt_key:
        raise HTTPException(status_code=400, detail="프롬프트 키가 일치하지 않습니다.")
    row = db.query(PromptConfig).filter(PromptConfig.prompt_key == prompt_key).first()
    if not row:
        raise HTTPException(status_code=404, detail="프롬프트를 찾을 수 없습니다.")
    enc = get_settings().encrypt_prompt
    row.label = body.label
    row.content = encrypt(body.content) if enc else body.content
    db.commit()
    db.refresh(row)
    create_audit_log(db, "prompt_updated", "prompt", body.prompt_key, body.label)
    return {"message": "프롬프트를 수정했습니다.", "prompt": serialize_prompt(row)}


@router.delete("/prompts/{prompt_key}")
def delete_prompt(prompt_key: str, db: Session = Depends(get_db), _: None = Depends(verify_admin)):
    if prompt_key in PROTECTED_PROMPTS:
        raise HTTPException(status_code=400, detail="기본 시스템 프롬프트는 삭제할 수 없습니다.")
    row = db.query(PromptConfig).filter(PromptConfig.prompt_key == prompt_key).first()
    if not row:
        raise HTTPException(status_code=404, detail="프롬프트를 찾을 수 없습니다.")
    db.delete(row)
    db.commit()
    create_audit_log(db, "prompt_deleted", "prompt", prompt_key)
    return {"message": "프롬프트를 삭제했습니다."}


@router.get("/logs")
def get_logs(limit: int = 100, db: Session = Depends(get_db), _: None = Depends(verify_admin)):
    processing_logs = db.query(ProcessingLog).order_by(ProcessingLog.created_at.desc()).limit(limit).all()
    chat_logs = db.query(ChatLog).order_by(ChatLog.created_at.desc()).limit(limit).all()
    audit_logs = db.query(AdminAuditLog).order_by(AdminAuditLog.created_at.desc()).limit(limit).all()
    return {
        "processing_logs": [_serialize_processing_log(row) for row in processing_logs],
        "chat_logs": [_serialize_chat_log(row) for row in chat_logs],
        "audit_logs": [_serialize_audit_log(row) for row in audit_logs],
    }


@router.get("/audit-logs")
def get_audit_logs(limit: int = 100, db: Session = Depends(get_db), _: None = Depends(verify_admin)):
    rows = db.query(AdminAuditLog).order_by(AdminAuditLog.created_at.desc()).limit(limit).all()
    return {"audit_logs": [_serialize_audit_log(row) for row in rows]}


@router.get("/chat-logs")
def list_chat_logs(start_date: date | None = None, end_date: date | None = None, session_id: str | None = None, db: Session = Depends(get_db), _: None = Depends(verify_admin)):
    rows = _filter_chat_logs(db, start_date=start_date, end_date=end_date, session_id=session_id)
    return {"chat_logs": [_serialize_chat_log(row) for row in rows]}


@router.get("/chat-logs/export")
def export_chat_logs(start_date: date | None = None, end_date: date | None = None, session_id: str | None = None, db: Session = Depends(get_db), _: None = Depends(verify_admin)):
    rows = [_serialize_chat_log(row) for row in _filter_chat_logs(db, start_date=start_date, end_date=end_date, session_id=session_id, limit=None)]
    payload = _build_workbook(rows)
    filename = f"chat_logs_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
    return Response(
        content=payload,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ── 커스텀 데이터 관리 ──────────────────────────────────────────


class CreateTableRequest(BaseModel):
    name: str
    description: str = ""


class CreateColumnRequest(BaseModel):
    column_name: str
    column_type: str = "text"  # text | number | date


class UpsertRowRequest(BaseModel):
    data: dict


class UpdateColumnRequest(BaseModel):
    column_name: str


class ReorderColumnRequest(BaseModel):
    direction: str  # "up" | "down"


@router.get("/data-tables")
def list_data_tables(db: Session = Depends(get_db), _: None = Depends(verify_admin)):
    tables = db.query(CustomTable).order_by(CustomTable.created_at.desc()).all()
    inspector = sa_inspect(db.bind)
    existing_tables = set(inspector.get_table_names())
    result = []
    for t in tables:
        real_table = f"cdata_{t.id}"
        if real_table in existing_tables:
            try:
                row_count = db.execute(text(f'SELECT COUNT(*) FROM "{real_table}"')).scalar() or 0  # noqa: S608
            except Exception:
                row_count = 0
        else:
            row_count = 0
        result.append({"id": t.id, "name": t.name, "description": t.description, "row_count": row_count, "created_at": t.created_at})
    return {"tables": result}


@router.post("/data-tables", status_code=201)
def create_data_table(body: CreateTableRequest, db: Session = Depends(get_db), _: None = Depends(verify_admin)):
    if not body.name.strip():
        raise HTTPException(status_code=400, detail="테이블 이름을 입력해주세요.")
    table = CustomTable(name=body.name.strip(), description=body.description.strip())
    db.add(table)
    db.commit()
    db.refresh(table)
    real_table = f"cdata_{table.id}"
    db.execute(text(f'CREATE TABLE IF NOT EXISTS "{real_table}" (id SERIAL PRIMARY KEY, created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(), updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW())'))  # noqa: S608
    db.commit()
    create_audit_log(db, "data_table_created", "custom_table", str(table.id), body.name)
    return {"id": table.id, "name": table.name, "description": table.description}


@router.get("/data-tables/export-all")
def export_all_data_tables(db: Session = Depends(get_db), _: None = Depends(verify_admin)):
    tables = db.query(CustomTable).order_by(CustomTable.created_at.asc()).all()
    inspector = sa_inspect(db.bind)
    existing_tables = set(inspector.get_table_names())

    wb = Workbook()
    ws_index = wb.active
    ws_index.title = "개요"
    ws_index.append(["테이블명", "설명", "행 수", "생성일시"])

    used_sheet_names: set[str] = {"개요"}

    for t in tables:
        real_table = f"cdata_{t.id}"
        cols = db.query(CustomColumn).filter(CustomColumn.table_id == t.id).order_by(CustomColumn.sort_order, CustomColumn.id).all()
        col_names = [c.column_name for c in cols]

        rows: list = []
        if real_table in existing_tables and col_names:
            try:
                select_cols = ", ".join([_qi(cn) for cn in col_names])
                raw = db.execute(text(f'SELECT id, {select_cols}, created_at FROM "{real_table}" ORDER BY id')).fetchall()  # noqa: S608
                rows = list(raw)
            except Exception:
                rows = []

        ws_index.append([t.name, t.description or "", len(rows), t.created_at.isoformat() if t.created_at else ""])

        # 시트 이름 충돌 방지
        sheet_name = t.name[:28]
        if sheet_name in used_sheet_names:
            sheet_name = f"{sheet_name[:25]}_{t.id}"
        used_sheet_names.add(sheet_name)

        ws = wb.create_sheet(title=sheet_name)
        ws.append(["ID"] + col_names + ["생성일시"])
        for r in rows:
            row_vals = list(r[1:-1]) if col_names else []
            created = r[-1].isoformat() if r[-1] else ""
            ws.append([r[0]] + row_vals + [created])

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    filename = f"all_data_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
    return Response(
        content=buf.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.delete("/data-tables/{table_id}")
def delete_data_table(table_id: int, db: Session = Depends(get_db), _: None = Depends(verify_admin)):
    table = db.query(CustomTable).filter(CustomTable.id == table_id).first()
    if not table:
        raise HTTPException(status_code=404, detail="테이블을 찾을 수 없습니다.")
    table_name = table.name  # commit 후엔 ORM 인스턴스가 만료되므로 미리 보관
    real_table = f"cdata_{table_id}"
    db.execute(text(f'DROP TABLE IF EXISTS "{real_table}"'))  # noqa: S608
    db.query(CustomColumn).filter(CustomColumn.table_id == table_id).delete()
    db.delete(table)
    db.commit()
    create_audit_log(db, "data_table_deleted", "custom_table", str(table_id), table_name)
    return {"message": "삭제되었습니다."}


@router.get("/data-tables/{table_id}")
def get_data_table(table_id: int, db: Session = Depends(get_db), _: None = Depends(verify_admin)):
    table = db.query(CustomTable).filter(CustomTable.id == table_id).first()
    if not table:
        raise HTTPException(status_code=404, detail="테이블을 찾을 수 없습니다.")
    columns = db.query(CustomColumn).filter(CustomColumn.table_id == table_id).order_by(CustomColumn.sort_order, CustomColumn.id).all()
    col_names = [c.column_name for c in columns]
    real_table = f"cdata_{table_id}"
    rows: list[dict] = []
    inspector = sa_inspect(db.bind)
    if real_table in inspector.get_table_names():
        select_cols = ", ".join([_qi(cn) for cn in col_names]) if col_names else "1 as _empty"
        raw_rows = db.execute(text(f'SELECT id, {select_cols}, created_at FROM "{real_table}" ORDER BY id DESC')).fetchall()  # noqa: S608
        for r in raw_rows:
            row_data = dict(zip(col_names, list(r)[1:-1]))
            rows.append({"id": r[0], "data": row_data, "created_at": r[-1]})
    return {
        "id": table.id,
        "name": table.name,
        "description": table.description,
        "columns": [{"id": c.id, "column_name": c.column_name, "column_type": c.column_type, "sort_order": c.sort_order} for c in columns],
        "rows": rows,
    }


_COL_TYPE_MAP = {"text": "TEXT", "number": "NUMERIC", "date": "DATE"}


def _qi(name: str) -> str:
    """SQL 식별자 안전 인용: 내부 큰따옴표를 이스케이프해 인젝션을 차단한다. (한글 등 유니코드 컬럼명은 그대로 허용)"""
    return '"' + str(name).replace('"', '""') + '"'


def _validate_col_name(name: str) -> str:
    """사용자 입력 컬럼명 검증: 위험 문자(큰따옴표/제어문자) 차단 + 길이 제한. 한글·공백은 허용."""
    cleaned = (name or "").strip()
    if not cleaned:
        raise HTTPException(status_code=400, detail="컬럼 이름을 입력해주세요.")
    if len(cleaned) > 63 or '"' in cleaned or any(ord(ch) < 32 for ch in cleaned):
        raise HTTPException(status_code=400, detail='컬럼 이름에 큰따옴표(")나 제어문자는 사용할 수 없으며 63자 이하여야 합니다.')
    return cleaned


def _validate_row_keys(db: Session, table_id: int, data: dict) -> None:
    """행 데이터의 키가 실제 등록된 컬럼인지 검증 (식별자 인젝션·오타 키 차단)."""
    valid = {c.column_name for c in db.query(CustomColumn).filter(CustomColumn.table_id == table_id).all()}
    invalid = [k for k in data if k not in valid]
    if invalid:
        raise HTTPException(status_code=400, detail=f"존재하지 않는 컬럼입니다: {', '.join(invalid)}")


@router.post("/data-tables/{table_id}/columns", status_code=201)
def add_column(table_id: int, body: CreateColumnRequest, db: Session = Depends(get_db), _: None = Depends(verify_admin)):
    if not db.query(CustomTable).filter(CustomTable.id == table_id).first():
        raise HTTPException(status_code=404, detail="테이블을 찾을 수 없습니다.")
    if not body.column_name.strip():
        raise HTTPException(status_code=400, detail="컬럼 이름을 입력해주세요.")
    if body.column_type not in ("text", "number", "date"):
        raise HTTPException(status_code=400, detail="컬럼 타입은 text, number, date 중 하나여야 합니다.")
    max_order = db.query(CustomColumn).filter(CustomColumn.table_id == table_id).count()
    col_name = _validate_col_name(body.column_name)
    col = CustomColumn(table_id=table_id, column_name=col_name, column_type=body.column_type, sort_order=max_order)
    db.add(col)
    db.commit()
    db.refresh(col)
    sql_type = _COL_TYPE_MAP.get(body.column_type, "TEXT")
    real_table = f"cdata_{table_id}"
    db.execute(text(f'ALTER TABLE "{real_table}" ADD COLUMN IF NOT EXISTS {_qi(col_name)} {sql_type}'))  # noqa: S608
    db.commit()
    return {"id": col.id, "column_name": col.column_name, "column_type": col.column_type, "sort_order": col.sort_order}


@router.delete("/data-tables/{table_id}/columns/{column_id}")
def delete_column(table_id: int, column_id: int, db: Session = Depends(get_db), _: None = Depends(verify_admin)):
    col = db.query(CustomColumn).filter(CustomColumn.id == column_id, CustomColumn.table_id == table_id).first()
    if not col:
        raise HTTPException(status_code=404, detail="컬럼을 찾을 수 없습니다.")
    col_name = col.column_name
    db.delete(col)
    db.commit()
    real_table = f"cdata_{table_id}"
    db.execute(text(f'ALTER TABLE "{real_table}" DROP COLUMN IF EXISTS {_qi(col_name)}'))  # noqa: S608
    db.commit()
    return {"message": "컬럼이 삭제되었습니다."}


@router.put("/data-tables/{table_id}/columns/{column_id}")
def rename_column(table_id: int, column_id: int, body: UpdateColumnRequest, db: Session = Depends(get_db), _: None = Depends(verify_admin)):
    col = db.query(CustomColumn).filter(CustomColumn.id == column_id, CustomColumn.table_id == table_id).first()
    if not col:
        raise HTTPException(status_code=404, detail="컬럼을 찾을 수 없습니다.")
    new_name = _validate_col_name(body.column_name)
    old_name = col.column_name
    real_table = f"cdata_{table_id}"
    db.execute(text(f'ALTER TABLE "{real_table}" RENAME COLUMN {_qi(old_name)} TO {_qi(new_name)}'))  # noqa: S608
    col.column_name = new_name
    db.commit()
    return {"id": col.id, "column_name": col.column_name, "column_type": col.column_type, "sort_order": col.sort_order}


@router.post("/data-tables/{table_id}/columns/{column_id}/reorder")
def reorder_column(table_id: int, column_id: int, body: ReorderColumnRequest, db: Session = Depends(get_db), _: None = Depends(verify_admin)):
    if body.direction not in {"up", "down"}:
        raise HTTPException(status_code=400, detail="direction은 up 또는 down이어야 합니다.")
    columns = db.query(CustomColumn).filter(CustomColumn.table_id == table_id).order_by(CustomColumn.sort_order, CustomColumn.id).all()
    idx = next((i for i, c in enumerate(columns) if c.id == column_id), None)
    if idx is None:
        raise HTTPException(status_code=404, detail="컬럼을 찾을 수 없습니다.")
    swap_idx = idx - 1 if body.direction == "up" else idx + 1
    if swap_idx < 0 or swap_idx >= len(columns):
        return {"message": "이동할 수 없습니다."}
    columns[idx], columns[swap_idx] = columns[swap_idx], columns[idx]
    for i, col in enumerate(columns):
        col.sort_order = i
    db.commit()
    return {"message": "컬럼 순서를 변경했습니다."}


@router.post("/data-tables/{table_id}/rows", status_code=201)
def add_row(table_id: int, body: UpsertRowRequest, db: Session = Depends(get_db), _: None = Depends(verify_admin)):
    if not db.query(CustomTable).filter(CustomTable.id == table_id).first():
        raise HTTPException(status_code=404, detail="테이블을 찾을 수 없습니다.")
    real_table = f"cdata_{table_id}"
    if not body.data:
        row_id = db.execute(text(f'INSERT INTO "{real_table}" DEFAULT VALUES RETURNING id, created_at')).fetchone()  # noqa: S608
    else:
        _validate_row_keys(db, table_id, body.data)
        col_sql = ", ".join([_qi(k) for k in body.data])
        val_sql = ", ".join([f":v{i}" for i in range(len(body.data))])
        params = {f"v{i}": v for i, v in enumerate(body.data.values())}
        row_id = db.execute(text(f'INSERT INTO "{real_table}" ({col_sql}) VALUES ({val_sql}) RETURNING id, created_at'), params).fetchone()  # noqa: S608
    db.commit()
    return {"id": row_id[0], "data": body.data, "created_at": row_id[1]}


@router.put("/data-tables/{table_id}/rows/{row_id}")
def update_row(table_id: int, row_id: int, body: UpsertRowRequest, db: Session = Depends(get_db), _: None = Depends(verify_admin)):
    if not db.query(CustomTable).filter(CustomTable.id == table_id).first():
        raise HTTPException(status_code=404, detail="테이블을 찾을 수 없습니다.")
    real_table = f"cdata_{table_id}"
    if not body.data:
        db.execute(text(f'UPDATE "{real_table}" SET updated_at = NOW() WHERE id = :id'), {"id": row_id})  # noqa: S608
    else:
        _validate_row_keys(db, table_id, body.data)
        set_sql = ", ".join([f'{_qi(k)} = :v{i}' for i, k in enumerate(body.data)])
        params = {f"v{i}": v for i, v in enumerate(body.data.values())}
        params["id"] = row_id
        db.execute(text(f'UPDATE "{real_table}" SET {set_sql}, updated_at = NOW() WHERE id = :id'), params)  # noqa: S608
    db.commit()
    return {"id": row_id, "data": body.data}


@router.delete("/data-tables/{table_id}/rows/{row_id}")
def delete_row(table_id: int, row_id: int, db: Session = Depends(get_db), _: None = Depends(verify_admin)):
    real_table = f"cdata_{table_id}"
    db.execute(text(f'DELETE FROM "{real_table}" WHERE id = :id'), {"id": row_id})  # noqa: S608
    db.commit()
    return {"message": "행이 삭제되었습니다."}


@router.get("/data-tables/{table_id}/export")
def export_data_table(table_id: int, db: Session = Depends(get_db), _: None = Depends(verify_admin)):
    table = db.query(CustomTable).filter(CustomTable.id == table_id).first()
    if not table:
        raise HTTPException(status_code=404, detail="테이블을 찾을 수 없습니다.")
    columns = db.query(CustomColumn).filter(CustomColumn.table_id == table_id).order_by(CustomColumn.sort_order, CustomColumn.id).all()
    col_names = [c.column_name for c in columns]
    real_table = f"cdata_{table_id}"
    if col_names:
        select_cols = ", ".join([_qi(cn) for cn in col_names])
        raw_rows = db.execute(text(f'SELECT id, {select_cols}, created_at FROM "{real_table}" ORDER BY id')).fetchall()  # noqa: S608
    else:
        raw_rows = db.execute(text(f'SELECT id, created_at FROM "{real_table}" ORDER BY id')).fetchall()  # noqa: S608
    wb = Workbook()
    ws = wb.active
    ws.title = table.name[:31]
    ws.append(["ID"] + col_names + ["생성일시"])
    for r in raw_rows:
        row_values = list(r[1:-1]) if col_names else []
        ws.append([r[0]] + row_values + [r[-1].isoformat() if r[-1] else ""])
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    filename = f"{table.name}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
    return Response(
        content=buf.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/data-tables/{table_id}/import")
async def import_table_data(table_id: int, file: UploadFile = File(...), db: Session = Depends(get_db), _: None = Depends(verify_admin)):
    table = db.query(CustomTable).filter(CustomTable.id == table_id).first()
    if not table:
        raise HTTPException(status_code=404, detail="테이블을 찾을 수 없습니다.")

    fname = (file.filename or "").lower()
    if not (fname.endswith(".csv") or fname.endswith(".xlsx") or fname.endswith(".xls")):
        raise HTTPException(status_code=400, detail="CSV 또는 Excel(.xlsx/.xls) 파일만 업로드할 수 있습니다.")

    cols = db.query(CustomColumn).filter(CustomColumn.table_id == table_id).order_by(CustomColumn.sort_order, CustomColumn.id).all()
    col_names = [c.column_name for c in cols]
    if not col_names:
        raise HTTPException(status_code=400, detail="컬럼을 먼저 추가해주세요.")

    content = await file.read()

    if fname.endswith(".csv"):
        text_content = content.decode("utf-8-sig")
        reader = csv.DictReader(io.StringIO(text_content))
        raw_rows: list[dict] = [dict(r) for r in reader]
    else:
        from openpyxl import load_workbook as _load_wb
        wb_in = _load_wb(io.BytesIO(content), read_only=True)
        ws_in = wb_in.active
        headers = [str(cell.value) if cell.value is not None else "" for cell in next(ws_in.iter_rows(max_row=1))]
        raw_rows = []
        for row in ws_in.iter_rows(min_row=2, values_only=True):
            raw_rows.append(dict(zip(headers, [str(v) if v is not None else "" for v in row])))
        wb_in.close()

    real_table = f"cdata_{table_id}"
    count = 0
    for raw in raw_rows:
        data = {cn: str(raw[cn]) for cn in col_names if cn in raw and raw[cn] not in (None, "")}
        if not data:
            continue
        col_sql = ", ".join([_qi(k) for k in data])
        val_sql = ", ".join([f":v{i}" for i in range(len(data))])
        params = {f"v{i}": v for i, v in enumerate(data.values())}
        db.execute(text(f'INSERT INTO "{real_table}" ({col_sql}) VALUES ({val_sql})'), params)  # noqa: S608
        count += 1

    db.commit()
    return {"message": f"{count}개 행을 가져왔습니다.", "count": count}


# ── DB 브라우저 ──────────────────────────────────────────────


@router.get("/db/tables")
def list_db_tables(db: Session = Depends(get_db), _: None = Depends(verify_admin)):
    inspector = sa_inspect(db.bind)
    tables = sorted(inspector.get_table_names())
    custom_meta: dict[str, tuple[str, str]] = {}
    for ct in db.query(CustomTable).all():
        custom_meta[f"cdata_{ct.id}"] = (ct.name, ct.description or "")
    result = []
    for table_name in tables:
        try:
            count = db.execute(text(f'SELECT COUNT(*) FROM "{table_name}"')).scalar() or 0  # noqa: S608
        except Exception:
            count = -1
        columns = [col["name"] for col in inspector.get_columns(table_name)]
        if table_name in custom_meta:
            display_name, description = custom_meta[table_name]
            display_name = f"[데이터] {display_name}"
        else:
            display_name = table_name
            description = TABLE_DESCRIPTIONS.get(table_name, "")
        result.append({"name": table_name, "display_name": display_name, "description": description, "row_count": count, "columns": columns})
    return {"tables": result}


@router.get("/db/tables/{table_name}")
def browse_db_table(
    table_name: str,
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    _: None = Depends(verify_admin),
):
    inspector = sa_inspect(db.bind)
    valid_tables = inspector.get_table_names()
    if table_name not in valid_tables:
        raise HTTPException(status_code=404, detail="테이블을 찾을 수 없습니다.")

    columns = [col["name"] for col in inspector.get_columns(table_name)]
    offset = (page - 1) * limit
    total = db.execute(text(f'SELECT COUNT(*) FROM "{table_name}"')).scalar() or 0  # noqa: S608
    try:
        rows_result = db.execute(
            text(f'SELECT * FROM "{table_name}" ORDER BY id DESC LIMIT :limit OFFSET :offset'),  # noqa: S608
            {"limit": limit, "offset": offset},
        ).fetchall()
    except Exception:
        rows_result = db.execute(
            text(f'SELECT * FROM "{table_name}" LIMIT :limit OFFSET :offset'),  # noqa: S608
            {"limit": limit, "offset": offset},
        ).fetchall()

    def _serialize(v):
        if isinstance(v, datetime):
            return v.isoformat()
        if isinstance(v, (date, time)):
            return str(v)
        if isinstance(v, str):
            return decrypt_if_needed(v) or v
        return v

    rows = [dict(zip(columns, [_serialize(v) for v in row])) for row in rows_result]
    return {
        "columns": columns,
        "rows": rows,
        "total": total,
        "page": page,
        "limit": limit,
        "editable": table_name in EDITABLE_TABLES,
        "droppable": _is_droppable(table_name),
        "restriction_reason": _restriction_reason(table_name),
        "protected_columns": sorted(PROTECTED_COLUMNS),
    }


# ─────────────────────────────────────────────────────────────────────────
# DB 브라우저 행 편집·삭제 (안전한 4개 테이블만 화이트리스트)
# ─────────────────────────────────────────────────────────────────────────

EDITABLE_TABLES = {"faqs", "chat_logs", "processing_logs", "cancel_requests"}

# 저장 시 카테고리 토글 상태에 따라 enc:: 자동 처리되는 컬럼
ENCRYPT_AWARE_COLUMNS: dict[str, set[str]] = {
    "faqs": {"category", "question", "answer", "keywords_json", "aliases_json", "search_hints_json", "source_files_json"},
    "chat_logs": {"question", "answer", "retrieval_chunks", "error"},
    # processing_logs / cancel_requests는 평문 저장
}

# 수정·삭제 시 보호되는 컬럼 (편집 불가)
PROTECTED_COLUMNS = {"id", "created_at", "updated_at"}

# 테이블 자체를 DROP 가능한 화이트리스트 (시스템 영향 없음)
DROPPABLE_TABLES = {"chat_logs", "processing_logs", "cancel_requests", "admin_audit_logs"}
# cdata_* 동적 사용자 정의 테이블은 prefix 매칭으로 별도 허용


class DbRowUpdate(BaseModel):
    values: dict[str, object]


@router.put("/db/tables/{table_name}/rows/{row_id}")
def update_db_row(
    table_name: str,
    row_id: int,
    body: DbRowUpdate,
    db: Session = Depends(get_db),
    _: str = Depends(verify_admin),
):
    if table_name not in EDITABLE_TABLES:
        raise HTTPException(status_code=403, detail="이 테이블은 편집할 수 없습니다.")

    inspector = sa_inspect(db.bind)
    if table_name not in inspector.get_table_names():
        raise HTTPException(status_code=404, detail="테이블을 찾을 수 없습니다.")

    valid_columns = {col["name"] for col in inspector.get_columns(table_name)}
    enc_columns = ENCRYPT_AWARE_COLUMNS.get(table_name, set())

    updates: dict[str, object] = {}
    for col, raw_value in body.values.items():
        if col in PROTECTED_COLUMNS or col not in valid_columns:
            continue
        value = raw_value
        if isinstance(value, str) and col in enc_columns:
            value = maybe_encrypt(value)
        updates[col] = value

    if not updates:
        raise HTTPException(status_code=400, detail="수정할 컬럼이 없습니다.")

    set_clause = ", ".join([f'"{k}" = :{k}' for k in updates])
    params = {**updates, "row_id": row_id}
    result = db.execute(
        text(f'UPDATE "{table_name}" SET {set_clause} WHERE id = :row_id'),  # noqa: S608
        params,
    )
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="행을 찾을 수 없습니다.")
    db.commit()

    create_audit_log(
        db,
        "db_row_update",
        table_name,
        str(row_id),
        f"수정된 컬럼: {', '.join(updates.keys())}",
    )
    return {"message": "수정되었습니다.", "table": table_name, "row_id": row_id, "updated": list(updates.keys())}


@router.delete("/db/tables/{table_name}/rows/{row_id}")
def delete_db_row(
    table_name: str,
    row_id: int,
    db: Session = Depends(get_db),
    _: str = Depends(verify_admin),
):
    if table_name not in EDITABLE_TABLES:
        raise HTTPException(status_code=403, detail="이 테이블은 삭제할 수 없습니다.")

    inspector = sa_inspect(db.bind)
    if table_name not in inspector.get_table_names():
        raise HTTPException(status_code=404, detail="테이블을 찾을 수 없습니다.")

    try:
        result = db.execute(
            text(f'DELETE FROM "{table_name}" WHERE id = :row_id'),  # noqa: S608
            {"row_id": row_id},
        )
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"삭제 실패: {exc}") from exc

    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="행을 찾을 수 없습니다.")
    db.commit()

    create_audit_log(db, "db_row_delete", table_name, str(row_id), "행 삭제")
    return {"message": "삭제되었습니다.", "table": table_name, "row_id": row_id}


def _is_droppable(table_name: str) -> bool:
    if table_name in DROPPABLE_TABLES:
        return True
    if table_name.startswith("cdata_"):
        return True
    return False


def _restriction_reason(table_name: str) -> str | None:
    """편집·삭제 불가 사유를 사람이 읽을 수 있는 문구로 반환. 가능한 테이블이면 None."""
    if table_name in EDITABLE_TABLES or _is_droppable(table_name):
        return None
    reasons: dict[str, str] = {
        "chunks": "RAG 검색 인덱스(FAISS)와 1:1로 묶여 있어 직접 수정하면 검색이 깨집니다. 문서 검토 탭에서 재인덱싱으로만 변경하세요.",
        "documents": "원본 문서 메타. 문서 검토 탭의 승인·반려·삭제 흐름으로만 관리됩니다.",
        "chat_messages": "사용자 대화 본체. 수정·삭제하면 대화 이력이 깨집니다.",
        "chat_sessions": "세션 식별자. 변경 시 모든 메시지·로그가 끊깁니다.",
        "admin_users": "관리자 권한 목록. 권한 관리 탭에서만 안전하게 수정하세요.",
        "prompt_configs": "시스템 프롬프트. 프롬프트 탭에서 안전하게 편집하세요.",
        "faqs": "FAQ 콘텐츠. FAQ 관리 탭에서 안전하게 편집하세요.",
        "custom_tables": "사용자 정의 테이블 메타. 데이터 관리 탭에서 관리됩니다.",
        "custom_columns": "사용자 정의 컬럼 정의. 데이터 관리 탭에서 관리됩니다.",
    }
    return reasons.get(table_name, "시스템 무결성 보호를 위해 직접 편집·삭제가 차단되어 있습니다.")


@router.delete("/db/tables/{table_name}")
def drop_db_table(
    table_name: str,
    db: Session = Depends(get_db),
    _: str = Depends(verify_admin),
):
    if not _is_droppable(table_name):
        raise HTTPException(status_code=403, detail="이 테이블은 삭제할 수 없습니다.")

    inspector = sa_inspect(db.bind)
    if table_name not in inspector.get_table_names():
        raise HTTPException(status_code=404, detail="테이블을 찾을 수 없습니다.")

    # cdata_* 는 custom_tables 메타도 같이 정리
    if table_name.startswith("cdata_"):
        try:
            cdata_id = int(table_name[len("cdata_"):])
            db.execute(text("DELETE FROM custom_columns WHERE table_id = :tid"), {"tid": cdata_id})
            db.execute(text("DELETE FROM custom_tables WHERE id = :tid"), {"tid": cdata_id})
        except (ValueError, Exception):
            pass

    try:
        db.execute(text(f'DROP TABLE IF EXISTS "{table_name}" CASCADE'))  # noqa: S608
        db.commit()
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"테이블 삭제 실패: {exc}") from exc

    create_audit_log(db, "db_table_drop", table_name, table_name, "테이블 DROP")
    return {"message": f"{table_name} 테이블을 삭제했습니다.", "table": table_name}


def _is_chat_model(model_id: str) -> bool:
    if ":" in model_id:
        return False
    EXCLUDED = ("instruct", "realtime", "audio", "tts", "whisper", "dall", "embedding", "moderation", "vision")
    if any(kw in model_id for kw in EXCLUDED):
        return False
    prefixes = ("gpt-5", "gpt-4", "gpt-3.5-turbo", "o1", "o3", "o4", "chatgpt")
    return any(model_id.startswith(p) for p in prefixes)


@router.get("/settings/model")
async def get_model_settings(_: None = Depends(verify_admin)):
    settings = get_settings()
    try:
        openai_client = AsyncOpenAI(api_key=settings.openai_api_key)
        response = await openai_client.models.list()
        chat_models = sorted(
            [m for m in response.data if _is_chat_model(m.id)],
            key=lambda m: m.created,
            reverse=True,
        )
        available_models = [m.id for m in chat_models]
    except Exception:
        available_models = ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"]
    return {"current_model": get_active_model(), "available_models": available_models}


@router.put("/settings/model")
def change_model(body: ModelChangeRequest, db: Session = Depends(get_db), _: None = Depends(verify_admin)):
    # 모델 설정은 DB(app_settings)에 저장한다. (.env 방식은 배포 재생성·환경변수 우선·멀티워커로 인해 유지 안 됨)
    model_name = (body.model_name or "").strip()
    if not _is_chat_model(model_name):
        raise HTTPException(status_code=400, detail="유효한 채팅 모델 ID가 아닙니다.")
    set_active_model(db, model_name)
    create_audit_log(db, "model_changed", "system", "model_name", model_name)
    return {"message": f"모델을 {model_name}으로 변경했습니다.", "model_name": model_name}


@router.put("/password")
def change_password(body: PasswordChangeRequest, db: Session = Depends(get_db), _: None = Depends(verify_admin)):
    if not body.new_password or len(body.new_password) < 4:
        raise HTTPException(status_code=400, detail="비밀번호는 4자 이상이어야 합니다.")
    lines = ENV_PATH.read_text(encoding="utf-8").splitlines() if ENV_PATH.exists() else []
    updated = [line for line in lines if not line.startswith("ADMIN_PASSWORD=")]
    updated.append(f"ADMIN_PASSWORD={body.new_password}")
    ENV_PATH.write_text("\n".join(updated) + "\n", encoding="utf-8")
    get_settings.cache_clear()
    create_audit_log(db, "password_changed", "system", "admin_password")
    return {"message": "비밀번호를 변경했습니다."}


# ── 권한 관리 ──────────────────────────────────────────────────


class ChangeSuperadminRequest(BaseModel):
    new_email: str


@router.put("/settings/superadmin")
def change_superadmin(
    body: ChangeSuperadminRequest,
    db: Session = Depends(get_db),
    current_user: str = Depends(verify_admin),
):
    if current_user != get_settings().admin_email:
        raise HTTPException(status_code=403, detail="최상위 관리자만 이 작업을 수행할 수 있습니다.")
    new_email = body.new_email.strip().lower()
    if not new_email or "@" not in new_email:
        raise HTTPException(status_code=400, detail="유효한 이메일을 입력해주세요.")
    if new_email == get_settings().admin_email:
        raise HTTPException(status_code=400, detail="현재 최상위 관리자 이메일과 동일합니다.")
    lines = ENV_PATH.read_text(encoding="utf-8").splitlines() if ENV_PATH.exists() else []
    updated = [line for line in lines if not line.startswith("ADMIN_EMAIL=")]
    updated.append(f"ADMIN_EMAIL={new_email}")
    ENV_PATH.write_text("\n".join(updated) + "\n", encoding="utf-8")
    get_settings.cache_clear()
    create_audit_log(db, "superadmin_changed", "system", "admin_email", current_user)
    return {"message": f"최상위 관리자를 {new_email}로 변경했습니다. 다시 로그인해주세요."}


class AddPermissionRequest(BaseModel):
    email: str


@router.get("/permissions")
def list_permissions(db: Session = Depends(get_db), current_user: str = Depends(verify_admin)):
    users = db.query(AdminUser).order_by(AdminUser.created_at).all()
    return {
        "superadmin": get_settings().admin_email,
        "current_user": current_user,
        "admins": [
            {
                "email": u.email,
                "added_by": u.added_by,
                "created_at": u.created_at.isoformat() if u.created_at else None,
            }
            for u in users
        ],
    }


@router.post("/permissions", status_code=201)
def add_permission(body: AddPermissionRequest, db: Session = Depends(get_db), current_user: str = Depends(verify_admin)):
    if not body.email or "@" not in body.email:
        raise HTTPException(status_code=400, detail="유효한 이메일을 입력해주세요.")
    if db.query(AdminUser).filter(AdminUser.email == body.email).first():
        raise HTTPException(status_code=409, detail="이미 등록된 이메일입니다.")
    user = AdminUser(email=body.email, added_by=current_user)
    db.add(user)
    db.commit()
    create_audit_log(db, "permission_added", "admin_user", body.email, current_user)
    return {"message": f"{body.email}에 권한을 부여했습니다."}


@router.delete("/permissions/{email}")
def remove_permission(email: str, db: Session = Depends(get_db), current_user: str = Depends(verify_admin)):
    if email == get_settings().admin_email:
        raise HTTPException(status_code=400, detail="기본 관리자 이메일은 제거할 수 없습니다.")
    if email == current_user:
        raise HTTPException(status_code=400, detail="본인 계정은 제거할 수 없습니다. (자가 잠금 방지)")
    user = db.query(AdminUser).filter(AdminUser.email == email).first()
    if not user:
        raise HTTPException(status_code=404, detail="등록되지 않은 이메일입니다.")
    db.delete(user)
    db.commit()
    create_audit_log(db, "permission_removed", "admin_user", email, current_user)
    return {"message": f"{email}의 권한을 제거했습니다."}


# ── 암호화 설정 ─────────────────────────────────────────────────


class EncryptionToggleRequest(BaseModel):
    encrypt_enabled: bool


class EncryptionMigrateRequest(BaseModel):
    category: str
    direction: str  # "encrypt" | "decrypt"


def _count_encrypted(values: list[str | None]) -> int:
    return sum(1 for v in values if v and v.startswith(ENCRYPTED_PREFIX))


@router.get("/settings/encryption")
def get_encryption_settings(db: Session = Depends(get_db), _: None = Depends(verify_admin)):
    settings = get_settings()

    faq_rows = db.query(FaqRecord).filter(FaqRecord.is_active.is_(True)).all()
    faq_enc = _count_encrypted([r.answer for r in faq_rows])

    prompt_rows = db.query(PromptConfig).all()
    prompt_enc = _count_encrypted([r.content for r in prompt_rows])

    doc_rows = db.query(DocumentRecord).filter(DocumentRecord.is_deleted.is_(False)).all()
    doc_enc = _count_encrypted([r.original_filename for r in doc_rows])

    return {
        "categories": [
            {
                "key": "faq",
                "label": "FAQ 내용",
                "encrypt_enabled": settings.encrypt_faq,
                "encrypted_count": faq_enc,
                "plain_count": len(faq_rows) - faq_enc,
                "total": len(faq_rows),
            },
            {
                "key": "prompt",
                "label": "프롬프트 내용",
                "encrypt_enabled": settings.encrypt_prompt,
                "encrypted_count": prompt_enc,
                "plain_count": len(prompt_rows) - prompt_enc,
                "total": len(prompt_rows),
            },
            {
                "key": "document",
                "label": "문서 파일명·검토내용",
                "encrypt_enabled": settings.encrypt_document,
                "encrypted_count": doc_enc,
                "plain_count": len(doc_rows) - doc_enc,
                "total": len(doc_rows),
            },
        ]
    }


@router.put("/settings/encryption/{category}")
def toggle_encryption(category: str, body: EncryptionToggleRequest, db: Session = Depends(get_db), _: None = Depends(verify_admin)):
    if category not in {"faq", "prompt", "document"}:
        raise HTTPException(status_code=400, detail="유효하지 않은 카테고리입니다.")
    env_key = f"ENCRYPT_{category.upper()}"
    env_value = "true" if body.encrypt_enabled else "false"
    lines = ENV_PATH.read_text(encoding="utf-8").splitlines() if ENV_PATH.exists() else []
    updated = [line for line in lines if not line.startswith(f"{env_key}=")]
    updated.append(f"{env_key}={env_value}")
    ENV_PATH.write_text("\n".join(updated) + "\n", encoding="utf-8")
    get_settings.cache_clear()
    create_audit_log(db, "encryption_toggled", "system", category, f"{env_key}={env_value}")
    label = "활성화" if body.encrypt_enabled else "비활성화"
    return {"message": f"{category} 암호화가 {label}되었습니다.", "category": category, "encrypt_enabled": body.encrypt_enabled}


@router.post("/settings/encryption/migrate")
def migrate_encryption(body: EncryptionMigrateRequest, db: Session = Depends(get_db), _: None = Depends(verify_admin)):
    if body.category not in {"faq", "prompt", "document"}:
        raise HTTPException(status_code=400, detail="유효하지 않은 카테고리입니다.")
    if body.direction not in {"encrypt", "decrypt"}:
        raise HTTPException(status_code=400, detail="direction은 encrypt 또는 decrypt여야 합니다.")

    count = 0

    if body.category == "faq":
        rows = db.query(FaqRecord).filter(FaqRecord.is_active.is_(True)).all()
        fields = ["category", "question", "answer", "keywords_json", "aliases_json", "search_hints_json", "source_files_json"]
        for row in rows:
            changed = False
            for field in fields:
                value = getattr(row, field)
                if not value:
                    continue
                if body.direction == "decrypt" and value.startswith(ENCRYPTED_PREFIX):
                    decrypted = decrypt_if_needed(value)
                    if decrypted:  # 복호화 실패(키 불일치 등) 시 ""로 덮어쓰지 않고 원본 유지 → 데이터 손실 방지
                        setattr(row, field, decrypted)
                        changed = True
                elif body.direction == "encrypt" and not value.startswith(ENCRYPTED_PREFIX):
                    setattr(row, field, encrypt(value))
                    changed = True
            if changed:
                count += 1
        db.commit()

    elif body.category == "prompt":
        rows = db.query(PromptConfig).all()
        for row in rows:
            value = row.content
            if not value:
                continue
            if body.direction == "decrypt" and value.startswith(ENCRYPTED_PREFIX):
                row.content = decrypt_if_needed(value) or value
                count += 1
            elif body.direction == "encrypt" and not value.startswith(ENCRYPTED_PREFIX):
                row.content = encrypt(value)
                count += 1
        db.commit()

    elif body.category == "document":
        rows = db.query(DocumentRecord).filter(DocumentRecord.is_deleted.is_(False)).all()
        for row in rows:
            changed = False
            for field in ["original_filename", "review_note", "error_message"]:
                value = getattr(row, field)
                if not value:
                    continue
                if body.direction == "decrypt" and value.startswith(ENCRYPTED_PREFIX):
                    decrypted = decrypt_if_needed(value)
                    if decrypted:  # 복호화 실패(키 불일치 등) 시 ""로 덮어쓰지 않고 원본 유지 → 데이터 손실 방지
                        setattr(row, field, decrypted)
                        changed = True
                elif body.direction == "encrypt" and not value.startswith(ENCRYPTED_PREFIX):
                    setattr(row, field, encrypt(value))
                    changed = True
            if changed:
                count += 1
        db.commit()

    action = "암호화" if body.direction == "encrypt" else "복호화"
    create_audit_log(db, f"encryption_migrated_{body.direction}", "system", body.category, f"{count}개 처리")
    return {"message": f"{count}개 레코드를 {action}했습니다.", "count": count, "category": body.category, "direction": body.direction}
