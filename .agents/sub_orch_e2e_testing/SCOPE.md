# Scope: E2E Testing Track for HDSFD V2

## Architecture
- Opaque-box E2E testing framework.
- Independent of direct implementation details, validating requirements R1-R6 via HTTP API, database inspections, and client-state simulation.
- Test layout: `tests/` directory at project root.
- Test runner: Python-based runner executing modular test suites (using `unittest` or a custom test framework).

## Milestones
| # | Name | Scope | Dependencies | Status | Conversation ID |
|---|------|-------|-------------|--------|-----------------|
| M1 | Test Infrastructure & Runner | Setup test harness, db reset utility, backend service life-cycle management | None | DONE | 4a7b802b, 8a9a57ab, ab235c36 |
| M2 | Tier 1 Feature Coverage Tests | Happy-path verification (>=5 cases/feature, >=65 cases total) | M1 | IN_PROGRESS | 867c47f0 |
| M3 | Tier 2 Boundary & Corner Cases | Boundary/error conditions (>=5 cases/feature, >=65 cases total) | M2 | IN_PROGRESS | 867c47f0 |
| M4 | Tier 3 Cross-Feature Pairwise | Interacting features scenarios (>=13 cases total) | M3 | IN_PROGRESS | 867c47f0 |
| M5 | Tier 4 Real-World Application | End-to-end user workflows (>=7 scenarios total) | M4 | IN_PROGRESS | 867c47f0 |
| M6 | Documentation & Sign-off | Compile TEST_INFRA.md and publish TEST_READY.md | M5 | PLANNED | TBD |

## Interface Contracts
- Tests must execute against `http://localhost:5000` (or dynamically allocated port).
- Tests must reset the database to a clean baseline state before/after test cases.
- API endpoints to target:
  - Auth: `/api/auth/login`
  - CRUD: `/api/create`, `/api/update/<id>` or `/api/update`, `/api/delete/<id>` or `/api/delete`, `/api/data/<username>`
  - Chat/Stats: `/api/chat/recent`, `/api/chat/send`, `/api/stats/<username>`
  - Reschedule: `/api/tasks/reschedule`
  - Currency: `/api/seeds/transaction`
  - Google Calendar Sync: `/api/gcal/auth`, `/api/gcal/callback`, `/api/gcal/sync`
  - Jarvis configuration: `/api/jarvis/config`
  - Biometrics Sync: `/api/biometrics/sync`
  - Gifting: `/api/store/gift`
  - Backup: `/api/settings/backup`
