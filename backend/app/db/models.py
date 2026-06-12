from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, Integer, Text, String
from sqlalchemy.sql import func

from app.db.database import Base


class AdminUser(Base):
    __tablename__ = "admin_users"

    id = Column(Integer, primary_key=True, autoincrement=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    added_by = Column(String(255), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class AppSetting(Base):
    """런타임에 변경 가능한 시스템 설정(key-value). .env 대신 DB에 저장해
    재시작·재배포·멀티워커와 무관하게 일관되게 유지된다. (예: 활성 LLM 모델명)"""

    __tablename__ = "app_settings"

    key = Column(String(100), primary_key=True)
    value = Column(Text, nullable=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class ChatSession(Base):
    __tablename__ = "chat_sessions"

    id = Column(String(64), primary_key=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    message_count = Column(Integer, default=0)
    encrypted_user_name = Column(Text, nullable=True)


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(String(64), index=True)
    role = Column(String(20))
    content = Column(Text)
    source = Column(String(30))
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class DocumentRecord(Base):
    __tablename__ = "documents"

    id = Column(Integer, primary_key=True, autoincrement=True)
    logical_name = Column(String(255), index=True, nullable=False)
    version = Column(Integer, default=1, nullable=False)
    original_filename = Column(Text, nullable=False)
    storage_key = Column(String(512), nullable=True)
    pdf_path = Column(Text, nullable=True)
    md_path = Column(Text, nullable=True)
    json_path = Column(Text, nullable=True)
    chunk_path = Column(Text, nullable=True)
    embedding_path = Column(Text, nullable=True)
    parser_type = Column(String(50), nullable=True)
    status = Column(String(30), index=True, default="uploaded", nullable=False)
    is_active = Column(Boolean, default=False, nullable=False)
    is_deleted = Column(Boolean, default=False, nullable=False)
    review_note = Column(Text, nullable=True)
    approved_at = Column(DateTime(timezone=True), nullable=True)
    rejected_at = Column(DateTime(timezone=True), nullable=True)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class ChunkRecord(Base):
    __tablename__ = "chunks"

    id = Column(Integer, primary_key=True, autoincrement=True)
    document_id = Column(Integer, index=True, nullable=False)
    chunk_index = Column(Integer, nullable=False)
    content = Column(Text, nullable=False)
    metadata_json = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class ChatLog(Base):
    __tablename__ = "chat_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(String(64), index=True, nullable=False)
    question = Column(Text, nullable=False)
    retrieval_chunks = Column(Text, nullable=True)
    answer = Column(Text, nullable=True)
    source = Column(String(30), nullable=True)
    error = Column(Text, nullable=True)
    processing_status = Column(String(30), default="ready", nullable=False)
    embedding_cost = Column(Float, default=0.0, nullable=False)
    llm_cost = Column(Float, default=0.0, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class CancelRequest(Base):
    __tablename__ = "cancel_requests"

    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(String(64), index=True, nullable=False)
    message = Column(Text, nullable=False)
    status = Column(String(30), default="requested", nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class ProcessingLog(Base):
    __tablename__ = "processing_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    document_id = Column(Integer, index=True, nullable=True)
    log_type = Column(String(30), nullable=False)
    status = Column(String(30), nullable=False)
    message = Column(Text, nullable=False)
    detail = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class PromptConfig(Base):
    __tablename__ = "prompt_configs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    prompt_key = Column(String(50), unique=True, index=True, nullable=False)
    label = Column(String(100), nullable=False)
    content = Column(Text, nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class FaqRecord(Base):
    __tablename__ = "faqs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    faq_key = Column(String(50), unique=True, index=True, nullable=False)
    category = Column(Text, nullable=False)
    question = Column(Text, nullable=False)
    answer = Column(Text, nullable=False)
    keywords_json = Column(Text, nullable=True)
    aliases_json = Column(Text, nullable=True)
    search_hints_json = Column(Text, nullable=True)
    source_files_json = Column(Text, nullable=True)
    direct_answer = Column(Boolean, default=False, nullable=False)
    top_k = Column(Integer, default=4, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class AdminAuditLog(Base):
    __tablename__ = "admin_audit_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    actor = Column(String(100), nullable=False, default="admin")
    action = Column(String(50), index=True, nullable=False)
    target_type = Column(String(50), index=True, nullable=False)
    target_id = Column(String(100), nullable=True)
    detail = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class CustomTable(Base):
    __tablename__ = "custom_tables"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class CustomColumn(Base):
    __tablename__ = "custom_columns"

    id = Column(Integer, primary_key=True, autoincrement=True)
    table_id = Column(Integer, ForeignKey("custom_tables.id"), nullable=False, index=True)
    column_name = Column(String(100), nullable=False)
    column_type = Column(String(20), nullable=False, default="text")  # text | number | date
    sort_order = Column(Integer, default=0, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


