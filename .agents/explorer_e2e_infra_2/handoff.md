# E2E Infrastructure Test Design Handoff Report — Explorer 2

## 1. Observation
We audited the application repository at `C:\Users\venky\OneDrive\Documents\CODING PROJECTS\HDSFD` and observed the following:

- **Database Stacking and WAL Mode**:
  - The SQLite connection in `backend/app.py` does not configure WAL mode.
    ```python
    14: def get_db_connection():
    15:     conn = sqlite3.connect(DB_PATH)
    16:     conn.row_factory = sqlite3.Row
    17:     return conn
    ```
- **Generic Document Store**:
  - The database uses a generic schema-less `data` table (defined in `backend/app.py` lines 29-37) to store content as serialized JSON:
    ```python
    29:         CREATE TABLE IF NOT EXISTS data (
    30:             id INTEGER PRIMARY KEY AUTOINCREMENT,
    31:             username TEXT NOT NULL,
    32:             type TEXT NOT NULL,
    33:             content TEXT NOT NULL,
    34:             created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    35:             FOREIGN KEY (username) REFERENCES users (username)
    36:         )
    ```
- **CRUD Endpoint Mismatches**:
  - In `src/main.js` (lines 53-73), the frontend SDK issues POST requests to `/api/update` and `/api/delete` with parameters in the body:
    ```javascript
    53:   update: async (data) => {
    54:     await fetch(`${API_URL}/update`, {
    55:       method: 'POST',
    56:       headers: { 'Content-Type': 'application/json' },
    57:       body: JSON.stringify({ ...data, username: activeUser })
    58:     });
    ...
    64:   delete: async (data) => {
    65:     await fetch(`${API_URL}/delete`, {
    66:       method: 'POST',
    67:       headers: { 'Content-Type': 'application/json' },
    68:       body: JSON.stringify({ id: data.id, username: activeUser })
    69:     });
    ```
  - However, in `backend/app.py` (lines 121-137), the backend defines these routes as:
    ```python
    121: @app.route('/api/update/<int:item_id>', methods=['PUT'])
    122: def update_item(item_id):
    ...
    131: @app.route('/api/delete/<int:item_id>', methods=['DELETE'])
    132: def delete_item(item_id):
    ```
    This represents a clear mismatch where the frontend POST actions will fail (returning 404).

- **Zen Mode Escape Hold**:
  - Exiting Zen Mode requires holding `Escape` for 3 seconds. The duration is tracked via `requestAnimationFrame` and `Date.now()` on lines 803-815 of `src/main.js`.
  - Releasing `Escape` cancels the exit animation and resets the progress (lines 867-876 of `src/main.js`).

- **Chat Ephemeral Message Purging**:
  - Recent chat messages are retrieved via `GET /api/chat/recent` and sent via `POST /api/chat/send`.
  - Old chat messages (>24 hours) are purged automatically on query/write (lines 141-143 of `backend/app.py`):
    ```python
    141: def purge_old_chat(conn):
    142:     conn.execute("DELETE FROM ephemeral_chat WHERE created_at < datetime('now', '-24 hours')")
    143:     conn.commit()
    ```

- **P2P Gifting Storefront**:
  - The endpoint `POST /api/store/gift` handles P2P currency or item transfer (lines 415-480 of `backend/app.py`). It enforces bounds checks:
    - Verifies friend existence (line 432).
    - Checks insufficient seeds (line 444).
    - Checks item ownership (line 448).
    - Disallows self-gifting (line 428).

