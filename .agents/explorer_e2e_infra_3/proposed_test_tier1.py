import os
import sys
import unittest

try:
    import requests
except ImportError:
    print("Error: The 'requests' library is required to run E2E integration tests.")
    print("Please install it using: pip install requests")
    sys.exit(1)

class TestTier1Core(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Retrieve server URL from environment variable, default to 5000 if not set
        cls.server_url = os.environ.get('TEST_SERVER_URL', 'http://127.0.0.1:5000')
        cls.username = "test_user_tier1"
        cls.password_hash = "abc123hash"

    def test_01_auth_flow(self):
        # Register new user
        url = f"{self.server_url}/api/auth/login"
        payload = {
            "username": self.username,
            "password_hash": self.password_hash
        }
        res = requests.post(url, json=payload)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data.get("status"), "success")
        self.assertEqual(data.get("username"), self.username)
        self.assertTrue(data.get("new_user"))

        # Log in again (existing user)
        res = requests.post(url, json=payload)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data.get("status"), "success")
        self.assertEqual(data.get("username"), self.username)
        self.assertIsNone(data.get("new_user"))

        # Try to login with incorrect access key
        payload_fail = {
            "username": self.username,
            "password_hash": "wrongpassword"
        }
        res = requests.post(url, json=payload_fail)
        self.assertEqual(res.status_code, 401)
        data = res.json()
        self.assertEqual(data.get("status"), "error")
        self.assertEqual(data.get("message"), "Incorrect access key")

    def test_02_data_crud(self):
        # 1. Create task
        create_url = f"{self.server_url}/api/create"
        task_payload = {
            "username": self.username,
            "type": "task",
            "title": "Finish Math Homework",
            "completed": False,
            "timestamp": "2026-06-15T10:00:00Z",
            "duration": 45
        }
        res = requests.post(create_url, json=task_payload)
        self.assertEqual(res.status_code, 201)
        created_data = res.json()
        self.assertEqual(created_data.get("username"), self.username)
        self.assertEqual(created_data.get("type"), "task")
        self.assertEqual(created_data.get("title"), "Finish Math Homework")
        self.assertIn("__backendId", created_data)
        item_id = created_data["__backendId"]

        # Test invalid create (missing username or type)
        invalid_payload = {
            "username": self.username
            # missing type
        }
        res_err = requests.post(create_url, json=invalid_payload)
        self.assertEqual(res_err.status_code, 400)

        # 2. Read tasks
        read_url = f"{self.server_url}/api/data/{self.username}"
        res = requests.get(read_url)
        self.assertEqual(res.status_code, 200)
        items = res.json()
        self.assertTrue(len(items) >= 1)
        
        # Verify the created task is in the list
        found_task = None
        for item in items:
            if item.get("__backendId") == item_id:
                found_task = item
                break
        self.assertIsNotNone(found_task)
        self.assertEqual(found_task["title"], "Finish Math Homework")

        # 3. Update task
        update_url = f"{self.server_url}/api/update/{item_id}"
        updated_payload = found_task.copy()
        updated_payload["completed"] = True
        res = requests.put(update_url, json=updated_payload)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json().get("status"), "success")

        # Verify update was persisted
        res = requests.get(read_url)
        items = res.json()
        persisted_task = next(item for item in items if item.get("__backendId") == item_id)
        self.assertTrue(persisted_task["completed"])

        # 4. Delete task
        delete_url = f"{self.server_url}/api/delete/{item_id}"
        res = requests.delete(delete_url)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json().get("status"), "deleted")

        # Verify deletion
        res = requests.get(read_url)
        items = res.json()
        has_deleted = any(item.get("__backendId") == item_id for item in items)
        self.assertFalse(has_deleted)

    def test_03_task_rescheduling(self):
        # Create a task to reschedule
        create_url = f"{self.server_url}/api/create"
        task_payload = {
            "username": self.username,
            "type": "task",
            "title": "History Lecture Review",
            "completed": False,
            "timestamp": "2026-06-16T12:00:00Z",
            "duration": 60
        }
        res = requests.post(create_url, json=task_payload)
        item_id = res.json()["__backendId"]

        # Reschedule task
        resched_url = f"{self.server_url}/api/tasks/reschedule"
        new_timestamp = "2026-06-16T14:30:00Z"
        resched_payload = {
            "task_id": item_id,
            "username": self.username,
            "new_timestamp": new_timestamp,
            "duration": 90
        }
        res = requests.post(resched_url, json=resched_payload)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data.get("status"), "success")
        self.assertEqual(data["task"]["timestamp"], new_timestamp)
        self.assertEqual(data["task"]["duration"], 90)

        # Reschedule invalid task (wrong ID)
        invalid_payload = {
            "task_id": 99999,
            "username": self.username,
            "new_timestamp": new_timestamp,
            "duration": 90
        }
        res = requests.post(resched_url, json=invalid_payload)
        self.assertEqual(res.status_code, 404)

        # Missing parameters
        missing_payload = {
            "task_id": item_id,
            # missing username
            "new_timestamp": new_timestamp
        }
        res = requests.post(resched_url, json=missing_payload)
        self.assertEqual(res.status_code, 400)

if __name__ == '__main__':
    unittest.main()
