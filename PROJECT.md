# Project: HDSFD V2

## Architecture
HDSFD V2 is a glassmorphic student productivity suite containing a Flask backend and a Vite/Tailwind/Lucide/Chart.js frontend.
- Backend: Flask, SQLite database in standard rollback journal mode (`PRAGMA journal_mode=DELETE;`), OAuth2 flow for Google Drive database backups.
- Frontend: Single-page application using Vite with custom tab page routing, interactive calendar, 3D book canvas, audio synthesis, and chatbot command interface.

## Milestones
| # | Name | Scope | Dependencies | Status | Conversation ID |
|---|------|-------|-------------|--------|-----------------|
| M1 | Backend, DELETE DB & GDrive Backup | R1: SQLite PRAGMA journal_mode=DELETE, stateless backend, OAuth2 GDrive backup | None | DONE | d8c6a8f4-9b5a-4710-bd58-2a575e5458c9 |
| M2 | Focus Sanctuary & Zen Mode | R2: Pomodoro, Brown noise synthesizer, storm visuals, exam boss, chat, peer stats | M1 | DONE | d8c6a8f4-9b5a-4710-bd58-2a575e5458c9 |
| M3 | Tasks, Calendar & Heatmap | R3: Day/Week/Month/Year views, drag-drop rescheduling, syllabus track, 365 heatmap | M2 | DONE | d8c6a8f4-9b5a-4710-bd58-2a575e5458c9 |
| M4 | Skeuomorphic Notes Journal | R4: 3D flip-book layout, transparent vector drawing canvas, corner hotspots, Local AI summary | M3 | DONE | d8c6a8f4-9b5a-4710-bd58-2a575e5458c9 |
| M5 | Jarvis Chatbot & Gifting | R5: Slash commands parsing, state inspector, steps sync, P2P gifting storefront | M3 | DONE | d8c6a8f4-9b5a-4710-bd58-2a575e5458c9 |
| M6 | Legacy Fixes & Stability | R6: Fix ERR-001 through ERR-006 | M2, M3 | DONE | d8c6a8f4-9b5a-4710-bd58-2a575e5458c9 |
| M7 | E2E Integration & Hardening | Final Milestone: Pass 100% E2E tests, Forensic Audit CLEAN | M1-M6, E2E Test Suite | DONE | f720a585-2642-46da-a054-e9c305f197a3 |

## Code Layout
- Frontend Source: `src/main.js`, `src/style.css`, `index.html`
- Backend Source: `backend/app.py`, `backend/database.db`
- E2E Tests: `tests/`
- Build Artifacts: `dist/`

## Interface Contracts
### Task Rescheduling API
- Endpoint: POST `/api/v2/tasks/reschedule`
- Request: `{ "task_id": int, "new_timestamp": ISOString, "username": string, "duration": int }`
- Response: `{ "status": "success", "task": object }`