- **Critical Code Crashers (Legacy Bugs)**:
  - **ERR-001 (Post-it delete validation)**: In `src/main.js` line 725, `deleteNote(id)` searches for the note to delete using:
    ```javascript
    726:   const note = allData.find(d => d.__backendId === id);
    ```
    However, the `onclick` handler in line 682 passes a string: `onclick="deleteNote('${note.__backendId}')"`. Since `d.__backendId` is a number, the strict equality operator (`===`) evaluates to `false`, causing the deletion to fail silently.
  - **ERR-002 (Animations toggle element missing)**: In `src/main.js` lines 221-223, the frontend queries for `toggle-animations` and registers a listener:
    ```javascript
    221: const animToggle = document.getElementById('toggle-animations');
    222: const animKnob = document.getElementById('anim-knob');
    223: animToggle.addEventListener('click', toggleAnimations);
    ```
    But `index.html` has no element with `id="toggle-animations"` (only `id="toggle-animations-btn"` in line 648). This throws a `TypeError` on load and prevents the JavaScript application from initializing.

---

## 2. Logic Chain
Based on these observations, we conclude:

1. **Verification of WAL Mode**: Since HDSFD V2's database is SQLite, E2E tests can directly verify WAL mode using raw SQLite query `PRAGMA journal_mode;` on the target database, expecting the result `wal`. The current implementation lacks this setting, meaning E2E initialization scripts must explicitly run `PRAGMA journal_mode=WAL;` to conform to R1.
2. **Stateless API Verification**: To confirm the stateless contract of R1, the E2E test runner should issue request sequences (e.g. `GET /api/data/alice` followed by `GET /api/data/bob`) without sending cookies/headers, confirming that each request is authenticated solely by parameters/routes.
3. **Simulating Pomodoro & Seed Progression**: Completed focus minutes increase the user's seed count. Because the backend `seeds_transaction` endpoint (line 281) deducts `cost` from the user's seeds, a focus session of 25 minutes requires sending a *negative* cost of `-25` to `POST /api/seeds/transaction`. Tests should verify both records by querying `data` table (focus session item creation and seed increment).
4. **Validating Zen Mode Hold**: Browser automation must emulate a continuous 3-second `Escape` key press. Test paths must verify that:
   - Holding `Escape` for >=3000ms removes the `.zen-mode-active` class from `#app`.
   - Releasing the key at <3000ms leaves Zen Mode active and hides the `#zen-escape-overlay`.
5. **Generic Path Saving (R4)**: Since the skeumorphic vector drawing canvas is schema-less, paths must be persisted via `POST /api/create` (using a custom document type like `vector_drawing` or `canvas_paths`). E2E testing will verify that arbitrary JSON strings containing coordinate coordinates are saved to the `content` field of the `data` table.
6. **Chat Purging & P2P Limits**: The ephemeral chat purge must be tested by seeding an outdated chat record (`created_at` > 24 hours ago) and calling `GET /api/chat/recent`, checking that the count of expired records is `0` in both DB and API response. P2P gifting requires verifying that self-gifting or sending with insufficient funds fails with status code 400.
7. **Resolving CRUD and Initialization Bugs**:
   - The test suite must check if `DELETE /api/delete/<id>` is called correctly (as defined in backend) or if the frontend's mismatch causes failures.
   - E2E testing must verify that fixing `ERR-001` (by casting `id` to a number or using loose comparison `==`) resolves note deletion.
   - E2E testing must verify that fixing `ERR-002` (by matching the element ID or adding a null check) allows the dashboard scripts to load without throwing errors.

---

## 3. Caveats
- **Planned Features**: Requirements for R4 (3D book canvas, vector drawings, AI summary) and parts of R3 are marked as "PLANNED" in the project milestones. Our test mapping assumes the frontend will store these drawing paths using the generic `dataSdk.create` interface with JSON-serialized coordinates. If the developers decide to build custom tables or distinct endpoints for vector data in a future milestone, the test design must be adjusted.
- **Dropbox Token Sandbox**: The backup endpoint simulates upload by performing a local copy to `backend/backups/` when the Dropbox token is empty or invalid. The test design relies on verifying the sandbox behavior.

---

## 4. Conclusion
We have created a comprehensive mapping of requirements R1-R6 to exact opaque-box testing paths. The test architecture requires a Python-based E2E runner that utilizes HTTP clients (like `requests`) for API tests, browser automation (like `Playwright` or `Selenium`) for UI simulations, and SQLite connection checks for direct database verification. 
Two critical bugs (type mismatch in note deletion and missing element ID in animations toggle) were identified as blockers to E2E verification and must be resolved before test execution.

