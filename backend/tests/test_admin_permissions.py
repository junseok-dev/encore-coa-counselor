import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException

from app.routers import admin


class AdminPermissionTest(unittest.TestCase):
    def test_regular_admin_cannot_pass_superadmin_check(self):
        settings = SimpleNamespace(admin_email="owner@example.com")

        with patch.object(admin, "get_settings", return_value=settings):
            with self.assertRaises(HTTPException) as context:
                admin.verify_superadmin("operator@example.com")

        self.assertEqual(403, context.exception.status_code)

    def test_permission_access_only_reports_current_role(self):
        settings = SimpleNamespace(admin_email="owner@example.com")

        with patch.object(admin, "get_settings", return_value=settings):
            access = admin.get_permission_access("operator@example.com")

        self.assertEqual(
            {"current_user": "operator@example.com", "is_superadmin": False},
            access,
        )

    def test_permission_management_routes_require_superadmin(self):
        protected_routes = {
            ("/settings/superadmin", "PUT"),
            ("/permissions", "GET"),
            ("/permissions", "POST"),
            ("/permissions/{email}", "DELETE"),
        }

        for path, method in protected_routes:
            route = next(
                route
                for route in admin.router.routes
                if route.path == path and method in route.methods
            )
            dependencies = {dependency.call for dependency in route.dependant.dependencies}
            self.assertIn(admin.verify_superadmin, dependencies)


if __name__ == "__main__":
    unittest.main()
