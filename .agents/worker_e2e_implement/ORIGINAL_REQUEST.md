## 2026-06-14T21:41:37Z
You are the E2E Integration Worker.
Your working directory is C:\Users\venky\OneDrive\Documents\CODING PROJECTS\HDSFD\.agents\worker_e2e_implement\.
Your task is to implement the entire E2E Testing Track for HDSFD V2 by creating a 4-tier test suite and a custom test runner.

Perform the following steps:
1. **Patch backend/app.py**:
   - Parameterize the database path: `DB_PATH = os.environ.get('HDSFD_DB_PATH', os.path.join(os.path.dirname(__file__), 'database.db'))`
   - Programmatically configure SQLite WAL mode and synchronous level:
     ```python
     def get_db_connection():
         conn = sqlite3.connect(DB_PATH)
         conn.execute("PRAGMA journal_mode=WAL;")
         conn.execute("PRAGMA synchronous=NORMAL;")
         conn.row_factory = sqlite3.Row
         return conn
     ```
   - Parameterize the web server port inside the main entrypoint:
     ```python
     if __name__ == '__main__':
         init_db()
         port = int(os.environ.get('PORT', 5000))
         app.run(debug=True, port=port)
     ```
2. **Update requirements.txt**:
   - Ensure `requests` is added as a dependency (e.g. append `requests` to requirements.txt if missing).
3. **Implement tests/run_tests.py**:
   - Must locate a free port dynamically using `socket`.
   - Must spawn `backend/app.py` as a subprocess with `HDSFD_DB_PATH` and `PORT` environment variables configured to sandbox files (`tests/test_database.db`).
   - Must capture all server output (stdout/stderr) into `tests/backend_test.log`.
   - Must wait for the backend to become responsive on the chosen port before executing tests.
   - Must run the unit test suites under the `tests/` directory (discover pattern `test_*.py`).
   - Must cleanly terminate the backend subprocess after tests finish (using robust terminate/kill calls).
   - Must clean up the temporary database files (including `.db-wal` and `.db-shm` companion files) using a retry loop with short delays to handle Windows asynchronous file locking.
4. **Implement tests/test_tier1.py (Feature Coverage)**:
   - Implement exactly 65 distinct happy-path test cases (5 cases for each of the 13 features: F1-F13) using `unittest`.
   - Features:
     - F1: User Authentication (login, register, status checks)
     - F2: Data Store CRUD (creation, retrieval, updates, deletion of items)
     - F3: Focus Sanctuary (focus session data creation, retrieval, updates)
     - F4: Zen Mode (saving/reading custom preferences, toggles, layout options)
     - F5: Exam Boss Battle (creating boss count-downs, targets, difficulty, visual states)
     - F6: Calendar & Task Rescheduling (creation, list views, and rescheduled time slot updates via `/api/tasks/reschedule`)
     - F7: Syllabus Tracker (syllabus creation, item listing, module updates, progress states)
     - F8: Activity Heatmap (activity log creation, listing, count verification, date formatting)
     - F9: Notes Journal (notes list, canvas path drawings, page updates, note deletion)
     - F10: Local AI Summary (AI summary logs, updates, preferences, sliders)
     - F11: Jarvis Chatbot (Jarvis chatbot config settings, tier parameters, updates)
     - F12: Store & Seeds Economy (currency checks, transactions, streak freeze and theme purchases)
     - F13: Biometrics Steps & Gifting (steps sync rewarding seeds, P2P gifting of seeds or themes)
5. **Implement tests/test_tier2.py (Boundaries & Corners)**:
   - Implement exactly 65 distinct edge/boundary/error test cases (5 cases for each of the 13 features: F1-F13).
   - Test boundaries: empty inputs, out-of-bound ranges (e.g. negative cost, negative focus minutes, syllabus >100% or <0%), invalid formats (date strings, user IDs), non-existent entity lookups (e.g. task IDs, user IDs), and legacy regressions (e.g. note deletion type mismatches).
6. **Implement tests/test_tier3.py (Cross-Feature Pairwise)**:
   - Implement exactly 13 pairwise interaction test cases (e.g. focus sessions updating stamina, tasks updating knowledge/agility, biometrics rewarding seeds which are then gifted or spent on themes, note canvas drawings linked to active pages, database backup snapshot validations).
7. **Implement tests/test_tier4.py (Real-World Workloads)**:
   - Implement exactly 7 real-world student workload scenario test cases (e.g., student semester kickoff, high-productivity study blocks, exam preparation boss battles, collaborative study with peer gifting, creative journaling summaries, chatbot interactive commands with rescheduling, and backup disaster recovery).
8. **Run the test runner and verify everything passes cleanly**.
