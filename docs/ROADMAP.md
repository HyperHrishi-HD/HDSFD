# HDSFD — PythonAnywhere-Only Overhaul Roadmap

**Date:** 2026-09-27 · **Direction source:** `docs/VISION_2026-09-27.md` (user's message, verbatim)

**Direction:** PythonAnywhere is the only host. No Vercel. No Oracle. GitHub becomes a scrubbed public template. Everything works again — and better. Google auth fully restored. Work proceeds phase by phase; each phase ends in a commit that can be reviewed. **Nothing is implemented yet** — this file is the plan of record.

## Locked decisions (confirmed by user 2026-09-27)

- **API keys = 10 total:** 3 (Account A → signed-in non-Google users) + 6 (Account B → Google-signed-in users) + 1 spare (guests + emergency backup). Capacity math: Gemini free tier is limited **per project/account, not per key** → ≈10 RPM / 250 RPD per account on Gemini 2.5 Flash (Flash-Lite up to 30 RPM / 1,000 RPD) → **~500 req/day combined**. Extra keys on the same account give redundancy only, not extra quota; the second account gives a genuinely separate quota. Round-robin balances load; per-key cooldown + 429 failover; server-side per-user throttle for fairness. All pools exhausted → fallback chain.
- **"HDAI" = the Gemini-key AI itself** (branding shown in the app/Settings), not a separate server endpoint. Fallback chain: **HDAI (shared Gemini pools) → local Qwen 3.5 0.8B in-browser → BYO API key → MCP/OAuth**. Provider switching lives **only in Settings**; the AI surface stays minimalist and shows statuses.
- **Local model:** Qwen 3.5 0.8B in-browser (WebGPU), one-time user-triggered download with progress + status, persisted indefinitely (OPFS/Cache), unlimited and offline-capable; graceful "browser not supported" state.
- **School Connect stays** (ICS/CSV timetable import — works, tested; fits the classes/tests vision).
- **Oracle/Vercel kit deleted:** `deploy/`, `vercel.json`, Oracle/Vercel GitHub workflows, `backend/schema_postgresql.sql`, `deploy/migrate_pa_to_oracle.py`. Review `.github/workflows/monthly-pa-reload.yml` before deleting anything — if it is a PA keep-alive, it stays.
- **No data migration required.** A safety snapshot of the PA SQLite DB is still taken before any schema change (cheap insurance).

## AI tiering & fallback (final)

| Tier | Keys | Who | Behavior |
|---|---|---|---|
| A | 3 (Account A) | Signed in with username+password | Round-robin, cooldowns, per-user throttle |
| B | 6 (Account B) | Signed in with Google | Round-robin, cooldowns, per-user throttle |
| Spare | 1 | Guests + emergency overflow | Very low per-user limits → offline fallback |
| Local | — | Anyone | Qwen 3.5 0.8B in-browser, unlimited |
| BYO | — | Anyone | User's own key, entered in Settings |
| MCP/OAuth | — | Anyone | Integration slot, Settings only |

Order: tier pool → spare (if authorized) → local model → BYO → MCP/OAuth. Every AI surface shows which engine is active.

## Phase 0 — Docs & repo hygiene (first actionable phase)

1. ~~Save user's message verbatim → `docs/VISION_2026-09-27.md`~~ ✅ (this doc set)
2. ~~Write plan → `docs/ROADMAP.md`~~ ✅ (this file)
3. ~~Update `PROJECT.md`~~ ✅
4. Delete Oracle/Vercel artifacts (list above; review `monthly-pa-reload.yml` first); fix any test/doc references
5. Commit: docs + PA-only cleanup

## Phase 1 — Login system (the main thing)

- Backend (root `app.py` — the PA runtime): real register + login + **password change** + session/me endpoints. scrypt password hashing and sha256-stored session tokens already exist — wire properly with auto-register on first login; upgrade `users` table (display_name etc.).
- **Google as a sign-in option:** "Continue with Google" creates/links the local account via the OAuth identity.
- **Guest mode:** data local to browser + device identity; **sign-in popup + top banner**; guests can use everything except sync / shop / coins; guest AI on the spare key with very low limits → offline fallback.
- Frontend: login/register modal, account menu, password-change UI; local data merges into the account on first sign-in.
- **Verify:** register → sign out → sign in on a second browser and see your data (the Chromebook scenario).

## Phase 2 — Google auth fully restored + PA cloud storage

- Fix/verify the full OAuth flow on PA (`/api/gdrive/auth` → `/api/gdrive/callback` → token storage), **Google Tasks sync**, **Calendar sync** — end to end.
- **All data persists to PA SQLite** for any signed-in user (Google or not): server-authoritative items, offline queue + auto-flush with retry/backoff (pattern already exists in `src/main.js`).
- **Drive backup = ONE neat folder** (`HDSFD Backup`), smart auto-sync when online, timestamped snapshots.
- First-time users: local-only data, popup + banner prompting sign-in.

## Phase 3 — Tasks, folders & schedules that actually work

- **Every class IS a folder**; categories: School classes / External classes / Upcoming tests; minimalist UI.
- **Folder-as-prefix Google sync:** tasks sync to a single Google list titled `"Math | Homework 3"` — no separate Google lists, no clutter. HDSFD is where you update/organize; change-detection avoids sync loops.
- **Schedules de-cluttered:** clean day/week views; exams/tests/quizzes as schedule items with prep countdowns and a working quiz/test mode.
- **Tasks UI overhaul:** groups, drag-drop, filters.

## Phase 4 — AI overhaul

- **Tiered key pools** (3 / 6 / 1) with round-robin, per-key cooldown, 429 failover, per-user fairness throttle; status display of pool health.
- **Full context:** every note, task, folder, schedule/exam, progress stat, and full chat history (user-deletable) packed per request.
- **Universal command executor:** AI output executes through the same action layer as slash commands — sticky notes, tasks/folders, schedules/exams/classes, settings, play any song, start focus — natural language in, anything done.
- **Fallback chain** (Settings-only): HDAI → Qwen 3.5 0.8B in-browser (WebGPU, persisted download, status shown) → BYO key → MCP/OAuth slot.

## Phase 5 — Notes UI + minimalist polish

- Better note mechanics (editor, organization, quick capture); glassmorphic consistency and declutter pass across the app.

## Phase 6 — Stability & GitHub template

- E2E checklist on live PA: auth, sync, folder→Google tasks, AI chain incl. local model, YT player, notes.
- Extend tests; `py_compile` + unittest green (44 existing tests stay passing).
- **Template scrub:** remove OAuth client id/secret, Gemini keys, domain-verification file, personal data; add template README with setup guide; push as public template.

## Verification per phase

`py_compile` + unittest after every change, manual E2E on the PA app per phase, one reviewable commit per phase.

## Repo facts (for whoever implements)

- Root `index.html` loads root `app.js?v=3.1` (5,905 lines, `API_BASE='/api'`) — this is the real PA frontend. `src/main.js` is the Vite entry and is NOT loaded by root index.html; use it as the offline-queue reference.
- Root `app.py` (2,515 lines) is the PA backend: `GEMINI_KEY_POOL` round-robin+failover, OAuth/gdrive endpoints, Tasks/Calendar/YouTube proxies, `/api/auth/login` with scrypt + bearer-token sessions (auto-registers on first login — extend, don't replace).
- Known gaps to fix along the way: `backend/app.py` has ownership-check holes (but that file is the unused alt backend); root app.py's login auto-registers any username — Phase 1 adds real register/login separation + password change.
- Tests: `python -m unittest tests.test_school_connect tests.test_migration_mapping` → 44 OK (migration-mapping tests are removed together with the Oracle kit in Phase 0; School Connect tests stay).
- `.freebuff/` is local tool state — never commit it.
