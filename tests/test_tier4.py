import os
import unittest
import requests

PORT = os.environ.get('HDSFD_TESTING_PORT', '5000')
BASE_URL = f"http://127.0.0.1:{PORT}"

class TestTier4RealWorldWorkloads(unittest.TestCase):

    # 1. Semester Kickoff Scenario
    def test_scenario1_semester_kickoff(self):
        username = "student_kickoff"
        # 1. Register student
        r_auth = requests.post(f"{BASE_URL}/api/auth/login", json={"username": username, "password_hash": "pass_kickoff"})
        self.assertEqual(r_auth.status_code, 200)

        # 2. Create Syllabus Modules
        requests.post(f"{BASE_URL}/api/create", json={"username": username, "type": "syllabus_item", "module_name": "Database Systems", "progress": 0, "status": "todo"})
        requests.post(f"{BASE_URL}/api/create", json={"username": username, "type": "syllabus_item", "module_name": "Operating Systems", "progress": 0, "status": "todo"})

        # 3. Create starter tasks
        requests.post(f"{BASE_URL}/api/create", json={"username": username, "type": "task", "title": "Buy OS Textbook", "completed": False})
        requests.post(f"{BASE_URL}/api/create", json={"username": username, "type": "task", "title": "Install PostgreSQL", "completed": False})

        # 4. Save Zen Mode preferences with panels hidden initially
        requests.post(f"{BASE_URL}/api/create", json={
            "username": username, 
            "type": "zen_preferences", 
            "theme": "dark_cyberpunk", 
            "sound_volume": 80,
            "panels_hidden": True,
            "esc_pressed": False,
            "q_hold_seconds": 0.0
        })

        # 5. Set Jarvis Chatbot config
        requests.post(f"{BASE_URL}/api/jarvis/config", json={"username": username, "tier": "low"})

        # 6. Retrieve all items to verify semester data is saved
        r_data = requests.get(f"{BASE_URL}/api/data/{username}")
        self.assertTrue(len(r_data.json()) >= 5)

    # 2. High-Productivity Study Block Scenario
    def test_scenario2_high_productivity_study_blocks(self):
        username = "student_prod"
        requests.post(f"{BASE_URL}/api/auth/login", json={"username": username, "password_hash": "p"})

        # 1. Student completes a 45-minute focus session
        requests.post(f"{BASE_URL}/api/create", json={"username": username, "type": "focus_session", "minutes": 45})

        # 2. Student marks 3 tasks as completed
        requests.post(f"{BASE_URL}/api/create", json={"username": username, "type": "task", "title": "Read Chapter 1", "completed": True})
        requests.post(f"{BASE_URL}/api/create", json={"username": username, "type": "task", "title": "Review lecture notes", "completed": True})
        requests.post(f"{BASE_URL}/api/create", json={"username": username, "type": "task", "title": "Lab 1 setup", "completed": True})

        # 3. Sync biometrics steps (earned seeds)
        requests.post(f"{BASE_URL}/api/biometrics/sync", json={"username": username, "steps": 5000})

        # 4. Check RPG stats
        r_stats = requests.get(f"{BASE_URL}/api/stats/{username}")
        self.assertEqual(r_stats.json().get("stamina"), 14)
        self.assertEqual(r_stats.json().get("knowledge"), 25)

        # 5. Initialize seeds via transaction cost=0
        r_seeds = requests.post(f"{BASE_URL}/api/seeds/transaction", json={"username": username, "cost": 0})
        self.assertEqual(r_seeds.json().get("currency").get("seeds"), 125)

    # 3. Exam Preparation Boss Battle Scenario
    def test_scenario3_exam_preparation_boss_battles(self):
        username = "student_boss"
        requests.post(f"{BASE_URL}/api/auth/login", json={"username": username, "password_hash": "p"})

        # 1. Create boss battle for "Calculus Final"
        r_boss = requests.post(f"{BASE_URL}/api/create", json={
            "username": username, "type": "exam_boss", "boss_name": "Calculus Final", "target_date": "2026-06-20", "difficulty": "epic", "visual_state": "undamaged"
        })
        boss_item = r_boss.json()
        boss_id = boss_item["__backendId"]

        # 2. Add and reschedule prep tasks leading up to the exam
        r_task = requests.post(f"{BASE_URL}/api/create", json={"username": username, "type": "task", "title": "Calculus Review Sheet"})
        task_id = r_task.json()["__backendId"]
        
        requests.post(f"{BASE_URL}/api/tasks/reschedule", json={
            "username": username, "task_id": task_id, "new_timestamp": "2026-06-19T20:00:00"
        })

        # 3. Complete study sessions (focus sessions)
        requests.post(f"{BASE_URL}/api/create", json={"username": username, "type": "focus_session", "minutes": 60})

        # 4. Update the boss visual state to "defeated" after completing prep
        requests.put(f"{BASE_URL}/api/update/{boss_id}", json={
            "username": username, "type": "exam_boss", "boss_name": "Calculus Final", "target_date": "2026-06-20", "difficulty": "epic", "visual_state": "defeated"
        })

        # 5. Retrieve boss battle to confirm state
        r_data = requests.get(f"{BASE_URL}/api/data/{username}")
        boss_retrieved = [item for item in r_data.json() if item.get("type") == "exam_boss"][0]
        self.assertEqual(boss_retrieved.get("visual_state"), "defeated")

    # 4. Collaborative Study with Peer Gifting Scenario
    def test_scenario4_collaborative_study_with_peer_gifting(self):
        sender = "peer_sender"
        recipient = "peer_recipient"
        requests.post(f"{BASE_URL}/api/auth/login", json={"username": sender, "password_hash": "p"})
        requests.post(f"{BASE_URL}/api/auth/login", json={"username": recipient, "password_hash": "p"})

        # 2. Sender earns seeds via steps sync
        requests.post(f"{BASE_URL}/api/biometrics/sync", json={"username": sender, "steps": 10000})

        # 3. Sender purchases "neon" theme
        requests.post(f"{BASE_URL}/api/seeds/transaction", json={"username": sender, "cost": 30, "action": "buy_theme_neon"})

        # 4. Sender gifts 40 seeds to recipient
        requests.post(f"{BASE_URL}/api/store/gift", json={
            "username": sender, "friend_username": recipient, "gift_type": "seeds", "amount": 40
        })

        # 5. Sender gifts "neon" theme item to recipient
        requests.post(f"{BASE_URL}/api/store/gift", json={
            "username": sender, "friend_username": recipient, "gift_type": "item", "item_id": "neon"
        })

        # 6. Verify recipient's balance and inventory
        r_recip_data = requests.get(f"{BASE_URL}/api/data/{recipient}")
        curr = [item for item in r_recip_data.json() if item.get("type") == "currency"][0]
        self.assertEqual(curr.get("seeds"), 40)
        self.assertIn("neon", curr.get("inventory"))

    # 5. Creative Journaling Summaries Scenario
    def test_scenario5_creative_journaling_summaries(self):
        username = "creative_student"
        requests.post(f"{BASE_URL}/api/auth/login", json={"username": username, "password_hash": "p"})

        # 1. Create a note journal with canvas sketches
        requests.post(f"{BASE_URL}/api/create", json={
            "username": username, "type": "note", "title": "Lab Sketch", "body": "Microscope diagram", "canvas_paths": [{"x": 100, "y": 150}]
        })

        # 2. Generate AI summary log
        requests.post(f"{BASE_URL}/api/create", json={
            "username": username, "type": "ai_summary", "summary_text": "Completed lab sketch and synchronized notes."
        })

        # 3. Update AI preferences
        requests.post(f"{BASE_URL}/api/create", json={
            "username": username, "type": "ai_preferences", "creativity_slider": 0.9, "length_slider": 250
        })

        # 4. Retrieve data and verify creative summary elements exist
        r_data = requests.get(f"{BASE_URL}/api/data/{username}")
        types = [item.get("type") for item in r_data.json()]
        self.assertIn("note", types)
        self.assertIn("ai_summary", types)
        self.assertIn("ai_preferences", types)

    # 6. Chatbot Interactive Commands with Rescheduling Scenario (HTTP Polling verification)
    def test_scenario6_chatbot_interactive_commands_with_rescheduling(self):
        username = "chat_student"
        requests.post(f"{BASE_URL}/api/auth/login", json={"username": username, "password_hash": "p"})

        # 1. Configure chatbot tier settings
        requests.post(f"{BASE_URL}/api/jarvis/config", json={"username": username, "tier": "high"})

        # 2. Send messages to chatbot (simulating HTTP Send polling flow)
        requests.post(f"{BASE_URL}/api/chat/send", json={"username": username, "message": "Help me reschedule my conflicts."})
        requests.post(f"{BASE_URL}/api/chat/send", json={"username": username, "message": "Schedule a study session for OS."})

        # 3. Retrieve chat history via GET HTTP Fetch Polling
        r_chat = requests.get(f"{BASE_URL}/api/chat/recent")
        self.assertTrue(len(r_chat.json()) >= 2)

        # 4. Create and reschedule conflicting tasks
        r_task = requests.post(f"{BASE_URL}/api/create", json={"username": username, "type": "task", "title": "Group Meeting", "timestamp": "2026-06-15T13:00:00"})
        task_id = r_task.json()["__backendId"]
        
        r_resched = requests.post(f"{BASE_URL}/api/tasks/reschedule", json={
            "username": username, "task_id": task_id, "new_timestamp": "2026-06-15T15:30:00"
        })
        self.assertEqual(r_resched.status_code, 200)

    # 7. Backup Disaster Recovery Scenario
    def test_scenario7_backup_disaster_recovery(self):
        username = "recovery_student"
        # 1. Setup mock google drive auth
        requests.post(f"{BASE_URL}/api/auth/login", json={"username": username, "password_hash": "p"})
        r_auth = requests.get(f"{BASE_URL}/api/gdrive/auth?username={username}")
        self.assertEqual(r_auth.status_code, 200)

        # 2. Create some items
        requests.post(f"{BASE_URL}/api/create", json={"username": username, "type": "task", "title": "Recoverable Task", "completed": True})

        # 3. Request settings backup
        r_backup = requests.post(f"{BASE_URL}/api/settings/backup", json={"username": username})
        self.assertEqual(r_backup.status_code, 200)

        # 4. Validate backup metadata is returned
        backup_data = r_backup.json()
        self.assertEqual(backup_data.get("status"), "success")
        self.assertIn("backup_filename", backup_data)
        self.assertTrue(backup_data.get("size_bytes") > 0)

if __name__ == '__main__':
    unittest.main()
