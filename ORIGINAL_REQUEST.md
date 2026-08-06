# Original User Request

## Initial Request — 2026-06-14T21:38:22Z

Build "HDSFD V2" as a high-performance student productivity web application using a premium, glassmorphic UI. It features a focus sanctuary with Brown Noise audio synthesis, a Pomodoro timer, peer lookup with community chat, an exam boss fight, a multi-view calendar grid with drag-and-drop rescheduling, a skeuomorphic vector canvas journal with anti-aliased geometry, and a Jarvis command-parsing chatbot interface with e-commerce mechanics and zero-cost cloud Google Drive snapshots.

Working directory: C:\Users\venky\OneDrive\Documents\CODING PROJECTS\HDSFD
Integrity mode: development

## Requirements

### R1. Stateless Backend & Google Drive Backup
Implement a stateless Python Flask backend conforming to WSGI server compatibility (PythonAnywhere free tier), utilizing a local SQLite database running in Write-Ahead Logging (WAL) mode. Implement full OAuth2 credentials flow to backup, compress, and stream the sqlite database snapshot (`hdsfd_v2.db`) directly into a dedicated directory in the user's Google Drive.

### R2. Tab 1 - Focus Sanctuary & Zen Mode
Build a center Pomodoro timer and custom brown noise synthesiser mixed with Rain and Lo-Fi audio control. Toggle Zen Mode to activate browser Fullscreen API, pure black screen (#000000), hiding nav panels, requiring a strict 3-second ESC hold to exit. Implement Left panel with community chat and stat inspector, and Right panel with an Exam Boss battle showing a target date countdown timeline and custom storm lighting visual styles.

### R3. Tab 2 - Intelligent Tasks, Calendar & Heatmap
Build a calendar workspace (Daily, Weekly, Monthly, Yearly views) with an interactive drag-and-drop layer to reschedule tasks to hour blocks (sending `/api/v2/tasks/reschedule`). Include an Academic Syllabus tracker sidebar and a 365-day color-coded activity heatmap.

### R4. Tab 3 - Skeuomorphic Notes Journal & Vector Canvas
Render a dual-page digital book layout with 3D folding animation page transitions. Provide a transparent HTML5 canvas overlay supporting stylus/pointer vector drawing paths, corner hotspots for quick notes, and a Local AI summary drawer.

### R5. Tab 4 - Jarvis AI & Commerce
Jarvis chat assistant with client state inspection, slash command parsing (`/theme`, `/add`, `/schedule`, `/buy`, `/gift`), AI Power reasoning slider, steps converter sync, and e-commerce P2P gifting storefront.

### R6. Legacy Fixes & Stabiliations
Fix ERR-001 (Post-it delete validation), ERR-002 (Animations toggle pseudoelement visual switch), ERR-003/004 (Folder dropdown z-index context clipping), and ERR-005/006 (Mobile layouts and glass blur filter leaks).

## Acceptance Criteria

### Verification Checks
- [ ] Backend runs successfully on WSGI simulator with WAL SQLite.
- [ ] Google OAuth2 flow connects and database snapshots upload successfully to Google Drive.
- [ ] Tab 1 Zen Mode locks fullscreen, isolates clock, and exits only on 3s ESC key hold.
- [ ] Audio mixer Browns noise synthetically without latency.
- [ ] Tab 2 drag-and-drop rescheduling updates calendar slots and dispatches DB updates.
- [ ] Tab 3 renders 3D flip pages and vector lines save/load as string vectors.
- [ ] Tab 4 command parser resolves slash commands dynamically, updating global variables.
- [ ] Mobile docks layout collapses properly without leaks or overlaps.
- [ ] Legacy audit ERR-001 through ERR-006 pass all regression checks.

## Follow-up — 2026-06-14T21:43:53Z

1. R1 Google Drive: Assume credentials.json is already present in the root. Write only the production Python streaming/upload logic (no setup guides, markdown instructions, or config texts).
2. Zero Shortcuts: Absolutely zero // TODO, /* code here */, or markdown ellipses (...) are allowed. Write out every single line of code for the Tab 3 3D flip-book matrix and the HTML5 Canvas pointer-tracking vector arrays.
3. Paths & Compiling: Map all file paths natively to the designated working directory layout with absolute z-index isolation to ensure a clean Vite production compilation.

## Follow-up — 2026-06-14T21:44:21Z

1. Network Filesystem Adjustment: SQLite WAL mode must NOT be used because it will crash or lock up on PythonAnywhere's distributed storage. Force the Flask backend to use standard rollback journal mode (PRAGMA journal_mode=DELETE;) instead of WAL.
2. Fullscreen API Security Override: In Zen Mode, hitting ESC drops fullscreen natively, but a strict 3-second hold on the 'Q' key (or a dedicated button) is required to actually unhide the navigation panels and restore the workspace.
3. PythonAnywhere WSGI Constraints: The community chat must strictly use lightweight HTTP polling via Fetch API instead of WebSockets.
4. Google Drive Credentials: Assume 'credentials.json' is present. Write only production Python streaming logic, no guides/instructions.
5. Zero Shortcuts: No // TODO, /* code here */, or ellipses (...) are permitted in the codebase (including Tab 3 3D page-flip matrix, CSS, and vector arrays). Everything must be fully written out.

## Follow-up — 2026-07-30T17:33:54Z

Build "HDSFD V2" as a high-performance student productivity web application using a premium, glassmorphic UI with a Focus Sanctuary, Brown Noise audio synthesis, Pomodoro timer, 24h ephemeral chat, exam boss fight, multi-view calendar grid with drag-and-drop rescheduling, skeuomorphic vector canvas journal, and a Jarvis slash-command chatbot interface.

Working directory: e:\Projects\HD Coding Projects\HDSFD
Integrity mode: development

## Requirements

### R1. Stateless Backend & Google Drive Backup
Implement a Python Flask backend adhering to WSGI server compatibility (PythonAnywhere free tier), utilizing a local SQLite database in standard rollback journal mode (`PRAGMA journal_mode=DELETE;`). Implement OAuth2 credentials flow to backup, compress, and stream database snapshots (`hdsfd_v2.db`) directly into the user's Google Drive folder.

### R2. Tab 1 - Focus Sanctuary & Zen Mode
Build a center Pomodoro timer and custom Web Audio Brown Noise synthesizer mixed with Rain and Lo-Fi audio control. Toggle Zen Mode to activate browser Fullscreen API, pure black background (`#000000`), hiding peripheral panels, requiring a strict 3-second hold to exit ('Q' key / exit trigger). Implement Left panel with 24-hour ephemeral community chat and stat inspector, and Right panel with RPG plant evolution/decay loop, character stats (Stamina, Knowledge, Agility), and an Exam Boss battle with storm lighting visual styles and a task countdown timeline drain bar.

### R3. Tab 2 - Intelligent Tasks, Calendar & Heatmap
Build a calendar workspace (Daily, Weekly, Monthly, Yearly, and Academic Syllabus views) with an interactive drag-and-drop layer to reschedule tasks (`/api/v2/tasks/reschedule`). Include a folder-organized hierarchical task sidebar with priority ordering (High to Low), a 365-day color-coded activity heatmap, a habit tracker, and Duolingo-style streak freeze protection items purchased with Seed currency.

### R4. Tab 3 - Skeuomorphic Notes Journal & Vector Canvas
Render a dual-page digital book layout with 3D folding animation page transitions (vertical scrolling on mobile). Provide an HTML5 canvas overlay supporting stylus/pointer vector drawing paths, corner hotspots (Top-Left: Sticky notes manager; Bottom-Left: Vector canvas trigger; Top-Right: Markdown rich-text editor; Bottom-Right: Local AI summary drawer), and image drop targets.

### R5. Tab 4 - Jarvis AI & Commerce
Jarvis chat assistant with client state inspection, slash command parsing (`/theme`, `/add`, `/schedule`, `/buy`, `/gift`), AI power/reasoning slider, physical step count sync (1 seed/100 steps), and e-commerce P2P gifting storefront.

### R6. Legacy Fixes & Stabilizations
Fix ERR-001 (Post-it delete validation and SQL deletion trigger), ERR-002 (Settings UI fluid animation toggle pill CSS pseudo-elements), ERR-003/004 (Folder dropdown z-index context clipping & touch targeting math), and ERR-005/006 (Mobile timer layout flexbox alignment & glass tab opacity fallback).

## Acceptance Criteria

### Automated Verification Suite
- [ ] Backend starts clean with `PRAGMA journal_mode=DELETE;` and passes all `tests/run_tests.py` checks without server initialization errors.
- [ ] Google OAuth2 flow connects and database snapshots stream to Google Drive.
- [ ] Tab 1 Zen Mode locks fullscreen, isolates chronometer, and exits only on 3-second key/button hold.
- [ ] Audio mixer synthesizes Brown noise, Rain, and Lo-Fi without latency.
- [ ] Tab 2 drag-and-drop rescheduling updates calendar slots and dispatches DB updates to POST `/api/v2/tasks/reschedule`.
- [ ] Tab 3 renders 3D flip pages and vector sketch lines load/save accurately.
- [ ] Tab 4 command parser resolves slash commands dynamically (`/theme`, `/add`, `/schedule`, `/buy`, `/gift`).
- [ ] Legacy audit ERR-001 through ERR-006 pass all regression checks.
- [ ] 100% of test cases in `test_tier1.py`, `test_tier2.py`, `test_tier3.py`, and `test_tier4.py` pass.
