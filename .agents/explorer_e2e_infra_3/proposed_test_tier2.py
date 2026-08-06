import os
import sys
import unittest

try:
    import requests
except ImportError:
    print("Error: The 'requests' library is required to run E2E integration tests.")
    print("Please install it using: pip install requests")
    sys.exit(1)

class TestTier2Advanced(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server_url = os.environ.get('TEST_SERVER_URL', 'http://127.0.0.1:5000')
        cls.sender = "test_sender"
        cls.recipient = "test_recipient"
        cls.password_hash = "pwhash"

        # Register users
        for user in [cls.sender, cls.recipient]:
            requests.post(f"{cls.server_url}/api/auth/login", json={
                "username": user,
                "password_hash": cls.password_hash
            })

    def test_01_chat_system(self):
        # Post message
        send_url = f"{self.server_url}/api/chat/send"
        msg_payload = {
            "username": self.sender,
            "message": "Hello world from integration test!"
        }
        res = requests.post(send_url, json=msg_payload)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json().get("status"), "success")

        # Get recent messages
        recent_url = f"{self.server_url}/api/chat/recent"
        res = requests.get(recent_url)
        self.assertEqual(res.status_code, 200)
        messages = res.json()
        self.assertTrue(len(messages) >= 1)
        # Ensure our message is in there
        found = any(m["username"] == self.sender and m["message"] == "Hello world from integration test!" for m in messages)
        self.assertTrue(found)

        # Invalid post
        res = requests.post(send_url, json={"username": self.sender}) # missing message
        self.assertEqual(res.status_code, 400)

    def test_02_rpg_stats(self):
        # Clean current database of user content or use a unique username to avoid stat pollution
        username = "rpg_test_user"
        requests.post(f"{self.server_url}/api/auth/login", json={
            "username": username,
            "password_hash": self.password_hash
        })

        # Insert RPG data: 2 completed tasks, 1 incomplete task, 45 focus minutes, 3 notes
        create_url = f"{self.server_url}/api/create"
        
        # Tasks (2 completed, 1 incomplete)
        requests.post(create_url, json={"username": username, "type": "task", "completed": True, "title": "C1"})
        requests.post(create_url, json={"username": username, "type": "task", "completed": True, "title": "C2"})
        requests.post(create_url, json={"username": username, "type": "task", "completed": False, "title": "I1"})

        # Focus session: 45 minutes
        requests.post(create_url, json={"username": username, "type": "focus_session", "minutes": 45})

        # Notes: 3 notes
        requests.post(create_url, json={"username": username, "type": "note", "title": "N1"})
        requests.post(create_url, json={"username": username, "type": "note", "title": "N2"})
        requests.post(create_url, json={"username": username, "type": "note", "title": "N3"})

        # Fetch stats
        stats_url = f"{self.server_url}/api/stats/{username}"
        res = requests.get(stats_url)
        self.assertEqual(res.status_code, 200)
        stats = res.json()

        # Assert calculations
        # stamina = min(100, 10 + (focus_minutes // 10)) => 10 + (45 // 10) = 14
        # knowledge = min(100, 10 + (tasks_completed * 5)) => 10 + (2 * 5) = 20
        # agility = min(100, 15 + (tasks_completed * 3) + (notes_created * 2)) => 15 + (2 * 3) + (3 * 2) = 27
        self.assertEqual(stats["stamina"], 14)
        self.assertEqual(stats["knowledge"], 20)
        self.assertEqual(stats["agility"], 27)
        self.assertEqual(stats["focus_minutes"], 45)
        self.assertEqual(stats["tasks_completed"], 2)

    def test_03_seeds_economy_and_biometrics(self):
        username = "economy_test_user"
        requests.post(f"{self.server_url}/api/auth/login", json={
            "username": username,
            "password_hash": self.password_hash
        })

        # Sync biometrics steps: 500 steps (earns 500 // 100 = 5 seeds)
        sync_url = f"{self.server_url}/api/biometrics/sync"
        res = requests.post(sync_url, json={"username": username, "steps": 500})
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["seeds_earned"], 5)
        self.assertEqual(data["currency"]["seeds"], 5)

        # Syncing with insufficient steps (less than 100) -> 400
        res = requests.post(sync_url, json={"username": username, "steps": 50})
        self.assertEqual(res.status_code, 400)

        # Transaction: buy streak freeze for 3 seeds
        tx_url = f"{self.server_url}/api/seeds/transaction"
        res = requests.post(tx_url, json={
            "username": username,
            "cost": 3,
            "action": "buy_streak_freeze"
        })
        self.assertEqual(res.status_code, 200)
        curr = res.json()["currency"]
        self.assertEqual(curr["seeds"], 2)
        self.assertEqual(curr["streak_freezes"], 1)

        # Transaction: buy theme 'glassmorphism' for 5 seeds -> should fail (insufficient seeds)
        res = requests.post(tx_url, json={
            "username": username,
            "cost": 5,
            "action": "buy_theme_glassmorphism"
        })
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.json()["message"], "Insufficient seeds")

    def test_04_p2p_gifting(self):
        # Give sender some seeds via biometrics sync
        requests.post(f"{self.server_url}/api/biometrics/sync", json={"username": self.sender, "steps": 1000}) # 10 seeds

        gift_url = f"{self.server_url}/api/store/gift"

        # Gift 4 seeds from sender to recipient
        payload = {
            "username": self.sender,
            "friend_username": self.recipient,
            "gift_type": "seeds",
            "amount": 4
        }
        res = requests.post(gift_url, json=payload)
        self.assertEqual(res.status_code, 200)
        sender_curr = res.json()["sender_currency"]
        self.assertEqual(sender_curr["seeds"], 6) # 10 - 4 = 6

        # Verify recipient received seeds
        # Recipient started with 0 seeds.
        # Check recipient currency. We can trigger a 0-cost seeds transaction or inspect DB
        # The easiest way to check recipient's currency is to do a 0-cost seeds transaction for recipient
        tx_url = f"{self.server_url}/api/seeds/transaction"
        res_rec = requests.post(tx_url, json={"username": self.recipient, "cost": 0})
        self.assertEqual(res_rec.status_code, 200)
        recipient_curr = res_rec.json()["currency"]
        self.assertEqual(recipient_curr["seeds"], 4)

        # Error cases
        # 1. Gift to self
        payload_self = payload.copy()
        payload_self["friend_username"] = self.sender
        res = requests.post(gift_url, json=payload_self)
        self.assertEqual(res.status_code, 400)

        # 2. Gift to non-existent friend
        payload_fake = payload.copy()
        payload_fake["friend_username"] = "fake_friend_123"
        res = requests.post(gift_url, json=payload_fake)
        self.assertEqual(res.status_code, 404)

        # 3. Insufficient seeds
        payload_excess = payload.copy()
        payload_excess["amount"] = 100
        res = requests.post(gift_url, json=payload_excess)
        self.assertEqual(res.status_code, 400)

    def test_05_settings_backup(self):
        backup_url = f"{self.server_url}/api/settings/backup"
        
        # Local Sandbox backup
        res = requests.post(backup_url, json={"username": self.sender})
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "success")
        self.assertEqual(data["destination"], "Local Workspaces Sandbox")
        self.assertIn("backup_filename", data)
        self.assertTrue(data["size_bytes"] > 0)

        # Cloud (Dropbox Mock) backup
        res = requests.post(backup_url, json={"username": self.sender, "dropbox_token": "mock_token"})
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "success")
        self.assertEqual(data["destination"], "Dropbox Cloud API")

    def test_06_google_calendar_oauth(self):
        # 1. GCal auth (sandbox mode since GOOGLE_CLIENT_ID env var is empty)
        auth_url = f"{self.server_url}/api/gcal/auth"
        res = requests.get(auth_url)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "sandbox")
        self.assertIn("redirect_url", data)

        # 2. GCal callback
        callback_url = f"{self.server_url}/api/gcal/callback"
        res = requests.get(callback_url, params={"code": "sandbox_demo_code"})
        self.assertEqual(res.status_code, 200)
        self.assertIn("Connection Successful!", res.text)

        # 3. GCal sync
        sync_url = f"{self.server_url}/api/gcal/sync"
        res = requests.post(sync_url, json={"username": self.sender})
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "success")
        self.assertTrue(data["synced_count"] > 0)
        self.assertTrue(len(data["events"]) > 0)

if __name__ == '__main__':
    unittest.main()
