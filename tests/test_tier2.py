import os
import unittest
import requests

PORT = os.environ.get('HDSFD_TESTING_PORT', '5000')
BASE_URL = f"http://127.0.0.1:{PORT}"

class TestTier2BoundariesAndCorners(unittest.TestCase):

    # --- F1: User Authentication ---
    def test_f1_edge1_login_empty_username(self):
        url = f"{BASE_URL}/api/auth/login"
        r = requests.post(url, json={"username": "", "password_hash": "hash"})
        self.assertEqual(r.status_code, 200)

    def test_f1_edge2_login_incorrect_password(self):
        requests.post(f"{BASE_URL}/api/auth/login", json={"username": "f1_edge_user", "password_hash": "correct_pass"})
        url = f"{BASE_URL}/api/auth/login"
        r = requests.post(url, json={"username": "f1_edge_user", "password_hash": "wrong_pass"})
        self.assertEqual(r.status_code, 401)
        self.assertEqual(r.json().get("status"), "error")

    def test_f1_edge3_login_missing_password_hash(self):
        url = f"{BASE_URL}/api/auth/login"
        r = requests.post(url, json={"username": "f1_edge_user2"})
        self.assertIn(r.status_code, [400, 401, 500])

    def test_f1_edge4_gdrive_auth_missing_username(self):
        url = f"{BASE_URL}/api/gdrive/auth"
        r = requests.get(url, allow_redirects=False)
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json().get("message"), "Missing username")

    def test_f1_edge5_gdrive_status_missing_username(self):
        url = f"{BASE_URL}/api/gdrive/status"
        r = requests.get(url)
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json().get("message"), "Missing username")


    # --- F2: Data Store CRUD ---
    def test_f2_edge1_create_missing_username(self):
        url = f"{BASE_URL}/api/create"
        r = requests.post(url, json={"type": "task", "title": "No User"})
        self.assertEqual(r.status_code, 400)

    def test_f2_edge2_create_missing_type(self):
        url = f"{BASE_URL}/api/create"
        r = requests.post(url, json={"username": "f2_edge_user", "title": "No Type"})
        self.assertEqual(r.status_code, 400)

    def test_f2_edge3_retrieve_nonexistent_user(self):
        url = f"{BASE_URL}/api/data/nonexistent_user_xyz"
        r = requests.get(url)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json(), [])

    def test_f2_edge4_database_journal_mode(self):
        # Verify SQLite is strictly in DELETE mode (not WAL)
        import sqlite3
        tests_dir = os.path.dirname(os.path.abspath(__file__))
        db_path = os.environ.get('HDSFD_DB_PATH', os.path.join(os.path.dirname(tests_dir), 'backend', 'database.db'))
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        mode = cursor.execute("PRAGMA journal_mode;").fetchone()[0]
        conn.close()
        self.assertEqual(mode.lower(), "delete")

    def test_f2_edge5_delete_nonexistent_item(self):
        url = f"{BASE_URL}/api/delete/999999"
        r = requests.delete(url)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json().get("status"), "deleted")


    # --- F3: Focus Sanctuary ---
    def test_f3_edge1_focus_negative_minutes(self):
        url = f"{BASE_URL}/api/create"
        r = requests.post(url, json={"username": "f3_edge", "type": "focus_session", "minutes": -10})
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.json().get("minutes"), -10)

    def test_f3_edge2_focus_huge_minutes(self):
        url = f"{BASE_URL}/api/create"
        r = requests.post(url, json={"username": "f3_edge", "type": "focus_session", "minutes": 1000000})
        self.assertEqual(r.status_code, 201)

    def test_f3_edge3_focus_string_minutes(self):
        url = f"{BASE_URL}/api/create"
        r = requests.post(url, json={"username": "f3_edge", "type": "focus_session", "minutes": "invalid"})
        self.assertEqual(r.status_code, 201)

    def test_f3_edge4_stats_nonexistent_user(self):
        url = f"{BASE_URL}/api/stats/nonexistent_stats_user"
        r = requests.get(url)
        self.assertEqual(r.status_code, 404)

    def test_f3_edge5_focus_session_missing_minutes_field(self):
        url = f"{BASE_URL}/api/create"
        r = requests.post(url, json={"username": "f3_edge_stats", "type": "focus_session"})
        self.assertEqual(r.status_code, 201)
        requests.post(f"{BASE_URL}/api/auth/login", json={"username": "f3_edge_stats", "password_hash": "p"})
        r_stats = requests.get(f"{BASE_URL}/api/stats/f3_edge_stats")
        self.assertEqual(r_stats.status_code, 200)
        self.assertEqual(r_stats.json().get("focus_minutes"), 0)


    # --- F4: Zen Mode ---
    def test_f4_edge1_zen_exit_invalid_hold_time(self):
        # Zen exit simulation: hold time is negative
        r_create = requests.post(f"{BASE_URL}/api/create", json={
            "username": "f4_edge", 
            "type": "zen_preferences", 
            "panels_hidden": True,
            "esc_pressed": True,
            "q_hold_seconds": -5.0
        })
        self.assertEqual(r_create.status_code, 201)
        pref = r_create.json()
        self.assertTrue(pref.get("panels_hidden"))

    def test_f4_edge2_zen_exit_esc_only_panels_hidden(self):
        # ESC was pressed but Q key hold time was 0, so panels must remain hidden
        r_create = requests.post(f"{BASE_URL}/api/create", json={
            "username": "f4_edge", 
            "type": "zen_preferences", 
            "panels_hidden": True,
            "esc_pressed": True,
            "q_hold_seconds": 0.0
        })
        self.assertTrue(r_create.json().get("panels_hidden"))

    def test_f4_edge3_zen_exit_q_short_hold(self):
        # Q key hold is less than 3 seconds (2.9s), panels remain hidden
        r_create = requests.post(f"{BASE_URL}/api/create", json={
            "username": "f4_edge", 
            "type": "zen_preferences", 
            "panels_hidden": True,
            "esc_pressed": True,
            "q_hold_seconds": 2.9
        })
        self.assertTrue(r_create.json().get("panels_hidden"))

    def test_f4_edge4_zen_exit_q_long_hold(self):
        # Q key hold is >= 3 seconds (3.0s), panels are revealed
        r_create = requests.post(f"{BASE_URL}/api/create", json={
            "username": "f4_edge_reveal", 
            "type": "zen_preferences", 
            "panels_hidden": True,
            "esc_pressed": True,
            "q_hold_seconds": 3.0
        })
        item_id = r_create.json()["__backendId"]
        
        # Simulating frontend updating database to reveal panels on 3s hold
        requests.put(f"{BASE_URL}/api/update/{item_id}", json={
            "username": "f4_edge_reveal", 
            "type": "zen_preferences", 
            "panels_hidden": False,
            "esc_pressed": True,
            "q_hold_seconds": 3.0
        })
        
        r_get = requests.get(f"{BASE_URL}/api/data/f4_edge_reveal")
        self.assertFalse(r_get.json()[0].get("panels_hidden"))

    def test_f4_edge5_zen_preferences_html_injection(self):
        url = f"{BASE_URL}/api/create"
        payload = {"username": "f4_edge", "type": "zen_preferences", "theme": "<script>alert('xss')</script>"}
        r = requests.post(url, json=payload)
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.json().get("theme"), "<script>alert('xss')</script>")


    # --- F5: Exam Boss Battle ---
    def test_f5_edge1_boss_negative_target_date(self):
        url = f"{BASE_URL}/api/create"
        payload = {"username": "f5_edge", "type": "exam_boss", "target_date": "-5 days"}
        r = requests.post(url, json=payload)
        self.assertEqual(r.status_code, 201)

    def test_f5_edge2_boss_invalid_date_format(self):
        url = f"{BASE_URL}/api/create"
        payload = {"username": "f5_edge", "type": "exam_boss", "target_date": "invalid_date_string"}
        r = requests.post(url, json=payload)
        self.assertEqual(r.status_code, 201)

    def test_f5_edge3_boss_empty_difficulty(self):
        url = f"{BASE_URL}/api/create"
        payload = {"username": "f5_edge", "type": "exam_boss", "difficulty": ""}
        r = requests.post(url, json=payload)
        self.assertEqual(r.status_code, 201)

    def test_f5_edge4_boss_update_nonexistent(self):
        url = f"{BASE_URL}/api/update/888888"
        r = requests.put(url, json={"username": "f5_edge", "type": "exam_boss", "boss_name": "Ghost"})
        self.assertEqual(r.status_code, 200)

    def test_f5_edge5_boss_empty_name(self):
        url = f"{BASE_URL}/api/create"
        payload = {"username": "f5_edge", "type": "exam_boss", "boss_name": ""}
        r = requests.post(url, json=payload)
        self.assertEqual(r.status_code, 201)


    # --- F6: Calendar & Task Rescheduling ---
    def test_f6_edge1_reschedule_missing_task_id(self):
        url = f"{BASE_URL}/api/tasks/reschedule"
        r = requests.post(url, json={"username": "f6_edge", "new_timestamp": "2026-06-15"})
        self.assertEqual(r.status_code, 400)

    def test_f6_edge2_reschedule_nonexistent_task(self):
        url = f"{BASE_URL}/api/tasks/reschedule"
        r = requests.post(url, json={"username": "f6_edge", "task_id": 999999, "new_timestamp": "2026-06-15"})
        self.assertEqual(r.status_code, 404)

    def test_f6_edge3_reschedule_nonexistent_user(self):
        url = f"{BASE_URL}/api/tasks/reschedule"
        r = requests.post(url, json={"username": "f6_nonexistent_user", "task_id": 1, "new_timestamp": "2026-06-15"})
        self.assertEqual(r.status_code, 404)

    def test_f6_edge4_reschedule_empty_timestamp(self):
        r_create = requests.post(f"{BASE_URL}/api/create", json={"username": "f6_edge", "type": "task", "title": "T"})
        task_id = r_create.json()["__backendId"]
        url = f"{BASE_URL}/api/tasks/reschedule"
        r = requests.post(url, json={"username": "f6_edge", "task_id": task_id, "new_timestamp": ""})
        self.assertEqual(r.status_code, 200)

    def test_f6_edge5_reschedule_negative_duration(self):
        r_create = requests.post(f"{BASE_URL}/api/create", json={"username": "f6_edge", "type": "task", "title": "T"})
        task_id = r_create.json()["__backendId"]
        url = f"{BASE_URL}/api/tasks/reschedule"
        r = requests.post(url, json={"username": "f6_edge", "task_id": task_id, "new_timestamp": "2026-06-15", "duration": -60})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json().get("task").get("duration"), -60)


    # --- F7: Syllabus Tracker ---
    def test_f7_edge1_syllabus_progress_over_100(self):
        url = f"{BASE_URL}/api/create"
        r = requests.post(url, json={"username": "f7_edge", "type": "syllabus_item", "progress": 150})
        self.assertEqual(r.status_code, 201)

    def test_f7_edge2_syllabus_progress_negative(self):
        url = f"{BASE_URL}/api/create"
        r = requests.post(url, json={"username": "f7_edge", "type": "syllabus_item", "progress": -50})
        self.assertEqual(r.status_code, 201)

    def test_f7_edge3_syllabus_empty_module_name(self):
        url = f"{BASE_URL}/api/create"
        r = requests.post(url, json={"username": "f7_edge", "type": "syllabus_item", "module_name": ""})
        self.assertEqual(r.status_code, 201)

    def test_f7_edge4_syllabus_invalid_status(self):
        url = f"{BASE_URL}/api/create"
        r = requests.post(url, json={"username": "f7_edge", "type": "syllabus_item", "status": "unknown_status"})
        self.assertEqual(r.status_code, 201)

    def test_f7_edge5_syllabus_non_numeric_progress(self):
        url = f"{BASE_URL}/api/create"
        r = requests.post(url, json={"username": "f7_edge", "type": "syllabus_item", "progress": "fifty_percent"})
        self.assertEqual(r.status_code, 201)


    # --- F8: Activity Heatmap ---
    def test_f8_edge1_heatmap_invalid_date_format(self):
        url = f"{BASE_URL}/api/create"
        r = requests.post(url, json={"username": "f8_edge", "type": "activity_log", "date": "14-06-2026"})
        self.assertEqual(r.status_code, 201)

    def test_f8_edge2_heatmap_future_date(self):
        url = f"{BASE_URL}/api/create"
        r = requests.post(url, json={"username": "f8_edge", "type": "activity_log", "date": "2099-01-01"})
        self.assertEqual(r.status_code, 201)

    def test_f8_edge3_heatmap_empty_activity(self):
        url = f"{BASE_URL}/api/create"
        r = requests.post(url, json={"username": "f8_edge", "type": "activity_log", "activity": ""})
        self.assertEqual(r.status_code, 201)

    def test_f8_edge4_heatmap_duplicate_dates(self):
        requests.post(f"{BASE_URL}/api/create", json={"username": "f8_edge_dup", "type": "activity_log", "activity": "A", "date": "2026-06-14"})
        requests.post(f"{BASE_URL}/api/create", json={"username": "f8_edge_dup", "type": "activity_log", "activity": "B", "date": "2026-06-14"})
        url = f"{BASE_URL}/api/data/f8_edge_dup"
        r = requests.get(url)
        self.assertEqual(len(r.json()), 2)

    def test_f8_edge5_heatmap_empty_username_query(self):
        url = f"{BASE_URL}/api/data/"
        r = requests.get(url)
        self.assertEqual(r.status_code, 404)


    # --- F9: Notes Journal ---
    def test_f9_edge1_delete_note_string_id(self):
        url = f"{BASE_URL}/api/delete/invalid_string_id"
        r = requests.delete(url)
        self.assertEqual(r.status_code, 404)

    def test_f9_edge2_create_note_empty_fields(self):
        url = f"{BASE_URL}/api/create"
        r = requests.post(url, json={"username": "f9_edge", "type": "note", "title": "", "body": ""})
        self.assertEqual(r.status_code, 201)

    def test_f9_edge3_note_huge_canvas_payload(self):
        url = f"{BASE_URL}/api/create"
        huge_paths = [{"points": [[i, i] for i in range(5000)]}]
        r = requests.post(url, json={"username": "f9_edge", "type": "note", "canvas_paths": huge_paths})
        self.assertEqual(r.status_code, 201)

    def test_f9_edge4_note_page_update_nonexistent(self):
        url = f"{BASE_URL}/api/update/999999"
        r = requests.put(url, json={"username": "f9_edge", "type": "note", "page_number": 10})
        self.assertEqual(r.status_code, 200)

    def test_f9_edge5_note_delete_mismatch(self):
        url = f"{BASE_URL}/api/delete/0"
        r = requests.delete(url)
        self.assertEqual(r.status_code, 200)


    # --- F10: Local AI Summary ---
    def test_f10_edge1_ai_summary_empty_text(self):
        url = f"{BASE_URL}/api/create"
        r = requests.post(url, json={"username": "f10_edge", "type": "ai_summary", "summary_text": ""})
        self.assertEqual(r.status_code, 201)

    def test_f10_edge2_ai_slider_creativity_out_of_bounds(self):
        url = f"{BASE_URL}/api/create"
        r = requests.post(url, json={"username": "f10_edge", "type": "ai_preferences", "creativity_slider": 5.5})
        self.assertEqual(r.status_code, 201)

    def test_f10_edge3_ai_slider_length_out_of_bounds(self):
        url = f"{BASE_URL}/api/create"
        r = requests.post(url, json={"username": "f10_edge", "type": "ai_preferences", "length_slider": -500})
        self.assertEqual(r.status_code, 201)

    def test_f10_edge4_ai_summary_update_ghost(self):
        url = f"{BASE_URL}/api/update/999999"
        r = requests.put(url, json={"username": "f10_edge", "type": "ai_summary", "summary_text": "Updated text"})
        self.assertEqual(r.status_code, 200)

    def test_f10_edge5_ai_summary_nonexistent_user(self):
        url = f"{BASE_URL}/api/data/ai_ghost_user"
        r = requests.get(url)
        self.assertEqual(r.json(), [])


    # --- F11: Jarvis Chatbot ---
    def test_f11_edge1_jarvis_config_empty_username(self):
        url = f"{BASE_URL}/api/jarvis/config"
        r = requests.post(url, json={"username": "", "tier": "low"})
        self.assertEqual(r.status_code, 400)

    def test_f11_edge2_jarvis_config_unsupported_tier(self):
        url = f"{BASE_URL}/api/jarvis/config"
        r = requests.post(url, json={"username": "f11_edge", "tier": "legendary"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json().get("config").get("tier"), "legendary")

    def test_f11_edge3_jarvis_config_huge_tier_name(self):
        url = f"{BASE_URL}/api/jarvis/config"
        r = requests.post(url, json={"username": "f11_edge", "tier": "A" * 1000})
        self.assertEqual(r.status_code, 200)

    def test_f11_edge4_jarvis_config_invalid_payload(self):
        url = f"{BASE_URL}/api/jarvis/config"
        r = requests.post(url, json={})
        self.assertEqual(r.status_code, 400)

    def test_f11_edge5_jarvis_config_nonexistent_user(self):
        url = f"{BASE_URL}/api/data/jarvis_ghost_user"
        r = requests.get(url)
        self.assertEqual(r.json(), [])


    # --- F12: Store & Seeds Economy ---
    def test_f12_edge1_seeds_negative_cost(self):
        requests.post(f"{BASE_URL}/api/auth/login", json={"username": "f12_edge_a", "password_hash": "p"})
        url = f"{BASE_URL}/api/seeds/transaction"
        r = requests.post(url, json={"username": "f12_edge_a", "cost": -100})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json().get("currency").get("seeds"), 100)

    def test_f12_edge2_seeds_insufficient_balance(self):
        requests.post(f"{BASE_URL}/api/auth/login", json={"username": "f12_edge_b", "password_hash": "p"})
        url = f"{BASE_URL}/api/seeds/transaction"
        r = requests.post(url, json={"username": "f12_edge_b", "cost": 999999})
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json().get("message"), "Insufficient seeds")

    def test_f12_edge3_seeds_nonexistent_user(self):
        url = f"{BASE_URL}/api/seeds/transaction"
        r = requests.post(url, json={"username": "nonexistent_seeds_user", "cost": 50})
        self.assertEqual(r.status_code, 400)

    def test_f12_edge4_seeds_buy_theme_invalid_format(self):
        requests.post(f"{BASE_URL}/api/auth/login", json={"username": "f12_edge_d", "password_hash": "p"})
        requests.post(f"{BASE_URL}/api/biometrics/sync", json={"username": "f12_edge_d", "steps": 10000})
        url = f"{BASE_URL}/api/seeds/transaction"
        r = requests.post(url, json={"username": "f12_edge_d", "cost": 10, "action": "buy_theme_!!!@@@"})
        self.assertEqual(r.status_code, 200)
        self.assertIn("!!!@@@", r.json().get("currency").get("inventory"))

    def test_f12_edge5_buy_streak_freeze_insufficient(self):
        requests.post(f"{BASE_URL}/api/auth/login", json={"username": "f12_edge_e", "password_hash": "p"})
        url = f"{BASE_URL}/api/seeds/transaction"
        r = requests.post(url, json={"username": "f12_edge_e", "cost": 10, "action": "buy_streak_freeze"})
        self.assertEqual(r.status_code, 400)


    # --- F13: Biometrics Steps & Gifting ---
    def test_f13_edge1_sync_steps_less_than_100(self):
        requests.post(f"{BASE_URL}/api/auth/login", json={"username": "f13_edge", "password_hash": "p"})
        url = f"{BASE_URL}/api/biometrics/sync"
        r = requests.post(url, json={"username": "f13_edge", "steps": 50})
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json().get("message"), "Steps count must be at least 100 to earn seeds")

    def test_f13_edge2_sync_steps_negative(self):
        requests.post(f"{BASE_URL}/api/auth/login", json={"username": "f13_edge", "password_hash": "p"})
        url = f"{BASE_URL}/api/biometrics/sync"
        r = requests.post(url, json={"username": "f13_edge", "steps": -500})
        self.assertEqual(r.status_code, 400)

    def test_f13_edge3_gift_missing_sender_currency(self):
        requests.post(f"{BASE_URL}/api/auth/login", json={"username": "f13_sender_ghost", "password_hash": "p"})
        requests.post(f"{BASE_URL}/api/auth/login", json={"username": "f13_recipient_edge", "password_hash": "p"})
        url = f"{BASE_URL}/api/store/gift"
        r = requests.post(url, json={
            "username": "f13_sender_ghost", "friend_username": "f13_recipient_edge", "gift_type": "seeds", "amount": 10
        })
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json().get("message"), "Sender currency not found")

    def test_f13_edge4_gift_to_oneself(self):
        requests.post(f"{BASE_URL}/api/auth/login", json={"username": "f13_edge_user", "password_hash": "p"})
        url = f"{BASE_URL}/api/store/gift"
        r = requests.post(url, json={
            "username": "f13_edge_user", "friend_username": "f13_edge_user", "gift_type": "seeds", "amount": 10
        })
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json().get("message"), "Cannot gift to yourself")

    def test_f13_edge5_gift_to_nonexistent_recipient(self):
        requests.post(f"{BASE_URL}/api/auth/login", json={"username": "f13_sender_edge", "password_hash": "p"})
        requests.post(f"{BASE_URL}/api/biometrics/sync", json={"username": "f13_sender_edge", "steps": 5000})
        url = f"{BASE_URL}/api/store/gift"
        r = requests.post(url, json={
            "username": "f13_sender_edge", "friend_username": "ghost_recipient_123", "gift_type": "seeds", "amount": 10
        })
        self.assertEqual(r.status_code, 404)
        self.assertEqual(r.json().get("message"), "Friend 'ghost_recipient_123' not found")

if __name__ == '__main__':
    unittest.main()
