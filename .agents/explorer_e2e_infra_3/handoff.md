# E2E Test Suite and Runner Infrastructure Design

## Summary
A complete E2E testing framework has been designed and sandbox-verified for the HDSFD V2 application. It features a custom test runner that isolates execution via dynamic port allocation, environment overrides, subprocess execution, log capturing, and standard Python `unittest` categorization (Tier 1 Core and Tier 2 Advanced).

---

## 1. Observation
1. **Hardcoded Database Path**: In `backend/app.py`, the SQLite database path is hardcoded:
   - Line 12: `DB_PATH = os.path.join(os.path.dirname(__file__), 'database.db')`
2. **Hardcoded Flask Port**: In `backend/app.py`, the port is hardcoded to 5000:
   - Lines 516-519:
     ```python
     if __name__ == '__main__':
         init_db()
         app.run(debug=True, port=5000)
     ```
3. **Missing `requests` Dependency**: The current `requirements.txt` file only contains Flask packages:
   - Lines 1-2:
     ```
     Flask==3.0.2
     Flask-Cors==4.0.0
     ```
     The HTTP testing client `requests` is required but not currently listed.
4. **No Existing Tests Directory**: The root directory lacks a `tests/` folder.
5. **API Endpoints Signature**: `backend/app.py` exposes key REST endpoints for auth, CRUD operations, chat, stats computation, biometrics, seeds economy, gifting, settings backups, and Google Calendar integration.

---

## 2. Logic Chain
1. **Dynamic Port Allocation & Test Isolation**:
   - Because the backend port is hardcoded to `5000` (Observation 2), running tests would collide with a running development server.
   - Because the database path is hardcoded to `database.db` (Observation 1), tests would modify and pollute the active development database.
   - *Therefore*, the backend must be patched to accept environment variable overrides for both `PORT` and `HDSFD_DB_PATH`.
   - Dynamic port allocation is solved by binding a socket to port `0`, retrieving the assigned ephemeral port, closing the socket, and passing this port to the backend subprocess via the `PORT` env var.
2. **Test Framework Selection**:
   - Since Python has a built-in `unittest` package, using it avoids unnecessary extra framework dependencies.
   - Since tests need to make actual HTTP calls to the backend, the `requests` library is selected as the primary client library and must be added to requirements (Observation 3).
3. **Runner Process Orchestration**:
   - The test runner must programmatically manage the lifecycle of the Flask server.
   - It will start the server as a background subprocess, capture its stdout/stderr to a dedicated log file (`tests/backend_test.log`), wait for it to become responsive, run the test suites, terminate the server, and clean up test databases.
4. **Log & Response Verification**:
   - Response validation (response codes, JSON structures) is handled inside individual test cases using assertions (e.g., `self.assertEqual(res.status_code, 201)`).
   - Backend warning/exception logging is verified by directing all subprocess outputs to `tests/backend_test.log` and checking for patterns in the logs if needed.
5. **Categorization**:
   - Tests are divided into `test_tier1.py` (critical paths: registration, login, data CRUD, task rescheduling) and `test_tier2.py` (advanced workflows: chat, stats calculation, seeds economy, biometrics sync, P2P gifting, settings backup, and Google Calendar oauth sandbox).

---

## 3. Caveats
- **Socket Release Race Condition**: Finding a free port via `socket.bind(('', 0))` and closing it before starting the subprocess has a tiny window where another process could grab the port. In practice, this is rare and sufficient for local development/CI.
- **Mock Dependencies**: Google Calendar sync `/api/gcal/sync` returns mock events; the tests validate the sandbox response structure, not actual integration with Google servers.

---

## 4. Conclusion
We propose creating the following folder structure and files under the project root:

### Proposed Folder Layout
```
HDSFD/
├── backend/
│   └── app.py (patched)
├── requirements.txt (updated to include requests)
└── tests/
    ├── run_tests.py          # Port allocator, subprocess orchestrator, and test runner
    ├── test_tier1.py         # Core integrity tests (Auth, CRUD, Rescheduling)
    └── test_tier2.py         # Advanced integration tests (Chat, Stats, Economy, Backups, GCal)
```

### Proposed Patch for `backend/app.py`
*(Saved as `app_db_port_override.patch`)*
```diff
diff --git a/backend/app.py b/backend/app.py
--- a/backend/app.py
+++ b/backend/app.py
@@ -12,3 +12,3 @@
-DB_PATH = os.path.join(os.path.dirname(__file__), 'database.db')
+DB_PATH = os.environ.get('HDSFD_DB_PATH', os.path.join(os.path.dirname(__file__), 'database.db'))
 
 def get_db_connection():
@@ -516,3 +516,4 @@
 if __name__ == '__main__':
     init_db()
-    app.run(debug=True, port=5000)
+    port = int(os.environ.get('PORT', 5000))
+    app.run(debug=True, port=port)
```

### Proposed Test Runner and Test Suites
The complete, syntactically verified code files have been written to the agent's folder:
- `proposed_run_tests.py`
- `proposed_test_tier1.py`
- `proposed_test_tier2.py`

---

## 5. Verification Method

### How to Verify Locally
1. Run `pip install requests` to install the HTTP client dependency.
2. Apply the patch to `backend/app.py` from the root directory:
   ```bash
   git apply .agents/explorer_e2e_infra_3/app_db_port_override.patch
   ```
3. Copy the proposed test files into a new `tests/` directory:
   ```bash
   mkdir tests
   cp .agents/explorer_e2e_infra_3/proposed_run_tests.py tests/run_tests.py
   cp .agents/explorer_e2e_infra_3/proposed_test_tier1.py tests/test_tier1.py
   cp .agents/explorer_e2e_infra_3/proposed_test_tier2.py tests/test_tier2.py
   ```
4. Execute the test runner:
   ```bash
   python tests/run_tests.py
   ```
5. Expect the runner to output:
   - Dynamic port selected.
   - Flask server started.
   - All 9 test cases in `test_tier1` and `test_tier2` executed and passed (`OK`).
   - Clean shutdown of Flask server and deletion of the temporary database.
