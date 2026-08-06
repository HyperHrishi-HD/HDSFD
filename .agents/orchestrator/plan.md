# HDSFD V2 Build Plan

## Objective
Orchestrate the development and verification of HDSFD V2, matching all original user request requirements (R1 through R6) and passing 100% of acceptance criteria tests in test_tier1.py, test_tier2.py, test_tier3.py, test_tier4.py, and tests/run_tests.py.

## Global Constraints (Follow-up & Critical Adjustments)
1. **Google Drive Backup**: Assume `credentials.json` is already present in the root directory. Output production-only Python streaming and upload logic (no instructions or config texts).
2. **Zero Shortcuts**: Zero `// TODO`, `/* code here */`, or markdown ellipses (`...`) are allowed in any codebase file or documentation. All code logic for Tab 3 (3D flip-book matrix) and Tab 3 pointer-tracking vector arrays must be fully written out.
3. **Paths & Compilation**: Use correct z-index isolation and file path mappings to ensure clean Vite compilation in production.
4. **SQLite Storage**: Use standard rollback journal mode (`PRAGMA journal_mode=DELETE;`) instead of WAL to prevent lockups on PythonAnywhere.
5. **Zen Mode Exit**: Escape from Zen Mode (unhiding workspace/navigation) requires holding the 'Q' key (or a dedicated button) for 3 seconds. Hitting ESC only drops native fullscreen.
6. **Chat Polling**: Community chat must strictly use Fetch API HTTP polling instead of WebSockets.

## Execution Steps

### Step 1: Verification & E2E Testing Infra Setup
- [x] Update orchestrator state files (`plan.md`, `progress.md`, `context.md`, `BRIEFING.md`).
- [ ] Spawn E2E Testing Orchestrator to verify `tests/run_tests.py`, `test_tier1.py` through `test_tier4.py`, create `TEST_INFRA.md`, and publish `TEST_READY.md`.

### Step 2: Implementation Milestones Execution
- [ ] **Milestone 1: Backend, DELETE DB & GDrive Backup** (R1)
  - Tasks: Set up standard rollback journal SQLite mode (`PRAGMA journal_mode=DELETE;`), Flask WSGI compatibility, OAuth2 Google Drive database backup streaming.
- [ ] **Milestone 2: Focus Sanctuary & Zen Mode** (R2)
  - Tasks: Web Audio API brown noise synthesizer mixed with Rain/Lo-Fi, Zen Mode 3s 'Q' key hold exit, 24h ephemeral community chat via Fetch API HTTP polling, Peer stats inspector, RPG plant evolution/decay loop, Exam Boss fight countdown timeline & storm visual styles.
- [ ] **Milestone 3: Tasks, Calendar & Heatmap** (R3)
  - Tasks: Daily/Weekly/Monthly/Yearly/Syllabus views, drag-and-drop rescheduling layer dispatching POST `/api/v2/tasks/reschedule`, folder-organized task sidebar with priority ordering (High to Low), 365-day heatmap, habit tracker, Duolingo-style streak freeze protection items purchased with Seed currency.
- [ ] **Milestone 4: Skeuomorphic Notes Journal & Vector Canvas** (R4)
  - Tasks: Dual-page digital book layout with 3D folding animation page transitions (vertical scrolling on mobile), HTML5 canvas overlay supporting stylus/pointer vector drawing paths, corner hotspots (Top-Left: Sticky notes manager; Bottom-Left: Vector canvas trigger; Top-Right: Markdown rich-text editor; Bottom-Right: Local AI summary drawer), image drop targets.
- [ ] **Milestone 5: Jarvis AI & Commerce** (R5)
  - Tasks: Jarvis chat assistant with client state inspection, slash command parsing (`/theme`, `/add`, `/schedule`, `/buy`, `/gift`), AI power/reasoning slider, physical step count sync (1 seed/100 steps), P2P gifting storefront.
- [ ] **Milestone 6: Legacy Fixes & Stabilizations** (R6)
  - Tasks: Fix ERR-001 (Post-it delete validation and SQL deletion trigger), ERR-002 (Settings UI fluid animation toggle pill CSS pseudo-elements), ERR-003/004 (Folder dropdown z-index context clipping & touch targeting math), ERR-005/006 (Mobile timer layout flexbox alignment & glass tab opacity fallback).

### Step 3: Final Acceptance & Forensic Audit Gating
- [ ] Execute test suite `python tests/run_tests.py` across all test tiers (Tiers 1-4).
- [ ] Run Forensic Auditor checks (`teamwork_preview_auditor`) to verify zero-tolerance compliance (no hardcoded test results, genuine logic, zero shortcuts).
- [ ] Validate 100% passing test score and clean audit verdict.
- [ ] Report final completion back to Sentinel/Parent.
