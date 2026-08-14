import unittest
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.database import Base
from app.db.migrations import migrate_database
from app.db.models import CustomTable
from app.routers import admin


class CustomDataCatalogTest(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.session_factory = sessionmaker(bind=self.engine)
        self.db = self.session_factory()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def create_table(self, name: str = "상담 신청") -> dict:
        return admin.create_data_table(
            admin.CreateTableRequest(name=name, description="운영 데이터"),
            self.db,
            None,
        )

    def test_created_table_appears_in_database_catalog(self):
        created = self.create_table()

        self.assertIn(created["physical_name"], inspect(self.engine).get_table_names())
        catalog = admin.list_db_tables(self.db, None)["tables"]
        item = next(table for table in catalog if table["name"] == created["physical_name"])

        self.assertEqual("custom", item["table_kind"])
        self.assertEqual(created["id"], item["custom_table_id"])
        self.assertEqual("상담 신청", item["display_name"])

    def test_normalized_duplicate_table_name_is_rejected(self):
        self.create_table("상담   신청")

        with self.assertRaises(HTTPException) as context:
            self.create_table("  상담 신청  ")

        self.assertEqual(409, context.exception.status_code)

    def test_normalized_duplicate_column_name_is_rejected(self):
        created = self.create_table()
        admin.add_column(
            created["id"],
            admin.CreateColumnRequest(column_name="연락처", column_type="text"),
            self.db,
            None,
        )

        with self.assertRaises(HTTPException) as context:
            admin.add_column(
                created["id"],
                admin.CreateColumnRequest(column_name="  연락처  ", column_type="text"),
                self.db,
                None,
            )

        self.assertEqual(409, context.exception.status_code)

    def test_metadata_is_rolled_back_when_physical_table_creation_fails(self):
        with patch.object(admin.Table, "create", side_effect=RuntimeError("ddl failed")):
            with self.assertRaises(HTTPException) as context:
                self.create_table()

        self.assertEqual(500, context.exception.status_code)
        self.assertEqual(0, self.db.query(CustomTable).count())

    def test_table_rows_support_column_search_and_pagination(self):
        created = self.create_table()
        for column_name in ("이름", "지역"):
            admin.add_column(
                created["id"],
                admin.CreateColumnRequest(column_name=column_name, column_type="text"),
                self.db,
                None,
            )
        for name, region in (("김민수", "서울"), ("이서연", "부산"), ("박지훈", "서울")):
            admin.add_row(
                created["id"],
                admin.UpsertRowRequest(data={"이름": name, "지역": region}),
                self.db,
                None,
            )

        first_page = admin.get_data_table(
            created["id"],
            query="서울",
            search_column="지역",
            page=1,
            limit=1,
            db=self.db,
            _=None,
        )
        second_page = admin.get_data_table(
            created["id"],
            query="서울",
            search_column="지역",
            page=2,
            limit=1,
            db=self.db,
            _=None,
        )

        self.assertEqual(2, first_page["total"])
        self.assertEqual(2, first_page["total_pages"])
        self.assertEqual("박지훈", first_page["rows"][0]["data"]["이름"])
        self.assertEqual("김민수", second_page["rows"][0]["data"]["이름"])

    def test_table_rows_search_all_columns_case_insensitively(self):
        created = self.create_table()
        admin.add_column(
            created["id"],
            admin.CreateColumnRequest(column_name="메모", column_type="text"),
            self.db,
            None,
        )
        admin.add_row(
            created["id"],
            admin.UpsertRowRequest(data={"메모": "Follow UP"}),
            self.db,
            None,
        )

        result = admin.get_data_table(
            created["id"],
            query="follow up",
            search_column="",
            page=1,
            limit=50,
            db=self.db,
            _=None,
        )

        self.assertEqual(1, result["total"])
        self.assertEqual("Follow UP", result["rows"][0]["data"]["메모"])

    def test_unknown_search_column_is_rejected(self):
        created = self.create_table()

        with self.assertRaises(HTTPException) as context:
            admin.get_data_table(
                created["id"],
                query="검색어",
                search_column="없는 컬럼",
                page=1,
                limit=50,
                db=self.db,
                _=None,
            )

        self.assertEqual(400, context.exception.status_code)


class CustomDataMigrationTest(unittest.TestCase):
    def test_existing_database_gets_unique_normalized_name_keys(self):
        engine = create_engine("sqlite://")
        with engine.begin() as connection:
            connection.execute(text(
                "CREATE TABLE custom_tables ("
                "id INTEGER PRIMARY KEY, name VARCHAR(100) NOT NULL, description TEXT)"
            ))
            connection.execute(text(
                "CREATE TABLE custom_columns ("
                "id INTEGER PRIMARY KEY, table_id INTEGER NOT NULL, "
                "column_name VARCHAR(100) NOT NULL, column_type VARCHAR(20) NOT NULL, "
                "sort_order INTEGER NOT NULL)"
            ))
            connection.execute(text(
                "INSERT INTO custom_tables (id, name) VALUES (1, '상담 신청'), (2, '상담  신청')"
            ))
            connection.execute(text(
                "INSERT INTO custom_columns (id, table_id, column_name, column_type, sort_order) "
                "VALUES (1, 1, '연락처', 'text', 0), (2, 1, ' 연락처 ', 'text', 1)"
            ))

        migrate_database(engine)

        inspector = inspect(engine)
        self.assertIn("name_key", {column["name"] for column in inspector.get_columns("custom_tables")})
        self.assertIn(
            "column_name_key",
            {column["name"] for column in inspector.get_columns("custom_columns")},
        )
        with engine.connect() as connection:
            table_keys = connection.execute(
                text("SELECT name_key FROM custom_tables ORDER BY id")
            ).scalars().all()
            column_keys = connection.execute(
                text("SELECT column_name_key FROM custom_columns ORDER BY id")
            ).scalars().all()

        self.assertEqual(2, len(set(table_keys)))
        self.assertEqual(2, len(set(column_keys)))
        with self.assertRaises(IntegrityError):
            with engine.begin() as connection:
                connection.execute(
                    text(
                        "INSERT INTO custom_tables (id, name, name_key) "
                        "VALUES (3, '중복', :name_key)"
                    ),
                    {"name_key": table_keys[0]},
                )
        engine.dispose()


if __name__ == "__main__":
    unittest.main()
