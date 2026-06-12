from __future__ import annotations

import argparse
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

from sqlalchemy import text


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.append(str(ROOT))

from app.db import models  # noqa: E402
from app.db.database import SessionLocal, engine  # noqa: E402
from app.db.migrations import migrate_database  # noqa: E402


TABLE_MODEL_MAP = [
    ("chat_sessions", models.ChatSession),
    ("chat_messages", models.ChatMessage),
    ("documents", models.DocumentRecord),
    ("chunks", models.ChunkRecord),
    ("chat_logs", models.ChatLog),
    ("cancel_requests", models.CancelRequest),
    ("processing_logs", models.ProcessingLog),
    ("prompt_configs", models.PromptConfig),
    ("faqs", models.FaqRecord),
    ("admin_audit_logs", models.AdminAuditLog),
]

DATETIME_COLUMNS = {
    "chat_sessions": {"created_at", "updated_at"},
    "chat_messages": {"created_at"},
    "documents": {"created_at", "updated_at", "approved_at", "rejected_at", "deleted_at"},
    "chunks": {"created_at"},
    "chat_logs": {"created_at"},
    "cancel_requests": {"created_at"},
    "processing_logs": {"created_at"},
    "prompt_configs": {"updated_at"},
    "faqs": {"updated_at"},
    "admin_audit_logs": {"created_at"},
}

BOOLEAN_COLUMNS = {
    "documents": {"is_active", "is_deleted"},
    "faqs": {"direct_answer", "is_active"},
}

FLOAT_COLUMNS = {
    "chat_logs": {"embedding_cost", "llm_cost"},
}

INTEGER_COLUMNS = {
    "chat_sessions": {"message_count"},
    "documents": {"version"},
    "chunks": {"document_id", "chunk_index"},
    "cancel_requests": {"id"},
    "processing_logs": {"document_id"},
    "faqs": {"top_k"},
}

SEQUENCE_TABLES = {
    "chat_messages": "id",
    "documents": "id",
    "chunks": "id",
    "chat_logs": "id",
    "cancel_requests": "id",
    "processing_logs": "id",
    "prompt_configs": "id",
    "faqs": "id",
    "admin_audit_logs": "id",
}


def _parse_datetime(value: object) -> datetime | None:
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        return value
    text_value = str(value).strip()
    if not text_value:
        return None
    try:
        return datetime.fromisoformat(text_value.replace("Z", "+00:00"))
    except ValueError:
        for fmt in ("%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S"):
            try:
                return datetime.strptime(text_value, fmt)
            except ValueError:
                continue
    raise ValueError(f"Unsupported datetime format: {text_value}")


def _normalize_row(table_name: str, row: sqlite3.Row) -> dict:
    normalized: dict[str, object] = {}
    datetime_columns = DATETIME_COLUMNS.get(table_name, set())
    boolean_columns = BOOLEAN_COLUMNS.get(table_name, set())
    float_columns = FLOAT_COLUMNS.get(table_name, set())
    integer_columns = INTEGER_COLUMNS.get(table_name, set())

    for key in row.keys():
        value = row[key]
        if key in datetime_columns:
            normalized[key] = _parse_datetime(value)
        elif key in boolean_columns:
            normalized[key] = bool(value) if value is not None else False
        elif key in float_columns:
            normalized[key] = float(value) if value is not None else 0.0
        elif key in integer_columns and value is not None:
            normalized[key] = int(value)
        else:
            normalized[key] = value
    return normalized


def _sync_sequences(db_session) -> None:
    for table_name, pk_name in SEQUENCE_TABLES.items():
        result = db_session.execute(text(f"SELECT COALESCE(MAX({pk_name}), 0) FROM {table_name}"))
        max_id = result.scalar() or 0
        db_session.execute(
            text(
                """
                SELECT setval(
                    pg_get_serial_sequence(:table_name, :pk_name),
                    :max_id,
                    :has_rows
                )
                """
            ),
            {
                "table_name": table_name,
                "pk_name": pk_name,
                "max_id": max_id,
                "has_rows": max_id > 0,
            },
        )
    db_session.commit()


def migrate(sqlite_path: Path) -> None:
    if not sqlite_path.exists():
        raise FileNotFoundError(f"SQLite DB not found: {sqlite_path}")

    models.Base.metadata.create_all(bind=engine)
    migrate_database(engine)

    source = sqlite3.connect(str(sqlite_path))
    source.row_factory = sqlite3.Row
    target = SessionLocal()

    try:
        counts: dict[str, int] = {}
        for table_name, model in TABLE_MODEL_MAP:
            rows = source.execute(f"SELECT * FROM {table_name}").fetchall()
            counts[table_name] = len(rows)
            for row in rows:
                payload = _normalize_row(table_name, row)
                target.merge(model(**payload))
            target.commit()

        _sync_sequences(target)

        print("Migration complete.")
        for table_name, count in counts.items():
            print(f"- {table_name}: {count}")
    finally:
        target.close()
        source.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Migrate backend/chatbot.db into the configured RDS database.")
    parser.add_argument(
        "--sqlite-path",
        default=str(ROOT / "chatbot.db"),
        help="Path to the source SQLite DB. Defaults to backend/chatbot.db",
    )
    args = parser.parse_args()
    migrate(Path(args.sqlite_path))


if __name__ == "__main__":
    main()
