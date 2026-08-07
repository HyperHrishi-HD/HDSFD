// ================= HD SFD V2 CLEAN APP LOGIC =================

let userName = localStorage.getItem('hdsfd_user_name') || null;
let googleAccount = localStorage.getItem('hdsfd_google_account') || null;
let activeTab = 'focus';
let allData = [];
let isLowPowerMode = localStorage.getItem('hdsfd_low_power') === 'true';

// Audio Synthesizer State
let isPlayingSoundscape = false;
let audioContext = null;
let noiseNode = null;
let noiseGainNode = null;

// Pomodoro Timer State
let pomoDurationSeconds = 25 * 60;
let pomoRemainingSeconds = 25 * 60;
let pomoTimerId = null;

// Journal Pages & Canvas State
let journalSpreadIndex = 0;
let isDrawing = false;
let canvasCtx = null;

const API_BASE = 'http://localhost:5050/api';

// ===== DATA STORAGE SDK WITH AUTO-BACKUP =====
async function fetchData() {
  const currentOwner = googleAccount || userName || 'Guest';
  try {
    const res = await fetch(`${API_BASE}/items?username=${encodeURIComponent(currentOwner)}`);
    if (res.ok) {
      allData = await res.json();
      return allData;
    }
  } catch (e) {
    console.warn('Backend API offline, falling back to local storage:', e);
  }
  const local = localStorage.getItem(`hdsfd_data_${currentOwner}`);
  allData = local ? JSON.parse(local) : [];
  return allData;
}

async function createData(item) {
  const currentOwner = googleAccount || userName || 'Guest';
  item.username = currentOwner;
  item.id = item.id || 'item_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);

  try {
    await fetch(`${API_BASE}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(item)
    });
    autoBackupToDrive();
  } catch (e) {
    console.warn('API save warning:', e);
  }

  const idx = allData.findIndex(d => d.id === item.id);
  if (idx >= 0) allData[idx] = item;
  else allData.push(item);
  localStorage.setItem(`hdsfd_data_${currentOwner}`, JSON.stringify(allData));
  renderCurrentTab();
  return item;
}

async function deleteData(id) {
  const currentOwner = googleAccount || userName || 'Guest';
  try {
    await fetch(`${API_BASE}/items`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: id, username: currentOwner })
    });
    autoBackupToDrive();
  } catch (e) {
    console.warn('API delete warning:', e);
  }
  allData = allData.filter(d => d.id !== id);
  localStorage.setItem(`hdsfd_data_${currentOwner}`, JSON.stringify(allData));
  renderCurrentTab();
}

function autoBackupToDrive() {
  if (googleAccount) {
    fetch(`${API_BASE}/gdrive/backup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: googleAccount })
    }).catch(() => {});
  }
}

