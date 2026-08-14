from __future__ import annotations

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

from app.utils.data_names import data_name_key


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
        return {
            "account_identifier": "VARCHAR(120)",
            "instance_identifier": "VARCHAR(120)",
        }.get(column_name)
    if table_name == "operations_alerts":
        return {
            "test_question": "TEXT",
            "test_answer": "TEXT",
            "test_source": "VARCHAR(30)",
            "test_passed": "BOOLEAN NOT NULL DEFAULT FALSE",
            "tested_by": "VARCHAR(255)",
            "tested_at": "TIMESTAMP WITH TIME ZONE",
        }.get(column_name)
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


def _legacy_unique_key(base_key: str, row_id: int, used: set[str]) -> str:
    candidate = base_key or f"unnamed-{row_id}"
    if candidate not in used:
        used.add(candidate)
        return candidate
    suffix = f"~legacy-{row_id}"
    candidate = f"{candidate[:120 - len(suffix)]}{suffix}"
    used.add(candidate)
    return candidate


def _ensure_custom_data_name_keys(engine: Engine) -> None:
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    if "custom_tables" not in tables or "custom_columns" not in tables:
        return

    table_columns = {column["name"] for column in inspector.get_columns("custom_tables")}
    column_columns = {column["name"] for column in inspector.get_columns("custom_columns")}

    with engine.begin() as connection:
        if "name_key" not in table_columns:
            connection.execute(text("ALTER TABLE custom_tables ADD COLUMN name_key VARCHAR(120)"))
        if "column_name_key" not in column_columns:
            connection.execute(text("ALTER TABLE custom_columns ADD COLUMN column_name_key VARCHAR(120)"))

        used_table_keys: set[str] = set()
        for row in connection.execute(text("SELECT id, name FROM custom_tables ORDER BY id")):
            key = _legacy_unique_key(data_name_key(row.name), row.id, used_table_keys)
            connection.execute(
                text("UPDATE custom_tables SET name_key = :key WHERE id = :id"),
                {"key": key, "id": row.id},
            )

        used_column_keys: dict[int, set[str]] = {}
        for row in connection.execute(
            text("SELECT id, table_id, column_name FROM custom_columns ORDER BY table_id, id")
        ):
            used = used_column_keys.setdefault(row.table_id, set())
            key = _legacy_unique_key(data_name_key(row.column_name), row.id, used)
            connection.execute(
                text("UPDATE custom_columns SET column_name_key = :key WHERE id = :id"),
                {"key": key, "id": row.id},
            )

        existing_table_uniques = {
            tuple(constraint["column_names"])
            for constraint in inspect(connection).get_unique_constraints("custom_tables")
        }
        existing_column_uniques = {
            tuple(constraint["column_names"])
            for constraint in inspect(connection).get_unique_constraints("custom_columns")
        }
        if ("name_key",) not in existing_table_uniques:
            connection.execute(text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_custom_tables_name_key "
                "ON custom_tables (name_key)"
            ))
        if ("table_id", "column_name_key") not in existing_column_uniques:
            connection.execute(text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_custom_columns_table_name_key "
                "ON custom_columns (table_id, column_name_key)"
            ))


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
        for column_name in ("account_identifier", "instance_identifier"):
            if column_name in existing:
                continue
            with engine.begin() as connection:
                connection.execute(text(
                    f"ALTER TABLE admin_secret_records ADD COLUMN {column_name} VARCHAR(120)"
                ))

    if "operations_alerts" in inspector.get_table_names():
        existing = {column["name"] for column in inspector.get_columns("operations_alerts")}
        for column_name in (
            "test_question", "test_answer", "test_source", "test_passed", "tested_by", "tested_at",
        ):
            if column_name in existing:
                continue
            column_sql = _column_sql("operations_alerts", column_name)
            with engine.begin() as connection:
                connection.execute(text(
                    f"ALTER TABLE operations_alerts ADD COLUMN {column_name} {column_sql}"
                ))

    _ensure_text_columns(engine)
    _ensure_custom_data_name_keys(engine)
    _drop_legacy_tables(engine)
