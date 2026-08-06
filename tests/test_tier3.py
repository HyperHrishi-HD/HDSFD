import os
import unittest
import requests

PORT = os.environ.get('HDSFD_TESTING_PORT', '5000')
BASE_URL = f"http://127.0.0.1:{PORT}"

class TestTier3CrossFeaturePairwise(unittest.TestCase):

    # 1. Focus session updates stamina
    def test_pairwise1_focus_updates_stamina(self):
        username = "p_user_1"
        requests.post(f"{BASE_URL}/api/auth/login", json={"username": username, "password_hash": "p"})
        
        # Initial stats
        r_init = requests.get(f"{BASE_URL}/api/stats/{username}")
        stamina_init = r_init.json().get("stamina")
        
        # Create focus session of 60 minutes
        requests.post(f"{BASE_URL}/api/create", json={"username": username, "type": "focus_session", "minutes": 60})
        
        # Stats after focus
        r_after = requests.get(f"{BASE_URL}/api/stats/{username}")
        stamina_after = r_after.json().get("stamina")
        self.assertEqual(stamina_after, stamina_init + 6)

    # 2. Tasks update knowledge & agility
    def test_pairwise2_tasks_update_rpg_stats(self):
        username = "p_user_2"
        requests.post(f"{BASE_URL}/api/auth/login", json={"username": username, "password_hash": "p"})
        
        # Complete 2 tasks
        requests.post(f"{BASE_URL}/api/create", json={"username": username, "type": "task", "completed": True})
        requests.post(f"{BASE_URL}/api/create", json={"username": username, "type": "task", "completed": True})
        
        # Check stats
        r = requests.get(f"{BASE_URL}/api/stats/{username}")
        self.assertEqual(r.json().get("knowledge"), 20)
        self.assertEqual(r.json().get("agility"), 21)

    # 3. Biometrics rewarding seeds spent on streak freeze
    def test_pairwise3_biometrics_spent_on_streak_freeze(self):
        username = "p_user_3"
        requests.post(f"{BASE_URL}/api/auth/login", json={"username": username, "password_hash": "p"})
        
        # Sync steps to earn seeds
        requests.post(f"{BASE_URL}/api/biometrics/sync", json={"username": username, "steps": 1000})
        
        # Spend 5 seeds on streak freeze
        r = requests.post(f"{BASE_URL}/api/seeds/transaction", json={
            "username": username, "cost": 5, "action": "buy_streak_freeze"
        })
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json().get("currency").get("seeds"), 5)
        self.assertEqual(r.json().get("currency").get("streak_freezes"), 1)

    # 4. Biometrics rewarding seeds gifted to friend
    def test_pairwise4_biometrics_gifted_to_friend(self):
        sender = "p_sender_4"
        recipient = "p_recipient_4"
        requests.post(f"{BASE_URL}/api/auth/login", json={"username": sender, "password_hash": "p"})
        requests.post(f"{BASE_URL}/api/auth/login", json={"username": recipient, "password_hash": "p"})
        
        # Sync steps for sender
        requests.post(f"{BASE_URL}/api/biometrics/sync", json={"username": sender, "steps": 5000})
        
        # Gift 30 seeds to recipient
        r = requests.post(f"{BASE_URL}/api/store/gift", json={
            "username": sender, "friend_username": recipient, "gift_type": "seeds", "amount": 30
        })
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json().get("sender_currency").get("seeds"), 20)

    # 5. Buy theme and gift item
    def test_pairwise5_buy_theme_and_gift_item(self):
        sender = "p_sender_5"
        recipient = "p_recipient_5"
        requests.post(f"{BASE_URL}/api/auth/login", json={"username": sender, "password_hash": "p"})
        requests.post(f"{BASE_URL}/api/auth/login", json={"username": recipient, "password_hash": "p"})
        
        # Sync steps to get 100 seeds
        requests.post(f"{BASE_URL}/api/biometrics/sync", json={"username": sender, "steps": 10000})
        
        # Buy theme sunset
        requests.post(f"{BASE_URL}/api/seeds/transaction", json={"username": sender, "cost": 30, "action": "buy_theme_sunset"})
        
        # Gift theme sunset
        r = requests.post(f"{BASE_URL}/api/store/gift", json={
            "username": sender, "friend_username": recipient, "gift_type": "item", "item_id": "sunset"
        })
        self.assertEqual(r.status_code, 200)
        self.assertNotIn("sunset", r.json().get("sender_currency").get("inventory"))

    # 6. Note canvas drawings linked to active pages
    def test_pairwise6_note_canvas_linked_to_active_pages(self):
        username = "p_user_6"
        r_create = requests.post(f"{BASE_URL}/api/create", json={"username": username, "type": "note", "title": "Calculus"})
        item_id = r_create.json()["__backendId"]
        
        # Link canvas drawings and page number
        requests.put(f"{BASE_URL}/api/update/{item_id}", json={
            "username": username, "type": "note", "title": "Calculus", "page_number": 3, "canvas_paths": [{"x": 10, "y": 20}]
        })
        
        # Retrieve and verify linkage
        r = requests.get(f"{BASE_URL}/api/data/{username}")
        note = r.json()[0]
        self.assertEqual(note.get("page_number"), 3)
        self.assertEqual(note.get("canvas_paths")[0].get("x"), 10)

    # 7. Rescheduling updates calendar sync
    def test_pairwise7_task_reschedule_updates_calendar_sync(self):
        username = "p_user_7"
        r_create = requests.post(f"{BASE_URL}/api/create", json={"username": username, "type": "task", "title": "Initial Task"})
        task_id = r_create.json()["__backendId"]
        
        # Reschedule task
        requests.post(f"{BASE_URL}/api/tasks/reschedule", json={
            "username": username, "task_id": task_id, "new_timestamp": "2026-06-25T15:00:00"
        })
        
        # Sync calendar
        r = requests.post(f"{BASE_URL}/api/gcal/sync", json={"username": username})
        self.assertEqual(r.status_code, 200)
        self.assertTrue(len(r.json().get("events")) > 0)

    # 8. Jarvis chatbot config setting matches user data
    def test_pairwise8_jarvis_chatbot_config_matches_data(self):
        username = "p_user_8"
        requests.post(f"{BASE_URL}/api/jarvis/config", json={"username": username, "tier": "high"})
        
        r = requests.get(f"{BASE_URL}/api/data/{username}")
        config = [item for item in r.json() if item.get("type") == "jarvis_config"][0]
        self.assertEqual(config.get("tier"), "high")

    # 9. Database backup snapshot validations
    def test_pairwise9_database_backup_validates_snapshot(self):
        username = "p_user_9"
        requests.post(f"{BASE_URL}/api/auth/login", json={"username": username, "password_hash": "p"})
        
        # Get gdrive auth (sets up mock credentials)
        r_auth = requests.get(f"{BASE_URL}/api/gdrive/auth?username={username}")
        self.assertEqual(r_auth.status_code, 200)
        
        # Request database backup
        r_backup = requests.post(f"{BASE_URL}/api/settings/backup", json={"username": username})
        self.assertEqual(r_backup.status_code, 200)
        self.assertEqual(r_backup.json().get("status"), "success")
        self.assertIn("Local Workspaces Sandbox (Mock)", r_backup.json().get("destination"))
        self.assertTrue(r_backup.json().get("size_bytes") > 0)

    # 10. Focus and tasks generate initial seeds
    def test_pairwise10_focus_and_tasks_generate_initial_seeds(self):
        username = "p_user_10"
        requests.post(f"{BASE_URL}/api/auth/login", json={"username": username, "password_hash": "p"})
        
        # 3 completed tasks and 25 focus minutes
        requests.post(f"{BASE_URL}/api/create", json={"username": username, "type": "task", "completed": True})
        requests.post(f"{BASE_URL}/api/create", json={"username": username, "type": "task", "completed": True})
        requests.post(f"{BASE_URL}/api/create", json={"username": username, "type": "task", "completed": True})
        requests.post(f"{BASE_URL}/api/create", json={"username": username, "type": "focus_session", "minutes": 25})
        
        # Trigger transaction to calculate initial seeds
        r = requests.post(f"{BASE_URL}/api/seeds/transaction", json={"username": username, "cost": 0})
        self.assertEqual(r.json().get("currency").get("seeds"), 55)

    # 11. Completed syllabus module updates heatmap and stats
    def test_pairwise11_completed_syllabus_updates_heatmap_and_stats(self):
        username = "p_user_11"
        requests.post(f"{BASE_URL}/api/auth/login", json={"username": username, "password_hash": "p"})
        
        # Complete task/syllabus
        requests.post(f"{BASE_URL}/api/create", json={"username": username, "type": "task", "completed": True})
        requests.post(f"{BASE_URL}/api/create", json={"username": username, "type": "activity_log", "activity": "Syllabus Week 1 Complete"})
        
        # Check stats
        r = requests.get(f"{BASE_URL}/api/stats/{username}")
        self.assertEqual(r.json().get("tasks_completed"), 1)

    # 12. Zen mode preferences stored alongside boss battles
    def test_pairwise12_zen_preferences_stored_alongside_boss_battles(self):
        username = "p_user_12"
        # Simulate active Zen Mode preferences (with ESC exit parameters)
        requests.post(f"{BASE_URL}/api/create", json={
            "username": username, 
            "type": "zen_preferences", 
            "layout": "zen",
            "panels_hidden": True,
            "esc_pressed": True,
            "q_hold_seconds": 3.0
        })
        requests.post(f"{BASE_URL}/api/create", json={"username": username, "type": "exam_boss", "boss_name": "Midterm"})
        
        r = requests.get(f"{BASE_URL}/api/data/{username}")
        types = [item.get("type") for item in r.json()]
        self.assertIn("zen_preferences", types)
        self.assertIn("exam_boss", types)

    # 13. Delete item updates RPG stats
    def test_pairwise13_delete_item_updates_rpg_stats(self):
        username = "p_user_13"
        requests.post(f"{BASE_URL}/api/auth/login", json={"username": username, "password_hash": "p"})
        
        r_create = requests.post(f"{BASE_URL}/api/create", json={"username": username, "type": "task", "completed": True})
        item_id = r_create.json()["__backendId"]
        
        # Check stats before deletion
        r1 = requests.get(f"{BASE_URL}/api/stats/{username}")
        self.assertEqual(r1.json().get("tasks_completed"), 1)
        
        # Delete task
        requests.delete(f"{BASE_URL}/api/delete/{item_id}")
        
        # Check stats after deletion
        r2 = requests.get(f"{BASE_URL}/api/stats/{username}")
        self.assertEqual(r2.json().get("tasks_completed"), 0)

if __name__ == '__main__':
    unittest.main()
