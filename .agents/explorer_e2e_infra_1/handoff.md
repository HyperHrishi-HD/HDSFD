# Handoff Report - E2E SQLite WAL Mode & Test Subprocess Architecture

This report details the analysis of how the HDSFD V2 Flask backend handles its SQLite database in WAL (Write-Ahead Logging) mode, and proposes a reliable E2E test runner lifecycle to start/stop the Flask subprocess, handle WAL-specific file cleanups, and reset the database state safely under Windows.

---

## 1. Observation

### A. Current Database Connection & Configuration in `backend/app.py`
The Flask backend defines its database connection in `backend/app.py` (lines 12-17):
```python
DB_PATH = os.path.join(os.path.dirname(__file__), 'database.db')

def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn
```
*   **Observation**: There is no programmatic setting for WAL mode (`PRAGMA journal_mode=WAL;`) inside `app.py`.
*   **Observation**: The SQLite database file path (`DB_PATH`) is hardcoded to `backend/database.db`.
*   **Observation**: A check of the active journal mode on `backend/database.db` using a python shell query:
    `python -c "import sqlite3; conn = sqlite3.connect('backend/database.db'); print(conn.execute('PRAGMA journal_mode;').fetchone())"`
    returned:
    `('delete',)`
    which indicates the database is currently running in the default rollback journal mode, not WAL mode.

### B. User Registration and Stateless Authentication
*   **Observation**: In `backend/app.py`, the login route automatically registers new users if they do not exist (lines 62-82):
    ```python
    @app.route('/api/auth/login', methods=['POST'])
    def login():
        # ...
        if user:
            # ...
        else:
            conn.execute('INSERT INTO users (username, password_hash) VALUES (?, ?)', (username, password_hash))
            conn.commit()
            conn.close()
            return jsonify({"status": "success", "username": username, "new_user": True})
    ```
*   **Observation**: The backend does not maintain sessions or cookies; it is stateless. User data endpoints filter strictly by the `username` parameter provided in request bodies or query parameters (e.g. `/api/data/<string:username>`).
*   **Observation**: The statistics endpoint `/api/stats/<username>` returns a 404 error if the user is not present in the `users` table:
    ```python
    user = conn.execute('SELECT username FROM users WHERE username = ?', (username,)).fetchone()
    if not user:
        conn.close()
        return jsonify({"status": "error", "message": "User not found"}), 404
    ```
*   **Observation**: In the frontend (`src/main.js` lines 202-205), session persistence is handled via `localStorage`:
    ```javascript
    const savedSession = localStorage.getItem('hd_sfd_session');
    if(savedSession) {
      executeLogin(savedSession);
    }
    ```

### C. WAL Mode Disk Behavior
A test script running in the project directory:
`python -c "import sqlite3, os; db = 'backend/test_wal_verify.db'; conn = sqlite3.connect(db); conn.execute('PRAGMA journal_mode=WAL;'); conn.execute('CREATE TABLE IF NOT EXISTS test (id INTEGER);'); conn.execute('INSERT INTO test VALUES (1);'); conn.commit(); print('Files before close:', [f for f in os.listdir('backend') if 'test_wal_verify' in f])"`
returned:
`Files before close: ['test_wal_verify.db', 'test_wal_verify.db-shm', 'test_wal_verify.db-wal']`
*   **Observation**: Toggling WAL mode on SQLite results in the creation of two temporary companion files: `.db-wal` (write-ahead log) and `.db-shm` (shared memory file).
*   **Observation**: When the python process exits cleanly, the `.db-shm` and `.db-wal` files are automatically deleted because SQLite checkpoints and closes connections cleanly. If a process is terminated abruptly (e.g. via `taskkill /F`), these files persist on disk.

---

## 2. Logic Chain

1.  **Enabling WAL Mode Programmatically**:
    *   Since E2E testing requires deleting the database file to ensure a clean state, any new database file created will revert to SQLite's default `delete` mode unless WAL mode is set during database initialization.
    *   Therefore, `backend/app.py` must execute `PRAGMA journal_mode=WAL;` and `PRAGMA synchronous=NORMAL;` inside `get_db_connection()`.
2.  **Database Path Parametrization**:
    *   Currently, the database path is hardcoded. If E2E tests run on `database.db`, local development data will be overwritten and destroyed.
    *   Therefore, `DB_PATH` should be parameterized using an environment variable (e.g. `HDSFD_DB_PATH`) so the test runner can point to a separate database file (e.g. `test_database.db`).
3.  **Process Termination on Windows**:
    *   Since the host operating system is Windows, calling simple `kill()` on a parent process wrapper may leave orphaned child processes. These orphaned python processes will hold active open handles to the database files, causing a `PermissionError` during deletion attempts.
    *   Therefore, a process tree termination mechanism (`taskkill /F /T /PID <pid>` or the Node `tree-kill` package) must be used by the test runner to ensure the Flask app and all its sub-processes are terminated.
4.  **Complete Deletion of WAL Companion Files**:
    *   Because the Flask subprocess might be killed abruptly between tests, the companion files (`test_database.db-wal` and `test_database.db-shm`) may remain. Deleting only `test_database.db` could leave SQLite attempting to recover transactions from mismatched WAL blocks on the next launch.
    *   Therefore, the cleanup script must delete all three files: `test_database.db`, `test_database.db-wal`, and `test_database.db-shm`.
    *   On Windows, file handle releases by the OS can be asynchronous. Hence, file deletions must be performed within a retry loop with short delays.
