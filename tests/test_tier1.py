import os
import unittest
import requests

PORT = os.environ.get('HDSFD_TESTING_PORT', '5000')
BASE_URL = f"http://127.0.0.1:{PORT}"

class TestTier1FeatureCoverage(unittest.TestCase):

    # --- F1: User Authentication ---
    def test_f1_case1_register_user_a(self):
        url = f"{BASE_URL}/api/auth/login"
        payload = {"username": "f1_user_a", "password_hash": "hash_a"}
        r = requests.post(url, json=payload)
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json().get("new_user"))
        self.assertEqual(r.json().get("username"), "f1_user_a")

    def test_f1_case2_register_user_b(self):
        url = f"{BASE_URL}/api/auth/login"
        payload = {"username": "f1_user_b", "password_hash": "hash_b"}
        r = requests.post(url, json=payload)
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json().get("new_user"))

    def test_f1_case3_login_existing_user_a(self):
        # Register first
        requests.post(f"{BASE_URL}/api/auth/login", json={"username": "f1_user_c", "password_hash": "hash_c"})
        # Login
        url = f"{BASE_URL}/api/auth/login"
        payload = {"username": "f1_user_c", "password_hash": "hash_c"}
        r = requests.post(url, json=payload)
        self.assertEqual(r.status_code, 200)
        self.assertIsNone(r.json().get("new_user"))
        self.assertEqual(r.json().get("username"), "f1_user_c")

    def test_f1_case4_login_existing_user_b(self):
        requests.post(f"{BASE_URL}/api/auth/login", json={"username": "f1_user_d", "password_hash": "hash_d"})
        url = f"{BASE_URL}/api/auth/login"
        payload = {"username": "f1_user_d", "password_hash": "hash_d"}
        r = requests.post(url, json=payload)
        self.assertEqual(r.status_code, 200)

    def test_f1_case5_gdrive_status_check(self):
        # Check initial unlinked status
        url = f"{BASE_URL}/api/gdrive/status?username=f1_user_a"
        r = requests.get(url)
        self.assertEqual(r.status_code, 200)
        self.assertFalse(r.json().get("linked"))


    # --- F2: Data Store CRUD ---
    def test_f2_case1_create_item(self):
        url = f"{BASE_URL}/api/create"
        payload = {"username": "f2_user", "type": "task", "title": "Math Homework", "completed": False}
        r = requests.post(url, json=payload)
        self.assertEqual(r.status_code, 201)
        self.assertIn("__backendId", r.json())
        self.assertEqual(r.json().get("title"), "Math Homework")

    def test_f2_case2_retrieve_user_data(self):
        requests.post(f"{BASE_URL}/api/create", json={"username": "f2_user_retrieve", "type": "task", "title": "Phys Class"})
        url = f"{BASE_URL}/api/data/f2_user_retrieve"
        r = requests.get(url)
        self.assertEqual(r.status_code, 200)
        self.assertTrue(len(r.json()) >= 1)
        self.assertEqual(r.json()[0].get("title"), "Phys Class")

    def test_f2_case3_update_item(self):
        r_create = requests.post(f"{BASE_URL}/api/create", json={"username": "f2_user", "type": "task", "title": "Draft"})
        item_id = r_create.json()["__backendId"]
        
        url = f"{BASE_URL}/api/update/{item_id}"
        payload = {"username": "f2_user", "type": "task", "title": "Finalized", "completed": True}
        r = requests.put(url, json=payload)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json().get("status"), "success")

    def test_f2_case4_delete_item(self):
        r_create = requests.post(f"{BASE_URL}/api/create", json={"username": "f2_user", "type": "task", "title": "To Delete"})
        item_id = r_create.json()["__backendId"]
        
        url = f"{BASE_URL}/api/delete/{item_id}"
        r = requests.delete(url)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json().get("status"), "deleted")

    def test_f2_case5_create_multiple_types(self):
        requests.post(f"{BASE_URL}/api/create", json={"username": "f2_multi_user", "type": "task", "title": "Task A"})
        requests.post(f"{BASE_URL}/api/create", json={"username": "f2_multi_user", "type": "note", "title": "Note B"})
        url = f"{BASE_URL}/api/data/f2_multi_user"
        r = requests.get(url)
        self.assertEqual(r.status_code, 200)
        types = [item.get("type") for item in r.json()]
        self.assertIn("task", types)
        self.assertIn("note", types)


    # --- F3: Focus Sanctuary ---
    def test_f3_case1_create_focus_session(self):
        url = f"{BASE_URL}/api/create"
        payload = {"username": "f3_user", "type": "focus_session", "minutes": 25}
        r = requests.post(url, json=payload)
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.json().get("minutes"), 25)

    def test_f3_case2_retrieve_focus_session(self):
        requests.post(f"{BASE_URL}/api/create", json={"username": "f3_user_r", "type": "focus_session", "minutes": 30})
        url = f"{BASE_URL}/api/data/f3_user_r"
        r = requests.get(url)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()[0].get("minutes"), 30)

    def test_f3_case3_update_focus_session(self):
        r_create = requests.post(f"{BASE_URL}/api/create", json={"username": "f3_user", "type": "focus_session", "minutes": 20})
        item_id = r_create.json()["__backendId"]
        
        url = f"{BASE_URL}/api/update/{item_id}"
        payload = {"username": "f3_user", "type": "focus_session", "minutes": 40}
        r = requests.put(url, json=payload)
        self.assertEqual(r.status_code, 200)

    def test_f3_case4_create_multiple_focus_sessions(self):
        requests.post(f"{BASE_URL}/api/create", json={"username": "f3_user_m", "type": "focus_session", "minutes": 15})
        requests.post(f"{BASE_URL}/api/create", json={"username": "f3_user_m", "type": "focus_session", "minutes": 45})
        url = f"{BASE_URL}/api/data/f3_user_m"
        r = requests.get(url)
        self.assertEqual(len(r.json()), 2)

    def test_f3_case5_focus_session_stats(self):
        # Register user
        requests.post(f"{BASE_URL}/api/auth/login", json={"username": "f3_user_stats", "password_hash": "pass"})
        # Create session
        requests.post(f"{BASE_URL}/api/create", json={"username": "f3_user_stats", "type": "focus_session", "minutes": 50})
        # Check stats
        url = f"{BASE_URL}/api/stats/f3_user_stats"
        r = requests.get(url)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json().get("focus_minutes"), 50)
        # stamina = min(100, 10 + (50 // 10)) = 15
        self.assertEqual(r.json().get("stamina"), 15)


    # --- F4: Zen Mode ---
    def test_f4_case1_create_zen_preferences(self):
        url = f"{BASE_URL}/api/create"
        payload = {
            "username": "f4_user", 
            "type": "zen_preferences", 
            "theme": "ocean", 
            "sound_enabled": True,
            "panels_hidden": True,
            "esc_pressed": False,
            "q_hold_seconds": 0.0
        }
        r = requests.post(url, json=payload)
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.json().get("theme"), "ocean")
        self.assertTrue(r.json().get("panels_hidden"))

    def test_f4_case2_zen_exit_esc_only(self):
        # Fullscreen mode is dropped natively by ESC, but panels and workspace must remain hidden on ESC alone
        r_create = requests.post(f"{BASE_URL}/api/create", json={
            "username": "f4_user_esc", 
            "type": "zen_preferences", 
            "panels_hidden": True,
            "esc_pressed": True,
            "q_hold_seconds": 0.0
        })
        self.assertEqual(r_create.status_code, 201)
        
        # Verify panels remain hidden
        r_get = requests.get(f"{BASE_URL}/api/data/f4_user_esc")
        pref = r_get.json()[0]
        self.assertTrue(pref.get("panels_hidden"))
        self.assertTrue(pref.get("esc_pressed"))
        self.assertEqual(pref.get("q_hold_seconds"), 0.0)

    def test_f4_case3_zen_exit_q_short_hold(self):
        # Q held for less than 3 seconds does not reveal navigation panels
        r_create = requests.post(f"{BASE_URL}/api/create", json={
            "username": "f4_user_q_short", 
            "type": "zen_preferences", 
            "panels_hidden": True,
            "esc_pressed": True,
            "q_hold_seconds": 1.5
        })
        self.assertEqual(r_create.status_code, 201)
        
        # Verify panels remain hidden
        r_get = requests.get(f"{BASE_URL}/api/data/f4_user_q_short")
        pref = r_get.json()[0]
        self.assertTrue(pref.get("panels_hidden"))
        self.assertEqual(pref.get("q_hold_seconds"), 1.5)

    def test_f4_case4_zen_exit_q_long_hold(self):
        # Strict 3-second hold on the 'Q' key reveals the panels (panels_hidden -> False)
        r_create = requests.post(f"{BASE_URL}/api/create", json={
            "username": "f4_user_q_long", 
            "type": "zen_preferences", 
            "panels_hidden": True,
            "esc_pressed": True,
            "q_hold_seconds": 3.0
        })
        item_id = r_create.json()["__backendId"]
        
        # Simulate frontend hold check and update panels_hidden to False
        url = f"{BASE_URL}/api/update/{item_id}"
        payload = {
            "username": "f4_user_q_long", 
            "type": "zen_preferences", 
            "panels_hidden": False,
            "esc_pressed": True,
            "q_hold_seconds": 3.0
        }
        r_up = requests.put(url, json=payload)
        self.assertEqual(r_up.status_code, 200)
        
        # Verify panels are now revealed
        r_get = requests.get(f"{BASE_URL}/api/data/f4_user_q_long")
        pref = r_get.json()[0]
        self.assertFalse(pref.get("panels_hidden"))
        self.assertEqual(pref.get("q_hold_seconds"), 3.0)

    def test_f4_case5_multiple_zen_layouts(self):
        requests.post(f"{BASE_URL}/api/create", json={"username": "f4_user_m2", "type": "zen_preferences", "layout": "minimal"})
        requests.post(f"{BASE_URL}/api/create", json={"username": "f4_user_m2", "type": "zen_preferences", "layout": "sidebar"})
        url = f"{BASE_URL}/api/data/f4_user_m2"
        r = requests.get(url)
        self.assertEqual(len(r.json()), 2)


    # --- F5: Exam Boss Battle ---
    def test_f5_case1_create_boss_battle(self):
        url = f"{BASE_URL}/api/create"
        payload = {"username": "f5_user", "type": "exam_boss", "boss_name": "AI Midterm", "difficulty": "hard", "visual_state": "normal"}
        r = requests.post(url, json=payload)
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.json().get("boss_name"), "AI Midterm")

    def test_f5_case2_retrieve_boss_battle(self):
        requests.post(f"{BASE_URL}/api/create", json={"username": "f5_user_r", "type": "exam_boss", "boss_name": "CS 101 Final"})
        url = f"{BASE_URL}/api/data/f5_user_r"
        r = requests.get(url)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()[0].get("boss_name"), "CS 101 Final")

    def test_f5_case3_update_boss_visual_state(self):
        r_create = requests.post(f"{BASE_URL}/api/create", json={"username": "f5_user", "type": "exam_boss", "boss_name": "Bio 1", "visual_state": "full_health"})
        item_id = r_create.json()["__backendId"]
        
        url = f"{BASE_URL}/api/update/{item_id}"
        payload = {"username": "f5_user", "type": "exam_boss", "boss_name": "Bio 1", "visual_state": "damaged"}
        r = requests.put(url, json=payload)
        self.assertEqual(r.status_code, 200)

    def test_f5_case4_delete_boss_battle(self):
        r_create = requests.post(f"{BASE_URL}/api/create", json={"username": "f5_user", "type": "exam_boss", "boss_name": "Chem"})
        item_id = r_create.json()["__backendId"]
        
        url = f"{BASE_URL}/api/delete/{item_id}"
        r = requests.delete(url)
        self.assertEqual(r.status_code, 200)

    def test_f5_case5_multiple_bosses_list(self):
        requests.post(f"{BASE_URL}/api/create", json={"username": "f5_user_m", "type": "exam_boss", "boss_name": "Math"})
        requests.post(f"{BASE_URL}/api/create", json={"username": "f5_user_m", "type": "exam_boss", "boss_name": "History"})
        url = f"{BASE_URL}/api/data/f5_user_m"
        r = requests.get(url)
        self.assertEqual(len(r.json()), 2)


    # --- F6: Calendar & Task Rescheduling ---
    def test_f6_case1_create_reschedulable_task(self):
        url = f"{BASE_URL}/api/create"
        payload = {"username": "f6_user", "type": "task", "title": "Homework", "timestamp": "2026-06-15T10:00:00", "duration": 30}
        r = requests.post(url, json=payload)
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.json().get("title"), "Homework")

    def test_f6_case2_reschedule_task_time(self):
        r_create = requests.post(f"{BASE_URL}/api/create", json={"username": "f6_user", "type": "task", "title": "Quiz Prep", "timestamp": "2026-06-15T12:00:00"})
        task_id = r_create.json()["__backendId"]
        
        url = f"{BASE_URL}/api/tasks/reschedule"
        payload = {"username": "f6_user", "task_id": task_id, "new_timestamp": "2026-06-16T14:00:00"}
        r = requests.post(url, json=payload)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json().get("task").get("timestamp"), "2026-06-16T14:00:00")

    def test_f6_case3_reschedule_task_duration(self):
        r_create = requests.post(f"{BASE_URL}/api/create", json={"username": "f6_user", "type": "task", "title": "Read Book", "timestamp": "2026-06-15T12:00:00"})
        task_id = r_create.json()["__backendId"]
        
        url = f"{BASE_URL}/api/tasks/reschedule"
        payload = {"username": "f6_user", "task_id": task_id, "new_timestamp": "2026-06-15T12:00:00", "duration": 60}
        r = requests.post(url, json=payload)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json().get("task").get("duration"), 60)

    def test_f6_case4_list_rescheduled_tasks(self):
        requests.post(f"{BASE_URL}/api/create", json={"username": "f6_user_l", "type": "task", "title": "Labs"})
        url = f"{BASE_URL}/api/data/f6_user_l"
        r = requests.get(url)
        self.assertEqual(r.status_code, 200)

    def test_f6_case5_gcal_sync_endpoint(self):
        url = f"{BASE_URL}/api/gcal/sync"
        payload = {"username": "f6_user"}
        r = requests.post(url, json=payload)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json().get("status"), "success")
        self.assertTrue(len(r.json().get("events")) > 0)


    # --- F7: Syllabus Tracker ---
    def test_f7_case1_create_syllabus_item(self):
        url = f"{BASE_URL}/api/create"
        payload = {"username": "f7_user", "type": "syllabus_item", "module_name": "Linear Algebra", "progress": 10, "status": "in_progress"}
        r = requests.post(url, json=payload)
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.json().get("module_name"), "Linear Algebra")

    def test_f7_case2_list_syllabus_items(self):
        requests.post(f"{BASE_URL}/api/create", json={"username": "f7_user_r", "type": "syllabus_item", "module_name": "Calculus II"})
        url = f"{BASE_URL}/api/data/f7_user_r"
        r = requests.get(url)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()[0].get("module_name"), "Calculus II")

    def test_f7_case3_update_syllabus_progress(self):
        r_create = requests.post(f"{BASE_URL}/api/create", json={"username": "f7_user", "type": "syllabus_item", "module_name": "Physics", "progress": 20})
        item_id = r_create.json()["__backendId"]
        
        url = f"{BASE_URL}/api/update/{item_id}"
        payload = {"username": "f7_user", "type": "syllabus_item", "module_name": "Physics", "progress": 50, "status": "in_progress"}
        r = requests.put(url, json=payload)
        self.assertEqual(r.status_code, 200)

    def test_f7_case4_complete_syllabus_module(self):
        r_create = requests.post(f"{BASE_URL}/api/create", json={"username": "f7_user", "type": "syllabus_item", "module_name": "Chemistry", "progress": 50})
        item_id = r_create.json()["__backendId"]
        
        url = f"{BASE_URL}/api/update/{item_id}"
        payload = {"username": "f7_user", "type": "syllabus_item", "module_name": "Chemistry", "progress": 100, "status": "done"}
        r = requests.put(url, json=payload)
        self.assertEqual(r.status_code, 200)

    def test_f7_case5_delete_syllabus_module(self):
        r_create = requests.post(f"{BASE_URL}/api/create", json={"username": "f7_user", "type": "syllabus_item", "module_name": "Biology"})
        item_id = r_create.json()["__backendId"]
        
        url = f"{BASE_URL}/api/delete/{item_id}"
        r = requests.delete(url)
        self.assertEqual(r.status_code, 200)


    # --- F8: Activity Heatmap ---
    def test_f8_case1_create_activity_log(self):
        url = f"{BASE_URL}/api/create"
        payload = {"username": "f8_user", "type": "activity_log", "activity": "coding", "date": "2026-06-14"}
        r = requests.post(url, json=payload)
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.json().get("activity"), "coding")

    def test_f8_case2_list_activity_logs(self):
        requests.post(f"{BASE_URL}/api/create", json={"username": "f8_user_r", "type": "activity_log", "activity": "reading"})
        url = f"{BASE_URL}/api/data/f8_user_r"
        r = requests.get(url)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()[0].get("activity"), "reading")

    def test_f8_case3_create_multiple_activity_dates(self):
        requests.post(f"{BASE_URL}/api/create", json={"username": "f8_user_m", "type": "activity_log", "activity": "run", "date": "2026-06-13"})
        requests.post(f"{BASE_URL}/api/create", json={"username": "f8_user_m", "type": "activity_log", "activity": "swim", "date": "2026-06-14"})
        url = f"{BASE_URL}/api/data/f8_user_m"
        r = requests.get(url)
        self.assertEqual(len(r.json()), 2)

    def test_f8_case4_verify_activity_log_count(self):
        requests.post(f"{BASE_URL}/api/create", json={"username": "f8_user_c", "type": "activity_log", "activity": "writing"})
        url = f"{BASE_URL}/api/data/f8_user_c"
        r = requests.get(url)
        self.assertEqual(len(r.json()), 1)

    def test_f8_case5_update_activity_date_format(self):
        r_create = requests.post(f"{BASE_URL}/api/create", json={"username": "f8_user", "type": "activity_log", "activity": "gym", "date": "2026-06-14"})
        item_id = r_create.json()["__backendId"]
        
        url = f"{BASE_URL}/api/update/{item_id}"
        payload = {"username": "f8_user", "type": "activity_log", "activity": "gym", "date": "2026-06-14T18:00:00Z"}
        r = requests.put(url, json=payload)
        self.assertEqual(r.status_code, 200)


    # --- F9: Notes Journal ---
    def test_f9_case1_create_note(self):
        url = f"{BASE_URL}/api/create"
        payload = {"username": "f9_user", "type": "note", "title": "Calculus Notes", "body": "Integrals are fun"}
        r = requests.post(url, json=payload)
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.json().get("title"), "Calculus Notes")

    def test_f9_case2_list_notes(self):
        requests.post(f"{BASE_URL}/api/create", json={"username": "f9_user_r", "type": "note", "title": "Chem Notes"})
        url = f"{BASE_URL}/api/data/f9_user_r"
        r = requests.get(url)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()[0].get("title"), "Chem Notes")

    def test_f9_case3_update_note_canvas_paths(self):
        r_create = requests.post(f"{BASE_URL}/api/create", json={"username": "f9_user", "type": "note", "title": "Sketch"})
        item_id = r_create.json()["__backendId"]
        
        url = f"{BASE_URL}/api/update/{item_id}"
        payload = {"username": "f9_user", "type": "note", "title": "Sketch", "canvas_paths": [{"x": 1, "y": 2}, {"x": 3, "y": 4}]}
        r = requests.put(url, json=payload)
        self.assertEqual(r.status_code, 200)

    def test_f9_case4_update_note_page_details(self):
        r_create = requests.post(f"{BASE_URL}/api/create", json={"username": "f9_user", "type": "note", "title": "Pages"})
        item_id = r_create.json()["__backendId"]
        
        url = f"{BASE_URL}/api/update/{item_id}"
        payload = {"username": "f9_user", "type": "note", "title": "Pages", "page_number": 2, "total_pages": 5}
        r = requests.put(url, json=payload)
        self.assertEqual(r.status_code, 200)

    def test_f9_case5_delete_note(self):
        r_create = requests.post(f"{BASE_URL}/api/create", json={"username": "f9_user", "type": "note", "title": "Trash Note"})
        item_id = r_create.json()["__backendId"]
        
        url = f"{BASE_URL}/api/delete/{item_id}"
        r = requests.delete(url)
        self.assertEqual(r.status_code, 200)


    # --- F10: Local AI Summary ---
    def test_f10_case1_create_ai_summary(self):
        url = f"{BASE_URL}/api/create"
        payload = {"username": "f10_user", "type": "ai_summary", "summary_text": "Completed math module and logged steps."}
        r = requests.post(url, json=payload)
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.json().get("summary_text"), "Completed math module and logged steps.")

    def test_f10_case2_list_ai_summaries(self):
        requests.post(f"{BASE_URL}/api/create", json={"username": "f10_user_r", "type": "ai_summary", "summary_text": "Study session summary"})
        url = f"{BASE_URL}/api/data/f10_user_r"
        r = requests.get(url)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()[0].get("summary_text"), "Study session summary")

    def test_f10_case3_update_ai_summary(self):
        r_create = requests.post(f"{BASE_URL}/api/create", json={"username": "f10_user", "type": "ai_summary", "summary_text": "Draft"})
        item_id = r_create.json()["__backendId"]
        
        url = f"{BASE_URL}/api/update/{item_id}"
        payload = {"username": "f10_user", "type": "ai_summary", "summary_text": "Final version of summary"}
        r = requests.put(url, json=payload)
        self.assertEqual(r.status_code, 200)

    def test_f10_case4_create_ai_preferences_sliders(self):
        url = f"{BASE_URL}/api/create"
        payload = {"username": "f10_user", "type": "ai_preferences", "creativity_slider": 0.8, "length_slider": 150}
        r = requests.post(url, json=payload)
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.json().get("creativity_slider"), 0.8)

    def test_f10_case5_retrieve_ai_preferences(self):
        requests.post(f"{BASE_URL}/api/create", json={"username": "f10_user_p", "type": "ai_preferences", "creativity_slider": 0.5})
        url = f"{BASE_URL}/api/data/f10_user_p"
        r = requests.get(url)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()[0].get("creativity_slider"), 0.5)


    # --- F11: Jarvis Chatbot & HTTP Polling Verification ---
    def test_f11_case1_create_jarvis_config_low(self):
        url = f"{BASE_URL}/api/jarvis/config"
        payload = {"username": "f11_user", "tier": "low"}
        r = requests.post(url, json=payload)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json().get("config").get("tier"), "low")

    def test_f11_case2_create_jarvis_config_medium(self):
        url = f"{BASE_URL}/api/jarvis/config"
        payload = {"username": "f11_user", "tier": "medium"}
        r = requests.post(url, json=payload)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json().get("config").get("tier"), "medium")

    def test_f11_case3_create_jarvis_config_high(self):
        url = f"{BASE_URL}/api/jarvis/config"
        payload = {"username": "f11_user", "tier": "high"}
        r = requests.post(url, json=payload)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json().get("config").get("tier"), "high")

    def test_f11_case4_retrieve_jarvis_config(self):
        requests.post(f"{BASE_URL}/api/jarvis/config", json={"username": "f11_user_r", "tier": "medium"})
        url = f"{BASE_URL}/api/data/f11_user_r"
        r = requests.get(url)
        self.assertEqual(r.status_code, 200)
        # Verify jarvis config type is present
        config_items = [item for item in r.json() if item.get("type") == "jarvis_config"]
        self.assertEqual(len(config_items), 1)
        self.assertEqual(config_items[0].get("tier"), "medium")

    def test_f11_case5_chat_http_polling_verification(self):
        # Explicitly verify chat HTTP Fetch polling instead of WebSockets
        username = "f11_chat_poll_user"
        # 1. Poll chat history initially
        url_recent = f"{BASE_URL}/api/chat/recent"
        r_init = requests.get(url_recent)
        self.assertEqual(r_init.status_code, 200)
        init_messages_count = len(r_init.json())

        # 2. Send message via POST (simulating HTTP Send)
        url_send = f"{BASE_URL}/api/chat/send"
        payload = {"username": username, "message": "HTTP Polling is active!"}
        r_send = requests.post(url_send, json=payload)
        self.assertEqual(r_send.status_code, 200)

        # 3. Poll chat history again (simulating subsequent HTTP Fetch poll)
        r_poll = requests.get(url_recent)
        self.assertEqual(r_poll.status_code, 200)
        self.assertEqual(len(r_poll.json()), init_messages_count + 1)
        self.assertEqual(r_poll.json()[-1].get("message"), "HTTP Polling is active!")


    # --- F12: Store & Seeds Economy ---
    def test_f12_case1_initialize_seeds_from_activities(self):
        # Register user
        requests.post(f"{BASE_URL}/api/auth/login", json={"username": "f12_user_a", "password_hash": "p"})
        # Complete task and focus session
        requests.post(f"{BASE_URL}/api/create", json={"username": "f12_user_a", "type": "task", "completed": True})
        requests.post(f"{BASE_URL}/api/create", json={"username": "f12_user_a", "type": "focus_session", "minutes": 20})
        # Trigger transaction to calculate initial seeds
        url = f"{BASE_URL}/api/seeds/transaction"
        payload = {"username": "f12_user_a", "cost": 0}
        r = requests.post(url, json=payload)
        self.assertEqual(r.status_code, 200)
        # seeds = (1 * 10) + 20 = 30
        self.assertEqual(r.json().get("currency").get("seeds"), 30)

    def test_f12_case2_buy_streak_freeze(self):
        requests.post(f"{BASE_URL}/api/auth/login", json={"username": "f12_user_b", "password_hash": "p"})
        requests.post(f"{BASE_URL}/api/create", json={"username": "f12_user_b", "type": "task", "completed": True})
        # Initial seeds = 10
        # Buy streak freeze costing 5 seeds
        url = f"{BASE_URL}/api/seeds/transaction"
        payload = {"username": "f12_user_b", "cost": 5, "action": "buy_streak_freeze"}
        r = requests.post(url, json=payload)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json().get("currency").get("seeds"), 5)
        self.assertEqual(r.json().get("currency").get("streak_freezes"), 1)

    def test_f12_case3_buy_theme_neon(self):
        requests.post(f"{BASE_URL}/api/auth/login", json={"username": "f12_user_c", "password_hash": "p"})
        requests.post(f"{BASE_URL}/api/create", json={"username": "f12_user_c", "type": "focus_session", "minutes": 50})
        # Initial seeds = 50
        # Buy theme neon costing 20 seeds
        url = f"{BASE_URL}/api/seeds/transaction"
        payload = {"username": "f12_user_c", "cost": 20, "action": "buy_theme_neon"}
        r = requests.post(url, json=payload)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json().get("currency").get("seeds"), 30)
        self.assertIn("neon", r.json().get("currency").get("inventory"))

    def test_f12_case4_verify_balances(self):
        requests.post(f"{BASE_URL}/api/auth/login", json={"username": "f12_user_d", "password_hash": "p"})
        requests.post(f"{BASE_URL}/api/create", json={"username": "f12_user_d", "type": "focus_session", "minutes": 100})
        # Initial seeds = 100
        requests.post(f"{BASE_URL}/api/seeds/transaction", json={"username": "f12_user_d", "cost": 10, "action": "buy_streak_freeze"})
        url = f"{BASE_URL}/api/data/f12_user_d"
        r = requests.get(url)
        currency_items = [item for item in r.json() if item.get("type") == "currency"]
        self.assertEqual(len(currency_items), 1)
        self.assertEqual(currency_items[0].get("seeds"), 90)

    def test_f12_case5_multiple_transactions_persistence(self):
        requests.post(f"{BASE_URL}/api/auth/login", json={"username": "f12_user_e", "password_hash": "p"})
        requests.post(f"{BASE_URL}/api/create", json={"username": "f12_user_e", "type": "focus_session", "minutes": 80})
        # Initial seeds = 80
        # Trans 1: buy streak freeze cost 15
        requests.post(f"{BASE_URL}/api/seeds/transaction", json={"username": "f12_user_e", "cost": 15, "action": "buy_streak_freeze"})
        # Trans 2: buy theme dark cost 25
        url = f"{BASE_URL}/api/seeds/transaction"
        payload = {"username": "f12_user_e", "cost": 25, "action": "buy_theme_dark"}
        r = requests.post(url, json=payload)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json().get("currency").get("seeds"), 40)
        self.assertEqual(r.json().get("currency").get("streak_freezes"), 1)
        self.assertIn("dark", r.json().get("currency").get("inventory"))


    # --- F13: Biometrics Steps & Gifting ---
    def test_f13_case1_sync_steps_reward(self):
        requests.post(f"{BASE_URL}/api/auth/login", json={"username": "f13_user_a", "password_hash": "p"})
        # Sync 500 steps -> 5 seeds earned
        url = f"{BASE_URL}/api/biometrics/sync"
        payload = {"username": "f13_user_a", "steps": 500}
        r = requests.post(url, json=payload)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json().get("seeds_earned"), 5)
        self.assertEqual(r.json().get("currency").get("seeds"), 5)

    def test_f13_case2_sync_large_steps_reward(self):
        requests.post(f"{BASE_URL}/api/auth/login", json={"username": "f13_user_b", "password_hash": "p"})
        # Sync 12000 steps -> 120 seeds earned
        url = f"{BASE_URL}/api/biometrics/sync"
        payload = {"username": "f13_user_b", "steps": 12000}
        r = requests.post(url, json=payload)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json().get("seeds_earned"), 120)

    def test_f13_case3_gift_seeds_to_friend(self):
        # Register both
        requests.post(f"{BASE_URL}/api/auth/login", json={"username": "f13_sender_c", "password_hash": "p"})
        requests.post(f"{BASE_URL}/api/auth/login", json={"username": "f13_recipient_c", "password_hash": "p"})
        # Sync steps for sender to get 100 seeds
        requests.post(f"{BASE_URL}/api/biometrics/sync", json={"username": "f13_sender_c", "steps": 10000})
        # Gift 40 seeds
        url = f"{BASE_URL}/api/store/gift"
        payload = {"username": "f13_sender_c", "friend_username": "f13_recipient_c", "gift_type": "seeds", "amount": 40}
        r = requests.post(url, json=payload)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json().get("sender_currency").get("seeds"), 60)

    def test_f13_case4_gift_theme_item(self):
        # Register both
        requests.post(f"{BASE_URL}/api/auth/login", json={"username": "f13_sender_d", "password_hash": "p"})
        requests.post(f"{BASE_URL}/api/auth/login", json={"username": "f13_recipient_d", "password_hash": "p"})
        # Give sender 100 seeds
        requests.post(f"{BASE_URL}/api/biometrics/sync", json={"username": "f13_sender_d", "steps": 10000})
        # Buy theme sunset
        requests.post(f"{BASE_URL}/api/seeds/transaction", json={"username": "f13_sender_d", "cost": 30, "action": "buy_theme_sunset"})
        # Gift theme sunset
        url = f"{BASE_URL}/api/store/gift"
        payload = {"username": "f13_sender_d", "friend_username": "f13_recipient_d", "gift_type": "item", "item_id": "sunset"}
        r = requests.post(url, json=payload)
        self.assertEqual(r.status_code, 200)
        self.assertNotIn("sunset", r.json().get("sender_currency").get("inventory"))

    def test_f13_case5_verify_gifting_balances(self):
        # Register both
        requests.post(f"{BASE_URL}/api/auth/login", json={"username": "f13_sender_e", "password_hash": "p"})
        requests.post(f"{BASE_URL}/api/auth/login", json={"username": "f13_recipient_e", "password_hash": "p"})
        # Give sender 50 seeds, recipient 10 seeds
        requests.post(f"{BASE_URL}/api/biometrics/sync", json={"username": "f13_sender_e", "steps": 5000})
        requests.post(f"{BASE_URL}/api/biometrics/sync", json={"username": "f13_recipient_e", "steps": 1000})
        # Gift 20 seeds
        requests.post(f"{BASE_URL}/api/store/gift", json={
            "username": "f13_sender_e", "friend_username": "f13_recipient_e", "gift_type": "seeds", "amount": 20
        })
        # Check recipient's balance
        url = f"{BASE_URL}/api/data/f13_recipient_e"
        r = requests.get(url)
        curr = [item for item in r.json() if item.get("type") == "currency"][0]
        # 10 initial + 20 gifted = 30
        self.assertEqual(curr.get("seeds"), 30)

if __name__ == '__main__':
    unittest.main()