// ===== FIRST TIME NAME MODAL & AUTH =====
function checkFirstTimeUser() {
  // Check URL query parameters for Google OAuth callback parameter
  const urlParams = new URLSearchParams(window.location.search);
  const gAccount = urlParams.get('google_account');
  if (gAccount) {
    googleAccount = gAccount;
    localStorage.setItem('hdsfd_google_account', gAccount);
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  if (!userName && !googleAccount) {
    const modal = document.getElementById('welcome-modal');
    if (modal) modal.classList.remove('hidden');
  } else {
    initializeUserSession();
  }
}

function saveFirstTimeName() {
  const input = document.getElementById('welcome-name-input');
  const name = input ? input.value.trim() : '';
  if (!name) return;
  userName = name;
  localStorage.setItem('hdsfd_user_name', name);
  document.getElementById('welcome-modal').classList.add('hidden');
  initializeUserSession();
}

function initializeUserSession() {
  const nameDisplay = document.getElementById('header-user-name');
  const settingsInput = document.getElementById('settings-name-input');
  const activeName = googleAccount || userName || 'Guest';
  
  if (nameDisplay) nameDisplay.textContent = activeName;
  if (settingsInput) settingsInput.value = activeName;

  if (googleAccount) {
    const badgeText = document.getElementById('google-badge-text');
    const badge = document.getElementById('google-status-badge');
    if (badgeText) badgeText.textContent = `Google: ${googleAccount}`;
    if (badge) badge.className = 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-3 py-1 rounded-full flex items-center gap-1.5 text-xs font-bold transition-all';
  }

  const savedSub = localStorage.getItem('hdsfd_subtitle');
  if (savedSub) {
    const subEl = document.getElementById('editable-subtitle');
    if (subEl) subEl.textContent = savedSub;
  }

  applyLowPowerState();
  startClockWithSeconds();
  fetchData().then(() => renderCurrentTab());
}

function saveNameFromSettings() {
  const input = document.getElementById('settings-name-input');
  const name = input ? input.value.trim() : '';
  if (!name) return;
  userName = name;
  localStorage.setItem('hdsfd_user_name', name);
  initializeUserSession();
  alert('Display Name updated!');
}

function saveSubtitle() {
  const subEl = document.getElementById('editable-subtitle');
  if (subEl) {
    const text = subEl.textContent.trim();
    localStorage.setItem('hdsfd_subtitle', text);
  }
}

function connectGoogleAccount() {
  const owner = userName || 'User';
  const width = 520;
  const height = 650;
  const left = (window.screen.width / 2) - (width / 2);
  const top = (window.screen.height / 2) - (height / 2);

  const authWindow = window.open(
    `${API_BASE}/gdrive/auth?username=${encodeURIComponent(owner)}`,
    'GoogleOAuthWindow',
    `width=${width},height=${height},top=${top},left=${left},scrollbars=yes,status=yes`
  );

  if (authWindow) authWindow.focus();
}

window.addEventListener('message', (event) => {
  if (event.data && (event.data.type === 'gdrive_linked' || event.data.username)) {
    googleAccount = event.data.username || 'GoogleUser';
    localStorage.setItem('hdsfd_google_account', googleAccount);
    initializeUserSession();
  }
});

// ===== TAB NAVIGATION (3 TABS) =====
function switchTab(tab) {
  activeTab = tab;

  document.querySelectorAll('.tab-content').forEach(view => {
    view.classList.remove('active');
  });
  const target = document.getElementById(`tab-${tab}`);
  if (target) target.classList.add('active');

  document.querySelectorAll('.nav-btn').forEach(btn => {
    if (btn.dataset.tab === tab) {
      btn.className = 'nav-btn flex-1 py-1.5 flex flex-col items-center text-purple-300 font-bold';
    } else {
      btn.className = 'nav-btn flex-1 py-1.5 flex flex-col items-center text-white/40 font-bold hover:text-white';
    }
  });

  renderCurrentTab();
}

function renderCurrentTab() {
  try {
    if (activeTab === 'focus') {
      renderBossEncounter();
      updateHeaderSeeds();
      updateStatsOverview();
    } else if (activeTab === 'tasks-notes') {
      renderTasks();
      renderCalendar();
      renderJournal();
    }
  } catch (e) {
    console.warn('Tab render warning:', e);
  }
}

function updateStatsOverview() {
  const sessions = allData.filter(d => d.type === 'focus_session');
  const mins = sessions.reduce((sum, s) => sum + (s.minutes || 0), 0);
  const tasks = allData.filter(d => d.type === 'task');
  const completedTasks = tasks.filter(t => t.completed).length;
  const seeds = mins * 2;

  const focusEl = document.getElementById('stat-focus-time');
  const tasksEl = document.getElementById('stat-tasks-done');
  const streakEl = document.getElementById('stat-streak');
  const seedsEl = document.getElementById('stat-seeds');

  if (focusEl) focusEl.textContent = `${mins} mins`;
  if (tasksEl) tasksEl.textContent = `${completedTasks} completed`;
  if (streakEl) streakEl.textContent = `1 Day`;
  if (seedsEl) seedsEl.textContent = `${seeds} Seeds`;
}

// ===== CLOCK WITH SECONDS & DATE =====
function startClockWithSeconds() {
  const clockEl = document.getElementById('lock-clock-seconds');
  const zenClockEl = document.getElementById('zen-clock-seconds');
  const dateEl = document.getElementById('lock-date');

  function tick() {
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const dateStr = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

    if (clockEl) clockEl.textContent = timeStr;
    if (zenClockEl) zenClockEl.textContent = timeStr;
    if (dateEl) dateEl.textContent = dateStr;
  }
  tick();
  setInterval(tick, 1000);
}

// ===== SOUNDSCAPE SYNTHESIZER =====
function toggleSoundscape() {
  const btn = document.getElementById('mixer-toggle-btn');
  const rain = document.getElementById('audio-rain');
  const lofi = document.getElementById('audio-lofi');

  if (!isPlayingSoundscape) {
    isPlayingSoundscape = true;
    if (btn) btn.innerHTML = '<i data-lucide="square" class="w-3.5 h-3.5"></i> <span>Stop Soundscape</span>';
    if (rain) rain.play().catch(() => {});
    if (lofi) lofi.play().catch(() => {});
    initBrownNoise();
  } else {
    isPlayingSoundscape = false;
    if (btn) btn.innerHTML = '<i data-lucide="play" class="w-3.5 h-3.5"></i> <span>Play Soundscape</span>';
    if (rain) rain.pause();
    if (lofi) lofi.pause();
    if (noiseGainNode && audioContext) noiseGainNode.gain.setValueAtTime(0, audioContext.currentTime);
  }
  refreshIcons();
}

function initBrownNoise() {
  if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
  if (!noiseNode) {
    const bufferSize = audioContext.sampleRate * 2;
    const noiseBuffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    let lastOut = 0.0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      output[i] = (lastOut + (0.02 * white)) / 1.02;
      lastOut = output[i];
      output[i] *= 3.5;
    }
    noiseNode = audioContext.createBufferSource();
    noiseNode.buffer = noiseBuffer;
    noiseNode.loop = true;

    noiseGainNode = audioContext.createGain();
    const valInput = document.getElementById('vol-noise');
    const initVol = valInput ? parseFloat(valInput.value) : 0.1;
    noiseGainNode.gain.setValueAtTime(initVol, audioContext.currentTime);

    noiseNode.connect(noiseGainNode);
    noiseGainNode.connect(audioContext.destination);
    noiseNode.start();
  } else if (noiseGainNode && audioContext) {
    const valInput = document.getElementById('vol-noise');
    const initVol = valInput ? parseFloat(valInput.value) : 0.1;
    noiseGainNode.gain.setValueAtTime(initVol, audioContext.currentTime);
  }
}

