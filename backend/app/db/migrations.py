from __future__ import annotations

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine


def _column_sql(table_name: str, column_name: str) -> str | None:
    if table_name == "documents":
        mapping = {
            "is_deleted": "BOOLEAN NOT NULL DEFAULT FALSE",
            "review_note": "TEXT",
            "approved_at": "TIMESTAMP WITH TIME ZONE",
            "rejected_at": "TIMESTAMP WITH TIME ZONE",
            "deleted_at": "TIMESTAMP WITH TIME ZONE",
        }
        return mapping.get(column_name)
    if table_name == "chat_logs":
        mapping = {
            "question_category": "VARCHAR(64)",
            "question_category_label": "VARCHAR(100)",
            "question_category_source": "VARCHAR(20)",
        }
        return mapping.get(column_name)
    if table_name == "admin_secret_records":
        return {"account_identifier": "VARCHAR(120)"}.get(column_name)
    return None


def _ensure_text_columns(engine: Engine) -> None:
    inspector = inspect(engine)
    targets = {
        "documents": {"original_filename"},
        "faqs": {"category"},
    }

    for table_name, column_names in targets.items():
        if table_name not in inspector.get_table_names():
            continue
        for column in inspector.get_columns(table_name):
            name = column["name"]
            if name not in column_names:
                continue
            column_type = str(column["type"]).lower()
            if "char" not in column_type and "varchar" not in column_type:
                continue
            with engine.begin() as connection:
                connection.execute(text(f"ALTER TABLE {table_name} ALTER COLUMN {name} TYPE TEXT"))


def _drop_legacy_tables(engine: Engine) -> None:
    """폐기된 레거시 테이블 정리. cdata_* 도입(2026-05-16) 이전 EAV 방식."""
    legacy_tables = ("custom_rows",)
    inspector = inspect(engine)
    existing = set(inspector.get_table_names())
    for table_name in legacy_tables:
        if table_name not in existing:
            continue
        with engine.begin() as connection:
            connection.execute(text(f"DROP TABLE IF EXISTS {table_name} CASCADE"))


def migrate_database(engine: Engine) -> None:
    inspector = inspect(engine)

    if "documents" in inspector.get_table_names():
        existing = {column["name"] for column in inspector.get_columns("documents")}
        for column_name in ("is_deleted", "review_note", "approved_at", "rejected_at", "deleted_at"):
            if column_name in existing:
                continue
            column_sql = _column_sql("documents", column_name)
            if not column_sql:
                continue
            with engine.begin() as connection:
                connection.execute(text(f"ALTER TABLE documents ADD COLUMN {column_name} {column_sql}"))

    if "chat_logs" in inspector.get_table_names():
        existing = {column["name"] for column in inspector.get_columns("chat_logs")}
        for column_name in ("question_category", "question_category_label", "question_category_source"):
            if column_name in existing:
                continue
            column_sql = _column_sql("chat_logs", column_name)
            with engine.begin() as connection:
                connection.execute(text(f"ALTER TABLE chat_logs ADD COLUMN {column_name} {column_sql}"))

    if "admin_secret_records" in inspector.get_table_names():
        existing = {column["name"] for column in inspector.get_columns("admin_secret_records")}
        if "account_identifier" not in existing:
            with engine.begin() as connection:
                connection.execute(text("ALTER TABLE admin_secret_records ADD COLUMN account_identifier VARCHAR(120)"))

    _ensure_text_columns(engine)
    _drop_legacy_tables(engine)