---

## 5. Verification Method

### 1. Verification of SQLite WAL Mode
Run the following Python script to check if the database is running in WAL mode:
```python
import sqlite3
import os

db_path = os.path.abspath("backend/database.db")
conn = sqlite3.connect(db_path)
cursor = conn.cursor()
cursor.execute("PRAGMA journal_mode;")
mode = cursor.fetchone()[0]
conn.close()

assert mode == "wal", f"Expected 'wal', but got '{mode}'"
```

### 2. Verification of API Endpoints & Persisted States
To execute modular testing against the endpoints:
- Start the Flask backend:
  `python backend/app.py` (ensure port 5000 is open)
- Execute tests mapping to each requirement (see endpoint parameters and payload mappings below).
- Verify database state directly after requests using:
  `sqlite3 backend/database.db "SELECT * FROM data;"`
  `sqlite3 backend/database.db "SELECT * FROM ephemeral_chat;"`

---

## Appendix: API to DB Mapping Table

| Requirement | API Endpoint | Simulation Payload / Method | DB Table & Fields to Inspect | Expected DB State |
| :--- | :--- | :--- | :--- | :--- |
| **R1 (WAL/Auth)** | `POST /api/auth/login` | `{ "username": "user", "password_hash": "hash" }` | `users` (`username`, `password_hash`) | Row created with username and password hash. |
| **R1 (Backup)** | `POST /api/settings/backup` | `{ "username": "user", "dropbox_token": "" }` | Local file check in `backend/backups/` | File `backup_user_<timestamp>.db` exists. |
| **R2 (Pomodoro)** | `POST /api/create` | `{ "username": "user", "type": "focus_session", "minutes": 25 }` | `data` (`username`, `type`, `content`) | Row with type = `focus_session`, minutes = 25 in content. |
| **R2 (Seeds)** | `POST /api/seeds/transaction` | `{ "username": "user", "cost": -25, "action": "focus_session" }` | `data` (`username`, `type`, `content`) | Row with type = `currency`, seeds increased by 25. |
| **R2 (Exam Boss)** | `POST /api/create` | `{ "username": "user", "type": "exam_boss", "exam_name": "Calculus", "exam_date": "YYYY-MM-DD" }` | `data` (`username`, `type`, `content`) | Row with type = `exam_boss` and subject/date matches. |
| **R2 (Chat)** | `POST /api/chat/send` | `{ "username": "user", "message": "hello" }` | `ephemeral_chat` (`username`, `message`) | Row created. Older than 24h messages deleted. |
| **R2 (Peer Stats)** | `GET /api/stats/<username>` | GET request | Computed from `data` rows of user | Returns correct stamina, knowledge, agility. |
| **R3 (Reschedule)**| `POST /api/tasks/reschedule`| `{ "task_id": ID, "new_timestamp": "ISOString", "duration": 45, "username": "user" }` | `data` (`content` for task_id) | Task `content` updated with timestamp and duration. |
| **R4 (Canvas)** | `POST /api/create` | `{ "username": "user", "type": "canvas_paths", "paths": [...] }` | `data` (`username`, `type`, `content`) | Row with type = `canvas_paths` contains vector coordinates. |
| **R5 (Biometrics)**| `POST /api/biometrics/sync` | `{ "username": "user", "steps": 5000 }` | `data` (`content` for type = `currency`) | Seeds increased by 50 (steps // 100). |
| **R5 (Gifting)** | `POST /api/store/gift` | `{ "username": "alice", "friend_username": "bob", "gift_type": "seeds", "amount": 50 }` | `data` (`content` for currency) | Alice's seeds -50, Bob's seeds +50. |
| **R6 (Delete note)**| `DELETE /api/delete/<id>` | DELETE request | `data` (where `id = ID`) | Row deleted. |