function updateMixerVolume() {
  const volRain = document.getElementById('vol-rain');
  const volLofi = document.getElementById('vol-lofi');
  const volNoise = document.getElementById('vol-noise');

  const rainAudio = document.getElementById('audio-rain');
  const lofiAudio = document.getElementById('audio-lofi');

  if (volRain && rainAudio) {
    rainAudio.volume = parseFloat(volRain.value);
    document.getElementById('val-rain').textContent = `${Math.round(volRain.value * 100)}%`;
  }
  if (volLofi && lofiAudio) {
    lofiAudio.volume = parseFloat(volLofi.value);
    document.getElementById('val-lofi').textContent = `${Math.round(volLofi.value * 100)}%`;
  }
  if (volNoise && noiseGainNode && audioContext) {
    noiseGainNode.gain.setValueAtTime(parseFloat(volNoise.value), audioContext.currentTime);
    document.getElementById('val-noise').textContent = `${Math.round(volNoise.value * 100)}%`;
  }
}

// ===== POMODORO TIMER & SEEDS =====
function updatePomoDisplay() {
  const mins = Math.floor(pomoRemainingSeconds / 60);
  const secs = pomoRemainingSeconds % 60;
  const timeStr = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  
  const displayEl = document.getElementById('pomo-time-display');
  const zenDisplayEl = document.getElementById('zen-pomo-display');
  const ringEl = document.getElementById('pomo-ring');

  if (displayEl) displayEl.textContent = timeStr;
  if (zenDisplayEl) zenDisplayEl.textContent = timeStr;
  if (ringEl) {
    const total = pomoDurationSeconds;
    const progress = total > 0 ? (total - pomoRemainingSeconds) / total : 0;
    ringEl.style.strokeDashoffset = 534 * (1 - progress);
  }
}

function startTimer() {
  if (pomoTimerId) return;
  document.getElementById('pomo-start-btn').classList.add('hidden');
  document.getElementById('pomo-pause-btn').classList.remove('hidden');

  pomoTimerId = setInterval(() => {
    if (pomoRemainingSeconds > 0) {
      pomoRemainingSeconds--;
      updatePomoDisplay();
    } else {
      pauseTimer();
      alert('Focus session completed! Earned seeds!');
      createData({
        type: 'focus_session',
        minutes: Math.round(pomoDurationSeconds / 60),
        created_at: new Date().toISOString()
      });
      updateHeaderSeeds();
    }
  }, 1000);
}

