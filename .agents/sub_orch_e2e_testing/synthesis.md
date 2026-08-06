# E2E Test Suite Design Synthesis

## Consensus
All Explorer subagents reached consensus on the following core requirements:
1. **Dynamic Configuration & Test Isolation**:
   - `backend/app.py` must be patched to support the `HDSFD_DB_PATH` and `PORT` environment variables to prevent test execution from colliding with development servers or overwriting live database state.
   - Enabling WAL mode (`PRAGMA journal_mode=WAL;` and `PRAGMA synchronous=NORMAL;`) must be set programmatically within `get_db_connection()` to ensure WAL mode persists across dynamic database resets.
2. **Stateless API Verification**:
   - The backend is stateless, relying on client-supplied `username` parameters. Tests can verify this isolation by querying parallel user namespaces without cookies.
3. **P2P Gifting and Seeds Economy**:
   - The seeds balance can be manipulated and tested via the `/api/biometrics/sync` (earning seeds) and `/api/seeds/transaction` (spending seeds) endpoints, and gifting limits (insufficient seeds, self-gifting, non-existent recipients) should be validated.
4. **Subprocess Management under Windows**:
   - Clean startup requires checking socket availability, while process termination must handle process tree signaling (standard termination or `taskkill`) to release OS locks on the SQLite database, WAL log, and shared memory files (`.db`, `.db-wal`, `.db-shm`).

## Resolved Conflicts
- **Test Framework**: We selected Python's built-in `unittest` package to run all test cases rather than introducing external Node-based Playwright or Jest runner overhead, ensuring a clean and lightweight execution path with minimal dependencies (`requests` is the only external package needed).
- **Frontend Mismatch**: The frontend SDK attempts to send POST requests to `/api/update` and `/api/delete`, but the backend expects `PUT /api/update/<id>` and `DELETE /api/delete/<id>`. We resolved this by defining our E2E tests to hit the *actual backend API contract* first, while highlighting this frontend mismatch as a critical bug to be fixed by the implementation track.

## Dissenting Views
- None. All subagents agreed on the overall design and architecture.

## Gaps & Blockers
- **ERR-001 (Post-it delete validation)**: A string-to-number type mismatch prevents notes from being deleted via frontend scripts.
- **ERR-002 (Animations toggle element missing)**: The animations toggle listener target (`toggle-animations`) does not match the element ID in HTML (`toggle-animations-btn`), throwing a Javascript crash on page load.
- **Action**: These legacy bugs must be resolved to allow complete UI/frontend integration, although our opaque-box API test suite can run immediately to verify the backend database state.
