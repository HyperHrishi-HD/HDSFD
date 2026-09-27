"""Focused regression tests for the provider-neutral School Connect feature.

Uses Flask's test client against each app module so no server or network is
needed and the developer's real database is never touched.

Covers:
  - ICS and CSV parsing (titles, dates, course, external-id stability)
  - Authentication required on every school endpoint
  - Import creates records; re-importing identical content is idempotent
  - Records are owner-scoped (user B never sees user A's imports)
  - Secret-like source payloads are rejected
"""
import io
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import importlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

SAMPLE_ICS = "\r\n".join([
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Test//EN",
    "BEGIN:VEVENT",
    "UID:assignment-123@school.example",
    "SUMMARY:Algebra Quiz Chapter 4",
    "DESCRIPTION:Covers linear equations",
    "LOCATION:Room 204",
    "DTSTART:20260915T133000Z",
    "DTEND:20260915T143000Z",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "SUMMARY:Physics Lab Report Due",
    "DTSTART;VALUE=DATE:20260920",
    "END:VEVENT",
    "END:VCALENDAR",
    "",
])

SAMPLE_CSV = "\n".join([
    "title,course,due_date,description",
    "History Essay Draft,World History,2026-10-01,Minimum 1200 words",
    "Chemistry Lab Practical,Chemistry,2026-10-03,Bring goggles",
    "",
])

SAMPLE_CSV_UPDATED = "\n".join([
    "title,course,due_date,description",
    "History Essay Draft,World History,2026-10-02,Now 1500 words",
    "Chemistry Lab Practical,Chemistry,2026-10-03,Bring goggles",
    "",
])