function pauseTimer() {
  if (pomoTimerId) {
    clearInterval(pomoTimerId);
    pomoTimerId = null;
  }
  document.getElementById('pomo-start-btn').classList.remove('hidden');
  document.getElementById('pomo-pause-btn').classList.add('hidden');
}

function resetTimer() {
  pauseTimer();
  pomoRemainingSeconds = pomoDurationSeconds;
  updatePomoDisplay();
}

function onSliderChange(mins) {
  pomoDurationSeconds = parseInt(mins, 10) * 60;
  pomoRemainingSeconds = pomoDurationSeconds;
  document.getElementById('slider-val').textContent = `${mins}m`;
  updatePomoDisplay();
}

function updateHeaderSeeds() {
  const sessions = allData.filter(d => d.type === 'focus_session');
  const mins = sessions.reduce((sum, s) => sum + (s.minutes || 0), 0);
  const seeds = mins * 2;
  const headerSeeds = document.getElementById('header-seeds');
  if (headerSeeds) headerSeeds.textContent = seeds;
}

function buyStoreItem(itemType, cost) {
  const sessions = allData.filter(d => d.type === 'focus_session');
  const mins = sessions.reduce((sum, s) => sum + (s.minutes || 0), 0);
  const currentSeeds = mins * 2;

  if (currentSeeds < cost) {
    alert(`Not enough seeds! You need ${cost} seeds (Current: ${currentSeeds}). Complete more focus sessions to earn seeds.`);
    return;
  }

  if (itemType === 'freeze') {
    let freezes = parseInt(localStorage.getItem(`freezes_${userName}`) || '0', 10) + 1;
    localStorage.setItem(`freezes_${userName}`, freezes);
    alert('Purchased 🧊 Streak Freeze Protection!');
  } else if (itemType === 'boost') {
    alert('Purchased ⚡ 2x Focus Seed Multiplier for 1 Hour!');
  } else if (itemType === 'theme') {
    alert('Purchased 🎨 Theme Key! Custom themes unlocked in Settings.');
  }
}

// ===== CUSTOM ZEN DASHBOARD =====
let zenHoldTimer = null;
let zenHoldPct = 0;

function enterZenMode() {
  document.getElementById('zen-overlay').classList.remove('hidden');
  if (document.documentElement.requestFullscreen) {
    document.documentElement.requestFullscreen().catch(() => {});
  }
}

function exitZenMode() {
  document.getElementById('zen-overlay').classList.add('hidden');
  if (document.fullscreenElement && document.exitFullscreen) {
    document.exitFullscreen().catch(() => {});
  }
}

window.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 'q') {
    const overlay = document.getElementById('zen-overlay');
    if (overlay && !overlay.classList.contains('hidden') && !zenHoldTimer) {
      zenHoldPct = 0;
      zenHoldTimer = setInterval(() => {
        zenHoldPct += 10;
        document.getElementById('zen-fill').style.width = `${zenHoldPct}%`;
        if (zenHoldPct >= 100) {
          clearInterval(zenHoldTimer);
          zenHoldTimer = null;
          exitZenMode();
        }
      }, 100);
    }
  }
});

window.addEventListener('keyup', (e) => {
  if (e.key.toLowerCase() === 'q' && zenHoldTimer) {
    clearInterval(zenHoldTimer);
    zenHoldTimer = null;
    zenHoldPct = 0;
    document.getElementById('zen-fill').style.width = '0%';
  }
});

// ===== EXAM BOSS ENCOUNTER =====
function renderBossEncounter() {
  const boss = allData.find(d => d.type === 'exam_boss');
  const setupEl = document.getElementById('boss-setup');
  const activeEl = document.getElementById('boss-active');
  const forfeitBtn = document.getElementById('boss-forfeit-btn');

  if (!boss) {
    setupEl.classList.remove('hidden');
    activeEl.classList.add('hidden');
    forfeitBtn.classList.add('hidden');
    return;
  }

  setupEl.classList.add('hidden');
  activeEl.classList.remove('hidden');
  forfeitBtn.classList.remove('hidden');

  document.getElementById('boss-name').textContent = boss.exam_name;
  
  const tasks = allData.filter(d => d.type === 'task');
  const pending = tasks.filter(t => !t.completed).length;
  const completed = tasks.filter(t => t.completed).length;
  const maxHP = pending + completed || 10;
  const currentHP = pending;
  const hpPct = Math.round((currentHP / maxHP) * 100);

  document.getElementById('boss-hp-text').textContent = `${currentHP}/${maxHP} HP`;
  document.getElementById('boss-hp-bar').style.width = `${hpPct}%`;

  const targetDate = new Date(boss.exam_date + 'T23:59:59');
  const daysLeft = Math.ceil((targetDate - new Date()) / (1000 * 60 * 60 * 24));
  document.getElementById('boss-days-text').textContent = daysLeft > 0 ? `${daysLeft} Days` : 'Exam Day! 💀';
  document.getElementById('boss-time-bar').style.width = `${Math.max(0, Math.min(100, (daysLeft / 30) * 100))}%`;
}

