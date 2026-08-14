import unittest

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.database import Base
from app.routers import admin


class DbBrowserReadOnlyTest(unittest.TestCase):
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

    def test_browse_response_is_explicitly_read_only(self):
        response = admin.browse_db_table(
            "custom_tables",
            page=1,
            limit=50,
            db=self.db,
            _=None,
        )

        self.assertTrue(response["read_only"])
        self.assertNotIn("editable", response)
        self.assertNotIn("droppable", response)
        self.assertNotIn("protected_columns", response)

    def test_raw_database_mutation_routes_are_not_exposed(self):
        route_methods = {
            (method, route.path)
            for route in admin.router.routes
            for method in (route.methods or set())
        }

        self.assertNotIn(("PUT", "/db/tables/{table_name}/rows/{row_id}"), route_methods)
        self.assertNotIn(("DELETE", "/db/tables/{table_name}/rows/{row_id}"), route_methods)
        self.assertNotIn(("DELETE", "/db/tables/{table_name}"), route_methods)


if __name__ == "__main__":
    unittest.main()