5.  **Pristine & Authenticated Test State**:
    *   To make tests fast and reproducible, we must start with an empty database schema and register the test user.
    *   Since Flask automatically registers users on login, the test runner can seed the user by sending a POST request to `/api/auth/login` right after Flask starts. This populates the `users` table, preventing 404 errors on endpoints like `/api/stats`.
    *   To bypass the login UI, the E2E test runner can inject the test username into the browser's `localStorage` key `hd_sfd_session` before loading the app. The frontend will automatically load the dashboard for that user.

---

## 3. Caveats

*   **Port Collision**: The Flask app defaults to port 5000. If another process occupies port 5000, the Flask subprocess will fail to start. The runner should allow configuring the port (e.g. `FLASK_RUN_PORT`).
*   **Parallel Execution**: If multiple tests run in parallel, they must use distinct database paths (e.g., `test_database_worker_1.db`) via the `HDSFD_DB_PATH` environment variable to prevent write collisions and locking exceptions.
*   **Asynchronous File Locks**: On slower Windows virtual machines, file handle locks can persist for up to a second after process termination. The retry delay configuration for file unlinking must be sufficiently high (e.g., 5 retries, 100ms delay).

---

## 4. Conclusion

We recommend the following steps:
1.  Apply the patch `proposed_changes.patch` to `backend/app.py` to enable WAL mode programmatically and support the `HDSFD_DB_PATH` environment variable.
2.  Implement the E2E test runner lifecycle using the scripts provided below.

### Proposed Code Snippets & Scripts

#### A. Backend Changes (`backend/app.py`)
Replace lines 12-17 with:
```python
DB_PATH = os.environ.get('HDSFD_DB_PATH', os.path.join(os.path.dirname(__file__), 'database.db'))

def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    conn.row_factory = sqlite3.Row
    return conn
```

#### B. Node.js (Playwright / Jest) Test Runner Implementation
```javascript
import { spawn, exec } from 'child_process';
import path from 'path';
import fs from 'fs';
import waitOn from 'wait-on';

let flaskProcess = null;
const DB_BASE_PATH = path.resolve('backend/test_database.db');
const FLASK_PORT = 5000;

// Helper to delete files with retry to handle Windows file locks
async function deleteFileWithRetry(filePath, retries = 5, delay = 100) {
  for (let i = 0; i < retries; i++) {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      return;
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

// 1. Clean up SQLite WAL & Main DB Files
export async function cleanupDbFiles() {
  const files = [
    DB_BASE_PATH,
    `${DB_BASE_PATH}-wal`,
    `${DB_BASE_PATH}-shm`
  ];
  for (const file of files) {
    await deleteFileWithRetry(file);
  }
}

// 2. Start Flask Subprocess & Wait for Port
export async function startFlaskSubprocess() {
  await cleanupDbFiles();

  flaskProcess = spawn('python', ['backend/app.py'], {
    env: {
      ...process.env,
      HDSFD_DB_PATH: DB_BASE_PATH,
      FLASK_ENV: 'development'
    },
    stdio: 'pipe'
  });

  // Optional: Pipe stdout/stderr for logging
  flaskProcess.stdout.on('data', (d) => console.log(`[Flask] ${d}`));
  flaskProcess.stderr.on('data', (d) => console.error(`[Flask Err] ${d}`));

  // Wait for Flask to bind to port
  await waitOn({
    resources: [`http://127.0.0.1:${FLASK_PORT}/`],
    timeout: 10000
  });

  // Seed the default test user via Auth API
  await seedTestUser();
}

// 3. Stop Flask Subprocess (Windows Process Tree Termination)
export function stopFlaskSubprocess() {
  return new Promise((resolve) => {
    if (flaskProcess && flaskProcess.pid) {
      // taskkill /F /T kills the parent and all child processes spawned by it
      exec(`taskkill /F /T /PID ${flaskProcess.pid}`, () => {
        flaskProcess = null;
        resolve();
      });
    } else {
      resolve();
    }
  });
}

// 4. Seed test user via application login API
async function seedTestUser() {
  const hashPassword = async (password) => {
    // Computes SHA-256 to match the frontend crypto.subtle implementation
    const crypto = await import('crypto');
    return crypto.createHash('sha256').update(password).digest('hex');
  };

  const passwordHash = await hashPassword('test_password');
  const response = await fetch(`http://127.0.0.1:${FLASK_PORT}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'test_user',
      password_hash: passwordHash
    })
  });
  
  if (!response.ok) {
    throw new Error('Failed to seed default test user');
  }
}

// 5. Browser Context Injection (Bypass UI login page)
export async function injectAuthSession(browserContext) {
  await browserContext.addInitScript((user) => {
    window.localStorage.setItem('hd_sfd_session', user);
  }, 'test_user');
}
```

---

## 5. Verification Method

To verify the cleanup and reset flow:
1.  **Code patch check**: Ensure `proposed_changes.patch` is applied.
2.  **WAL Mode Verification**: Start Flask, query the database journal mode:
    `python -c "import sqlite3; conn = sqlite3.connect('backend/test_database.db'); print(conn.execute('PRAGMA journal_mode;').fetchone())"`
    It must return `('wal',)` indicating WAL mode is enabled successfully.
3.  **Process Kill Verification**: Spawn the subprocess, then execute the `stopFlaskSubprocess` function (or taskkill command). Verify that no process is listening on port 5000 and that the python process has exited.
4.  **File Cleanup Verification**: After terminating the subprocess, confirm that `test_database.db`, `test_database.db-wal`, and `test_database.db-shm` are deleted from the disk without throwing any `PermissionError`.