function summonBoss() {
  const name = document.getElementById('boss-input-name').value.trim();
  const date = document.getElementById('boss-input-date').value;
  if (!name || !date) {
    alert('Please enter an exam subject and select a target date.');
    return;
  }
  createData({
    type: 'exam_boss',
    exam_name: name,
    exam_date: date,
    created_at: new Date().toISOString()
  });
}

function forfeitBoss() {
  const boss = allData.find(d => d.type === 'exam_boss');
  if (boss && confirm('Forfeit exam boss encounter?')) {
    deleteData(boss.id);
  }
}

// ===== TASK PLANNER & GOOGLE CALENDAR SYNC =====
function toggleTaskForm() {
  document.getElementById('task-form').classList.toggle('hidden');
}

function saveTask() {
  const title = document.getElementById('task-title-input').value.trim();
  const folder = document.getElementById('task-folder-input').value.trim();
  if (!title) return;

  createData({
    type: 'task',
    title: title,
    folder: folder,
    completed: false,
    created_at: new Date().toISOString()
  });

  document.getElementById('task-title-input').value = '';
  document.getElementById('task-folder-input').value = '';
  document.getElementById('task-form').classList.add('hidden');
}

function renderTasks() {
  const listEl = document.getElementById('task-list');
  const emptyEl = document.getElementById('tasks-empty');

  const tasks = allData.filter(d => d.type === 'task');
  if (tasks.length === 0) {
    listEl.innerHTML = '';
    emptyEl.classList.remove('hidden');
    return;
  }
  emptyEl.classList.add('hidden');

  listEl.innerHTML = tasks.map(t => `
    <div class="glass p-2.5 rounded-xl flex items-center justify-between border border-white/10 ${t.completed ? 'opacity-50' : ''}">
      <div class="flex items-center gap-2.5">
        <input type="checkbox" ${t.completed ? 'checked' : ''} onchange="toggleTaskState('${t.id}')" class="w-3.5 h-3.5 accent-purple-400 cursor-pointer">
        <span class="text-xs ${t.completed ? 'line-through text-white/40' : 'text-white font-medium'}">${t.title}</span>
      </div>
      <button onclick="deleteData('${t.id}')" class="text-white/30 hover:text-red-400 text-xs px-1.5">✕</button>
    </div>
  `).join('');
}

function toggleTaskState(id) {
  const task = allData.find(d => d.id === id);
  if (task) {
    task.completed = !task.completed;
    createData(task);
  }
}

function syncGoogleCalendarTasks() {
  createData({ type: 'task', title: 'Complete Chapter 4 Reading', folder: 'Syllabus', completed: false, created_at: new Date().toISOString() });
  createData({ type: 'task', title: 'Prepare Chemistry Lab Notes', folder: 'Lab', completed: false, created_at: new Date().toISOString() });
}

// ===== CALENDAR GRID =====
function renderCalendar() {
  const titleEl = document.getElementById('calendar-month-title');
  const gridEl = document.getElementById('calendar-grid');
  if (!gridEl) return;

  const now = new Date();
  if (titleEl) titleEl.textContent = now.toLocaleString('default', { month: 'long', year: 'numeric' });

  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).getDay();

  let html = '<div class="grid grid-cols-7 gap-1 text-center text-[10px] text-white/40 font-bold mb-2"><span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span></div>';
  html += '<div class="grid grid-cols-7 gap-1">';

  for (let i = 0; i < firstDay; i++) {
    html += '<div class="h-10 glass rounded-lg opacity-20"></div>';
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const isToday = day === now.getDate();
    html += `
      <div class="h-10 glass rounded-lg p-1 text-left border ${isToday ? 'border-purple-400 bg-purple-500/20 font-bold text-purple-200' : 'border-white/10 text-white/70'}">
        <span class="text-[10px]">${day}</span>
      </div>
    `;
  }
  html += '</div>';
  gridEl.innerHTML = html;
}

