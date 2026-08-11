# 🌿 HDSFD — HD Student Focus Dashboard

[![Live App](https://img.shields.io/badge/Live%20App-hdsfd.pythonanywhere.com-8b5cf6?style=for-the-badge&logo=google-chrome&logoColor=white)](https://hdsfd.pythonanywhere.com/)
[![GitHub](https://img.shields.io/badge/GitHub-HyperHrishi--HD%2FHDSFD-10b981?style=for-the-badge&logo=github&logoColor=white)](https://github.com/HyperHrishi-HD/HDSFD)
[![YouTube](https://img.shields.io/badge/Creator-HyperHrishi%20HD-ff0000?style=for-the-badge&logo=youtube&logoColor=white)](https://www.youtube.com/@HyperHrishiHD?sub_confirmation=1)

> **HDSFD** (**HD Student Focus Dashboard**) is an ultra-fast, glassmorphic student productivity suite designed for deep focus sessions, intelligent academic planning, ambient audio synthesis, interactive physics notes, and a living botanical evolution sanctuary.

---

## 🌟 Core Feature Suite

### 1. ⏱️ Focus Sanctuary & Zen Mode (Tab 1)
- **Apple Chronometer**: Ultra-clean digital focus timer with dynamic 120m logarithmic slider, decimal custom stepper (`25.30m`), and quick preset chips (`15m`, `25m`, `45m`, `60m`, `90m`).
- **Partial Session Coin Engine**: Pausing or stopping focus sessions early calculates elapsed focus seconds and proportionally awards coins to your sanctuary.
- **Web Audio Soundscape Synthesizer**: Built-in procedural brown noise, rain soundscape mixer, and YouTube music player.
- **Distraction-Free Zen Mode**: Pure black fullscreen focus overlay with floating AssistiveTouch controls and an auto-fading 3-second hold to exit.

### 2. 📅 Intelligent Tasks, Calendar & Exam Scheduler (Tab 2)
- **Interactive Dark Calendar Grid**: Dynamic monthly calendar with event and deadline dots, quick-add modal, and seamless bidirectional **Google Calendar Sync**.
- **Hierarchical Tasks**: Multi-folder organization, subtask checklists, priority badges, deadline countdowns, and real-time **Google Tasks Sync**.
- **Weekly Class Timetable & Live Status**: Displays ongoing and upcoming classes with room locations and live status badges on the Home tab.
- **Exam & Major Assessment Scheduler**: Schedule midterms, SATs, and finals with custom completion rewards (`100–500 🪙`). Adding an exam automatically generates a dedicated task list folder.

### 3. 📝 3D Physics Sticky Notes & Gemini AI (Tab 3)
- **Skeuomorphic Jiggle Notes**: Drag-and-drop interactive notes board with inertia physics, 5 pastel color tags, vector stylus pen drawing, and Markdown support.
- **Google Gemini Study Agent**: Direct AI agent capable of generating real scientific formulas, math derivations, essay outlines, and executing in-app actions (creating notes, tasks, timers, themes).

### 4. 🌳 Living Sanctuary Tree & 100+ Botanical Stages (Tab 4)
- **Living Background Canvas**: A dynamic procedural SVG botanical tree rendering behind glassmorphism across all tabs.
- **100+ Evolutionary Stages**: From *Mystical Sprout* to *Radiant Sapling*, *Ancient Elder Redwood*, and *Cosmic World Tree (Yggdrasil Prime)*.
- **Lifetime Coins (XP) Engine**: The tree grows strictly from cumulative Lifetime XP earned through study. **Spending coins in the shop never shrinks your tree!**
- **Tree Vitality, Decay & Healing**: Inactivity causes subtle browning/decay; completing focus sessions, tasks, and exams heals the tree back to 100% vibrant green.
- **Stage 100 Milestone Bonus**: Unlock a massive **+10,000 Free Coins** blessing upon reaching Stage 100.

### 5. 🛍️ Upgrades Shop (Tab 4)
- 💧 **Fertile Spring Dew** (+10% Permanent Growth Multiplier per tier, starting at 50 🪙).
- ⚡ **Sunlight Essence** (2x Coins on Pomodoro & Zen for 1 Completed Session with a radiant timer aura - 100 🪙).
- 🌿 **Glowing Vines** (1.5x Growth for 24 Hours with climbing ivy - 150 🪙).
- 🌸 **Blossom Petals** (1.5x Coins + 10 🪙/hr Passive Income for 24 Hours with drifting sakura petals - 200 🪙).
- 🌟 **Starlight Aura** (2x Coins & 2x Growth for 1 Whole Week - 500 🪙).
- 🧊 **Streak Shield** (Protects streak and freezes tree vitality for 48 Hours - 250 🪙).
- 🎨 **Cosmic Theme Key** (Unlocks all 8 fluid gradient themes when signed in with Google + 200 Free Coins).
- 👑 **Zen Master Crown** (Subscribe to HyperHrishi HD to unlock royal crown profile badge and +1,000 Coins).

---

## 🔒 Security & Local-First Resiliency
- **Security Headers Active**: `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `X-XSS-Protection: 1; mode=block`, `Referrer-Policy: strict-origin-when-cross-origin`.
- **Zero-Error Local Fallback**: When offline or in Guest Mode, HDSFD functions completely offline using `localStorage` and SQLite fallback without throwing errors.
- **Automated Google Drive Backup**: Automatically backups all notes (`Notes.json`) and database (`data.db`) into the dedicated `HDSFD Backup` folder in Google Drive.

---

## 🚀 Installation & Local Development

```bash
# Clone repository
git clone https://github.com/HyperHrishi-HD/HDSFD.git
cd HDSFD

# Install dependencies
pip install Flask requests

# Run local development server
python server.py
```

Access the local server at `http://localhost:5050/`.

---

## 👨‍💻 Creator & Links
- **Developed by**: [HyperHrishi HD](https://www.youtube.com/@HyperHrishiHD?sub_confirmation=1)
- **Live Production URL**: [https://hdsfd.pythonanywhere.com/](https://hdsfd.pythonanywhere.com/)
- **GitHub Repository**: [https://github.com/HyperHrishi-HD/HDSFD](https://github.com/HyperHrishi-HD/HDSFD)
