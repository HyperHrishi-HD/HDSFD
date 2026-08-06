# Scope: Milestone 1 - Stateless Backend & Google Drive Backup

## Architecture
- Flask backend serving as a stateless WSGI application.
- SQLite database (`backend/database.db`) operating in standard rollback journal mode (`DELETE` mode).
- Google OAuth2 integration for backup, using Google Drive API.
- Snapshots of database should be zipped/gzipped and streamed directly to a dedicated Google Drive folder (e.g., "HDSFD_Backups").

## Milestones
| # | Name | Scope | Dependencies | Status | Conversation ID |
|---|------|-------|-------------|--------|-----------------|
| 1 | Investigate & Plan | Analyze existing backend structure, dependencies, and Google API requirements. | None | DONE | 4533ace3-d610-4fab-a98b-1c39cb7ec257 |
| 2 | Implementation | Implement standard DELETE journal mode, Google OAuth2 endpoints, and compressed backup stream. | M1.1 | IN_PROGRESS | TBD |
| 3 | Code Review | Review implementation correctness, safety, and WSGI compliance. | M1.2 | IN_PROGRESS | TBD |
| 4 | Verification & Testing | Test API endpoints, verify backup integrity, check DELETE journal behavior. | M1.3 | PLANNED | TBD |
| 5 | Forensic Audit | Verify compliance with anti-cheat/integrity rules. | M1.4 | PLANNED | TBD |

## Interface Contracts
### Google Drive Auth
- Endpoint: `GET /api/gdrive/auth`
- Query Params: `username` (string)
- Response: `{ "status": "success", "redirect_url": string }` (Google OAuth consent screen URL)

### Google Drive Callback
- Endpoint: `GET /api/gdrive/callback`
- Query Params: `code` (string), `state` (string representing username)
- Response: HTML page indicating success/failure (similar to Google Calendar callback).

### Settings Backup
- Endpoint: `POST /api/settings/backup` (replacing Dropbox backend)
- Request: `{ "username": string }`
- Response: `{ "status": "success", "backup_filename": string, "destination": "Google Drive Cloud API", "message": string, "size_bytes": int }`