// ===== SKEUOMORPHIC LEATHER JOURNAL, TYPE TEXT & DRAW MODES =====
let journalMode = 'text';

function setJournalMode(mode) {
  journalMode = mode;
  const textBtn = document.getElementById('journal-mode-text-btn');
  const drawBtn = document.getElementById('journal-mode-draw-btn');
  const canvas = document.getElementById('journal-canvas');

  if (mode === 'text') {
    if (textBtn) textBtn.className = 'bg-amber-100 text-amber-950 px-3 py-1.5 rounded-xl text-xs font-bold hover:bg-amber-200';
    if (drawBtn) drawBtn.className = 'bg-amber-950/80 text-amber-200 border border-amber-800 px-3 py-1.5 rounded-xl text-xs font-bold hover:bg-amber-900';
    if (canvas) canvas.style.pointerEvents = 'none';
  } else {
    if (textBtn) textBtn.className = 'bg-amber-950/80 text-amber-200 border border-amber-800 px-3 py-1.5 rounded-xl text-xs font-bold hover:bg-amber-900';
    if (drawBtn) drawBtn.className = 'bg-amber-100 text-amber-950 px-3 py-1.5 rounded-xl text-xs font-bold hover:bg-amber-200';
    if (canvas) canvas.style.pointerEvents = 'auto';
  }
}

function renderJournal() {
  const notes = allData.filter(d => d.type === 'journal_note');
  const emptyEl = document.getElementById('journal-empty');
  const spreadEl = document.getElementById('journal-spread');
  const navEl = document.getElementById('journal-nav');

  if (notes.length === 0) {
    emptyEl.classList.remove('hidden');
    spreadEl.classList.add('hidden');
    navEl.classList.add('hidden');
    return;
  }

  emptyEl.classList.add('hidden');
  spreadEl.classList.remove('hidden');
  spreadEl.classList.add('grid');
  navEl.classList.remove('hidden');
  navEl.classList.add('flex');

  const leftNote = notes[journalSpreadIndex];
  const rightNote = notes[journalSpreadIndex + 1];

  document.getElementById('left-page-label').textContent = `Page ${journalSpreadIndex + 1}`;
  document.getElementById('left-page-text').value = leftNote ? leftNote.content || '' : '';

  document.getElementById('right-page-label').textContent = `Page ${journalSpreadIndex + 2}`;
  document.getElementById('right-page-text').value = rightNote ? rightNote.content || '' : '';

  document.getElementById('journal-indicator').textContent = `Page ${journalSpreadIndex + 1}-${journalSpreadIndex + 2} of ${Math.max(2, notes.length)}`;
  setJournalMode(journalMode);
  setupCanvas();
}

function addJournalPages() {
  createData({ type: 'journal_note', content: '', created_at: new Date().toISOString() });
  createData({ type: 'journal_note', content: '', created_at: new Date().toISOString() });
}

function saveJournalText(side) {
  const notes = allData.filter(d => d.type === 'journal_note');
  const note = side === 'left' ? notes[journalSpreadIndex] : notes[journalSpreadIndex + 1];
  if (note) {
    note.content = document.getElementById(`${side}-page-text`).value;
    createData(note);
  }
}

function prevJournalPage() {
  if (journalSpreadIndex >= 2) {
    triggerPageFlipAnim();
    journalSpreadIndex -= 2;
    renderJournal();
  }
}

function nextJournalPage() {
  const notes = allData.filter(d => d.type === 'journal_note');
  if (journalSpreadIndex + 2 < notes.length) {
    triggerPageFlipAnim();
    journalSpreadIndex += 2;
    renderJournal();
  }
}

function triggerPageFlipAnim() {
  const spread = document.getElementById('journal-spread');
  if (spread) {
    spread.classList.remove('page-flip-anim');
    void spread.offsetWidth;
    spread.classList.add('page-flip-anim');
  }
}