class SchoolConnectTestCase(unittest.TestCase):
    APP_TARGET = None  # overridden by subclasses
    app_module = None  # set by setUpClass
    username = "school_test_user"

    @classmethod
    def setUpClass(cls):
        if cls.APP_TARGET is None:
            raise unittest.SkipTest("abstract base class — run RootAppSchoolTest / BackendAppSchoolTest")
        cls.app_module = importlib.import_module(cls.APP_TARGET)

    def setUp(self):
        self.db_fd, self.db_path = tempfile.mkstemp(suffix=".db")
        os.close(self.db_fd)
        self._orig_db_path = self.app_module.DB_PATH
        self.app_module.DB_PATH = self.db_path
        if hasattr(self.app_module, "init_db"):
            try:
                self.app_module.init_db()
            except Exception:
                pass
        self.client = self.app_module.app.test_client()

    def tearDown(self):
        self.app_module.DB_PATH = self._orig_db_path
        os.unlink(self.db_path)

    def login(self, username):
        res = self.client.post(
            "/api/auth/login",
            json={"username": username, "password": "testpassword123"},
        )
        self.assertEqual(res.status_code, 200, f"login failed: {res.get_json()}")
        return res.get_json()["token"]

    def auth_headers(self, token):
        return {"Authorization": f"Bearer {token}"}

    # ---------- parsing unit tests ----------

    def test_parse_ics(self):
        from backend.school_connect import parse_ics
        records, warnings = parse_ics(SAMPLE_ICS)
        self.assertEqual(len(records), 2, f"warnings: {warnings}")
        first = records[0]
        self.assertEqual(first["title"], "Algebra Quiz Chapter 4")
        self.assertEqual(first["external_id"], "assignment-123@school.example")
        self.assertEqual(first["location"], "Room 204")
        self.assertIn("2026-09-15", first["start_at"])
        second = records[1]
        self.assertTrue(second["all_day"])
        self.assertEqual(second["start_at"], "2026-09-20")

    def test_parse_csv(self):
        from backend.school_connect import parse_csv
        records, warnings = parse_csv(SAMPLE_CSV)
        self.assertEqual(len(records), 2, f"warnings: {warnings}")
        self.assertEqual(records[0]["title"], "History Essay Draft")
        self.assertEqual(records[0]["course"], "World History")
        self.assertEqual(records[0]["due_at"], "2026-10-01")
        self.assertEqual(records[0]["record_type"], "assignment")

    def test_parse_csv_idempotent_external_ids(self):
        from backend.school_connect import parse_csv
        first, _ = parse_csv(SAMPLE_CSV)
        second, _ = parse_csv(SAMPLE_CSV)
        self.assertEqual(
            [r["external_id"] for r in first],
            [r["external_id"] for r in second],
            "external IDs must be deterministic for repeat imports",
        )

    # ---------- API tests ----------

    def test_all_endpoints_require_auth(self):
        endpoints = [
            ("GET", "/api/school/providers", None),
            ("GET", "/api/school/sources", None),
            ("POST", "/api/school/sources", {}),
            ("GET", "/api/school/records", None),
            ("GET", "/api/school/imports", None),
            ("POST", "/api/school/import", {"format": "csv", "content": SAMPLE_CSV}),
        ]
        for method, url, payload in endpoints:
            if method == "GET":
                res = self.client.get(url)
            else:
                res = self.client.post(url, json=payload)
            if url == "/api/school/providers":
                # Providers is intentionally public metadata.
                self.assertEqual(res.status_code, 200)
                continue
            self.assertEqual(res.status_code, 401, f"{method} {url} must require auth")

    def test_providers_public(self):
        res = self.client.get("/api/school/providers")
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertIsInstance(data, list)
        self.assertTrue(any(p["id"] == "ics" for p in data))

    def test_import_and_idempotency(self):
        token = self.login(self.username)
        res = self.client.post(
            "/api/school/import",
            json={"format": "csv", "content": SAMPLE_CSV},
            headers=self.auth_headers(token),
        )
        self.assertEqual(res.status_code, 201, res.get_data(as_text=True))
        body = res.get_json()
        self.assertFalse(body["duplicate"])
        self.assertEqual(body["import"]["created_count"], 2)

        # Re-import the same content: must be a duplicate, not new records
        res2 = self.client.post(
            "/api/school/import",
            json={"format": "csv", "content": SAMPLE_CSV},
            headers=self.auth_headers(token),
        )
        self.assertEqual(res2.status_code, 200)
        body2 = res2.get_json()
        self.assertTrue(body2["duplicate"])

        # Updated content: should update the changed record, keep the other
        res3 = self.client.post(
            "/api/school/import",
            json={"format": "csv", "content": SAMPLE_CSV_UPDATED},
            headers=self.auth_headers(token),
        )
        self.assertEqual(res3.status_code, 201)
        body3 = res3.get_json()
        self.assertEqual(body3["import"]["updated_count"], 1)
        self.assertEqual(body3["import"]["created_count"], 1)

    def test_ownership_isolation(self):
        token_a = self.login("owner_a_school")
        token_b = self.login("owner_b_school")
        self.client.post(
            "/api/school/import",
            json={"format": "csv", "content": SAMPLE_CSV},
            headers=self.auth_headers(token_a),
        )
        res = self.client.get("/api/school/records", headers=self.auth_headers(token_b))
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.get_json(), [], "user B must not see user A's records")
        res_sources = self.client.get("/api/school/sources", headers=self.auth_headers(token_b))
        self.assertEqual(res_sources.get_json(), [])

    def test_source_with_secret_rejected(self):
        token = self.login(self.username)
        res = self.client.post(
            "/api/school/sources",
            json={"provider": "ics", "display_name": "Cal", "password": "hunter2"},
            headers=self.auth_headers(token),
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("not accepted", res.get_json()["message"])

    def test_multipart_import(self):
        token = self.login(self.username)
        res = self.client.post(
            "/api/school/import",
            data={"format": "ics", "file": (io.BytesIO(SAMPLE_ICS.encode("utf-8")), "school.ics")},
            content_type="multipart/form-data",
            headers=self.auth_headers(token),
        )
        self.assertIn(res.status_code, (200, 201), res.get_data(as_text=True))
        body = res.get_json()
        self.assertFalse(body.get("duplicate"))


class RootAppSchoolTest(SchoolConnectTestCase):
    APP_TARGET = "app"


class BackendAppSchoolTest(SchoolConnectTestCase):
    APP_TARGET = "backend.app"


if __name__ == "__main__":
    unittest.main()