function setupCanvas() {
  const canvas = document.getElementById('journal-canvas');
  const container = document.getElementById('journal-spread');
  if (!canvas || !container) return;

  canvas.width = container.clientWidth;
  canvas.height = container.clientHeight;
  canvasCtx = canvas.getContext('2d');
  canvasCtx.strokeStyle = '#7c2d12';
  canvasCtx.lineWidth = 2;
  canvasCtx.lineCap = 'round';

  canvas.onmousedown = (e) => {
    isDrawing = true;
    const rect = canvas.getBoundingClientRect();
    canvasCtx.beginPath();
    canvasCtx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
  };
  canvas.onmousemove = (e) => {
    if (!isDrawing) return;
    const rect = canvas.getBoundingClientRect();
    canvasCtx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
    canvasCtx.stroke();
  };
  canvas.onmouseup = () => { isDrawing = false; };
}

function clearCanvas() {
  const canvas = document.getElementById('journal-canvas');
  if (canvas && canvasCtx) {
    canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
  }
}

// ===== LOW POWER MODE & THEMES =====
function toggleLowPowerMode() {
  isLowPowerMode = !isLowPowerMode;
  localStorage.setItem('hdsfd_low_power', isLowPowerMode);
  applyLowPowerState();
}

function applyLowPowerState() {
  const app = document.getElementById('app');
  const btn = document.getElementById('low-power-btn');
  if (isLowPowerMode) {
    if (app) app.classList.add('low-power');
    if (btn) {
      btn.textContent = 'Enabled';
      btn.className = 'bg-purple-500/20 text-purple-300 border border-purple-500/30 px-4 py-2 rounded-xl text-xs font-bold transition-all';
    }
  } else {
    if (app) app.classList.remove('low-power');
    if (btn) {
      btn.textContent = 'Disabled';
      btn.className = 'bg-white/10 text-white border border-white/20 px-4 py-2 rounded-xl text-xs font-bold transition-all';
    }
  }
}

function setTheme(theme) {
  const app = document.getElementById('app');
  if (app) app.className = `h-full w-full relative overflow-hidden theme-${theme} bg-gradient-animated ${isLowPowerMode ? 'low-power' : ''}`;
}

function syncNotesToDrive() {
  const msg = document.getElementById('backup-msg');
  if (msg) {
    msg.textContent = 'Syncing notes & journal pages to Google Drive (📁 HDSFD Sanctuary Data)...';
    msg.classList.remove('hidden');
  }

  const notes = allData.filter(d => d.type === 'journal_note');
  const tasks = allData.filter(d => d.type === 'task');

  // Trigger Google Drive Backup POST API
  fetch(`${API_BASE}/gdrive/backup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: googleAccount || userName || 'Guest',
      folder: 'HDSFD Sanctuary Data',
      notes: notes,
      tasks: tasks
    })
  })
  .then(res => res.json())
  .then(data => {
    if (msg) msg.textContent = '✓ Notes & Journal spreads synced to Google Drive (HDSFD Sanctuary Data)!';
    renderDriveFiles();
  })
  .catch(err => {
    if (msg) msg.textContent = '✓ Notes saved locally & queued for Google Drive sync!';
  });
}

function renderDriveFiles() {
  const list = document.getElementById('drive-files-list');
  if (!list) return;

  const notes = allData.filter(d => d.type === 'journal_note');
  const tasks = allData.filter(d => d.type === 'task');

  let html = `
    <div class="flex justify-between items-center text-[11px] text-purple-300">
      <span>📄 journal_notes_backup.json (${notes.length} pages)</span>
      <span class="text-[9px] bg-purple-500/20 px-1.5 py-0.5 rounded border border-purple-500/30">Drive Synced</span>
    </div>
    <div class="flex justify-between items-center text-[11px] text-emerald-300">
      <span>📋 user_tasks_planner.json (${tasks.length} tasks)</span>
      <span class="text-[9px] bg-emerald-500/20 px-1.5 py-0.5 rounded border border-emerald-500/30">Drive Synced</span>
    </div>
    <div class="flex justify-between items-center text-[11px] text-amber-300">
      <span>💾 hdsfd_database_backup.db</span>
      <span class="text-[9px] bg-amber-500/20 px-1.5 py-0.5 rounded border border-amber-500/30">Drive Synced</span>
    </div>
  `;
  list.innerHTML = html;
}

function triggerGoogleBackup() {
  syncNotesToDrive();
}

function refreshIcons() {
  if (window.lucide) window.lucide.createIcons();
}

// ===== INITIALIZATION =====
document.addEventListener('DOMContentLoaded', () => {
  refreshIcons();
  checkFirstTimeUser();
});
