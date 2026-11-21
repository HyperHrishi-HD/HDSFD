// ================= HD SFD V2 LIGHTWEIGHT & OPTIMIZED APP LOGIC =================

let userName = localStorage.getItem('hdsfd_user_name') || null;
let googleAccount = localStorage.getItem('hdsfd_google_account') || null;
let googleAccountName = localStorage.getItem('hdsfd_google_name') || null;
let activeTab = 'focus';
let allData = [];
let isLowPowerMode = localStorage.getItem('hdsfd_low_power') === 'true';

// Applies the saved low-power preference. (Previously called but never defined,
// which threw during startup and aborted the rest of the init sequence.)
function applyLowPowerState() {
  const root = document.documentElement;
  root.classList.toggle('low-power-mode', !!isLowPowerMode);
  root.classList.toggle('reduce-motion', !!isLowPowerMode);
}

// Audio Synthesizer State
let isPlayingSoundscape = false;
let audioContext = null;
let noiseNode = null;
let noiseGainNode = null;
let isYouTubeDrawerOpen = false;

// YouTube Player State
let ytPlayer = null;
let isYTPlayerReady = false;
let isYTPlaying = false;
let ytCurrentVideoId = null;
let ytCurrentPlaylistId = null;
let ytSavedTime = 0;
let ytProgressInterval = null;
let ytSongHistory = JSON.parse(localStorage.getItem('hdsfd_yt_history') || '[]');

// Pomodoro Timer State
let pomoDurationSeconds = 25 * 60;
let pomoRemainingSeconds = 25 * 60;
let pomoTimerId = null;

// Selected Post-It Color
let selectedPostItColor = 'yellow';
let googleTaskLists = [];
let activeGTaskListFilter = 'all';

// Calendar State
let calViewingDate = new Date();
let selectedDayModalDateStr = null;
let calDaySelectedFolder = 'My Tasks';
let calDaySelectedType = 'task';

// Custom Date & Time Picker State
let pickerTargetField = null; // 'due', 'deadline', 'repeat-start', 'repeat-end', 'repeat'
let pickerViewingDate = new Date();
let pickerSelectedDateStr = null;
let pickerSelectedTimeStr = '';

// Custom Repeat Configuration State (Default: null / No Repeat)
let currentRepeatConfig = null;

// Selected Folder for New Task
let selectedNewTaskFolder = 'My Tasks';

// Pending Drive Attachment for New Task
let pendingNewTaskAttachment = null;
let attachTargetTaskId = null;

// Subtask Expand/Collapse State per Task ID
let expandedSubtasksMap = {};
let tempSubtasksList = [];

// Active Floating Menu ID
let activeFloatingMenuTaskId = null;

const API_BASE = '/api';

// ===== CURATED BRAINYQUOTE TOP QUOTES (HOURLY ROTATION) =====
const BRAINY_QUOTES = [
  { text: "The only way to do great work is to love what you do.", author: "Steve Jobs" },
  { text: "It does not matter how slowly you go as long as you do not stop.", author: "Confucius" },
  { text: "Life is what happens when you're busy making other plans.", author: "John Lennon" },
  { text: "The future belongs to those who believe in the beauty of their dreams.", author: "Eleanor Roosevelt" },
  { text: "In the middle of every difficulty lies opportunity.", author: "Albert Einstein" },
  { text: "Believe you can and you're halfway there.", author: "Theodore Roosevelt" },
  { text: "You miss 100% of the shots you don't take.", author: "Wayne Gretzky" },
  { text: "Success is not final, failure is not fatal: it is the courage to continue that counts.", author: "Winston Churchill" },
  { text: "Act as if what you do makes a difference. It does.", author: "William James" },
  { text: "What you get by achieving your goals is not as important as what you become by achieving your goals.", author: "Zig Ziglar" },
  { text: "Happiness is not something readymade. It comes from your own actions.", author: "Dalai Lama" },
  { text: "We are what we repeatedly do. Excellence, then, is not an act, but a habit.", author: "Aristotle" },
  { text: "Do what you can, with what you have, where you are.", author: "Theodore Roosevelt" },
  { text: "It always seems impossible until it is done.", author: "Nelson Mandela" },
  { text: "The secret of getting ahead is getting started.", author: "Mark Twain" },
  { text: "Quality is not an act, it is a habit.", author: "Aristotle" },
  { text: "Keep your eyes on the stars, and your feet on the ground.", author: "Theodore Roosevelt" },
  { text: "Strive not to be a success, but rather to be of value.", author: "Albert Einstein" },
  { text: "You must be the change you wish to see in the world.", author: "Mahatma Gandhi" },
  { text: "There are no shortcuts to any place worth going.", author: "Beverly Sills" }
];

function updateHourlyQuote() {
  const quoteEl = document.getElementById('hourly-quote-text');
  if (!quoteEl) return;

  const custom = localStorage.getItem('hdsfd_custom_quote');
  if (custom && custom.trim().length > 0) {
    quoteEl.textContent = `"${custom.trim()}"`;
    return;
  }

  const hourIndex = Math.floor(Date.now() / (1000 * 60 * 60)) % BRAINY_QUOTES.length;
  const q = BRAINY_QUOTES[hourIndex];
  quoteEl.textContent = `"${q.text}" — ${q.author}`;
}

function toggleQuoteEditMode(isEditing) {
  const displayWrap = document.getElementById('quote-display-wrap');
  const editWrap = document.getElementById('quote-edit-wrap');
  const input = document.getElementById('quote-custom-input');

  if (isEditing) {
    if (displayWrap) displayWrap.classList.add('hidden');
    if (editWrap) editWrap.classList.remove('hidden');
    if (input) {
      input.value = localStorage.getItem('hdsfd_custom_quote') || '';
      input.focus();
    }
  } else {
    if (displayWrap) displayWrap.classList.remove('hidden');
    if (editWrap) editWrap.classList.add('hidden');
  }
}

function saveCustomQuote() {
  const input = document.getElementById('quote-custom-input');
  const val = input ? input.value.trim() : '';

  if (val.length > 0) {
    localStorage.setItem('hdsfd_custom_quote', val);
  } else {
    localStorage.removeItem('hdsfd_custom_quote');
  }
  toggleQuoteEditMode(false);
  updateHourlyQuote();
}

function cancelQuoteEdit() {
  toggleQuoteEditMode(false);
}

// ===== DATA STORAGE SDK WITH PERSISTENCE =====
async function fetchData() {
  const currentOwner = currentOwnerKey();
  if (!hdsfdSessionUser()) {
    const cachedLocal = localStorage.getItem(`hdsfd_data_${currentOwner}`);
    allData = cachedLocal ? JSON.parse(cachedLocal) : [];
    return allData;
  }
  try {
    const res = await fetch(`${API_BASE}/items?username=${encodeURIComponent(currentOwner)}`, { headers: hdsfdAuthHeaders() });
    if (res.status === 401) {
      await hdsfdLogout();
      return allData;
    }
    if (res.ok) {
      const serverData = await res.json();
      if (Array.isArray(serverData) && serverData.length > 0) {
        const local = localStorage.getItem(`hdsfd_data_${currentOwner}`);
        const localItems = local ? JSON.parse(local) : [];
        allData = serverData.map(s => {
          const matchedLocal = localItems.find(l => l.id === s.id || l.title === s.title);
          return {
            ...s,
            completed: matchedLocal !== undefined && matchedLocal.completed !== undefined ? matchedLocal.completed : !!s.completed,
            is_important: matchedLocal ? !!matchedLocal.is_important : !!s.is_important,
            subtasks: matchedLocal && matchedLocal.subtasks ? matchedLocal.subtasks : (s.subtasks || []),
            attachments: matchedLocal && matchedLocal.attachments ? matchedLocal.attachments : (s.attachments || []),
            repeat_config: matchedLocal && matchedLocal.repeat_config ? matchedLocal.repeat_config : (s.repeat_config || null)
          };
        });
        localStorage.setItem(`hdsfd_data_${currentOwner}`, JSON.stringify(allData));
        return allData;
      }
    }
  } catch (e) {
    console.warn('Backend API offline, using local storage:', e);
  }
  const local = localStorage.getItem(`hdsfd_data_${currentOwner}`);
  allData = local ? JSON.parse(local) : [];
  return allData;
}

async function createData(item) {
  const currentOwner = currentOwnerKey();
  item.username = currentOwner;
  item.id = item.id || 'item_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);

  if (hdsfdSessionUser()) {
    try {
      await fetch(`${API_BASE}/items`, {
        method: 'POST',
        headers: hdsfdAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(item)
      });
    } catch (e) {
      console.warn('API save warning:', e);
    }
  }

  const idx = allData.findIndex(d => d.id === item.id);
  if (idx >= 0) allData[idx] = item;
  else allData.push(item);
  localStorage.setItem(`hdsfd_data_${currentOwner}`, JSON.stringify(allData));
  renderCurrentTab();
  return item;
}

async function deleteData(id) {
  const currentOwner = currentOwnerKey();
  const googleOwner = googleAccount || userName || 'Guest';
  const targetItem = allData.find(d => d.id === id);

  if (targetItem && targetItem.type === 'task' && !id.startsWith('task_') && !id.startsWith('item_')) {
    fetch(`${API_BASE}/google/tasks/${encodeURIComponent(id)}?username=${encodeURIComponent(googleOwner)}&tasklist_id=${encodeURIComponent(targetItem.tasklist_id || '@default')}`, {
      method: 'DELETE'
    }).catch(err => console.warn('Google Task delete failed:', err));
  }

  if (hdsfdSessionUser()) {
    try {
      await fetch(`${API_BASE}/items`, {
        method: 'DELETE',
        headers: hdsfdAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ id: id, username: currentOwner })
      });
    } catch (e) {
      console.warn('API delete warning:', e);
    }
  }
  allData = allData.filter(d => d.id !== id);
  localStorage.setItem(`hdsfd_data_${currentOwner}`, JSON.stringify(allData));
  renderCurrentTab();
}

function triggerGoogleBackup() {
  const owner = googleAccount || userName || 'Guest';
  const notes = allData.filter(d => d.type === 'note');
  const tasks = allData.filter(d => d.type === 'task');
  const schedules = allData.filter(d => d.type === 'schedule_entry');
  const exams = allData.filter(d => d.type === 'exam_entry');
  
  const focusMins = allData
    .filter(d => d.type === 'focus_session')
    .reduce((sum, session) => sum + (session.minutes || 0), 0);

  const fullContext = {
    username: owner,
    google_account: googleAccount,
    timestamp: new Date().toISOString(),
    stats: {
      coins: typeof getUserCoinsBalance === 'function' ? getUserCoinsBalance() : 0,
      lifetime_xp: typeof getLifetimeCoins === 'function' ? getLifetimeCoins() : 0,
      focus_time_mins: focusMins,
      tasks_completed: tasks.filter(t => t.completed).length,
      streak_days: parseInt(localStorage.getItem('hdsfd_streak_days') || '1', 10)
    },
    notes: notes,
    tasks: tasks,
    schedules: schedules,
    exams: exams,
    gemini_chat_history: geminiChatHistory,
    app_info: 'HDSFD (HD Student Focus Dashboard) — Student Focus Sanctuary & Intelligent Workspace'
  };

  const msgEl = document.getElementById('backup-msg');
  if (msgEl) {
    msgEl.classList.remove('hidden');
    msgEl.textContent = 'Saving backup to Google Drive (HDSFD Backup)...';
  }

  fetch(`${API_BASE}/gdrive/backup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: owner,
      notes: notes,
      full_context: fullContext
    })
  })
  .then(res => res.json())
  .then(res => {
    if (msgEl) {
      msgEl.textContent = res.drive_synced ? 'Backup saved to Google Drive (Notes.json, data.db, ai.json).' : 'Saved locally.';
      setTimeout(() => msgEl.classList.add('hidden'), 4000);
    }
  })
  .catch(() => {
    if (msgEl) {
      msgEl.textContent = 'Backup error occurred.';
      setTimeout(() => msgEl.classList.add('hidden'), 3000);
    }
  });
}

// ===== FIRST TIME USER & LIVE GOOGLE AUTH DETECTION =====
async function checkGoogleStatus() {
  const savedAccount = localStorage.getItem('hdsfd_google_account');
  if (!savedAccount || !savedAccount.includes('@')) {
    googleAccount = null;
    googleAccountName = null;
    return;
  }
  googleAccount = savedAccount;
  googleAccountName = localStorage.getItem('hdsfd_google_name') || null;
  try {
    const res = await fetch(`${API_BASE}/google/status?username=${encodeURIComponent(savedAccount)}`);
    if (res.ok) {
      const data = await res.json();
      if (data.connected && data.email) {
        googleAccount = data.email;
        localStorage.setItem('hdsfd_google_account', data.email);
        if (data.name && !data.name.includes('PRIZW') && data.name !== 'User') {
          googleAccountName = data.name;
          localStorage.setItem('hdsfd_google_name', data.name);
        }
      }
    }
  } catch (e) {
    console.warn('Google status check warning:', e);
  }
}

async function checkFirstTimeUser() {
  const urlParams = new URLSearchParams(window.location.search);
  const gAccount = urlParams.get('google_account');
  const gName = urlParams.get('name');
  if (gAccount && gAccount.includes('@')) {
    googleAccount = gAccount;
    localStorage.setItem('hdsfd_google_account', gAccount);
    if (gName && !gName.includes('PRIZW') && gName !== 'User') {
      googleAccountName = gName;
      localStorage.setItem('hdsfd_google_name', gName);
    }
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  // Always initialize session immediately so UI, clock, and local data are active with zero blocking
  initializeUserSession();

  // Then check live Google OAuth status in background if account is saved
  await checkGoogleStatus();
  initializeUserSession();
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
  
  // Custom display name saved by user takes first priority; then account profile name, then formatted email prefix, NOT raw email or random tokens!
  let customSavedName = localStorage.getItem('hdsfd_user_name');
  if (customSavedName && (customSavedName.includes('PRIZW') || (customSavedName.length > 20 && !customSavedName.includes(' ')))) {
    customSavedName = null;
    localStorage.removeItem('hdsfd_user_name');
  }

  let displayName = customSavedName;
  if (!displayName) {
    if (googleAccountName && !googleAccountName.includes('PRIZW') && googleAccountName !== 'User') {
      displayName = googleAccountName;
    } else if (googleAccount && googleAccount.includes('@')) {
      const prefix = googleAccount.split('@')[0];
      displayName = prefix.replace(/[._-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    } else {
      displayName = (userName && !userName.includes('PRIZW') && userName !== 'User') ? userName : 'User';
    }
  }
  
  userName = displayName;
  
  const hasCrown = localStorage.getItem('hdsfd_has_crown') === 'true';
  if (nameDisplay) nameDisplay.textContent = displayName;
  if (settingsInput && !settingsInput.matches(':focus')) settingsInput.value = displayName;

  const activeName = googleAccount || userName || 'Guest';

  const badgeText = document.getElementById('google-badge-text');
  const badge = document.getElementById('google-status-badge');
  const gdriveSettingsBadge = document.getElementById('settings-gdrive-badge');
  const geminiUserBadge = document.getElementById('gemini-user-email-text');

  if (googleAccount) {
    const userLabel = googleAccountName || displayName || googleAccount;
    if (badgeText) {
      badgeText.innerHTML = `<span class="hidden sm:inline">Google: ${escapeHtml(userLabel)}</span><span class="sm:hidden">Connected</span>`;
    }
    if (badge) {
      badge.className = 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 sm:px-3 py-0.5 sm:py-1 rounded-full flex items-center gap-1 sm:gap-1.5 text-[10px] sm:text-xs font-bold transition-all shadow-sm';
      badge.title = `Google Connected: ${googleAccount} (${userLabel})`;
    }
    if (gdriveSettingsBadge) {
      gdriveSettingsBadge.textContent = `Connected (${userLabel})`;
      gdriveSettingsBadge.title = googleAccount;
      gdriveSettingsBadge.className = 'text-[9px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded font-bold';
    }
    if (geminiUserBadge) {
      geminiUserBadge.textContent = userLabel;
      geminiUserBadge.title = `Connected: ${googleAccount}`;
    }
    const pairBtn = document.getElementById('btn-pair-gdrive');
    const disconnectBtn = document.getElementById('btn-disconnect-gdrive');
    if (pairBtn) pairBtn.classList.add('hidden');
    if (disconnectBtn) disconnectBtn.classList.remove('hidden');
  } else {
    if (badgeText) badgeText.innerHTML = '<span class="hidden sm:inline">Guest Mode (Pair Google)</span><span class="sm:hidden">Pair</span>';
    if (badge) {
      badge.className = 'bg-amber-500/20 text-amber-200 border border-amber-500/30 px-2 sm:px-3 py-0.5 sm:py-1 rounded-full flex items-center gap-1 sm:gap-1.5 text-[10px] sm:text-xs font-bold transition-all';
      badge.title = 'Guest Mode: Click to connect Google account';
    }
    if (gdriveSettingsBadge) {
      gdriveSettingsBadge.textContent = 'Guest Mode (Not Linked)';
      gdriveSettingsBadge.className = 'text-[9px] bg-amber-500/20 text-amber-200 border border-amber-500/30 px-2 py-0.5 rounded font-bold';
    }
    if (geminiUserBadge) {
      geminiUserBadge.textContent = 'Guest (Offline)';
      geminiUserBadge.title = 'Guest Mode';
    }
    const pairBtn = document.getElementById('btn-pair-gdrive');
    const disconnectBtn = document.getElementById('btn-disconnect-gdrive');
    if (pairBtn) pairBtn.classList.remove('hidden');
    if (disconnectBtn) disconnectBtn.classList.add('hidden');
  }

  // Synchronous zero-latency render from localStorage first
  const localCache = localStorage.getItem(`hdsfd_data_${activeName}`);
  if (localCache) {
    try {
      allData = JSON.parse(localCache);
      renderCurrentTab();
    } catch(e) {}
  }

  updateHourlyQuote();
  applyLowPowerState();
  startClockWithSeconds();
  renderYTHistory();
  initZenAssistiveTouch();
  initSplitResizer();
  fetchData().then(() => {
    autoSyncGoogleTasksAndCalendar();
    renderCurrentTab();
    renderSanctuaryTree();
  }).catch(err => console.warn('Fetch data init warning:', err));

  loadUserStatsFromServer();
}

function loadUserStatsFromServer() {
  if (!hdsfdSessionUser()) return;
  const statsUser = currentOwnerKey();
  fetch(`${API_BASE}/user/stats?username=${encodeURIComponent(statsUser)}`, { headers: hdsfdAuthHeaders() })
    .then(r => (r.status === 401 ? null : r.json()))
    .then(stats => {
      if (stats && stats.status === 'success') {
        // Restore bonus XP from server — take max of local and server so coins never go backwards
        if (typeof stats.lifetime_xp === 'number' && stats.lifetime_xp > 0) {
          const localBonusXP = parseInt(localStorage.getItem('hdsfd_lifetime_bonus_xp') || '0', 10);
          if (stats.lifetime_xp > localBonusXP) {
            localStorage.setItem('hdsfd_lifetime_bonus_xp', stats.lifetime_xp.toString());
          }
          localStorage.setItem(`hdsfd_lifetime_coins_${statsUser}`, stats.lifetime_xp.toString());
        }
        // Restore spent coins from server
        if (typeof stats.coins === 'number') {
          const localLifetime = getLifetimeCoins();
          const serverSpent = Math.max(0, localLifetime - stats.coins);
          const localSpent = parseInt(localStorage.getItem('hdsfd_spent_coins') || '0', 10);
          if (serverSpent < localSpent) {
            // Server has fewer spent — trust local (it knows about recent purchases)
          } else if (serverSpent > localSpent) {
            localStorage.setItem('hdsfd_spent_coins', serverSpent.toString());
          }
          localStorage.setItem(`hdsfd_coins_${statsUser}`, stats.coins.toString());
        }
        if (Array.isArray(stats.upgrades)) {
          const localUpgrades = JSON.parse(localStorage.getItem('hdsfd_upgrades') || '[]');
          const merged = Array.from(new Set([...localUpgrades, ...stats.upgrades]));
          localStorage.setItem('hdsfd_upgrades', JSON.stringify(merged));

          if (stats.upgrades.includes('cosmic_claimed') && googleAccount) {
            localStorage.setItem('hdsfd_cosmic_claimed_' + googleAccount, 'true');
          }
          if (stats.upgrades.includes('crown_claimed')) {
            localStorage.setItem('hdsfd_has_crown', 'true');
          }
        }
          updateStatsOverview();
        updateShopCardsUI();
      }
    }).catch(() => {});
}

// ===== THROTTLED GLOBAL SYNC =====
let lastSyncTimestamp = 0;

function triggerGlobalSync(isManual = false) {
  const now = Date.now();
  const badgeText = document.getElementById('global-sync-text');
  const spinIcon = document.getElementById('sync-spin-icon');
  
  if (isManual && (now - lastSyncTimestamp < 5000)) {
    if (badgeText) badgeText.textContent = 'Cooldown (5s)';
    setTimeout(() => {
      if (badgeText) badgeText.textContent = 'Synced';
    }, 1500);
    return;
  }
  
  lastSyncTimestamp = now;
  if (spinIcon) spinIcon.classList.add('animate-spin');
  if (badgeText) badgeText.textContent = 'Syncing...';

  autoSyncGoogleTasksAndCalendar().then(() => {
    if (spinIcon) spinIcon.classList.remove('animate-spin');
    if (badgeText) badgeText.textContent = 'Synced';
    const nowStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const badge = document.getElementById('global-sync-badge');
    if (badge) badge.title = `Last synced at ${nowStr}. Click to sync now!`;
  }).catch(() => {
    if (spinIcon) spinIcon.classList.remove('animate-spin');
    if (badgeText) badgeText.textContent = 'Sync Error';
  });
}

setInterval(() => triggerGlobalSync(), 60 * 60 * 1000);

// ===== GOOGLE TASKS & CALENDAR SYNC =====
function autoSyncGoogleTasksAndCalendar() {
  const owner = googleAccount || userName || 'Guest';
  
  fetchGoogleTaskLists();

  const p1 = fetch(`${API_BASE}/google/tasks?username=${encodeURIComponent(owner)}`)
    .then(res => res.json())
    .then(googleTasks => {
      if (Array.isArray(googleTasks)) {
        googleTasks.forEach(gt => {
          const idx = allData.findIndex(d => d.type === 'task' && (d.id === gt.id || d.title === gt.title));
          if (idx >= 0) {
            allData[idx].id = gt.id;
            allData[idx].tasklist_id = gt.tasklist_id;
            allData[idx].due = gt.due || allData[idx].due;
            if (allData[idx].completed === undefined) {
              allData[idx].completed = !!gt.completed;
            }
            allData[idx].folder = gt.folder || allData[idx].folder;
            if (allData[idx].is_important === undefined) {
              allData[idx].is_important = false;
            }
          } else {
            allData.push({
              id: gt.id,
              tasklist_id: gt.tasklist_id,
              type: 'task',
              title: gt.title,
              folder: gt.folder || 'My Tasks',
              due: gt.due || '',
              completed: gt.completed || false,
              username: owner,
              is_important: false,
              subtasks: [],
              attachments: []
            });
          }
        });
        localStorage.setItem(`hdsfd_data_${owner}`, JSON.stringify(allData));
        renderDirectGTasks();
        renderHomeStarredTasks();
        renderDarkCalendarGrid();
        updateStatsOverview();
      }
    })
    .catch(err => console.warn('Google Tasks auto-sync warning:', err));

  const p2 = fetch(`${API_BASE}/google/calendar?username=${encodeURIComponent(owner)}`)
    .then(res => res.json())
    .then(events => {
      if (Array.isArray(events)) {
        window.googleCalendarEvents = events;
        renderDarkCalendarGrid();
      }
    })
    .catch(err => console.warn('Google Calendar auto-sync warning:', err));

  return Promise.all([p1, p2]);
}

function fetchGoogleTaskLists() {
  const owner = googleAccount || userName || 'Guest';
  fetch(`${API_BASE}/google/tasklists?username=${encodeURIComponent(owner)}`)
    .then(res => res.json())
    .then(lists => {
      if (Array.isArray(lists)) {
        googleTaskLists = lists;
        renderTaskListTabs();
        populateTaskFolderMenus();
      }
    })
    .catch(() => {});
}

function getAvailableFolders() {
  const folderSet = new Set(['My Tasks', 'HW SAT', 'Chemistry', 'General', 'Important']);
  googleTaskLists.forEach(tl => {
    if (tl.title) folderSet.add(tl.title);
  });
  allData.forEach(d => {
    if (d.type === 'task' && d.folder) folderSet.add(d.folder);
    if (d.type === 'schedule_entry' && d.title) folderSet.add(d.title);
  });
  return Array.from(folderSet);
}

// ===== CUSTOM GLASSMORPHIC FOLDER DROPDOWNS (ZERO DEFAULT SELECT) =====
function populateTaskFolderMenus() {
  const folders = getAvailableFolders();

  // 1. Task Creator Folder Menu
  const taskCreatorMenu = document.getElementById('gtask-folder-dropdown-menu');
  if (taskCreatorMenu) {
    taskCreatorMenu.innerHTML = folders.map(f => `
      <button type="button" onclick="selectTaskFolder('${f}')" class="w-full text-left px-2.5 py-1.5 rounded-xl hover:bg-purple-500/20 text-xs flex items-center justify-between transition-all ${selectedNewTaskFolder === f ? 'text-purple-300 font-bold bg-purple-500/10' : 'text-white/80'}">
        <span class="truncate flex items-center gap-1.5">${hdsfdIcon('folder')} ${f}</span>
        ${selectedNewTaskFolder === f ? `<span class="text-purple-300">${hdsfdIcon('check')}</span>` : ''}
      </button>
    `).join('');
  }

  // 2. Calendar Day Add Folder Menu
  const calDayMenu = document.getElementById('cal-day-folder-menu');
  if (calDayMenu) {
    calDayMenu.innerHTML = folders.map(f => `
      <button type="button" onclick="selectCalDayFolder('${f}')" class="w-full text-left px-2.5 py-1.5 rounded-xl hover:bg-purple-500/20 text-xs flex items-center justify-between transition-all ${calDaySelectedFolder === f ? 'text-purple-300 font-bold bg-purple-500/10' : 'text-white/80'}">
        <span class="truncate flex items-center gap-1.5">${hdsfdIcon('folder')} ${f}</span>
        ${calDaySelectedFolder === f ? `<span class="text-purple-300">${hdsfdIcon('check')}</span>` : ''}
      </button>
    `).join('');
  }
}

function toggleTaskFolderDropdown(e) {
  if (e) e.stopPropagation();
  const menu = document.getElementById('gtask-folder-dropdown-menu');
  if (!menu) return;
  populateTaskFolderMenus();
  menu.classList.toggle('hidden');
}

function selectTaskFolder(folderName) {
  selectedNewTaskFolder = folderName;
  const label = document.getElementById('gtask-folder-btn-label');
  if (label) label.textContent = folderName;
  const menu = document.getElementById('gtask-folder-dropdown-menu');
  if (menu) menu.classList.add('hidden');
}

function toggleCalDayFolderDropdown(e) {
  if (e) e.stopPropagation();
  const menu = document.getElementById('cal-day-folder-menu');
  if (!menu) return;
  populateTaskFolderMenus();
  menu.classList.toggle('hidden');
}

function selectCalDayFolder(folderName) {
  calDaySelectedFolder = folderName;
  const label = document.getElementById('cal-day-folder-label');
  if (label) label.textContent = folderName;
  const menu = document.getElementById('cal-day-folder-menu');
  if (menu) menu.classList.add('hidden');
}

function toggleCalDayTypeDropdown(e) {
  if (e) e.stopPropagation();
  const menu = document.getElementById('cal-day-type-menu');
  if (menu) menu.classList.toggle('hidden');
}

function selectCalDayType(type, labelText) {
  calDaySelectedType = type;
  const label = document.getElementById('cal-day-type-label');
  if (label) label.textContent = labelText;
  const menu = document.getElementById('cal-day-type-menu');
  if (menu) menu.classList.add('hidden');

  const folderWrap = document.getElementById('cal-day-folder-wrap');
  if (folderWrap) {
    if (type === 'event') folderWrap.classList.add('hidden');
    else folderWrap.classList.remove('hidden');
  }
}

// Close dropdowns on outside click
document.addEventListener('click', () => {
  const m1 = document.getElementById('gtask-folder-dropdown-menu');
  const m2 = document.getElementById('cal-day-folder-menu');
  const m3 = document.getElementById('cal-day-type-menu');
  if (m1) m1.classList.add('hidden');
  if (m2) m2.classList.add('hidden');
  if (m3) m3.classList.add('hidden');
});

function renderTaskListTabs() {
  const tabsContainer = document.getElementById('gtasks-list-tabs');
  if (!tabsContainer) return;

  let tabsHtml = `<button onclick="filterGTasksByList('all')" class="gtask-tab-btn ${activeGTaskListFilter === 'all' ? 'bg-purple-500/30 text-purple-200 border-purple-500/40 font-black' : 'bg-white/5 text-white/60 border-white/10 hover:bg-white/10'} border px-2.5 py-0.5 rounded-lg text-[10px] font-bold whitespace-nowrap">All Tasks</button>`;
  
  const folders = getAvailableFolders();

  folders.forEach(f => {
    const isActive = activeGTaskListFilter.toLowerCase() === f.toLowerCase();
    tabsHtml += `<button onclick="filterGTasksByList('${f}')" class="gtask-tab-btn ${isActive ? 'bg-purple-500/30 text-purple-200 border-purple-500/40 font-black' : 'bg-white/5 text-white/60 border-white/10 hover:bg-white/10'} border px-2.5 py-0.5 rounded-lg text-[10px] font-bold whitespace-nowrap">${f}</button>`;
  });
  tabsContainer.innerHTML = tabsHtml;
}

function filterGTasksByList(listKey) {
  activeGTaskListFilter = listKey;
  renderDirectGTasks();
}

// ===== ULTRA-GLASS TASKS VIEW =====
function renderDirectGTasks() {
  const container = document.getElementById('gtasks-live-list');
  renderTaskListTabs();
  populateTaskFolderMenus();
  if (!container) return;

  let tasks = allData.filter(d => d.type === 'task');

  if (activeGTaskListFilter !== 'all') {
    tasks = tasks.filter(t => {
      const folderLower = (t.folder || 'My Tasks').toLowerCase();
      const filterLower = activeGTaskListFilter.toLowerCase();
      return folderLower === filterLower || t.tasklist_id === activeGTaskListFilter;
    });
  }

  const openCountEl = document.getElementById('tasks-open-count');
  if (openCountEl) openCountEl.textContent = `${tasks.filter(t => !t.completed).length} open`;

  if (tasks.length === 0) {
    container.innerHTML = '<p class="text-white/40 text-xs italic text-center py-12">No tasks in this list. Add a task above!</p>';
    return;
  }

  const uncompleted = tasks.filter(t => !t.completed);
  const completed = tasks.filter(t => t.completed);

  function renderTaskCard(t, indexInPartition, partitionTotal, isCompletedGroup) {
    let dueFormatted = '';
    if (t.due) {
      const d = new Date(t.due);
      dueFormatted = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
      if (t.due_time) dueFormatted += ` ${t.due_time}`;
    }
    const deadlineFormatted = t.deadline ? new Date(t.deadline).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '';
    const isImp = !!t.is_important;
    const subtasks = t.subtasks || [];
    const attachments = t.attachments || [];
    const isSubtasksExpanded = expandedSubtasksMap[t.id] !== false;

    let repeatLabel = '';
    if (t.repeat_config && t.repeat_config.unit) {
      repeatLabel = `${hdsfdIcon('repeat')} Every ${t.repeat_config.interval || 1} ${t.repeat_config.unit}`;
      if (t.repeat_config.time) repeatLabel += ` (${t.repeat_config.time})`;
    } else if (t.repeat && t.repeat !== 'none') {
      repeatLabel = `${hdsfdIcon('repeat')} ${t.repeat}`;
    }

    return `
      <div class="glass task-card group p-2.5 rounded-xl border border-white/10 hover:border-purple-500/40 transition-all ${t.completed ? 'opacity-55' : ''} space-y-1.5" data-task-id="${t.id}">
        <div class="flex items-start justify-between gap-2">
          
          <!-- Reorder Up/Down Buttons (appear on hover to keep the row calm) -->
          <div class="flex flex-col gap-0.5 pt-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
            <button onclick="reorderTask('${t.id}', 'up')" class="w-4 h-4 rounded bg-white/5 hover:bg-white/20 text-white/50 hover:text-white flex items-center justify-center transition-colors ${indexInPartition === 0 ? 'opacity-30 pointer-events-none' : ''}" title="Move Up">${hdsfdIcon('arrow-up')}</button>
            <button onclick="reorderTask('${t.id}', 'down')" class="w-4 h-4 rounded bg-white/5 hover:bg-white/20 text-white/50 hover:text-white flex items-center justify-center transition-colors ${indexInPartition === partitionTotal - 1 ? 'opacity-30 pointer-events-none' : ''}" title="Move Down">${hdsfdIcon('arrow-down')}</button>
          </div>

          <div class="flex items-start gap-2.5 overflow-hidden flex-1">
            <input type="checkbox" ${t.completed ? 'checked' : ''} onchange="toggleTaskState('${t.id}')" class="w-4 h-4 mt-0.5 accent-purple-400 cursor-pointer flex-shrink-0">
            
            <div class="flex flex-col truncate flex-1 text-left">
              <span class="text-xs ${t.completed ? 'line-through text-white/40' : 'text-white font-semibold'} truncate">${t.title}</span>
              ${t.details ? `<p class="text-[10px] text-white/50 line-clamp-2 mt-0.5">${t.details}</p>` : ''}
              
              <!-- Badges: Folder, Due Date/Time, Deadline, Repeat -->
              <div class="flex flex-wrap items-center gap-1.5 mt-1.5">
                ${t.folder ? `<span class="task-badge bg-purple-500/15 text-purple-200 border-purple-500/25">${hdsfdIcon('folder')} ${t.folder}</span>` : ''}
                ${dueFormatted ? `<span class="task-badge bg-sky-500/15 text-sky-200 border-sky-500/25">${hdsfdIcon('calendar')} ${dueFormatted}</span>` : ''}
                ${deadlineFormatted ? `<span class="task-badge bg-amber-500/15 text-amber-200 border-amber-500/25">${hdsfdIcon('target')} ${deadlineFormatted}</span>` : ''}
                ${repeatLabel ? `<span class="task-badge bg-emerald-500/15 text-emerald-200 border-emerald-500/25">${repeatLabel}</span>` : ''}
              </div>

              <!-- Attachments Chips -->
              ${attachments.length > 0 ? `
                <div class="flex flex-wrap items-center gap-1.5 mt-1.5">
                  ${attachments.map(att => `
                    <a href="${att.url || '#'}" target="_blank" class="text-[9px] bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 border border-cyan-500/30 px-2 py-0.5 rounded-md font-bold flex items-center gap-1 transition-all">
                      ${hdsfdIcon('paperclip')} <span class="truncate max-w-[120px]">${att.name || 'Drive File'}</span> ${hdsfdIcon('arrow-up-right')}
                    </a>
                  `).join('')}
                </div>
              ` : ''}
            </div>
          </div>

          <!-- Star & 3-Dots Button -->
          <div class="flex items-center gap-1">
            <button onclick="toggleTaskImportance('${t.id}')" class="px-1 ${isImp ? 'text-amber-300' : 'text-white/25 hover:text-white/60'} transition-colors" title="Toggle Starred">
              ${hdsfdIcon('star')}
            </button>
            <button onclick="openTaskFloatingMenu('${t.id}', this, event)" class="text-white/40 hover:text-white text-xs px-1.5 py-0.5 rounded-lg font-bold hover:bg-white/10 transition-all" title="Options">⋮</button>
          </div>
        </div>

        <!-- Subtasks Expand / Collapse & Indented Scrollable Section -->
        ${subtasks.length > 0 ? `
          <div class="pt-1">
            <div class="flex items-center justify-between text-[10px] text-white/50 font-bold mb-1">
              <button onclick="toggleSubtasksExpanded('${t.id}')" class="flex items-center gap-1 hover:text-purple-300 transition-all">
                ${hdsfdIcon(isSubtasksExpanded ? 'chevron-down' : 'chevron-right')}
                <span>Subtasks (${subtasks.filter(s => s.completed).length}/${subtasks.length})</span>
              </button>
              <button onclick="promptAddSubtask('${t.id}')" class="text-[9px] text-purple-300 hover:text-purple-200">+ Add</button>
            </div>

            ${isSubtasksExpanded ? `
              <div class="ml-5 pl-3 border-l-2 border-purple-500/30 space-y-1.5 max-h-36 overflow-y-auto pr-1">
                ${subtasks.map((st, sIdx) => `
                  <div class="flex items-center justify-between gap-2 text-[11px] group">
                    <label class="flex items-center gap-2 overflow-hidden flex-1 cursor-pointer">
                      <input type="checkbox" ${st.completed ? 'checked' : ''} onchange="toggleSubtaskState('${t.id}', ${sIdx})" class="w-3 h-3 accent-purple-400 cursor-pointer flex-shrink-0">
                      <span class="${st.completed ? 'line-through text-white/30' : 'text-white/80'} truncate">${st.title}</span>
                    </label>
                    <button onclick="removeSubtask('${t.id}', ${sIdx})" class="opacity-0 group-hover:opacity-100 text-white/30 hover:text-red-400 px-1 transition-colors">${hdsfdIcon('x')}</button>
                  </div>
                `).join('')}
              </div>
            ` : ''}
          </div>
        ` : ''}
      </div>
    `;
  }

  let html = '';
  if (uncompleted.length > 0) {
    html += `
      <div class="task-section-label"><span>Open</span><span>${uncompleted.length}</span></div>
      ${uncompleted.map((t, idx) => renderTaskCard(t, idx, uncompleted.length, false)).join('')}
    `;
  }

  if (completed.length > 0) {
    html += `
      <div class="pt-2 border-t border-white/10 mt-2 space-y-2">
        <div class="task-section-label"><span>Completed</span><span>${completed.length}</span></div>
        ${completed.map((t, idx) => renderTaskCard(t, idx, completed.length, true)).join('')}
      </div>
    `;
  }

  container.innerHTML = html;
}

function toggleSubtasksExpanded(taskId) {
  expandedSubtasksMap[taskId] = !(expandedSubtasksMap[taskId] !== false);
  renderDirectGTasks();
}

function reorderTask(taskId, direction) {
  const currentOwner = googleAccount || userName || 'Guest';
  const idx = allData.findIndex(d => d.id === taskId);
  if (idx < 0) return;

  const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (targetIdx >= 0 && targetIdx < allData.length) {
    const temp = allData[idx];
    allData[idx] = allData[targetIdx];
    allData[targetIdx] = temp;
    localStorage.setItem(`hdsfd_data_${currentOwner}`, JSON.stringify(allData));
    renderDirectGTasks();
  }
}

// ===== TOP-LEVEL FLOATING 3-DOTS MENU =====
function openTaskFloatingMenu(taskId, buttonEl, e) {
  if (e) e.stopPropagation();
  const menu = document.getElementById('task-floating-menu');
  if (!menu) return;

  if (activeFloatingMenuTaskId === taskId && !menu.classList.contains('hidden')) {
    menu.classList.add('hidden');
    activeFloatingMenuTaskId = null;
    return;
  }

  activeFloatingMenuTaskId = taskId;
  const task = allData.find(d => d.id === taskId);
  if (!task) return;

  const rect = buttonEl.getBoundingClientRect();
  menu.style.top = `${Math.min(window.innerHeight - 300, rect.bottom + 4)}px`;
  menu.style.left = `${Math.max(10, rect.right - 210)}px`;

  const isImp = !!task.is_important;
  const folders = getAvailableFolders();

  menu.innerHTML = `
    <button onclick="toggleTaskImportance('${task.id}'); closeTaskFloatingMenu();" class="w-full text-left px-2.5 py-1.5 rounded-xl hover:bg-white/10 text-xs flex items-center gap-2 text-white/90">
      <span class="${isImp ? 'text-amber-300' : 'text-white/50'}">${hdsfdIcon('star')}</span> <span>${isImp ? 'Remove from Starred' : 'Add to Starred'}</span>
    </button>

    <button onclick="openCustomDateTimeModal('deadline', '${task.id}'); closeTaskFloatingMenu();" class="w-full text-left px-2.5 py-1.5 rounded-xl hover:bg-white/10 text-xs flex items-center gap-2 text-white/90">
      <span class="text-amber-300">${hdsfdIcon('target')}</span> <span>Add / Edit Deadline</span>
    </button>

    <button onclick="openGDriveAttachModal('${task.id}'); closeTaskFloatingMenu();" class="w-full text-left px-2.5 py-1.5 rounded-xl hover:bg-white/10 text-xs flex items-center gap-2 text-cyan-300 font-medium">
      <span class="text-cyan-300">${hdsfdIcon('paperclip')}</span> <span>Add Drive Attachment</span>
    </button>

    <button onclick="promptAddSubtask('${task.id}'); closeTaskFloatingMenu();" class="w-full text-left px-2.5 py-1.5 rounded-xl hover:bg-white/10 text-xs flex items-center gap-2 text-white/90">
      <span class="text-white/60">${hdsfdIcon('corner-down-right')}</span> <span>Add a Subtask</span>
    </button>

    <button onclick="deleteData('${task.id}'); closeTaskFloatingMenu();" class="w-full text-left px-2.5 py-1.5 rounded-xl hover:bg-red-500/20 text-xs flex items-center gap-2 text-red-300 font-medium">
      <span>${hdsfdIcon('trash-2')}</span> <span>Delete Task</span>
    </button>

    <div class="border-t border-white/10 pt-1.5 mt-1 max-h-36 overflow-y-auto">
      <span class="text-[9px] uppercase font-bold text-white/40 px-2 block mb-1">Move to List</span>
      ${folders.map(f => `
        <button onclick="moveTaskFolder('${task.id}', '${f}'); closeTaskFloatingMenu();" class="w-full text-left px-2.5 py-1 rounded-lg hover:bg-white/10 text-[11px] flex items-center justify-between ${task.folder === f ? 'text-purple-300 font-bold' : 'text-white/70'}">
          <span class="truncate">${f}</span>
          ${task.folder === f ? `<span class="text-purple-300">${hdsfdIcon('check')}</span>` : ''}
        </button>
      `).join('')}
    </div>
  `;

  menu.classList.remove('hidden');
}

function closeTaskFloatingMenu() {
  const menu = document.getElementById('task-floating-menu');
  if (menu) menu.classList.add('hidden');
  activeFloatingMenuTaskId = null;
}
document.addEventListener('click', closeTaskFloatingMenu);

function moveTaskFolder(taskId, newFolder) {
  const currentOwner = googleAccount || userName || 'Guest';
  const task = allData.find(d => d.id === taskId);
  if (!task) return;
  task.folder = newFolder;
  localStorage.setItem(`hdsfd_data_${currentOwner}`, JSON.stringify(allData));
  renderDirectGTasks();
  renderHomeStarredTasks();
  renderDarkCalendarGrid();
}

function promptAddSubtask(taskId) {
  const stTitle = prompt('Enter subtask title:');
  if (!stTitle || !stTitle.trim()) return;
  const currentOwner = googleAccount || userName || 'Guest';
  const task = allData.find(d => d.id === taskId);
  if (!task) return;
  task.subtasks = task.subtasks || [];
  task.subtasks.push({ title: stTitle.trim(), completed: false });
  expandedSubtasksMap[taskId] = true;
  localStorage.setItem(`hdsfd_data_${currentOwner}`, JSON.stringify(allData));
  renderDirectGTasks();
}

function removeSubtask(taskId, subtaskIdx) {
  const currentOwner = googleAccount || userName || 'Guest';
  const task = allData.find(d => d.id === taskId);
  if (!task || !task.subtasks) return;
  task.subtasks.splice(subtaskIdx, 1);
  localStorage.setItem(`hdsfd_data_${currentOwner}`, JSON.stringify(allData));
  renderDirectGTasks();
}

function toggleSubtaskState(taskId, subtaskIdx) {
  const currentOwner = googleAccount || userName || 'Guest';
  const task = allData.find(d => d.id === taskId);
  if (!task || !task.subtasks || !task.subtasks[subtaskIdx]) return;
  task.subtasks[subtaskIdx].completed = !task.subtasks[subtaskIdx].completed;
  localStorage.setItem(`hdsfd_data_${currentOwner}`, JSON.stringify(allData));
  renderDirectGTasks();
}

function toggleAddSubtaskField() {
  const container = document.getElementById('subtask-inputs-container');
  const list = document.getElementById('subtasks-field-list');
  if (!container || !list) return;

  container.classList.remove('hidden');
  const subIdx = tempSubtasksList.length;
  tempSubtasksList.push('');

  const row = document.createElement('div');
  row.className = 'flex items-center gap-1';
  row.innerHTML = `
    <input type="text" placeholder="Subtask title..." class="flex-1 bg-white/10 border border-white/15 rounded-xl px-2.5 py-1 text-white text-[11px] outline-none" oninput="tempSubtasksList[${subIdx}] = this.value">
    <button type="button" onclick="this.parentElement.remove(); tempSubtasksList.splice(${subIdx}, 1);" class="text-white/40 hover:text-red-400 px-1">${hdsfdIcon('x')}</button>
  `;
  list.appendChild(row);
}

// ===== CUSTOM REPEAT CONFIGURATION MODAL =====
function openRepeatModal() {
  const modal = document.getElementById('repeat-config-modal');
  if (modal) modal.classList.remove('hidden');
}

function closeRepeatModal() {
  const modal = document.getElementById('repeat-config-modal');
  if (modal) modal.classList.add('hidden');
}

function onRepeatEndTypeChange() {
  const endType = document.querySelector('input[name="repeat-end-type"]:checked').value;
  const onBtn = document.getElementById('repeat-end-on-btn');
  const occInput = document.getElementById('repeat-end-occurrences');

  if (onBtn && occInput) {
    if (endType === 'on') {
      onBtn.disabled = false;
      onBtn.classList.remove('opacity-50');
      occInput.disabled = true;
      occInput.classList.add('opacity-50');
    } else if (endType === 'after') {
      onBtn.disabled = true;
      onBtn.classList.add('opacity-50');
      occInput.disabled = false;
      occInput.classList.remove('opacity-50');
    } else {
      onBtn.disabled = true;
      onBtn.classList.add('opacity-50');
      occInput.disabled = true;
      occInput.classList.add('opacity-50');
    }
  }
}

function clearRepeatConfiguration() {
  currentRepeatConfig = null;
  const labelEl = document.getElementById('gtask-repeat-btn-label');
  if (labelEl) labelEl.textContent = 'Repeat: None';
  closeRepeatModal();
}

function saveRepeatConfiguration() {
  const interval = parseInt(document.getElementById('repeat-interval-num').value, 10) || 1;
  const unit = document.getElementById('repeat-unit-select').value || 'day';
  const endType = document.querySelector('input[name="repeat-end-type"]:checked').value;
  const occurrences = parseInt(document.getElementById('repeat-end-occurrences').value, 10) || 30;

  currentRepeatConfig = {
    interval,
    unit,
    time: (currentRepeatConfig && currentRepeatConfig.time) || '',
    starts: (currentRepeatConfig && currentRepeatConfig.starts) || new Date().toISOString().split('T')[0],
    endType,
    endDate: (currentRepeatConfig && currentRepeatConfig.endDate) || '',
    endOccurrences: occurrences
  };

  const labelEl = document.getElementById('gtask-repeat-btn-label');
  if (labelEl) {
    labelEl.textContent = `Every ${interval} ${unit}${currentRepeatConfig.time ? ` (${currentRepeatConfig.time})` : ''}`;
  }
  closeRepeatModal();
}

// ===== CUSTOM GLASSMORPHIC DATE & TIME PICKER MODAL =====
function openCustomDateTimeModal(targetField, optTaskId) {
  pickerTargetField = targetField;
  attachTargetTaskId = optTaskId || null;

  const modal = document.getElementById('custom-datetime-modal');
  const title = document.getElementById('datetime-modal-title');
  const timeToggle = document.getElementById('picker-has-time');
  const timeControls = document.getElementById('picker-time-controls');

  if (title) {
    if (targetField === 'due') title.textContent = 'Set Due Date & Time';
    else if (targetField === 'deadline') title.textContent = 'Set Task Deadline';
    else if (targetField === 'repeat-start') title.textContent = 'Set Repeat Start Date';
    else if (targetField === 'repeat-end') title.textContent = 'Set Repeat End Date';
    else if (targetField === 'repeat') title.textContent = 'Set Repeat Time';
  }

  if (targetField === 'repeat') {
    if (timeToggle) timeToggle.checked = true;
    if (timeControls) timeControls.classList.remove('hidden');
  }

  pickerSelectedDateStr = new Date().toISOString().split('T')[0];
  renderPickerCalendarGrid();
  if (modal) modal.classList.remove('hidden');
}

function openCustomTimeModal(target) {
  openCustomDateTimeModal(target || 'repeat');
}

function openCustomDateModal(target) {
  openCustomDateTimeModal(target || 'repeat-start');
}

function closeCustomDateTimeModal() {
  const modal = document.getElementById('custom-datetime-modal');
  if (modal) modal.classList.add('hidden');
}

function changePickerMonth(delta) {
  pickerViewingDate.setMonth(pickerViewingDate.getMonth() + delta);
  renderPickerCalendarGrid();
}

function setQuickPickerDate(daysFromNow) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  pickerSelectedDateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  pickerViewingDate = new Date(d);
  renderPickerCalendarGrid();
}

function clearPickerDate() {
  pickerSelectedDateStr = null;
  renderPickerCalendarGrid();
}

function togglePickerHasTime() {
  const hasTime = document.getElementById('picker-has-time').checked;
  const controls = document.getElementById('picker-time-controls');
  if (controls) {
    if (hasTime) controls.classList.remove('hidden');
    else controls.classList.add('hidden');
  }
}

function renderPickerCalendarGrid() {
  const label = document.getElementById('picker-month-label');
  const grid = document.getElementById('picker-calendar-grid');
  if (!label || !grid) return;

  const year = pickerViewingDate.getFullYear();
  const month = pickerViewingDate.getMonth();
  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  label.textContent = `${monthNames[month]} ${year}`;

  const firstDay = new Date(year, month, 1).getDay();
  const lastDate = new Date(year, month + 1, 0).getDate();
  const totalCells = Math.ceil((firstDay + lastDate) / 7) * 7;

  let html = '';
  for (let i = 0; i < totalCells; i++) {
    if (i < firstDay || i >= firstDay + lastDate) {
      html += `<div class="p-1.5 opacity-20">-</div>`;
    } else {
      const dayNum = i - firstDay + 1;
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
      const isSelected = pickerSelectedDateStr === dateStr;

      html += `
        <button type="button" onclick="selectPickerDate('${dateStr}')" class="p-1.5 rounded-lg text-xs font-bold transition-all ${isSelected ? 'bg-purple-500 text-white shadow' : 'text-white/80 hover:bg-white/10'}">
          ${dayNum}
        </button>
      `;
    }
  }
  grid.innerHTML = html;
}

function selectPickerDate(dateStr) {
  pickerSelectedDateStr = dateStr;
  renderPickerCalendarGrid();
}

function saveCustomDateTimeSelection() {
  const hasTime = document.getElementById('picker-has-time').checked;
  let timeFormatted = '';
  if (hasTime) {
    const h = document.getElementById('picker-hour-select').value;
    const m = document.getElementById('picker-minute-select').value;
    const ampm = document.getElementById('picker-ampm-select').value;
    timeFormatted = `${h}:${m} ${ampm}`;
  }

  if (pickerTargetField === 'due') {
    const btnLabel = document.getElementById('gtask-due-btn-label');
    if (btnLabel) {
      if (pickerSelectedDateStr) {
        const d = new Date(pickerSelectedDateStr + 'T00:00:00');
        const formatted = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
        btnLabel.textContent = `Due: ${formatted}${timeFormatted ? ` ${timeFormatted}` : ''}`;
      } else {
        btnLabel.textContent = 'Due Date & Time';
      }
    }
    window.tempSelectedDueDate = pickerSelectedDateStr;
    window.tempSelectedDueTime = timeFormatted;
  } else if (pickerTargetField === 'deadline') {
    if (attachTargetTaskId) {
      const task = allData.find(d => d.id === attachTargetTaskId);
      if (task) {
        task.deadline = pickerSelectedDateStr;
        const currentOwner = googleAccount || userName || 'Guest';
        localStorage.setItem(`hdsfd_data_${currentOwner}`, JSON.stringify(allData));
        renderDirectGTasks();
        renderDarkCalendarGrid();
      }
    } else {
      const btnLabel = document.getElementById('gtask-deadline-btn-label');
      if (btnLabel) {
        if (pickerSelectedDateStr) {
          const d = new Date(pickerSelectedDateStr + 'T00:00:00');
          btnLabel.textContent = `Deadline: ${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
        } else {
          btnLabel.textContent = 'Deadline';
        }
      }
      window.tempSelectedDeadline = pickerSelectedDateStr;
    }
  } else if (pickerTargetField === 'repeat-start') {
    currentRepeatConfig.starts = pickerSelectedDateStr;
    const startLabel = document.getElementById('repeat-start-date-label');
    if (startLabel && pickerSelectedDateStr) {
      startLabel.textContent = new Date(pickerSelectedDateStr + 'T00:00:00').toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
  } else if (pickerTargetField === 'repeat-end') {
    currentRepeatConfig.endDate = pickerSelectedDateStr;
    const endLabel = document.getElementById('repeat-end-on-label');
    if (endLabel && pickerSelectedDateStr) {
      endLabel.textContent = new Date(pickerSelectedDateStr + 'T00:00:00').toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
  } else if (pickerTargetField === 'repeat') {
    currentRepeatConfig.time = timeFormatted;
    const timeLabel = document.getElementById('repeat-time-label');
    if (timeLabel) timeLabel.textContent = timeFormatted || 'Set time';
  }

  closeCustomDateTimeModal();
}

// ===== GOOGLE DRIVE ATTACHMENT MODAL =====
function openGDriveAttachModal(targetId) {
  attachTargetTaskId = targetId;
  const modal = document.getElementById('gdrive-attach-modal');
  if (modal) modal.classList.remove('hidden');
}

function closeGDriveAttachModal() {
  const modal = document.getElementById('gdrive-attach-modal');
  if (modal) modal.classList.add('hidden');
}

function openGoogleDriveWebBrowser() {
  const width = 800;
  const height = 650;
  const left = (window.screen.width / 2) - (width / 2);
  const top = (window.screen.height / 2) - (height / 2);

  window.open(
    'https://drive.google.com/drive/u/0/my-drive',
    'GoogleDriveBrowserWindow',
    `width=${width},height=${height},top=${top},left=${left},scrollbars=yes,status=yes`
  );

  const nameInput = document.getElementById('custom-drive-name-input');
  const linkInput = document.getElementById('custom-drive-link-input');
  if (nameInput && !nameInput.value) nameInput.value = 'My Google Drive File';
  if (linkInput && !linkInput.value) linkInput.value = 'https://drive.google.com';
}

function selectPresetDriveFile(fileName) {
  const nameInput = document.getElementById('custom-drive-name-input');
  const linkInput = document.getElementById('custom-drive-link-input');
  if (nameInput) nameInput.value = fileName;
  if (linkInput) linkInput.value = `https://drive.google.com/drive/search?q=${encodeURIComponent(fileName)}`;
}

function saveDriveAttachment() {
  const nameInput = document.getElementById('custom-drive-name-input');
  const linkInput = document.getElementById('custom-drive-link-input');
  const name = nameInput ? nameInput.value.trim() : 'Google Drive Attachment';
  const url = linkInput ? linkInput.value.trim() : 'https://drive.google.com';

  if (!name) return;

  if (attachTargetTaskId === 'new-task') {
    pendingNewTaskAttachment = { name, url };
    const chip = document.getElementById('new-task-attachment-chip');
    const chipName = document.getElementById('new-task-attachment-name');
    if (chip && chipName) {
      chipName.textContent = name;
      chip.classList.remove('hidden');
    }
  } else if (attachTargetTaskId) {
    const task = allData.find(d => d.id === attachTargetTaskId);
    if (task) {
      task.attachments = task.attachments || [];
      task.attachments.push({ name, url });
      const currentOwner = googleAccount || userName || 'Guest';
      localStorage.setItem(`hdsfd_data_${currentOwner}`, JSON.stringify(allData));
      renderDirectGTasks();
    }
  }

  closeGDriveAttachModal();
}

function removePendingAttachment() {
  pendingNewTaskAttachment = null;
  const chip = document.getElementById('new-task-attachment-chip');
  if (chip) chip.classList.add('hidden');
}

// ===== COMPREHENSIVE TASK CREATOR =====
function saveComprehensiveTask() {
  const titleInput = document.getElementById('gtask-title-input');
  const detailsInput = document.getElementById('gtask-details-input');

  const title = titleInput ? titleInput.value.trim() : '';
  if (!title) return;

  const details = detailsInput ? detailsInput.value.trim() : '';
  const due = window.tempSelectedDueDate || '';
  const dueTime = window.tempSelectedDueTime || '';
  const deadline = window.tempSelectedDeadline || '';
  const folder = selectedNewTaskFolder || 'My Tasks';

  const currentOwner = googleAccount || userName || 'Guest';
  const tempId = 'task_' + Date.now();

  const formattedSubtasks = tempSubtasksList.filter(s => s.trim().length > 0).map(s => ({ title: s.trim(), completed: false }));
  const attachments = pendingNewTaskAttachment ? [pendingNewTaskAttachment] : [];

  const taskObj = {
    id: tempId,
    tasklist_id: '@default',
    type: 'task',
    title: title,
    details: details,
    folder: folder,
    due: due ? (due.length === 10 ? due + 'T00:00:00.000Z' : due) : '',
    due_time: dueTime,
    deadline: deadline,
    repeat_config: (currentRepeatConfig && currentRepeatConfig.unit) ? { ...currentRepeatConfig } : null,
    subtasks: formattedSubtasks,
    attachments: attachments,
    completed: false,
    created_at: new Date().toISOString(),
    username: currentOwner,
    is_important: false
  };

  allData.unshift(taskObj);
  localStorage.setItem(`hdsfd_data_${currentOwner}`, JSON.stringify(allData));
  renderDirectGTasks();
  renderHomeStarredTasks();
  renderDarkCalendarGrid();
  updateStatsOverview();

  fetch(`${API_BASE}/google/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: currentOwner,
      title: title,
      folder: folder,
      due_date: due,
      notes: details
    })
  }).then(res => res.json()).then(res => {
    if (res.synced && res.task && res.task.id) {
      taskObj.id = res.task.id;
      taskObj.tasklist_id = res.tasklist_id || '@default';
      if (res.task.due) taskObj.due = res.task.due;
      localStorage.setItem(`hdsfd_data_${currentOwner}`, JSON.stringify(allData));
      renderDirectGTasks();
      renderHomeStarredTasks();
      renderDarkCalendarGrid();
    }
  }).catch(err => console.warn('Google Task save failed:', err));

  if (titleInput) titleInput.value = '';
  if (detailsInput) detailsInput.value = '';
  window.tempSelectedDueDate = null;
  window.tempSelectedDueTime = null;
  window.tempSelectedDeadline = null;
  pendingNewTaskAttachment = null;
  removePendingAttachment();

  currentRepeatConfig = null;
  const dueBtn = document.getElementById('gtask-due-btn-label');
  if (dueBtn) dueBtn.textContent = 'Due Date & Time';
  const deadlineBtn = document.getElementById('gtask-deadline-btn-label');
  if (deadlineBtn) deadlineBtn.textContent = 'Deadline';
  const repeatBtn = document.getElementById('gtask-repeat-btn-label');
  if (repeatBtn) repeatBtn.textContent = 'Repeat: None';

  tempSubtasksList = [];
  const subContainer = document.getElementById('subtask-inputs-container');
  const subList = document.getElementById('subtasks-field-list');
  if (subContainer) subContainer.classList.add('hidden');
  if (subList) subList.innerHTML = '';
}

// ===== ULTRA-GLASS INTERACTIVE CALENDAR & DAY INSPECTOR =====
function changeCalendarMonth(delta) {
  calViewingDate.setMonth(calViewingDate.getMonth() + delta);
  renderDarkCalendarGrid();
}

function jumpCalendarToToday() {
  calViewingDate = new Date();
  renderDarkCalendarGrid();
}

function renderDarkCalendarGrid() {
  const titleEl = document.getElementById('cal-month-title');
  const gridEl = document.getElementById('calendar-cells-grid');
  if (!titleEl || !gridEl) return;

  const year = calViewingDate.getFullYear();
  const month = calViewingDate.getMonth();
  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  titleEl.textContent = `${monthNames[month]} ${year}`;

  const firstDayIndex = new Date(year, month, 1).getDay();
  const lastDayCurrent = new Date(year, month + 1, 0).getDate();
  const lastDayPrev = new Date(year, month, 0).getDate();

  const totalCells = Math.ceil((firstDayIndex + lastDayCurrent) / 7) * 7;
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const events = window.googleCalendarEvents || [];
  const tasks = allData.filter(d => d.type === 'task');
  const exams = allData.filter(d => d.type === 'exam_entry');
  const schedules = allData.filter(d => d.type === 'schedule_entry');

  let cellsHtml = '';

  for (let i = 0; i < totalCells; i++) {
    let dayNum = 0;
    let isCurrentMonth = true;
    let cellDateStr = '';

    if (i < firstDayIndex) {
      dayNum = lastDayPrev - firstDayIndex + i + 1;
      isCurrentMonth = false;
      const prevMonth = month === 0 ? 11 : month - 1;
      const prevYear = month === 0 ? year - 1 : year;
      cellDateStr = `${prevYear}-${String(prevMonth + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
    } else if (i >= firstDayIndex + lastDayCurrent) {
      dayNum = i - (firstDayIndex + lastDayCurrent) + 1;
      isCurrentMonth = false;
      const nextMonth = month === 11 ? 0 : month + 1;
      const nextYear = month === 11 ? year + 1 : year;
      cellDateStr = `${nextYear}-${String(nextMonth + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
    } else {
      dayNum = i - firstDayIndex + 1;
      cellDateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
    }

    const isToday = isCurrentMonth && cellDateStr === todayStr;

    // Day of week (Sun, Mon, Tue, Wed, Thu, Fri, Sat)
    const dayDateObj = new Date(cellDateStr + 'T12:00:00');
    const dayOfWeekShort = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dayDateObj.getDay()];

    const dayExams = exams.filter(ex => ex.date && ex.date === cellDateStr);

    const daySchedules = schedules.filter(s => Array.isArray(s.days) && s.days.includes(dayOfWeekShort));

    const dayEvents = events.filter(e => {
      const eStart = (e.start && (e.start.dateTime || e.start.date)) || '';
      return eStart.startsWith(cellDateStr);
    });

    const dayTasks = tasks.filter(t => {
      return t.due && t.due.startsWith(cellDateStr);
    });

    const dayDeadlines = tasks.filter(t => {
      return t.deadline && t.deadline.startsWith(cellDateStr);
    });

    const totalCount = dayExams.length + daySchedules.length + dayEvents.length + dayTasks.length + dayDeadlines.length;

    cellsHtml += `
      <div onclick="openCalendarDayModal('${cellDateStr}')" class="calendar-day-cell glass border border-white/10 rounded-2xl p-2 flex flex-col justify-between cursor-pointer ${isCurrentMonth ? 'text-white' : 'text-white/20'} ${isToday ? 'ring-2 ring-purple-400 bg-purple-500/20' : ''}">
        <div class="flex justify-between items-center mb-1">
          <span class="text-[10px] font-black ${isToday ? 'bg-purple-500 text-white w-4 h-4 rounded-full flex items-center justify-center shadow' : ''}">${dayNum}</span>
          ${totalCount > 0 ? `<span class="text-[8px] bg-white/10 px-1.5 py-0.2 rounded-full font-bold text-white/80">${totalCount}</span>` : ''}
        </div>

        <div class="space-y-0.5 overflow-hidden flex-1">
          ${dayExams.map(ex => `
            <div class="cal-event-chip bg-rose-500/40 text-rose-100 border border-rose-400/50 font-bold" title="Exam: ${escapeHtml(ex.title)}">
              ${hdsfdIcon('target')} ${escapeHtml(ex.title)}
            </div>
          `).join('')}

          ${daySchedules.map(s => `
            <div class="cal-event-chip bg-emerald-500/30 text-emerald-200 border border-emerald-500/40 font-semibold" title="Class: ${escapeHtml(s.title)} (${s.start_time || ''})">
              ${hdsfdIcon('clock')} ${escapeHtml(s.title)}
            </div>
          `).join('')}

          ${dayEvents.map(e => `
            <div class="cal-event-chip bg-sky-500/30 text-sky-200 border border-sky-500/40" title="Event: ${escapeHtml(e.summary || 'Event')}">
              ${hdsfdIcon('circle')} ${escapeHtml(e.summary || 'Event')}
            </div>
          `).join('')}

          ${dayTasks.map(t => `
            <div class="cal-event-chip bg-purple-500/30 text-purple-200 border border-purple-500/40 ${t.completed ? 'line-through opacity-40' : ''}" title="Task: ${escapeHtml(t.title)}">
              ${hdsfdIcon('clipboard-list')} ${escapeHtml(t.title)}
            </div>
          `).join('')}

          ${dayDeadlines.map(t => `
            <div class="cal-event-chip bg-amber-500/30 text-amber-200 border border-amber-500/40 font-bold" title="Deadline: ${escapeHtml(t.title)}">
              ${hdsfdIcon('target')} ${escapeHtml(t.title)}
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  gridEl.innerHTML = cellsHtml;
}

// ===== CALENDAR DAY INSPECTOR & QUICK EVENT/TASK CREATOR MODAL =====
function openCalendarDayModal(dateStr) {
  selectedDayModalDateStr = dateStr;
  const modal = document.getElementById('calendar-day-modal');
  const title = document.getElementById('cal-day-modal-title');
  const list = document.getElementById('cal-day-items-list');

  populateTaskFolderMenus();

  if (title) {
    const d = new Date(dateStr + 'T00:00:00');
    title.textContent = d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  }

  if (list) {
    const dayDateObj = new Date(dateStr + 'T12:00:00');
    const dayOfWeekShort = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dayDateObj.getDay()];

    const dayExams = allData.filter(d => d.type === 'exam_entry' && d.date === dateStr);
    const daySchedules = allData.filter(d => d.type === 'schedule_entry' && Array.isArray(d.days) && d.days.includes(dayOfWeekShort));

    const events = (window.googleCalendarEvents || []).filter(e => {
      const eStart = (e.start && (e.start.dateTime || e.start.date)) || '';
      return eStart.startsWith(dateStr);
    });

    const tasks = allData.filter(d => d.type === 'task' && d.due && d.due.startsWith(dateStr));
    const deadlines = allData.filter(d => d.type === 'task' && d.deadline && d.deadline.startsWith(dateStr));

    if (dayExams.length === 0 && daySchedules.length === 0 && events.length === 0 && tasks.length === 0 && deadlines.length === 0) {
      list.innerHTML = '<p class="text-white/40 text-xs italic text-center py-6">No exams, classes, events or tasks scheduled for this day.</p>';
    } else {
      let html = '';

      // 1. Exams
      dayExams.forEach(ex => {
        html += `
          <div class="glass p-2.5 rounded-xl border border-rose-500/40 bg-rose-500/10 flex items-center justify-between text-xs">
            <div class="flex items-center gap-2">
              <span class="text-rose-400 font-black">${hdsfdIcon('target')} Exam:</span>
              <span class="text-white font-bold">${escapeHtml(ex.title)}</span>
              <span class="text-[9px] bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded font-bold">+${ex.reward || 250} ${hdsfdIcon('coins')}</span>
            </div>
            <span class="text-[10px] text-rose-200/80 font-mono">${formatTime12h(ex.time || '09:00')}</span>
          </div>
        `;
      });

      // 2. Class Schedules
      daySchedules.forEach(s => {
        html += `
          <div class="glass p-2.5 rounded-xl border border-purple-500/30 flex items-center justify-between text-xs">
            <div class="flex items-center gap-2">
              <span class="text-purple-300 font-bold">${hdsfdIcon('clock')} Class:</span>
              <span class="text-white font-medium">${escapeHtml(s.title)}</span>
              ${s.location ? `<span class="text-[10px] text-white/40">(${escapeHtml(s.location)})</span>` : ''}
            </div>
            <span class="text-[10px] text-purple-200/70 font-mono">${formatTime12h(s.start_time || '09:00')} - ${formatTime12h(s.end_time || '10:15')}</span>
          </div>
        `;
      });

      // 3. Google Events
      events.forEach(e => {
        html += `
          <div class="glass p-2.5 rounded-xl border border-sky-500/30 flex items-center justify-between text-xs">
            <div class="flex items-center gap-2">
              <span class="text-sky-300 font-bold">${hdsfdIcon('circle')} Event</span>
              <span class="text-white font-medium">${escapeHtml(e.summary || 'Google Calendar Event')}</span>
            </div>
            <span class="text-[10px] text-sky-200/60">${e.start && e.start.dateTime ? new Date(e.start.dateTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'All Day'}</span>
          </div>
        `;
      });

      // 4. Tasks
      tasks.forEach(t => {
        html += `
          <div class="glass p-2.5 rounded-xl border border-purple-500/30 flex items-center justify-between text-xs ${t.completed ? 'opacity-40' : ''}">
            <label class="flex items-center gap-2 cursor-pointer overflow-hidden flex-1">
              <input type="checkbox" ${t.completed ? 'checked' : ''} onchange="toggleTaskState('${t.id}'); openCalendarDayModal('${dateStr}');" class="w-3.5 h-3.5 accent-purple-400 cursor-pointer flex-shrink-0">
              <span class="text-purple-300 font-bold">${hdsfdIcon('clipboard-list')} Task:</span>
              <span class="${t.completed ? 'line-through text-white/40' : 'text-white'} truncate">${escapeHtml(t.title)}</span>
            </label>
            <span class="text-[9px] bg-purple-500/20 text-purple-200 px-1.5 py-0.5 rounded font-bold">${escapeHtml(t.folder || 'My Tasks')}</span>
          </div>
        `;
      });

      // 5. Deadlines
      deadlines.forEach(t => {
        html += `
          <div class="glass p-2.5 rounded-xl border border-amber-500/30 flex items-center justify-between text-xs">
            <div class="flex items-center gap-2">
              <span class="text-amber-300 font-bold">${hdsfdIcon('target')} Deadline:</span>
              <span class="text-white">${escapeHtml(t.title)}</span>
            </div>
            <span class="text-[9px] bg-amber-500/20 text-amber-200 px-1.5 py-0.5 rounded font-bold">${escapeHtml(t.folder || 'My Tasks')}</span>
          </div>
        `;
      });

      list.innerHTML = html;
    }
  }

  if (modal) modal.classList.remove('hidden');
}

function closeCalendarDayModal() {
  const modal = document.getElementById('calendar-day-modal');
  if (modal) modal.classList.add('hidden');
}

function saveQuickDayItem() {
  const titleInput = document.getElementById('cal-day-add-title');
  const timeInput = document.getElementById('cal-day-add-time');

  const title = titleInput ? titleInput.value.trim() : '';
  if (!title || !selectedDayModalDateStr) return;

  const itemType = calDaySelectedType || 'task';
  const timeVal = timeInput ? timeInput.value : '';
  const folderVal = calDaySelectedFolder || 'My Tasks';
  const currentOwner = googleAccount || userName || 'Guest';

  if (itemType === 'event') {
    window.googleCalendarEvents = window.googleCalendarEvents || [];
    window.googleCalendarEvents.push({
      summary: title,
      start: { dateTime: timeVal ? `${selectedDayModalDateStr}T${timeVal}:00` : selectedDayModalDateStr }
    });
  } else {
    const taskObj = {
      id: 'task_' + Date.now(),
      type: 'task',
      title: title,
      folder: folderVal,
      due: itemType === 'task' ? `${selectedDayModalDateStr}T00:00:00.000Z` : '',
      due_time: timeVal,
      deadline: itemType === 'deadline' ? selectedDayModalDateStr : '',
      completed: false,
      created_at: new Date().toISOString(),
      username: currentOwner,
      is_important: false,
      subtasks: []
    };
    allData.unshift(taskObj);
    localStorage.setItem(`hdsfd_data_${currentOwner}`, JSON.stringify(allData));

    // Save to Google Tasks API
    fetch(`${API_BASE}/google/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: currentOwner,
        title: title,
        folder: folderVal,
        due_date: taskObj.due
      })
    }).then(res => res.json()).then(res => {
      if (res.synced && res.task && res.task.id) {
        taskObj.id = res.task.id;
        taskObj.tasklist_id = res.tasklist_id || '@default';
        localStorage.setItem(`hdsfd_data_${currentOwner}`, JSON.stringify(allData));
      }
    }).catch(err => console.warn('Google Task quick save warning:', err));
  }

  renderDarkCalendarGrid();
  renderDirectGTasks();
  renderHomeStarredTasks();
  openCalendarDayModal(selectedDayModalDateStr);
  if (titleInput) titleInput.value = '';
}

// ===== CLASS & TIMETABLE SCHEDULE SYSTEM =====
let currentTab2Subview = 'calendar';
let activeScheduleDayFilter = 'all';
let selectedScheduleDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
let selectedScheduleColor = 'purple';

function switchTab2Subview(view) {
  currentTab2Subview = view;
  const calView = document.getElementById('native-dark-calendar-view');
  const schedView = document.getElementById('native-schedule-view');
  const calBtn = document.getElementById('tab2-subtab-cal-btn');
  const schedBtn = document.getElementById('tab2-subtab-sched-btn');
  const addBtn = document.getElementById('schedule-add-btn');

  if (view === 'schedule') {
    if (calView) calView.classList.add('hidden');
    if (schedView) schedView.classList.remove('hidden');
    if (calBtn) {
      calBtn.className = 'px-3 py-1 rounded-lg text-xs font-bold text-white/50 hover:text-white transition-all flex items-center gap-1.5';
    }
    if (schedBtn) {
      schedBtn.className = 'px-3 py-1 rounded-lg text-xs font-bold bg-purple-500/30 text-purple-200 border border-purple-500/40 transition-all flex items-center gap-1.5';
    }
    if (addBtn) addBtn.classList.remove('hidden');
    renderScheduleGrid();
  } else {
    if (calView) calView.classList.remove('hidden');
    if (schedView) schedView.classList.add('hidden');
    if (calBtn) {
      calBtn.className = 'px-3 py-1 rounded-lg text-xs font-bold bg-purple-500/30 text-purple-200 border border-purple-500/40 transition-all flex items-center gap-1.5';
    }
    if (schedBtn) {
      schedBtn.className = 'px-3 py-1 rounded-lg text-xs font-bold text-white/50 hover:text-white transition-all flex items-center gap-1.5';
    }
    if (addBtn) addBtn.classList.add('hidden');
    renderDarkCalendarGrid();
  }
}

function filterScheduleDay(day) {
  activeScheduleDayFilter = day;
  document.querySelectorAll('.sched-day-btn').forEach(btn => {
    if (btn.getAttribute('data-day') === day) {
      btn.className = 'sched-day-btn active px-2.5 py-1 rounded-lg text-[10px] font-bold bg-purple-500/30 text-purple-200 border border-purple-500/40 whitespace-nowrap transition-all';
    } else {
      btn.className = 'sched-day-btn px-2.5 py-1 rounded-lg text-[10px] font-bold bg-white/5 hover:bg-white/10 text-white/70 border border-white/10 whitespace-nowrap transition-all';
    }
  });
  renderScheduleGrid();
}

function toggleScheduleDaySelect(btn, day) {
  if (selectedScheduleDays.includes(day)) {
    selectedScheduleDays = selectedScheduleDays.filter(d => d !== day);
    btn.classList.remove('bg-purple-500/30', 'text-purple-200', 'border-purple-400');
    btn.classList.add('bg-white/10', 'text-white/70', 'border-white/10');
  } else {
    selectedScheduleDays.push(day);
    btn.classList.add('bg-purple-500/30', 'text-purple-200', 'border-purple-400');
    btn.classList.remove('bg-white/10', 'text-white/70', 'border-white/10');
  }
}

function selectScheduleColor(color) {
  selectedScheduleColor = color;
  document.querySelectorAll('.sched-color-btn').forEach(btn => {
    if (btn.getAttribute('data-color') === color) {
      btn.classList.add('ring-2', 'ring-white', 'border-2', 'border-slate-900');
    } else {
      btn.classList.remove('ring-2', 'ring-white', 'border-2', 'border-slate-900');
    }
  });
}

function openAddScheduleModal(editId = null) {
  const modal = document.getElementById('add-schedule-modal');
  const modalTitle = document.getElementById('schedule-modal-title');
  const editIdInput = document.getElementById('sched-edit-id');
  const titleInput = document.getElementById('sched-title-input');
  const startTimeInput = document.getElementById('sched-start-time');
  const endTimeInput = document.getElementById('sched-end-time');
  const locInput = document.getElementById('sched-loc-input');

  if (editId) {
    const entry = allData.find(d => d.id === editId && d.type === 'schedule_entry');
    if (entry) {
      if (modalTitle) modalTitle.textContent = 'Edit Class / Period';
      if (editIdInput) editIdInput.value = entry.id;
      if (titleInput) titleInput.value = entry.title || '';
      if (startTimeInput) startTimeInput.value = entry.start_time || '09:00';
      if (endTimeInput) endTimeInput.value = entry.end_time || '10:15';
      if (locInput) locInput.value = entry.location || '';
      selectedScheduleDays = Array.isArray(entry.days) ? [...entry.days] : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
      selectedScheduleColor = entry.color || 'purple';
    }
  } else {
    if (modalTitle) modalTitle.textContent = 'Add Class / Schedule Period';
    if (editIdInput) editIdInput.value = '';
    if (titleInput) titleInput.value = '';
    if (startTimeInput) startTimeInput.value = '09:00';
    if (endTimeInput) endTimeInput.value = '10:15';
    if (locInput) locInput.value = '';
    selectedScheduleDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
    selectedScheduleColor = 'purple';
  }

  // Update Days UI buttons
  document.querySelectorAll('.sched-day-toggle').forEach(btn => {
    const d = btn.getAttribute('data-day');
    if (selectedScheduleDays.includes(d)) {
      btn.classList.add('bg-purple-500/30', 'text-purple-200', 'border-purple-400');
      btn.classList.remove('bg-white/10', 'text-white/70', 'border-white/10');
    } else {
      btn.classList.remove('bg-purple-500/30', 'text-purple-200', 'border-purple-400');
      btn.classList.add('bg-white/10', 'text-white/70', 'border-white/10');
    }
  });

  selectScheduleColor(selectedScheduleColor);
  if (modal) modal.classList.remove('hidden');
  if (titleInput) titleInput.focus();
}

function closeAddScheduleModal() {
  const modal = document.getElementById('add-schedule-modal');
  if (modal) modal.classList.add('hidden');
}

function saveScheduleEntry() {
  const titleInput = document.getElementById('sched-title-input');
  const startTimeInput = document.getElementById('sched-start-time');
  const endTimeInput = document.getElementById('sched-end-time');
  const locInput = document.getElementById('sched-loc-input');
  const editIdInput = document.getElementById('sched-edit-id');

  const title = titleInput ? titleInput.value.trim() : '';
  if (!title) {
    if (titleInput) titleInput.focus();
    return;
  }

  const startTime = startTimeInput ? startTimeInput.value : '09:00';
  const endTime = endTimeInput ? endTimeInput.value : '10:15';
  const location = locInput ? locInput.value.trim() : '';
  const editId = editIdInput ? editIdInput.value : '';
  const currentOwner = googleAccount || userName || 'Guest';

  const entryObj = {
    id: editId || `sched_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    type: 'schedule_entry',
    title: title,
    days: selectedScheduleDays.length ? selectedScheduleDays : ['Mon'],
    start_time: startTime,
    end_time: endTime,
    location: location,
    color: selectedScheduleColor || 'purple',
    created_at: new Date().toISOString(),
    username: currentOwner
  };

  if (editId) {
    const idx = allData.findIndex(d => d.id === editId);
    if (idx !== -1) {
      allData[idx] = { ...allData[idx], ...entryObj };
    }
  } else {
    allData.push(entryObj);
  }

  localStorage.setItem(`hdsfd_data_${currentOwner}`, JSON.stringify(allData));
  createData(entryObj);

  // Sync to Google Calendar as recurring weekly class event
  fetch(`${API_BASE}/google/calendar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: currentOwner,
      title: title,
      start_time: startTime,
      end_time: endTime,
      days: entryObj.days,
      location: location
    })
  }).then(res => res.json()).then(res => {
    if (res.synced) {
 console.log(' Google Calendar Schedule Synced:', res.event);
    }
  }).catch(err => console.warn('Google Calendar schedule sync warning:', err));

  closeAddScheduleModal();
  renderScheduleGrid();
  populateTaskFolderMenus();
  renderHomeStatusAndNotifications();
  if (!editId) {
 awardActivityCoins(15, 'Schedule Period Added');
  }
  triggerGoogleBackup();
}

function deleteScheduleEntry(id) {
  const currentOwner = googleAccount || userName || 'Guest';
  allData = allData.filter(d => d.id !== id);
  localStorage.setItem(`hdsfd_data_${currentOwner}`, JSON.stringify(allData));
  deleteData(id);
  renderScheduleGrid();
  populateTaskFolderMenus();
  renderHomeStatusAndNotifications();
  triggerGoogleBackup();
}

function formatTime12h(timeStr) {
  if (!timeStr) return '';
  const [h, m] = timeStr.split(':');
  let hour = parseInt(h, 10);
  const min = m || '00';
  const ampm = hour >= 12 ? 'PM' : 'AM';
  hour = hour % 12 || 12;
  return `${hour}:${min} ${ampm}`;
}

function renderScheduleGrid() {
  const container = document.getElementById('schedule-cards-list');
  if (!container) return;

  const entries = allData.filter(d => d.type === 'schedule_entry');
  
  // Filter by active day
  const filtered = activeScheduleDayFilter === 'all' 
    ? entries 
    : entries.filter(e => Array.isArray(e.days) && e.days.includes(activeScheduleDayFilter));

  // Sort by start_time
  filtered.sort((a, b) => (a.start_time || '00:00').localeCompare(b.start_time || '00:00'));

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="glass p-6 rounded-2xl border border-white/10 text-center space-y-3 my-4">
        <div class="text-white/25">${hdsfdIcon('clock')}</div>
        <div>
          <h4 class="text-sm font-bold text-white">No Schedule Entries for ${activeScheduleDayFilter === 'all' ? 'this week' : activeScheduleDayFilter}</h4>
          <p class="text-xs text-white/50 mt-1">Add your daily classes, study periods, or routine blocks.</p>
        </div>
        <button onclick="openAddScheduleModal()" class="px-4 py-2 rounded-xl bg-purple-500/30 text-purple-200 border border-purple-500/40 text-xs font-bold hover:bg-purple-500/50 transition-all">
          ${hdsfdIcon('plus')} Add Class / Period
        </button>
      </div>
    `;
    return;
  }

  const colorStyles = {
    purple: { border: 'border-l-purple-400', badge: 'bg-purple-500/20 text-purple-300 border-purple-500/30' },
    blue: { border: 'border-l-blue-400', badge: 'bg-blue-500/20 text-blue-300 border-blue-500/30' },
    emerald: { border: 'border-l-emerald-400', badge: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' },
    amber: { border: 'border-l-amber-400', badge: 'bg-amber-500/20 text-amber-300 border-amber-500/30' },
    rose: { border: 'border-l-rose-400', badge: 'bg-rose-500/20 text-rose-300 border-rose-500/30' },
    cyan: { border: 'border-l-cyan-400', badge: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30' }
  };

  container.innerHTML = filtered.map(item => {
    const cTheme = colorStyles[item.color] || colorStyles.purple;
    const daysStr = Array.isArray(item.days) ? item.days.join(' • ') : 'Daily';
    const timeDisplay = `${formatTime12h(item.start_time)} - ${formatTime12h(item.end_time)}`;

    return `
      <div class="glass p-3.5 rounded-2xl border border-white/10 border-l-4 ${cTheme.border} flex items-center justify-between hover:bg-white/[0.08] transition-all group">
        <div class="space-y-1">
          <div class="flex items-center gap-2">
            <h4 class="text-xs font-bold text-white">${escapeHtml(item.title)}</h4>
            <span class="text-[9px] font-bold px-2 py-0.5 rounded-full border ${cTheme.badge}">${daysStr}</span>
          </div>
          <div class="flex items-center gap-3 text-[11px] text-white/70">
            <span class="flex items-center gap-1 text-purple-300 font-semibold">${hdsfdIcon('clock')} ${timeDisplay}</span>
            ${item.location ? `<span class="flex items-center gap-1 text-white/50">${hdsfdIcon('pin')} ${escapeHtml(item.location)}</span>` : ''}
          </div>
        </div>

        <div class="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
          <button onclick="openAddScheduleModal('${item.id}')" class="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/15 text-white/70 hover:text-white flex items-center justify-center text-xs transition-all" title="Edit Class">${hdsfdIcon('pencil')}</button>
          <button onclick="deleteScheduleEntry('${item.id}')" class="w-7 h-7 rounded-lg bg-red-500/10 hover:bg-red-500/30 text-red-300 flex items-center justify-center text-xs transition-all" title="Delete Class">${hdsfdIcon('trash-2')}</button>
        </div>
      </div>
    `;
  }).join('');
}

// ===== HOME LIVE SCHEDULE & NOTIFICATIONS STATUS SYSTEM =====
function renderHomeStatusAndNotifications() {
  const statusTitle = document.getElementById('home-status-class-title');
  const statusTime = document.getElementById('home-status-class-time');
  const statusBadge = document.getElementById('home-status-badge');
  const upcomingList = document.getElementById('home-upcoming-events-list');

  if (!statusTitle || !statusTime) return;

  const now = new Date();
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const todayAbbr = dayNames[now.getDay()];
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  // Find all schedule entries for today
  const scheduleEntries = allData.filter(d => 
    d.type === 'schedule_entry' && Array.isArray(d.days) && d.days.includes(todayAbbr)
  );

  let activeClass = null;
  let nextClass = null;
  let minMinutesUntilNext = Infinity;

  scheduleEntries.forEach(entry => {
    if (!entry.start_time || !entry.end_time) return;
    const [sh, sm] = entry.start_time.split(':').map(Number);
    const [eh, em] = entry.end_time.split(':').map(Number);
    const startMins = sh * 60 + sm;
    const endMins = eh * 60 + em;

    if (currentMinutes >= startMins && currentMinutes < endMins) {
      activeClass = entry;
    } else if (startMins > currentMinutes) {
      const diff = startMins - currentMinutes;
      if (diff < minMinutesUntilNext) {
        minMinutesUntilNext = diff;
        nextClass = entry;
      }
    }
  });

  if (activeClass) {
    statusTitle.textContent = `${activeClass.title}`;
    statusTime.textContent = `In Session: ${formatTime12h(activeClass.start_time)} - ${formatTime12h(activeClass.end_time)}${activeClass.location ? ' • ' + activeClass.location : ''}`;
    if (statusBadge) {
      statusBadge.textContent = 'In Class';
      statusBadge.className = 'text-[9px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded-full font-bold shadow-sm';
    }
    // Auto-select this class for task creator if default
    if (!selectedNewTaskFolder || selectedNewTaskFolder === 'My Tasks' || selectedNewTaskFolder === 'General') {
      selectedNewTaskFolder = activeClass.title;
      const label = document.getElementById('gtask-folder-btn-label');
      if (label) label.textContent = activeClass.title;
    }
  } else if (nextClass) {
    const hours = Math.floor(minMinutesUntilNext / 60);
    const mins = minMinutesUntilNext % 60;
    const timeUntilStr = hours > 0 ? `${hours}h ${mins}m` : `${mins} mins`;

    statusTitle.textContent = `Next: ${nextClass.title}`;
    statusTime.textContent = `Starts at ${formatTime12h(nextClass.start_time)} (in ${timeUntilStr})${nextClass.location ? ' • ' + nextClass.location : ''}`;
    if (statusBadge) {
      statusBadge.textContent = 'Upcoming';
      statusBadge.className = 'text-[9px] bg-sky-500/20 text-sky-300 border border-sky-500/30 px-2 py-0.5 rounded-full font-bold';
    }
  } else {
    statusTitle.textContent = scheduleEntries.length > 0 ? 'All classes finished for today' : 'No classes scheduled today';
    statusTime.textContent = 'Free deep focus study session';
    if (statusBadge) {
      statusBadge.textContent = 'Focus';
      statusBadge.className = 'text-[9px] bg-purple-500/20 text-purple-300 border border-purple-500/30 px-2 py-0.5 rounded-full font-bold';
    }
  }

  // Render upcoming events / schedule notifications list
  if (upcomingList) {
    let notificationsHtml = '';

    // 1. Next 2 classes today or upcoming days
    const upcomingSchedule = allData
      .filter(d => d.type === 'schedule_entry')
      .slice(0, 2);

    upcomingSchedule.forEach(sc => {
      const daysStr = Array.isArray(sc.days) ? sc.days.join(', ') : 'Daily';
      notificationsHtml += `
        <div class="flex items-center justify-between text-[11px] bg-white/[0.04] px-2.5 py-1.5 rounded-xl border border-white/10">
          <div class="flex items-center gap-1.5 truncate">
            <span class="text-sky-300">${hdsfdIcon('book')}</span>
            <span class="text-white font-semibold truncate">${escapeHtml(sc.title)}</span>
          </div>
          <span class="text-[9px] text-purple-300 font-bold bg-purple-500/20 px-1.5 py-0.5 rounded whitespace-nowrap">${daysStr} • ${formatTime12h(sc.start_time)}</span>
        </div>
      `;
    });

    // 2. Google Calendar Events
    const calEvents = (window.googleCalendarEvents || []).slice(0, 2);
    calEvents.forEach(ev => {
      notificationsHtml += `
        <div class="flex items-center justify-between text-[11px] bg-white/[0.04] px-2.5 py-1.5 rounded-xl border border-white/10">
          <div class="flex items-center gap-1.5 truncate">
            <span class="text-purple-300">${hdsfdIcon('calendar')}</span>
            <span class="text-sky-200 font-semibold truncate">${escapeHtml(ev.summary || 'Event')}</span>
          </div>
          <span class="text-[9px] text-sky-300 font-bold bg-sky-500/20 px-1.5 py-0.5 rounded whitespace-nowrap">Google Cal</span>
        </div>
      `;
    });

    if (!notificationsHtml) {
      notificationsHtml = `
        <p class="text-[10px] text-white/40 italic text-center py-1">No upcoming notifications</p>
      `;
    }

    upcomingList.innerHTML = notificationsHtml;
  }
}

function initSplitResizer() {
  const handle = document.getElementById('split-resizer-handle');
  const container = document.getElementById('tasks-split-container');
  const calPanel = document.getElementById('calendar-panel');
  const tasksPanel = document.getElementById('tasks-panel');

  if (!handle || !container || !calPanel || !tasksPanel) return;

  // Percentage widths only make sense while the panels sit side by side. When
  // they stack, an inline width would squeeze one pane into a sliver, so drop
  // the inline width entirely and let the stylesheet's 100% win.
  // Keep either pane wide enough to use: outside this band the calendar turns
  // into 30px columns, which is what a stale ratio saved from the stacked
  // layout used to produce.
  const MIN_RATIO = 35;
  const MAX_RATIO = 65;
  const clampRatio = pct => Math.max(MIN_RATIO, Math.min(MAX_RATIO, pct));

  let ratio = clampRatio(parseFloat(localStorage.getItem('hdsfd_split_ratio')) || 56);
  localStorage.setItem('hdsfd_split_ratio', ratio);
  const wideLayout = window.matchMedia('(min-width: 1200px)');

  function applySplitWidths() {
    if (!wideLayout.matches) {
      calPanel.style.width = '';
      tasksPanel.style.width = '';
      return;
    }
    calPanel.style.width = `${ratio}%`;
    tasksPanel.style.width = `${100 - ratio}%`;
  }
  applySplitWidths();
  wideLayout.addEventListener('change', applySplitWidths);
  window.addEventListener('resize', applySplitWidths);

  let isDragging = false;

  handle.addEventListener('pointerdown', (e) => {
    isDragging = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    function onPointerMove(e) {
      if (!isDragging || !wideLayout.matches) return;
      const rect = container.getBoundingClientRect();
      const offset = e.clientX - rect.left;
      let pct = clampRatio((offset / rect.width) * 100);

      // Magnetic Snapping Points: 33.33% (1/3 Cal, 2/3 Tasks), 50% (1/2 Middle), 66.67% (2/3 Cal, 1/3 Tasks)
      if (pct >= 30 && pct <= 36) {
        pct = 33.33;
      } else if (pct >= 47 && pct <= 53) {
        pct = 50;
      } else if (pct >= 64 && pct <= 70) {
        pct = 66.67;
      }

      calPanel.style.width = `${pct}%`;
      tasksPanel.style.width = `${100 - pct}%`;
    }

    function onPointerUp() {
      if (isDragging) {
        isDragging = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        const curWidth = parseFloat(calPanel.style.width) || ratio;
        ratio = curWidth;
        localStorage.setItem('hdsfd_split_ratio', curWidth);
        document.removeEventListener('pointermove', onPointerMove);
        document.removeEventListener('pointerup', onPointerUp);
      }
    }

    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
  });
}

function setSplitSnap(targetPct) {
  const calPanel = document.getElementById('calendar-panel');
  const tasksPanel = document.getElementById('tasks-panel');
  const clamped = Math.max(35, Math.min(65, targetPct));
  localStorage.setItem('hdsfd_split_ratio', clamped);
  if (!calPanel || !tasksPanel) return;
  // Stacked layout ignores the ratio; only a side-by-side split can apply it.
  if (!window.matchMedia('(min-width: 1200px)').matches) return;
  calPanel.style.width = `${clamped}%`;
  tasksPanel.style.width = `${100 - clamped}%`;
}

// ===== STARRED TASKS VIEW (INSTANT & AUTOMATIC SYNC) =====
function renderHomeStarredTasks() {
  const listEl = document.getElementById('home-starred-tasks-list');
  const zenListEl = document.getElementById('zen-quick-tasks-list');
  if (!listEl && !zenListEl) return;

  const tasks = allData.filter(d => d.type === 'task' && d.is_important);

  if (tasks.length === 0) {
    const emptyMsg = '<p class="text-white/40 text-[11px] italic text-center py-8">No starred tasks! Click the star on any task in Tasks tab to pin here.</p>';
    if (listEl) listEl.innerHTML = emptyMsg;
    if (zenListEl) zenListEl.innerHTML = '<span class="text-[10px] text-white/40 italic">No starred tasks</span>';
    return;
  }

  const groups = {};
  tasks.forEach(t => {
    const listKey = t.folder || 'My Tasks';
    if (!groups[listKey]) groups[listKey] = [];
    groups[listKey].push(t);
  });

  let html = '';
  let zenHtml = '';

  for (const [folderName, groupTasks] of Object.entries(groups)) {
    groupTasks.sort((a, b) => (a.completed === b.completed ? 0 : a.completed ? 1 : -1));

    html += `
      <div class="space-y-1">
        <div class="text-[9px] uppercase font-bold tracking-wider text-purple-300/80 px-1 border-b border-white/5 pb-0.5 flex items-center gap-1">
          <span class="text-purple-300">${hdsfdIcon('folder')}</span> <span>${folderName}</span>
        </div>
        ${groupTasks.map(t => {
          const dueFormatted = t.due ? new Date(t.due).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '';
          return `
            <div class="glass p-2.5 rounded-2xl flex items-center justify-between border border-white/10 hover:border-white/20 text-left transition-all ${t.completed ? 'opacity-40' : ''}">
              <div class="flex items-center gap-2 overflow-hidden flex-1">
                <input type="checkbox" ${t.completed ? 'checked' : ''} onchange="toggleTaskState('${t.id}')" class="w-3.5 h-3.5 accent-amber-400 cursor-pointer flex-shrink-0">
                <div class="flex flex-col truncate">
                  <span class="text-xs ${t.completed ? 'line-through text-white/40' : 'text-white font-medium'} truncate">${t.title}</span>
                  ${dueFormatted ? `<span class="text-[8px] text-amber-300/80 flex items-center gap-1">${hdsfdIcon('calendar')} ${dueFormatted}</span>` : ''}
                </div>
              </div>
              <button onclick="toggleTaskImportance('${t.id}')" class="text-xs text-amber-300 px-1 hover:scale-110 transition-all" title="Unstar to remove from Home">${hdsfdIcon('star')}</button>
            </div>
          `;
        }).join('')}
      </div>
    `;

    zenHtml += groupTasks.map(t => `
      <div class="flex items-center justify-between text-[10px] py-0.5">
        <span class="${t.completed ? 'line-through text-white/30' : 'text-white'} truncate">• ${t.title}</span>
        <span class="text-[8px] text-purple-300">${folderName}</span>
      </div>
    `).join('');
  }

  if (listEl) listEl.innerHTML = html;
  if (zenListEl) zenListEl.innerHTML = zenHtml;
}

function toggleTaskImportance(id) {
  const currentOwner = googleAccount || userName || 'Guest';
  const task = allData.find(d => d.id === id);
  if (!task) return;

  task.is_important = !task.is_important;
  localStorage.setItem(`hdsfd_data_${currentOwner}`, JSON.stringify(allData));
  
  // Instantaneous local UI updates with 0 delay
  renderDirectGTasks();
  renderHomeStarredTasks();
  renderDarkCalendarGrid();
}

function toggleTaskState(id) {
  const currentOwner = googleAccount || userName || 'Guest';
  const task = allData.find(d => d.id === id);
  if (!task) return;

  task.completed = !task.completed;
  localStorage.setItem(`hdsfd_data_${currentOwner}`, JSON.stringify(allData));
  
  if (task.completed) {
    // Calculate base coins: Starred = 20, Normal = 10
    let baseCoins = task.is_important ? 20 : 10;
    
    // Deadline bonus / penalty
    if (task.deadline) {
      const now = new Date();
      const deadlineDate = new Date(task.deadline + 'T23:59:59');
      const diffMs = deadlineDate - now;
      const diffDays = diffMs / (1000 * 60 * 60 * 24);

      if (diffDays >= 0) {
        // Completed early: Bonus proportional to days early (max +50 coins)
        const earlyBonus = Math.min(30, Math.round(diffDays * 5));
        baseCoins = Math.min(50, baseCoins + earlyBonus);
      } else {
        // Completed past deadline: minimum 1-10 coins
        baseCoins = Math.max(1, Math.min(10, Math.round(baseCoins - Math.abs(diffDays) * 2)));
      }
    }

    task.earned_coins = baseCoins;
 awardActivityCoins(baseCoins, task.is_important ? 'Starred Task Completed ' : 'Task Completed');
    healSanctuaryTree(15);
  } else {
    // Unchecking task: deduct previously earned coins
    const coinsToDeduct = task.earned_coins || (task.is_important ? 20 : 10);
    deductActivityCoins(coinsToDeduct, 'Task Unchecked');
    task.earned_coins = 0;
  }

  renderDirectGTasks();
  renderHomeStarredTasks();
  renderDarkCalendarGrid();
  updateStatsOverview();

  fetch(`${API_BASE}/google/tasks/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: currentOwner,
      tasklist_id: task.tasklist_id || '@default',
      completed: task.completed
    })
  }).catch(err => console.warn('Task state sync warning:', err));
}



// ===== SKEUOMORPHIC 3D JIGGLE PHYSICS STICKY NOTES ENGINE =====
let activeDraggedNoteId = null;
let isDraggingNote = false;
let noteDragStartX = 0;
let noteDragStartY = 0;
let noteInitialX = 0;
let noteInitialY = 0;
let noteLastPointerX = 0;
let noteLastPointerY = 0;
let noteVelocityX = 0;
let noteVelocityY = 0;
let notePhysicsMap = {};
let pendingDeleteNoteId = null;

function setSelectedPostItColor(color) {
  selectedPostItColor = color;
  ['yellow', 'pink', 'blue', 'green', 'purple'].forEach(c => {
    const btn = document.getElementById(`color-btn-${c}`);
    if (btn) {
      if (c === color) btn.className = `w-5 h-5 rounded-full bg-${c === 'yellow' ? 'yellow-300' : c === 'pink' ? 'pink-300' : c === 'blue' ? 'sky-300' : c === 'green' ? 'emerald-300' : 'purple-300'} ring-2 ring-white transition-all scale-110`;
      else btn.className = `w-5 h-5 rounded-full bg-${c === 'yellow' ? 'yellow-300' : c === 'pink' ? 'pink-300' : c === 'blue' ? 'sky-300' : c === 'green' ? 'emerald-300' : 'purple-300'} hover:opacity-80 transition-all`;
    }
  });
}

function addPhysicsPostIt() {
  const currentOwner = googleAccount || userName || 'Guest';
  const randomRot = parseFloat((Math.random() * 3.6 - 1.8).toFixed(1));

  const noteItem = {
    id: 'note_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
    type: 'note',
    content: '',
    title: 'Sticky Note',
    color: selectedPostItColor || 'yellow',
    tab: activeTab || 'notes',
    width: 175,
    height: 175,
    rotation: randomRot,
    xPct: 20 + Math.random() * 40,
    yPct: 20 + Math.random() * 35,
    drawMode: false,
    paths: [],
    created_at: new Date().toISOString(),
    username: currentOwner
  };

  createData(noteItem);
  renderPhysicsPostIts();
 awardActivityCoins(5, 'Sticky Note Created');
}

function addPostItNote() {
  addPhysicsPostIt();
}

function renderPhysicsPostIts() {
  const arena = document.getElementById('notes-canvas-arena');
  const globalOverlay = document.getElementById('global-postit-overlay');

  const notes = allData.filter(d => d.type === 'note');

  function createNoteElementHtml(note, isGridMode) {
    const colorClass = `phys-post-it-${note.color || 'yellow'}`;
    const isDrawMode = !!note.drawMode;
    const width = note.width || 175;
    const height = note.height || 175;
    const rot = note.rotation !== undefined ? note.rotation : 0;
    const fontSize = Math.max(9, Math.min(15, Math.round(height * 0.08)));
    const lineHeight = Math.round(fontSize * 1.35);

    let positionStyles = '';
    if (isGridMode) {
      positionStyles = `position: relative; width: ${width}px; height: ${height}px; min-height: 0px; transform: rotate(${rot}deg); margin: 6px; flex-shrink: 0; transition: transform 0.22s cubic-bezier(0.2, 0, 0, 1), box-shadow 0.2s ease;`;
    } else {
      const leftVal = note.xPct !== undefined ? `${note.xPct}%` : (note.x !== undefined ? `${note.x}px` : '100px');
      const topVal = note.yPct !== undefined ? `${note.yPct}%` : (note.y !== undefined ? `${note.y}px` : '120px');
      positionStyles = `position: fixed; left: ${leftVal}; top: ${topVal}; width: ${width}px; height: ${height}px; min-height: 0px; transform: rotate(${rot}deg); pointer-events: auto;`;
    }

    return `
      <div 
        id="note-card-${note.id}"
        class="phys-post-it ${colorClass} group" 
        style="${positionStyles}" 
        data-id="${note.id}"
        onpointerdown="initNotePhysicsDrag('${note.id}', event)"
      >
        <!-- Top Tape Strip (Clean Physical Grab Handle) -->
        <div class="note-tape" title="Hold & drag to lift note across any tab"></div>

        <!-- Top Left Corner: Mode Toggle -->
        <button type="button" onclick="toggleNoteDrawMode('${note.id}', event)" class="note-corner-btn-left" title="${isDrawMode ? 'Switch to Typing' : 'Switch to Drawing'}">
          <span class="${isDrawMode ? 'text-purple-950 font-bold scale-110' : 'text-black/60'}">${hdsfdIcon(isDrawMode ? 'pencil' : 'pen-line')}</span>
        </button>

        <!-- Top Right Corner: Delete (custom in-app modal) -->
        <button type="button" onclick="openDeleteNoteModal('${note.id}', event)" class="note-corner-btn-right" title="Delete Sticky Note">
          ${hdsfdIcon('x')}
        </button>

        <!-- Bottom Right Corner: Smooth Resize Corner -->
        <div class="note-resize-handle" onpointerdown="initNoteResize('${note.id}', event)" title="Drag corner to resize">
          <span class="text-[10px] text-black/35 font-bold select-none">⤡</span>
        </div>

        <!-- Freehand Vector Canvas Layer -->
        <canvas 
          id="canvas-${note.id}" 
          class="note-canvas ${isDrawMode ? 'pointer-events-auto' : 'pointer-events-none'}" 
          onpointerdown="startCanvasDrawing('${note.id}', event)"
          onpointermove="moveCanvasDrawing('${note.id}', event)"
          onpointerup="endCanvasDrawing('${note.id}', event)"
          onpointerleave="endCanvasDrawing('${note.id}', event)"
        ></canvas>

        <!-- Minimalist Zero-UI Writing Surface with Dynamic Font Scaling -->
        <textarea 
          placeholder="${isDrawMode ? '' : 'Click to write...'}" 
          class="note-textarea ${isDrawMode ? 'pointer-events-none opacity-75' : 'pointer-events-auto'}"
          style="font-size: ${fontSize}px; line-height: ${lineHeight}px;"
          oninput="debounceUpdateNoteText('${note.id}', this.value)"
        >${note.content || ''}</textarea>

        <!-- "Clear" Ink Option (Appears ONLY in Draw Mode when strokes exist) -->
        ${(isDrawMode && note.paths && note.paths.length > 0) ? `
          <button type="button" onclick="clearNoteDrawings('${note.id}', event)" class="absolute bottom-1.5 left-1.5 z-20 text-[9px] bg-black/15 hover:bg-black/25 text-black/80 font-bold px-2 py-0.5 rounded shadow-sm transition-all" title="Clear Canvas Drawing">
            Clear
          </button>
        ` : ''}
      </div>
    `;
  }

  // Preserve the currently dragged note element if dragging across tabs
  const activeDraggedEl = (isDraggingNote && activeDraggedNoteId) ? document.getElementById(`note-card-${activeDraggedNoteId}`) : null;

  // 1. In Notes Tab (Tab 3): Render 1 Interactive Drag-to-Peel Sticky Pad Pile + board notes
  if (arena) {
    if (activeTab === 'notes') {
      const boardNotes = notes.filter(n => (n.tab || 'notes') === 'notes' && !n.floatingOverlay && n.id !== activeDraggedNoteId);
      
      const stackHtml = `
        <div 
          id="infinite-sticky-stack" 
          onpointerdown="initPadPeelDrag(event)" 
          class="relative w-44 h-44 cursor-grab group flex-shrink-0 select-none p-1 m-1" 
          title="Drag to peel a new sticky note directly onto the board or any tab!"
        >
          <!-- 3D Layered Under-Notes (Physical Stack Look) -->
          <div class="absolute inset-3 bg-yellow-200/60 rounded-md transform rotate-3 scale-95 border border-yellow-400/20 shadow-md"></div>
          <div class="absolute inset-2 bg-pink-200/70 rounded-md transform -rotate-2 scale-98 border border-pink-400/20 shadow-md"></div>
          <div class="absolute inset-1.5 bg-sky-200/60 rounded-md transform rotate-1 scale-99 border border-sky-400/20 shadow-md"></div>
          
          <!-- Top Pad Surface (Looks & Acts Like Real Top Note Sheet) -->
          <div class="absolute inset-1 bg-gradient-to-br from-yellow-100 to-yellow-300 rounded-md border border-yellow-400/40 shadow-xl flex flex-col items-center justify-center group-hover:scale-105 group-active:scale-95 transition-all duration-200">
            <!-- Frosted Tape Strip -->
            <div class="w-14 h-4 bg-white/75 backdrop-blur-sm rounded-sm mb-3 shadow-sm border-l border-r border-dashed border-black/20"></div>
            <span class="text-3xl font-black text-amber-950/70 group-hover:text-amber-950 transition-colors">+</span>
            <span class="text-[10px] font-black text-amber-950/70 uppercase tracking-widest mt-1">Sticky Pad</span>
            <span class="text-[8px] font-bold text-amber-950/50 mt-0.5">Drag to peel note</span>
          </div>
        </div>
      `;

      arena.innerHTML = `
        <div class="w-full h-full overflow-y-auto flex flex-wrap items-start content-start gap-4 p-2">
          ${stackHtml}
          ${boardNotes.map(n => createNoteElementHtml(n, true)).join('')}
        </div>
      `;
      boardNotes.forEach(n => initNoteCanvasSurface(n));
    } else {
      arena.innerHTML = '';
    }
  }

  // 2. Global Overlay: Render notes assigned to current tab (including notes placed over the Gemini iframe)
  if (globalOverlay) {
    let overlayNotes = [];
    if (activeTab === 'notes') {
      overlayNotes = notes.filter(n => (n.tab === 'notes' && n.floatingOverlay) && n.id !== activeDraggedNoteId);
    } else {
      overlayNotes = notes.filter(n => n.tab && n.tab === activeTab && n.tab !== 'notes' && n.id !== activeDraggedNoteId);
    }
    
    globalOverlay.innerHTML = overlayNotes.map(n => createNoteElementHtml(n, false)).join('');
    overlayNotes.forEach(n => initNoteCanvasSurface(n));

    // Re-attach active dragged element so it NEVER disappears during tab switch!
    if (activeDraggedEl && isDraggingNote) {
      globalOverlay.appendChild(activeDraggedEl);
    }
  }
}

function renderPostItBoard() {
  renderPhysicsPostIts();
}

// ===== PEEL STICKY NOTE FROM PILE ON DRAG =====
function initPadPeelDrag(e) {
  const currentOwner = googleAccount || userName || 'Guest';
  const randomRot = parseFloat((Math.random() * 3.6 - 1.8).toFixed(1));

  const noteItem = {
    id: 'note_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
    type: 'note',
    content: '',
    title: 'Sticky Note',
    color: selectedPostItColor || 'yellow',
    tab: activeTab || 'notes',
    width: 175,
    height: 175,
    rotation: randomRot,
    xPct: Math.max(2, Math.min(85, parseFloat(((e.clientX / window.innerWidth) * 100).toFixed(2)))),
    yPct: Math.max(5, Math.min(80, parseFloat(((e.clientY / window.innerHeight) * 100).toFixed(2)))),
    drawMode: false,
    paths: [],
    created_at: new Date().toISOString(),
    username: currentOwner
  };

  allData.push(noteItem);
  localStorage.setItem(`hdsfd_data_${currentOwner}`, JSON.stringify(allData));
  createData(noteItem);

  // Render to DOM first then immediately trigger drag
  renderPhysicsPostIts();

  setTimeout(() => {
    initNotePhysicsDrag(noteItem.id, e);
  }, 10);
}

// ===== CUSTOM IN-APP DELETE MODAL CONTROLLERS =====
function openDeleteNoteModal(noteId, e) {
  if (e) e.stopPropagation();
  pendingDeleteNoteId = noteId;
  const modal = document.getElementById('custom-delete-note-modal');
  if (modal) modal.classList.remove('hidden');
}

function closeDeleteNoteModal() {
  pendingDeleteNoteId = null;
  const modal = document.getElementById('custom-delete-note-modal');
  if (modal) modal.classList.add('hidden');
}

function executeConfirmedDeleteNote() {
  if (pendingDeleteNoteId) {
    const noteId = pendingDeleteNoteId;
    deleteData(noteId);
    triggerGoogleBackup();
    closeDeleteNoteModal();
    renderPhysicsPostIts();
  }
}

// ===== CLEAR ALL STICKY NOTES WITH 3-SECOND COUNTDOWN =====
let clearAllNotesTimer = null;
let clearAllNotesCountdown = 3;

function openClearAllNotesModal() {
  const modal = document.getElementById('clear-all-notes-modal');
  const btn = document.getElementById('confirm-clear-all-btn');
  if (!modal || !btn) return;

  modal.classList.remove('hidden');
  clearAllNotesCountdown = 3;
  btn.disabled = true;
  btn.textContent = `Delete All (${clearAllNotesCountdown}s)`;
  btn.className = 'flex-1 py-2.5 rounded-xl bg-red-600/40 text-white/50 text-xs font-black transition-all cursor-not-allowed';

  if (clearAllNotesTimer) clearInterval(clearAllNotesTimer);
  clearAllNotesTimer = setInterval(() => {
    clearAllNotesCountdown--;
    if (clearAllNotesCountdown > 0) {
      btn.textContent = `Delete All (${clearAllNotesCountdown}s)`;
    } else {
      clearInterval(clearAllNotesTimer);
      btn.disabled = false;
      btn.textContent = 'Confirm Delete All';
      btn.className = 'flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-black shadow-lg shadow-red-600/30 transition-all active:scale-95 cursor-pointer';
    }
  }, 1000);
}

function closeClearAllNotesModal() {
  if (clearAllNotesTimer) clearInterval(clearAllNotesTimer);
  const modal = document.getElementById('clear-all-notes-modal');
  if (modal) modal.classList.add('hidden');
}

function executeConfirmedClearAllNotes() {
  const currentOwner = googleAccount || userName || 'Guest';
  const notesToDelete = allData.filter(d => d.type === 'note');
  notesToDelete.forEach(n => deleteData(n.id));
  allData = allData.filter(d => d.type !== 'note');
  localStorage.setItem(`hdsfd_data_${currentOwner}`, JSON.stringify(allData));
  triggerGoogleBackup();
  closeClearAllNotesModal();
  renderPhysicsPostIts();
}

// ===== NOTE RESIZING WITH DYNAMIC FONT SCALING =====
function initNoteResize(noteId, e) {
  e.stopPropagation();
  const noteEl = document.getElementById(`note-card-${noteId}`);
  if (!noteEl) return;

  const startWidth = noteEl.offsetWidth;
  const startHeight = noteEl.offsetHeight;
  const startX = e.clientX;
  const startY = e.clientY;

  function onResizeMove(e) {
    const newWidth = Math.max(60, Math.min(500, startWidth + (e.clientX - startX)));
    const newHeight = Math.max(50, Math.min(500, startHeight + (e.clientY - startY)));
    noteEl.style.width = `${newWidth}px`;
    noteEl.style.height = `${newHeight}px`;
    noteEl.style.minHeight = '0px';

    const textarea = noteEl.querySelector('.note-textarea');
    if (textarea) {
      const fontSize = Math.max(9, Math.min(15, Math.round(newHeight * 0.08)));
      textarea.style.fontSize = `${fontSize}px`;
      textarea.style.lineHeight = `${Math.round(fontSize * 1.35)}px`;
    }

    const canvas = document.getElementById(`canvas-${noteId}`);
    if (canvas) {
      canvas.width = newWidth;
      canvas.height = newHeight;
      const targetNote = allData.find(d => d.id === noteId);
      if (targetNote) redrawNoteCanvasPaths(canvas, targetNote.paths);
    }
  }

  function onResizeUp() {
    document.removeEventListener('pointermove', onResizeMove);
    document.removeEventListener('pointerup', onResizeUp);

    const currentOwner = googleAccount || userName || 'Guest';
    const target = allData.find(d => d.id === noteId);
    if (target) {
      target.width = noteEl.offsetWidth;
      target.height = noteEl.offsetHeight;
      localStorage.setItem(`hdsfd_data_${currentOwner}`, JSON.stringify(allData));
      createData(target);
    }
  }

  document.addEventListener('pointermove', onResizeMove);
  document.addEventListener('pointerup', onResizeUp);
}

// ===== FREEHAND VECTOR CANVAS DRAWING =====
function initNoteCanvasSurface(note) {
  const canvas = document.getElementById(`canvas-${note.id}`);
  if (!canvas) return;

  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width || note.width || 175;
  canvas.height = rect.height || note.height || 175;

  redrawNoteCanvasPaths(canvas, note.paths);
}

function redrawNoteCanvasPaths(canvas, paths) {
  if (!canvas || !paths || !Array.isArray(paths)) return;
  const ctx = canvas.getContext('2d');
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#18181b';
  ctx.lineWidth = 2.0;

  paths.forEach(stroke => {
    if (stroke.points && stroke.points.length > 0) {
      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (let i = 1; i < stroke.points.length; i++) {
        const p1 = stroke.points[i - 1];
        const p2 = stroke.points[i];
        const midX = (p1.x + p2.x) / 2;
        const midY = (p1.y + p2.y) / 2;
        ctx.quadraticCurveTo(p1.x, p1.y, midX, midY);
      }
      ctx.stroke();
    }
  });
}

function toggleNoteDrawMode(noteId, e) {
  if (e) e.stopPropagation();
  const currentOwner = googleAccount || userName || 'Guest';
  const target = allData.find(d => d.id === noteId);
  if (target) {
    target.drawMode = !target.drawMode;
    localStorage.setItem(`hdsfd_data_${currentOwner}`, JSON.stringify(allData));
    createData(target);
    renderPhysicsPostIts();
  }
}

function clearNoteDrawings(noteId, e) {
  if (e) e.stopPropagation();
  const currentOwner = googleAccount || userName || 'Guest';
  const target = allData.find(d => d.id === noteId);
  if (target) {
    target.paths = [];
    localStorage.setItem(`hdsfd_data_${currentOwner}`, JSON.stringify(allData));
    createData(target);
    const canvas = document.getElementById(`canvas-${noteId}`);
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    renderPhysicsPostIts();
  }
}

function startCanvasDrawing(noteId, e) {
  e.stopPropagation();
  const canvas = document.getElementById(`canvas-${noteId}`);
  if (!canvas) return;

  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  if (!notePhysicsMap[noteId]) notePhysicsMap[noteId] = {};
  notePhysicsMap[noteId].isDrawing = true;
  notePhysicsMap[noteId].currentStroke = [{ x, y }];

  const ctx = canvas.getContext('2d');
  ctx.beginPath();
  ctx.moveTo(x, y);
}

function moveCanvasDrawing(noteId, e) {
  if (!notePhysicsMap[noteId] || !notePhysicsMap[noteId].isDrawing) return;
  e.stopPropagation();

  const canvas = document.getElementById(`canvas-${noteId}`);
  if (!canvas) return;

  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  const stroke = notePhysicsMap[noteId].currentStroke;
  stroke.push({ x, y });

  const ctx = canvas.getContext('2d');
  ctx.lineTo(x, y);
  ctx.stroke();
}

function endCanvasDrawing(noteId, e) {
  if (!notePhysicsMap[noteId] || !notePhysicsMap[noteId].isDrawing) return;
  if (e) e.stopPropagation();

  notePhysicsMap[noteId].isDrawing = false;
  const stroke = notePhysicsMap[noteId].currentStroke;
  
  if (stroke && stroke.length > 1) {
    const currentOwner = googleAccount || userName || 'Guest';
    const target = allData.find(d => d.id === noteId);
    if (target) {
      target.paths = target.paths || [];
      target.paths.push({ points: stroke });
      localStorage.setItem(`hdsfd_data_${currentOwner}`, JSON.stringify(allData));
      createData(target);
    }
  }
}

// ===== ULTRA HIGH PERFORMANCE 60FPS GPU DRAG & DROP ENGINE =====
function initNotePhysicsDrag(noteId, e) {
  if (e.target.closest('textarea') || e.target.closest('button') || e.target.closest('.note-resize-handle') || e.target.closest('canvas.pointer-events-auto')) return;
  const noteEl = document.getElementById(`note-card-${noteId}`);
  if (!noteEl) return;

  activeDraggedNoteId = noteId;
  isDraggingNote = true;

  const rect = noteEl.getBoundingClientRect();
  const grabOffsetX = e.clientX - rect.left;
  const grabOffsetY = e.clientY - rect.top;

  let currentPointerX = e.clientX;
  let currentPointerY = e.clientY;
  let prevPointerX = e.clientX;
  let prevPointerY = e.clientY;
  let velocityX = 0;
  let velocityY = 0;
  let rAFId = null;

  // Elevate to fixed dragging overlay with GPU transform
  noteEl.style.position = 'fixed';
  noteEl.style.left = '0px';
  noteEl.style.top = '0px';
  noteEl.style.width = `${rect.width}px`;
  noteEl.style.height = `${rect.height}px`;
  noteEl.style.zIndex = '9999999';
  noteEl.style.transform = `translate3d(${rect.left}px, ${rect.top}px, 0px) scale(1.06)`;
  noteEl.classList.add('is-dragging');

  // Prevent iframe interference while dragging
  document.querySelectorAll('iframe').forEach(f => f.style.pointerEvents = 'none');

  // Ensure note is attached to global layer to prevent any parent clipping
  const globalOverlay = document.getElementById('global-postit-overlay');
  if (globalOverlay && noteEl.parentElement !== globalOverlay) {
    globalOverlay.appendChild(noteEl);
  }

  function updateDragFrame() {
    if (!isDraggingNote || activeDraggedNoteId !== noteId) return;

    const curX = currentPointerX - grabOffsetX;
    const curY = currentPointerY - grabOffsetY;

    velocityX = (currentPointerX - prevPointerX);
    velocityY = (currentPointerY - prevPointerY);
    prevPointerX = currentPointerX;
    prevPointerY = currentPointerY;

    const tilt = Math.max(-14, Math.min(14, velocityX * 0.65));
    const pitch = Math.max(-8, Math.min(8, -velocityY * 0.3));

    noteEl.style.transform = `translate3d(${curX}px, ${curY}px, 0px) perspective(600px) rotateZ(${tilt}deg) rotateX(${pitch}deg) scale(1.06)`;

    if (!notePhysicsMap[noteId]) notePhysicsMap[noteId] = {};
    notePhysicsMap[noteId].x = curX;
    notePhysicsMap[noteId].y = curY;
    notePhysicsMap[noteId].rot = tilt;

    // Fluid Drag Gap Shift Animation inside Tab 3 Board Arena
    if (activeTab === 'notes') {
      const arena = document.getElementById('notes-canvas-arena');
      const arenaRect = arena ? arena.getBoundingClientRect() : null;
      if (arenaRect && currentPointerX >= arenaRect.left - 10 && currentPointerX <= arenaRect.right + 10 && currentPointerY >= arenaRect.top - 10 && currentPointerY <= arenaRect.bottom + 10) {
        const boardCards = Array.from(document.querySelectorAll('#notes-canvas-arena .phys-post-it:not(.is-dragging)'));
        let foundIdx = boardCards.length;
        for (let i = 0; i < boardCards.length; i++) {
          const cardRect = boardCards[i].getBoundingClientRect();
          const cardCenterX = cardRect.left + cardRect.width / 2;
          const cardCenterY = cardRect.top + cardRect.height / 2;
          if (currentPointerY < cardCenterY || (Math.abs(currentPointerY - cardCenterY) < 60 && currentPointerX < cardCenterX)) {
            foundIdx = i;
            break;
          }
        }
        notePhysicsMap[noteId].targetBoardIdx = foundIdx;

        // Smoothly animate sibling cards to fill in and make room
        boardCards.forEach((c, idx) => {
          if (idx >= foundIdx) {
            c.style.transition = 'transform 0.2s cubic-bezier(0.2, 0, 0, 1)';
            c.style.transform = 'scale(0.97) translate3d(8px, 4px, 0px)';
          } else {
            c.style.transition = 'transform 0.2s cubic-bezier(0.2, 0, 0, 1)';
            c.style.transform = '';
          }
        });
      }
    }

    // Accurate bottom nav tab switch check (matches exact physical button positions)
    const navBtns = document.querySelectorAll('.nav-btn');
    for (const btn of navBtns) {
      const bRect = btn.getBoundingClientRect();
      if (
        currentPointerX >= bRect.left &&
        currentPointerX <= bRect.right &&
        currentPointerY >= bRect.top - 20 &&
        currentPointerY <= bRect.bottom + 20
      ) {
        const targetTab = btn.dataset.tab;
        if (targetTab && targetTab !== activeTab) {
          switchTab(targetTab);
        }
        break;
      }
    }

    rAFId = null;
  }

  function onPointerMove(e) {
    if (!isDraggingNote || activeDraggedNoteId !== noteId) return;
    currentPointerX = e.clientX;
    currentPointerY = e.clientY;

    if (!rAFId) {
      rAFId = requestAnimationFrame(updateDragFrame);
    }
  }

  function onPointerUp(e) {
    if (!isDraggingNote || activeDraggedNoteId !== noteId) return;
    isDraggingNote = false;
    activeDraggedNoteId = null;
    if (rAFId) cancelAnimationFrame(rAFId);

    noteEl.classList.remove('is-dragging');
    document.querySelectorAll('iframe').forEach(f => f.style.pointerEvents = 'auto');
    document.querySelectorAll('#notes-canvas-arena .phys-post-it').forEach(c => c.style.transform = '');

    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerUp);

    const finalX = (notePhysicsMap[noteId] && notePhysicsMap[noteId].x !== undefined) ? notePhysicsMap[noteId].x : (e.clientX - grabOffsetX);
    const finalY = (notePhysicsMap[noteId] && notePhysicsMap[noteId].y !== undefined) ? notePhysicsMap[noteId].y : (e.clientY - grabOffsetY);
    const targetRestRot = parseFloat((Math.random() * 3.6 - 1.8).toFixed(1));
    const targetBoardIdx = (notePhysicsMap[noteId] && notePhysicsMap[noteId].targetBoardIdx !== undefined) ? notePhysicsMap[noteId].targetBoardIdx : null;

    // Check if dropped inside Tab 3 left notes board
    const arena = document.getElementById('notes-canvas-arena');
    const arenaRect = arena ? arena.getBoundingClientRect() : null;
    const droppedInArena = (activeTab === 'notes') && arenaRect && (
      finalX >= arenaRect.left - 10 &&
      finalX <= arenaRect.right - 20 &&
      finalY >= arenaRect.top - 10 &&
      finalY <= arenaRect.bottom - 20
    );

    const currentOwner = googleAccount || userName || 'Guest';
    const target = allData.find(d => d.id === noteId);
    if (target) {
      if (droppedInArena) {
        target.tab = 'notes';
        target.floatingOverlay = false;

        // Perform reordering in allData array
        if (targetBoardIdx !== null) {
          const boardNotes = allData.filter(d => d.type === 'note' && (d.tab || 'notes') === 'notes' && !d.floatingOverlay && d.id !== noteId);
          boardNotes.splice(targetBoardIdx, 0, target);
          const otherItems = allData.filter(d => !(d.type === 'note' && (d.tab || 'notes') === 'notes' && !d.floatingOverlay));
          allData = [...boardNotes, ...otherItems];
        }
      } else if (activeTab === 'notes') {
        // Dropped on the right half (on top of Gemini iframe)
        target.tab = 'notes';
        target.floatingOverlay = true;
        target.xPct = Math.max(1, Math.min(88, parseFloat(((finalX / window.innerWidth) * 100).toFixed(2))));
        target.yPct = Math.max(2, Math.min(84, parseFloat(((finalY / window.innerHeight) * 100).toFixed(2))));
      } else {
        // Dropped on Home, Tasks, or More tab
        target.tab = activeTab;
        target.floatingOverlay = false;
        target.xPct = Math.max(1, Math.min(88, parseFloat(((finalX / window.innerWidth) * 100).toFixed(2))));
        target.yPct = Math.max(2, Math.min(84, parseFloat(((finalY / window.innerHeight) * 100).toFixed(2))));
      }
      target.rotation = targetRestRot;
      localStorage.setItem(`hdsfd_data_${currentOwner}`, JSON.stringify(allData));
      createData(target);
    }

    renderPhysicsPostIts();
  }

  document.addEventListener('pointermove', onPointerMove, { passive: true });
  document.addEventListener('pointerup', onPointerUp);
}

function onCanvasArenaPointerDown(e) {
  // Arena touch handler
}

// ===== GEMINI IFRAME CONTROLLER =====
function reloadGeminiIframe() {
  const frame = document.getElementById('gemini-live-frame');
  if (frame) {
    frame.src = '/gemini-portal?_=' + Date.now();
  }
}

function openOfficialGeminiApp() {
  window.open('https://gemini.google.com/app', '_blank');
}

// ===== PC HOTKEYS CONTROLLER (1,2,3,4 & ARROW KEYS) =====
document.addEventListener('keydown', (e) => {
  const activeEl = document.activeElement;
  const isTyping = activeEl && (
    activeEl.tagName === 'INPUT' ||
    activeEl.tagName === 'TEXTAREA' ||
    activeEl.tagName === 'SELECT' ||
    activeEl.isContentEditable ||
    activeEl.classList.contains('note-textarea')
  );

  if (isTyping) return;

  const tabsOrder = ['focus', 'tasks-notes', 'notes', 'settings'];
  const curIdx = tabsOrder.indexOf(activeTab);

  if (e.key === '1') {
    switchTab('focus');
  } else if (e.key === '2') {
    switchTab('tasks-notes');
  } else if (e.key === '3') {
    switchTab('notes');
  } else if (e.key === '4') {
    switchTab('settings');
  } else if (e.key === 'ArrowLeft') {
    const prevIdx = (curIdx - 1 + tabsOrder.length) % tabsOrder.length;
    switchTab(tabsOrder[prevIdx]);
  } else if (e.key === 'ArrowRight') {
    const nextIdx = (curIdx + 1) % tabsOrder.length;
    switchTab(tabsOrder[nextIdx]);
  }
});

let noteDebounceTimers = {};

// Notes are persisted locally, synced to the server and copied into Drive
// backups, so each note gets a hard ceiling to keep payloads and storage bounded.
const MAX_NOTE_CHARS = 2000;
function clampNoteText(text) {
  const value = String(text == null ? '' : text);
  return value.length > MAX_NOTE_CHARS ? value.slice(0, MAX_NOTE_CHARS) : value;
}

function debounceUpdateNoteText(id, text) {
  const currentOwner = googleAccount || userName || 'Guest';
  const target = allData.find(d => d.id === id);
  if (target) {
    target.content = clampNoteText(text);
    localStorage.setItem(`hdsfd_data_${currentOwner}`, JSON.stringify(allData));
  }

  clearTimeout(noteDebounceTimers[id]);
  noteDebounceTimers[id] = setTimeout(() => {
    if (target) {
      createData(target);
    }
  }, 600);
}

function updatePostItColor(id, newColor) {
  const target = allData.find(d => d.id === id);
  if (target) {
    target.color = newColor;
    createData(target);
    renderPhysicsPostIts();
  }
}

// ===== TAB NAVIGATION =====
function switchTab(tab) {
  activeTab = tab;

  document.querySelectorAll('.tab-content').forEach(view => {
    view.classList.remove('active');
  });
  const target = document.getElementById(`tab-${tab}`);
  if (target) target.classList.add('active');

  document.querySelectorAll('.nav-btn').forEach(btn => {
    if (btn.dataset.tab === tab) {
      btn.className = 'nav-btn flex-1 py-1.5 flex flex-col items-center text-purple-300 font-bold transition-all';
    } else {
      btn.className = 'nav-btn flex-1 py-1.5 flex flex-col items-center text-white/40 font-bold hover:text-white transition-all';
    }
  });

  renderCurrentTab();
}

function renderCurrentTab() {
  try {
    if (activeTab === 'focus') {
      updateStatsOverview();
      renderHomeStarredTasks();
      renderHomeStatusAndNotifications();
      updateHourlyQuote();
    } else if (activeTab === 'tasks-notes') {
      renderDirectGTasks();
      renderDarkCalendarGrid();
      renderScheduleGrid();
    } else if (activeTab === 'notes') {
      renderPhysicsPostIts();
      loadGeminiChatHistory();
    } else if (activeTab === 'settings') {
      updateStatsOverview();
    }
    renderPhysicsPostIts(); // Always refresh global overlay pinned notes
    refreshIcons();
  } catch (e) {
    console.warn('Tab render warning:', e);
  }
}

// ===== GOOGLE GEMINI 2.0 FLASH AI AGENT CLIENT & TOOL EXECUTION =====
let geminiChatHistory = [];
let isGeminiThinking = false;

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ===== HDSFD ACCOUNT + SCHOOL CONNECT =====
function getHdsfdToken() {
  return localStorage.getItem('hdsfd_auth_token') || null;
}

// Signed-in sessions own the server data; guests stay local-only.
function hdsfdSessionUser() {
  const token = getHdsfdToken();
  const user = localStorage.getItem('hdsfd_auth_user');
  if (!token || !user) return null;
  const expires = localStorage.getItem('hdsfd_auth_expires');
  if (expires) {
    const expiresAt = Date.parse(expires);
    if (!isNaN(expiresAt) && expiresAt <= Date.now()) {
      localStorage.removeItem('hdsfd_auth_token');
      localStorage.removeItem('hdsfd_auth_user');
      localStorage.removeItem('hdsfd_auth_expires');
      return null;
    }
  }
  return user;
}

function hdsfdAuthHeaders(extra) {
  const headers = Object.assign({}, extra || {});
  const token = getHdsfdToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

function currentOwnerKey() {
  return hdsfdSessionUser() || googleAccount || userName || 'Guest';
}

async function hdsfdLogin() {
  const userEl = document.getElementById('school-login-username');
  const passEl = document.getElementById('school-login-password');
  const resultEl = document.getElementById('school-import-result');
  if (!userEl || !passEl) return;
  const username = userEl.value.trim();
  const password = passEl.value;
  if (username.length < 3 || password.length < 8) {
    if (resultEl) {
      resultEl.classList.remove('hidden');
      resultEl.innerHTML = '<span class="text-amber-300">Username must be 3+ characters and password 8+ characters.</span>';
    }
    return;
  }
  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.status !== 'success') {
      if (resultEl) {
        resultEl.classList.remove('hidden');
        resultEl.innerHTML = `<span class="text-rose-300">${escapeHtml(data.message || 'Sign in failed')}</span>`;
      }
      return;
    }
    localStorage.setItem('hdsfd_auth_token', data.token);
    localStorage.setItem('hdsfd_auth_user', data.username);
    localStorage.setItem('hdsfd_auth_expires', data.expires_at);
    passEl.value = '';
    await afterHdsfdSignIn();
    updateSchoolAccountUI();
    refreshSchoolStatus();
  } catch (err) {
    if (resultEl) {
      resultEl.classList.remove('hidden');
      resultEl.innerHTML = '<span class="text-rose-300">Network error — could not reach the server.</span>';
    }
  }
}

async function afterHdsfdSignIn() {
  const signedIn = hdsfdSessionUser();
  if (!signedIn) return;
  // Carry the local workspace over on first sign-in with this account.
  const previousOwner = googleAccount || userName || 'Guest';
  if (previousOwner && previousOwner !== signedIn) {
    const previousKey = `hdsfd_data_${previousOwner}`;
    const signedInKey = `hdsfd_data_${signedIn}`;
    if (!localStorage.getItem(signedInKey) && localStorage.getItem(previousKey)) {
      localStorage.setItem(signedInKey, localStorage.getItem(previousKey));
    }
  }
  await fetchData();
  renderCurrentTab();
  renderSanctuaryTree();
  loadUserStatsFromServer();
  loadGeminiChatHistory();
}

async function hdsfdLogout() {
  const token = getHdsfdToken();
  if (token) {
    try {
      await fetch(`${API_BASE}/auth/logout`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
      });
    } catch (err) { /* token cleared locally regardless */ }
  }
  localStorage.removeItem('hdsfd_auth_token');
  localStorage.removeItem('hdsfd_auth_user');
  localStorage.removeItem('hdsfd_auth_expires');
  updateSchoolAccountUI();
}

function updateSchoolAccountUI() {
  const token = getHdsfdToken();
  const user = localStorage.getItem('hdsfd_auth_user');
  const loginForm = document.getElementById('school-login-form');
  const accountView = document.getElementById('school-account-view');
  const nameEl = document.getElementById('school-account-name');
  const badge = document.getElementById('school-status-badge');
  if (token && user) {
    if (loginForm) loginForm.classList.add('hidden');
    if (accountView) accountView.classList.remove('hidden');
    if (nameEl) nameEl.textContent = user;
    if (badge) {
      badge.textContent = `Synced (${user})`;
      badge.className = 'text-[9px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded font-bold';
    }
  } else {
    if (loginForm) loginForm.classList.remove('hidden');
    if (accountView) accountView.classList.add('hidden');
    if (badge) {
      badge.textContent = 'Guest Mode';
      badge.className = 'text-[9px] bg-amber-500/20 text-amber-200 border border-amber-500/30 px-2 py-0.5 rounded font-bold';
    }
  }
}

async function schoolImportFile() {
  const fileEl = document.getElementById('school-import-file');
  const resultEl = document.getElementById('school-import-result');
  const token = getHdsfdToken();
  if (!resultEl) return;
  if (!token) {
    resultEl.classList.remove('hidden');
    resultEl.innerHTML = '<span class="text-amber-300">Sign in to your HDSFD account first.</span>';
    return;
  }
  if (!fileEl || !fileEl.files || !fileEl.files[0]) {
    resultEl.classList.remove('hidden');
    resultEl.innerHTML = '<span class="text-amber-300">Choose a .ics or .csv file to import.</span>';
    return;
  }
  const file = fileEl.files[0];
  if (file.size > 1500000) {
    resultEl.classList.remove('hidden');
    resultEl.innerHTML = '<span class="text-rose-300">File is too large (max 1.5 MB).</span>';
    return;
  }
  const format = file.name.toLowerCase().endsWith('.ics') ? 'ics' : 'csv';
  resultEl.classList.remove('hidden');
  resultEl.innerHTML = '<span class="text-white/50">Importing…</span>';
  try {
    const form = new FormData();
    form.append('format', format);
    form.append('file', file);
    const res = await fetch(`${API_BASE}/school/import`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: form,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      resultEl.innerHTML = `<span class="text-rose-300">${escapeHtml(data.message || 'Import failed')}</span>`;
      return;
    }
    const imp = data.import || {};
    if (data.duplicate) {
      resultEl.innerHTML = '<span class="text-amber-300">Already imported — no duplicates created.</span>';
      return;
    }
    const warnCount = (imp.warnings || []).length;
    resultEl.innerHTML = `<span class="text-emerald-300">Imported ${imp.created_count || 0} new, updated ${imp.updated_count || 0}.</span>` +
      (warnCount ? `<span class="text-amber-300"> ${warnCount} warning(s).</span>` : '');
    fileEl.value = '';
  } catch (err) {
    resultEl.innerHTML = '<span class="text-rose-300">Network error — import failed.</span>';
  }
}

async function refreshSchoolStatus() {
  const token = getHdsfdToken();
  if (!token) return;
  try {
    const res = await fetch(`${API_BASE}/school/sources`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (res.status === 401) {
      // Session expired — clear stale token so the sign-in form reappears.
      await hdsfdLogout();
    }
  } catch (err) { /* offline: keep showing signed-in state from localStorage */ }
}

async function loadGeminiChatHistory() {
  const stream = document.getElementById('gemini-agent-chat-stream');
  const userBadge = document.getElementById('gemini-user-email-text');
  const currentOwner = currentOwnerKey();
  if (userBadge) {
    const userLabel = googleAccountName || userName || 'Guest (Offline)';
    userBadge.textContent = googleAccount ? userLabel : 'Guest (Offline)';
    userBadge.title = googleAccount ? `Connected: ${googleAccount}` : 'Guest Mode';
  }

  if (!hdsfdSessionUser()) {
    renderGeminiDefaultGreeting();
    return;
  }
  try {
    const res = await fetch(`${API_BASE}/gemini/history?username=${encodeURIComponent(currentOwner)}`, { headers: hdsfdAuthHeaders() });
    if (res.ok) {
      geminiChatHistory = await res.json();
      renderGeminiChatMessages();
    }
  } catch (err) {
    console.warn('Could not load Gemini chat history:', err);
    if (geminiChatHistory.length === 0) {
      renderGeminiDefaultGreeting();
    }
  }
}

function renderGeminiDefaultGreeting() {
  const stream = document.getElementById('gemini-agent-chat-stream');
  if (!stream) return;
  stream.innerHTML = '';
}

function renderGeminiChatMessages() {
  const stream = document.getElementById('gemini-agent-chat-stream');
  if (!stream) return;

  if (!geminiChatHistory || geminiChatHistory.length === 0) {
    renderGeminiDefaultGreeting();
    return;
  }

  stream.innerHTML = geminiChatHistory.map(msg => {
    if (msg.role === 'user') {
      return `
        <div class="self-end bg-[#282a2c] border border-white/10 px-3.5 py-2.5 rounded-2xl rounded-br-sm text-white text-xs max-w-[85%] leading-relaxed shadow-sm">
          ${escapeHtml(msg.content)}
        </div>
      `;
    } else {
      let actionsHtml = '';
      if (msg.actions && msg.actions.length > 0) {
        actionsHtml = msg.actions.map(act => renderAgentActionBadge(act)).join('');
      }

      // Format markdown-like elements (bold, bullet points, blockquotes)
      let formatted = formatGeminiResponseText(msg.content);

      return `
        <div class="flex items-start gap-3 max-w-[92%]">
          <div class="w-7 h-7 rounded-full bg-gradient-to-tr from-blue-500 via-indigo-500 to-pink-500 flex items-center justify-center text-white shrink-0 shadow-md">${hdsfdIcon('sparkles')}</div>
          <div class="bg-[#1e1f20] border border-white/10 p-3.5 rounded-2xl rounded-tl-sm text-slate-200 text-xs leading-relaxed space-y-2">
            <div>${formatted}</div>
            ${actionsHtml ? `<div class="pt-1.5 space-y-1">${actionsHtml}</div>` : ''}
          </div>
        </div>
      `;
    }
  }).join('');

  stream.scrollTop = stream.scrollHeight;
}

function renderAgentActionBadge(act) {
  if (act.type === 'create_task') {
    return `
      <div class="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-purple-500/20 border border-purple-500/30 text-purple-200 text-[11px] font-semibold">
        <span class="inline-flex items-center gap-1">${hdsfdIcon('zap')} Action:</span>
        <span class="truncate">Added Task: <b>"${escapeHtml(act.title)}"</b> (${act.folder || 'General'})</span>
      </div>
    `;
  } else if (act.type === 'create_note') {
    return `
      <div class="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-amber-500/20 border border-amber-500/30 text-amber-200 text-[11px] font-semibold">
        <span class="inline-flex items-center gap-1">${hdsfdIcon('pin')} Action:</span>
        <span class="truncate">Created ${act.color || 'yellow'} sticky note</span>
      </div>
    `;
  } else if (act.type === 'start_timer') {
    return `
      <div class="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-200 text-[11px] font-semibold">
        <span>⏱ Action:</span>
        <span>Started ${act.minutes || 25}m Pomodoro Session</span>
      </div>
    `;
  } else if (act.type === 'set_soundscape') {
    return `
      <div class="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-cyan-500/20 border border-cyan-500/30 text-cyan-200 text-[11px] font-semibold">
        <span class="inline-flex items-center gap-1">${hdsfdIcon('headphones')} Action:</span>
        <span>Updated focus soundscape</span>
      </div>
    `;
  } else if (act.type === 'change_theme') {
    return `
      <div class="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-indigo-500/20 border border-indigo-500/30 text-indigo-200 text-[11px] font-semibold">
        <span class="inline-flex items-center gap-1">${hdsfdIcon('palette')} Action:</span>
        <span>Changed theme to ${escapeHtml(act.theme)}</span>
      </div>
    `;
  } else if (act.type === 'play_song' || act.type === 'play_youtube' || act.type === 'search_music') {
    return `
      <div class="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-rose-500/20 border border-rose-500/30 text-rose-200 text-[11px] font-semibold">
        <span class="inline-flex items-center gap-1">${hdsfdIcon('music')} Action:</span>
        <span class="truncate">Playing ${escapeHtml(act.query || act.title || act.url || 'music')}</span>
      </div>
    `;
  } else if (act.type === 'complete_task') {
    return `
      <div class="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-200 text-[11px] font-semibold">
        <span class="inline-flex items-center gap-1">${hdsfdIcon('circle-check-big')} Action:</span>
        <span class="truncate">Completed: ${escapeHtml(act.title || '')}</span>
      </div>
    `;
  } else if (act.type === 'create_exam') {
    return `
      <div class="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-rose-500/20 border border-rose-500/30 text-rose-200 text-[11px] font-semibold">
        <span class="inline-flex items-center gap-1">${hdsfdIcon('file-text')} Action:</span>
        <span class="truncate">Exam added: ${escapeHtml(act.title || '')}</span>
      </div>
    `;
  } else if (act.type === 'create_schedule_entry') {
    return `
      <div class="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-teal-500/20 border border-teal-500/30 text-teal-200 text-[11px] font-semibold">
        <span class="inline-flex items-center gap-1">${hdsfdIcon('clock')} Action:</span>
        <span class="truncate">Class added: ${escapeHtml(act.title || '')}</span>
      </div>
    `;
  }
  return '';
}

function formatGeminiResponseText(raw) {
  if (!raw) return '';
  // Strip raw action json blocks from user-visible display
  let clean = raw.replace(/```json\s*\{[\s\S]*?\}\s*```/g, '').trim();
  
  // Format bold text
  clean = clean.replace(/\*\*(.*?)\*\*/g, '<b class="text-white font-bold">$1</b>');
  // Format blockquotes
  clean = clean.replace(/^>\s*(.*?)$/gm, '<blockquote class="border-l-2 border-sky-400 pl-2.5 py-0.5 my-1 text-slate-300 bg-white/5 rounded-r">$1</blockquote>');
  // Format line breaks
  clean = clean.replace(/\n/g, '<br>');
  return clean;
}

function setAgentPromptPrefix(prefix) {
  const input = document.getElementById('gemini-agent-input');
  if (input) {
    input.value = prefix;
    input.focus();
    input.selectionStart = input.selectionEnd = input.value.length;
  }
}

function submitAgentCommand(cmdText) {
  setAgentPromptPrefix(cmdText);
}

// Inline icon from the bundled Lucide sprite (no CDN, no layout shift).
function hdsfdIcon(name, extraClass) {
  const cls = extraClass ? `hdsfd-icon ${extraClass}` : 'hdsfd-icon';
  return `<svg class="${cls}" aria-hidden="true" focusable="false"><use href="#i-${name}"></use></svg>`;
}

// ===== LIVE WORKSPACE CONTEXT SENT WITH EVERY AI MESSAGE =====
// Only the slice an answer can use: open work first, then a little recent
// history. Keeps every request small so replies stay fast.
const AI_CONTEXT_LIMITS = { openTasks: 12, doneTasks: 3, notes: 6, schedule: 8, exams: 5, folders: 10 };

function buildAIWorkspaceContext() {
  const clip = (value, limit) => String(value == null ? '' : value)
    .replace(/\s+/g, ' ').trim().slice(0, limit || 70);

  const tasks = allData.filter(d => d.type === 'task');
  const notes = allData.filter(d => d.type === 'note');
  const schedule = allData.filter(d => d.type === 'schedule_entry');
  const exams = allData.filter(d => d.type === 'exam_entry');
  const sessions = allData.filter(d => d.type === 'focus_session');

  const openTasks = tasks.filter(t => !t.completed);
  const completedTasks = tasks.filter(t => t.completed);

  // Soonest due first, undated last — that is the order the assistant needs to
  // answer "what should I do now?".
  const byDueDate = (a, b) => {
    const aDue = a.due || a.deadline || '';
    const bDue = b.due || b.deadline || '';
    if (aDue && bDue) return aDue < bDue ? -1 : (aDue > bDue ? 1 : 0);
    if (aDue) return -1;
    if (bDue) return 1;
    return 0;
  };

  const prioritizedTasks = openTasks.slice().sort(byDueDate).slice(0, AI_CONTEXT_LIMITS.openTasks);
  const recentDoneTasks = completedTasks.slice(-AI_CONTEXT_LIMITS.doneTasks);
  const upcomingExams = exams.slice()
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')))
    .slice(0, AI_CONTEXT_LIMITS.exams);

  return {
    user: googleAccountName || userName || 'Guest',
    tab: activeTab,
    folders: (typeof getAvailableFolders === 'function' ? getAvailableFolders() : []).slice(0, AI_CONTEXT_LIMITS.folders),
    tasks: [...prioritizedTasks, ...recentDoneTasks].map(t => ({
      title: clip(t.title, 70),
      folder: clip(t.folder, 26),
      due: clip(t.due || t.deadline, 26),
      completed: !!t.completed
    })),
    notes: notes.slice(-AI_CONTEXT_LIMITS.notes).map(n => ({ title: clip(n.title || n.content, 80) })),
    schedule: schedule.slice(-AI_CONTEXT_LIMITS.schedule).map(s => ({
      title: clip(s.title, 60),
      days: Array.isArray(s.days) ? s.days : [],
      start: clip(s.start_time, 8),
      end: clip(s.end_time, 8)
    })),
    exams: upcomingExams.map(e => ({
      title: clip(e.title, 60),
      date: clip(e.date, 12),
      time: clip(e.time, 8)
    })),
    counts: {
      open_tasks: openTasks.length,
      notes: notes.length,
      classes: schedule.length,
      exams: exams.length
    },
    stats: {
      coins: typeof getUserCoinsBalance === 'function' ? getUserCoinsBalance() : 0,
      lifetime_xp: typeof getLifetimeCoins === 'function' ? getLifetimeCoins() : 0,
      focus_mins: sessions.reduce((sum, s) => sum + (s.minutes || 0), 0),
      tasks_done: tasks.filter(t => t.completed).length,
      streak: parseInt(localStorage.getItem('hdsfd_streak_days') || '1', 10)
    },
    music_now_playing: musicState.current
      ? { title: clip(musicState.current.title, 80), channel: clip(musicState.current.channel, 40) }
      : null
  };
}

function updateAIContextBadge(context) {
  const badge = document.getElementById('ai-context-badge');
  if (!badge || !context) return;
  const counts = context.counts || {};
  const pick = (key, fallback) => (typeof counts[key] === 'number' ? counts[key] : fallback);
  const parts = [
    `${pick('open_tasks', (context.tasks || []).length)} open`,
    `${pick('notes', (context.notes || []).length)} notes`,
    `${pick('classes', (context.schedule || []).length)} classes`,
    `${pick('exams', (context.exams || []).length)} exams`
  ];
  badge.innerHTML = `${hdsfdIcon('list-todo')} ${parts.join(' · ')}`;
  badge.title = 'The AI reads this live workspace snapshot on every message';
}

function setAIEngineBadge(data) {
  const badge = document.getElementById('ai-engine-badge');
  if (!badge) return;
  const source = (data && data.source) || 'built_in';
  const labels = {
    google_oauth_api: 'Gemini · OAuth',
    google_api_key_pool: 'Gemini · key pool',
    built_in: 'Offline engine'
  };
  badge.textContent = labels[source] || 'Gemini';
  badge.dataset.source = source;
  badge.title = `Model: ${(data && data.model) || 'unknown'}`;
}

async function sendGeminiAgentMessage(optPrompt) {
  if (isGeminiThinking) return;
  const input = document.getElementById('gemini-agent-input');
  const text = (optPrompt || (input ? input.value : '')).trim();
  if (!text) return;

  if (input) input.value = '';
  const currentOwner = googleAccount || userName || 'Guest';

  // Add User turn to local state
  geminiChatHistory.push({
    role: 'user',
    content: text,
    created_at: new Date().toISOString()
  });
 awardActivityCoins(3, null);
  renderGeminiChatMessages();

  // Show Thinking bubble
  const stream = document.getElementById('gemini-agent-chat-stream');
  isGeminiThinking = true;
  const thinkingId = 'gemini-thinking-indicator';
  if (stream) {
    const thinkEl = document.createElement('div');
    thinkEl.id = thinkingId;
    thinkEl.className = 'flex items-start gap-3 max-w-[92%]';
    thinkEl.innerHTML = `
      <div class="w-7 h-7 rounded-full bg-gradient-to-tr from-blue-500 via-indigo-500 to-pink-500 flex items-center justify-center text-white shrink-0 shadow-md animate-pulse">${hdsfdIcon('sparkles')}</div>
      <div class="bg-[#1e1f20] border border-white/10 p-3.5 rounded-2xl rounded-tl-sm text-slate-400 text-xs italic flex items-center gap-2">
        <span class="inline-block w-2 h-2 rounded-full bg-sky-400 animate-ping"></span>
        <span>Gemini AI is analyzing & executing...</span>
      </div>
    `;
    stream.appendChild(thinkEl);
    stream.scrollTop = stream.scrollHeight;
  }

  try {
    const savedApiKey = localStorage.getItem('hdsfd_gemini_api_key') || '';
    const aiContext = buildAIWorkspaceContext();
    updateAIContextBadge(aiContext);
    const res = await fetch('/api/gemini/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: text,
        username: currentOwner,
        api_key: savedApiKey,
        context: aiContext
      })
    });

    const data = await res.json();
    const thinkEl = document.getElementById(thinkingId);
    if (thinkEl) thinkEl.remove();

    if (data.status === 'success') {
      const responseText = data.text || '';
      const actions = data.actions || [];
      setAIEngineBadge(data);

      geminiChatHistory.push({
        role: 'model',
        content: responseText,
        actions: actions,
        created_at: new Date().toISOString()
      });

      renderGeminiChatMessages();

      // Execute all parsed agent actions live!
      if (actions && actions.length > 0) {
        actions.forEach(act => executeAgentAction(act));
      }
    } else {
      throw new Error(data.message || 'Error calling Gemini Agent');
    }
  } catch (err) {
    console.error('Gemini agent error:', err);
    const thinkEl = document.getElementById(thinkingId);
    if (thinkEl) thinkEl.remove();

    geminiChatHistory.push({
      role: 'model',
      content: `Error executing request: ${err.message}. Please check connection.`,
      actions: [],
      created_at: new Date().toISOString()
    });
    renderGeminiChatMessages();
  } finally {
    isGeminiThinking = false;
  }
}

// ===== REAL-TIME AGENT ACTION EXECUTOR =====
function executeAgentAction(action) {
  if (!action || !action.type) return;
  const currentOwner = googleAccount || userName || 'Guest';

 console.log(' Gemini Agent Executing Action:', action);

  if (action.type === 'create_task') {
    const newTask = {
      id: `task_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      type: 'task',
      title: action.title || 'New Study Task',
      folder: action.folder || activeGTasksListKey || 'General',
      details: action.details || '',
      due: action.due || '',
      deadline: action.deadline || '',
      completed: false,
      starred: false,
      subtasks: [],
      created_at: new Date().toISOString(),
      username: currentOwner
    };

    allData.push(newTask);
    localStorage.setItem(`hdsfd_data_${currentOwner}`, JSON.stringify(allData));
    createData(newTask);
    renderDirectGTasks();
    renderDarkCalendarGrid();
    triggerGoogleBackup();
  } 
  else if (action.type === 'create_note') {
    const newNote = {
      id: `note_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      type: 'note',
      content: clampNoteText(action.text || ''),
      title: 'Sticky Note',
      color: action.color || 'yellow',
      tab: 'notes',
      floatingOverlay: false,
      width: 175,
      height: 175,
      rotation: parseFloat((Math.random() * 3.6 - 1.8).toFixed(1)),
      drawMode: false,
      paths: [],
      created_at: new Date().toISOString(),
      username: currentOwner
    };

    allData.push(newNote);
    localStorage.setItem(`hdsfd_data_${currentOwner}`, JSON.stringify(allData));
    createData(newNote);
    renderPhysicsPostIts();
    triggerGoogleBackup();
  }
  else if (action.type === 'play_youtube' || action.type === 'play_song' || action.type === 'search_music') {
    const songUrl = action.url || '';
    const query = action.query || action.song || action.title || '';
    musicHandleQuery(songUrl || query);
  }
  else if (action.type === 'navigate_tab') {
    const allowed = ['focus', 'tasks-notes', 'notes', 'settings'];
    if (allowed.includes(action.tab)) switchTab(action.tab);
  }
  else if (action.type === 'complete_task' || action.type === 'delete_task') {
    const wanted = String(action.title || '').toLowerCase().trim();
    if (!wanted) return;
    const match = allData.find(d => d.type === 'task'
      && String(d.title || '').toLowerCase().includes(wanted));
    if (!match) {
 showInAppNotification(`No task matched “${action.title}”`);
      return;
    }
    if (action.type === 'delete_task') {
      deleteData(match.id);
    } else {
      match.completed = true;
      match.completed_at = new Date().toISOString();
      createData(match);
    }
 showInAppNotification(action.type === 'delete_task'
      ? `Deleted task: ${match.title}`
      : `Completed task: ${match.title}`);
  }
  else if (action.type === 'create_exam') {
    const examDate = action.date || new Date().toISOString().split('T')[0];
    const newExam = {
      id: `exam_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      type: 'exam_entry',
      title: action.title || 'Exam',
      date: examDate,
      time: action.time || '09:00',
      location: action.location || '',
      reward: parseInt(action.reward || '250', 10),
      completed: false,
      created_at: new Date().toISOString(),
      username: currentOwner
    };
    allData.push(newExam);
    localStorage.setItem(`hdsfd_data_${currentOwner}`, JSON.stringify(allData));
    createData(newExam);
    renderExamCardsList();
    renderDarkCalendarGrid();
    triggerGoogleBackup();
  }
  else if (action.type === 'start_timer') {
    const mins = parseInt(action.minutes, 10) || 25;
    setPomoPreset(mins);
    startTimer();
  }
  else if (action.type === 'pause_timer') {
    pauseTimer();
  }
  else if (action.type === 'reset_timer') {
    resetTimer();
  }
  else if (action.type === 'set_soundscape') {
    const rainSlider = document.getElementById('vol-rain');
    const rainAudio = document.getElementById('audio-rain');
    if (action.rain !== undefined && rainSlider && rainAudio) {
      rainSlider.value = action.rain;
      rainAudio.volume = action.rain;
      const rainLabel = document.getElementById('val-rain');
      if (rainLabel) rainLabel.textContent = `${Math.round(action.rain * 100)}%`;
    }
    if (action.playing && !isPlayingSoundscape) {
      toggleSoundscape();
    }
  }
  else if (action.type === 'change_theme') {
    if (action.theme) setTheme(action.theme);
  }
  else if (action.type === 'create_schedule_entry') {
    const newSchedule = {
      id: `sched_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      type: 'schedule_entry',
      title: action.title || 'Class Period',
      days: Array.isArray(action.days) && action.days.length ? action.days : ['Mon', 'Wed', 'Fri'],
      start_time: action.start_time || '09:00',
      end_time: action.end_time || '10:15',
      location: action.location || '',
      color: action.color || 'purple',
      created_at: new Date().toISOString(),
      username: currentOwner
    };

    allData.push(newSchedule);
    localStorage.setItem(`hdsfd_data_${currentOwner}`, JSON.stringify(allData));
    createData(newSchedule);
    renderScheduleGrid();
    triggerGoogleBackup();
  }
}

// ===== HDSFD MUSIC ENGINE (search • smart radio • taste • feed • ad-free audio) =====
// Playback strategy: the browser asks the music relay (Cloudflare Worker) for Innertube
// audio formats and streams them through the relay, so playback is audio-only and ad-free
// with working seek even where the app host cannot reach YouTube. If the relay cannot
// serve a track the player falls back to the official embed so music never stops.
//
// Recommendations live in two places: this file keeps a small, private taste model in
// localStorage (plays, skips, likes, artist and word affinity), and /api/music/feed +
// /api/music/radio rank search results on the server. Nothing is uploaded except the
// anonymous taste summary needed to rank that one request.

const MUSIC_KEYS = {
  queue: 'hdsfd_music_queue',
  index: 'hdsfd_music_index',
  recent: 'hdsfd_music_recent',
  volume: 'hdsfd_music_volume',
  shuffle: 'hdsfd_music_shuffle',
  repeat: 'hdsfd_music_repeat',
  radio: 'hdsfd_music_radio',
  autoplay: 'hdsfd_music_autoplay',
  taste: 'hdsfd_music_taste_v1',
  feed: 'hdsfd_music_feed_v1'
};

function musicSafeParse(raw, fallback) {
  try {
    const parsed = JSON.parse(raw);
    return parsed === null || parsed === undefined ? fallback : parsed;
  } catch (e) {
    return fallback;
  }
}

function musicStoreGet(key) {
  try { return localStorage.getItem(key); } catch (e) { return null; }
}

function musicStoreSet(key, value) {
  try { localStorage.setItem(key, value); } catch (e) { /* private mode */ }
}

function musicStoreRemove(key) {
  try { localStorage.removeItem(key); } catch (e) { /* private mode */ }
}

const musicState = {
  queue: [],
  index: -1,
  current: null,
  results: [],
  feed: [],
  feedMode: 'trending',
  feedTitle: 'Trending now',
  feedSubtitle: 'What everyone is playing right now',
  feedLoading: false,
  query: '',
  view: 'home',
  volume: (() => {
    const stored = parseFloat(musicStoreGet(MUSIC_KEYS.volume));
    return isNaN(stored) ? 0.7 : Math.min(1, Math.max(0, stored));
  })(),
  shuffle: musicStoreGet(MUSIC_KEYS.shuffle) === 'true',
  repeat: musicStoreGet(MUSIC_KEYS.repeat) || 'off',
  radio: musicStoreGet(MUSIC_KEYS.radio) !== 'false',
  autoplay: musicStoreGet(MUSIC_KEYS.autoplay) !== 'false',
  recent: musicSafeParse(musicStoreGet(MUSIC_KEYS.recent) || '[]', []),
  engine: 'idle',
  loading: false,
  resolving: false,
  radioLoading: false,
  searchBusy: false,
  playStartedAt: 0,
  resolvingItem: null,
  lastPlayedId: null,
  countedPlayId: null,
  error: ''
};

if (!Array.isArray(musicState.recent)) musicState.recent = [];

let musicSearchTimer = null;
let musicSearchAbort = null;
let musicRelayBase = null;
let musicRelayPromise = null;
let musicPlayToken = 0;
let musicSearchToken = 0;
let musicCountTimer = null;
let musicRadioPromise = null;

// ---------------------------------------------------------------------------
// Taste memory
// ---------------------------------------------------------------------------
const musicTaste = (() => {
  const base = { version: 1, artists: {}, terms: {}, plays: {}, skips: {}, likes: {}, dislikes: {}, updated: 0 };
  const saved = musicSafeParse(musicStoreGet(MUSIC_KEYS.taste) || '{}', {});
  if (!saved || typeof saved !== 'object') return base;
  return {
    version: 1,
    artists: saved.artists && typeof saved.artists === 'object' ? saved.artists : {},
    terms: saved.terms && typeof saved.terms === 'object' ? saved.terms : {},
    plays: saved.plays && typeof saved.plays === 'object' ? saved.plays : {},
    skips: saved.skips && typeof saved.skips === 'object' ? saved.skips : {},
    likes: saved.likes && typeof saved.likes === 'object' ? saved.likes : {},
    dislikes: saved.dislikes && typeof saved.dislikes === 'object' ? saved.dislikes : {},
    updated: Number(saved.updated) || 0
  };
})();

const MUSIC_STOP_WORDS = new Set(('the a an and or of to in on for with from by at is it this that ' +
  'official video audio lyrics lyric music song songs ft feat featuring remix version live ' +
  'hd hq 4k mv m v visualizer lyric video full album radio mix').split(/\s+/));

function musicTokens(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[\[\](){}]/g, ' ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter(token => token && token.length > 1 && !MUSIC_STOP_WORDS.has(token));
}

function musicNormTitle(text) {
  return musicTokens(text).join(' ').slice(0, 90);
}

function musicNormChannel(text) {
  return String(text || '').toLowerCase().replace(/\s*-\s*topic$/i, '').replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 80);
}

function musicTastePrune() {
  const trim = (object, max, compare) => {
    const keys = Object.keys(object);
    if (keys.length <= max) return;
    keys.sort(compare).slice(0, keys.length - max).forEach(key => { delete object[key]; });
  };
  trim(musicTaste.artists, 120, (a, b) => (Number(musicTaste.artists[a].plays) || 0) - (Number(musicTaste.artists[b].plays) || 0));
  trim(musicTaste.terms, 220, (a, b) => (musicTaste.terms[a] || 0) - (musicTaste.terms[b] || 0));
  trim(musicTaste.plays, 400, (a, b) => (musicTaste.plays[a].last || 0) - (musicTaste.plays[b].last || 0));
  trim(musicTaste.skips, 250, (a, b) => (musicTaste.skips[a].last || 0) - (musicTaste.skips[b].last || 0));
}

function musicTasteSave() {
  musicTastePrune();
  musicTaste.updated = Date.now();
  musicStoreSet(MUSIC_KEYS.taste, JSON.stringify(musicTaste));
}

function musicTasteArtist(name, create) {
  const key = musicNormChannel(name);
  if (!key) return null;
  if (!musicTaste.artists[key]) {
    if (!create) return null;
    musicTaste.artists[key] = { name: String(name).trim().slice(0, 80), plays: 0, skips: 0, likes: 0, last: 0 };
  }
  return musicTaste.artists[key];
}

function musicTasteCountPlay(item) {
  if (!item || !item.id) return;
  if (musicState.current && musicState.current.id !== item.id) return;
  // The 16 s timer and the "ended" event can both land; one listen is one play.
  if (musicState.countedPlayId === item.id) return;
  musicState.countedPlayId = item.id;
  const now = Date.now();
  const record = musicTaste.plays[item.id] || { count: 0, last: 0, title: item.title || '', channel: item.channel || '' };
  record.count = Math.min(999, (Number(record.count) || 0) + 1);
  record.last = now;
  record.title = item.title || record.title;
  record.channel = item.channel || record.channel;
  musicTaste.plays[item.id] = record;

  const artist = musicTasteArtist(item.channel, true);
  if (artist) {
    artist.plays = Math.min(999, (Number(artist.plays) || 0) + 1);
    artist.last = now;
  }
  musicTokens(item.title + ' ' + item.channel).slice(0, 8).forEach((token, index) => {
    musicTaste.terms[token] = Math.min(40, (Number(musicTaste.terms[token]) || 0) + (index < 2 ? 0.6 : 0.25));
  });
  musicTasteSave();
}

function musicTasteMaybeSkip(item) {
  if (!item || !item.id) return;
  if (!musicState.playStartedAt || Date.now() - musicState.playStartedAt > 15000) return;
  if (!musicState.current || musicState.current.id !== item.id) return;
  clearTimeout(musicCountTimer);
  const now = Date.now();
  const record = musicTaste.skips[item.id] || { count: 0, last: 0 };
  record.count = Math.min(99, (Number(record.count) || 0) + 1);
  record.last = now;
  musicTaste.skips[item.id] = record;
  const artist = musicTasteArtist(item.channel, true);
  if (artist) artist.skips = Math.min(99, (Number(artist.skips) || 0) + 1);
  musicTasteSave();
}

function musicTasteListenStart(item) {
  musicState.playStartedAt = Date.now();
  musicState.countedPlayId = null;
  musicState.lastPlayedId = item && item.id ? item.id : null;
  clearTimeout(musicCountTimer);
  if (!item || !item.id) return;
  musicCountTimer = setTimeout(() => {
    if (musicState.current && musicState.current.id === item.id) musicTasteCountPlay(item);
  }, 16000);
}

function musicIsLiked(id) {
  return !!(id && musicTaste.likes[id]);
}

function musicToggleLikeById(id) {
  const item = musicFindTrackById(id);
  if (!item) return;
  if (musicTaste.likes[id]) {
    delete musicTaste.likes[id];
    const artist = musicTasteArtist(item.channel, false);
    if (artist && artist.likes > 0) artist.likes -= 1;
    showInAppNotification('Removed from your taste');
  } else {
    musicTaste.likes[id] = { at: Date.now(), title: item.title || '', channel: item.channel || '' };
    delete musicTaste.dislikes[id];
    const artist = musicTasteArtist(item.channel, true);
    if (artist) artist.likes = Math.min(999, (Number(artist.likes) || 0) + 1);
    musicTokens(item.title + ' ' + item.channel).slice(0, 8).forEach(token => {
      musicTaste.terms[token] = Math.min(40, (Number(musicTaste.terms[token]) || 0) + 1.1);
    });
    showInAppNotification('Saved to your taste — radio will use it');
  }
  musicTasteSave();
  musicRenderResults();
  musicRenderFeed();
  musicRenderQueue();
  musicRenderRecent();
  musicRenderNowPlaying();
}

function musicProfile() {
  const artists = Object.values(musicTaste.artists)
    .filter(entry => entry && entry.name)
    .map(entry => ({
      name: entry.name,
      score: (Number(entry.plays) || 0) * 2 + (Number(entry.likes) || 0) * 3 - (Number(entry.skips) || 0) * 1.5
    }))
    .filter(entry => entry.score > -2)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  const terms = Object.keys(musicTaste.terms)
    .sort((a, b) => (Number(musicTaste.terms[b]) || 0) - (Number(musicTaste.terms[a]) || 0))
    .slice(0, 12);

  return {
    artists: artists.map(entry => entry.name),
    terms: terms,
    liked: Object.keys(musicTaste.likes).slice(-30),
    disliked: Object.keys(musicTaste.dislikes).slice(-30),
    plays: Object.values(musicTaste.plays).reduce((total, entry) => total + (Number(entry && entry.count) || 0), 0),
    updated: musicTaste.updated
  };
}

function musicHasTaste(profile) {
  const data = profile || musicProfile();
  return data.artists.length >= 2 || data.plays >= 4;
}

// ---------------------------------------------------------------------------
// Track helpers, dedupe and formatting
// ---------------------------------------------------------------------------
function musicValidId(id) {
  return /^[A-Za-z0-9_-]{11}$/.test(String(id || ''));
}

function musicNormalizeTrack(item) {
  if (!item || !musicValidId(item.id)) return null;
  const title = String(item.title || 'Untitled').trim();
  return {
    id: item.id,
    title: title,
    channel: String(item.channel || item.author || 'YouTube').trim(),
    thumbnail: item.thumbnail || `https://i.ytimg.com/vi/${item.id}/mqdefault.jpg`,
    url: item.url || `https://www.youtube.com/watch?v=${item.id}`,
    duration: item.duration || '',
    seconds: Number(item.seconds) || 0,
    views: item.views || ''
  };
}

function musicTrackKey(item) {
  if (!item) return '';
  const title = musicNormTitle(item.title);
  return title ? title + '|' + musicNormChannel(item.channel) : item.id || '';
}

function musicUniqueTracks(list, options) {
  const opts = options || {};
  const seenIds = new Set(opts.excludeIds ? Array.from(opts.excludeIds) : []);
  const seenKeys = new Set(opts.excludeKeys ? Array.from(opts.excludeKeys) : []);
  const cap = Number(opts.limit) > 0 ? Number(opts.limit) : Infinity;
  const output = [];
  (Array.isArray(list) ? list : []).forEach(raw => {
    if (output.length >= cap) return;
    const item = musicNormalizeTrack(raw);
    if (!item || seenIds.has(item.id)) return;
    const key = musicTrackKey(item);
    if (key && seenKeys.has(key)) return;
    seenIds.add(item.id);
    if (key) seenKeys.add(key);
    output.push(item);
  });
  return output;
}

function musicQueueKeys() {
  return new Set(musicState.queue.map(item => musicTrackKey(item)).filter(Boolean));
}

function musicQueueIds() {
  return new Set(musicState.queue.map(item => item.id).filter(Boolean));
}

function musicFindTrackById(id) {
  if (!id) return null;
  if (musicState.current && musicState.current.id === id) return musicState.current;
  const pools = [musicState.queue, musicState.results, musicState.feed, musicState.recent];
  for (const pool of pools) {
    if (!Array.isArray(pool)) continue;
    const found = pool.find(item => item && item.id === id);
    if (found) return found;
  }
  return null;
}

function musicFmt(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const mins = Math.floor(total / 60);
  return `${mins}:${String(total % 60).padStart(2, '0')}`;
}

function musicMetaLine(item) {
  const bits = [];
  if (item.channel) bits.push(item.channel);
  if (item.duration) bits.push(item.duration);
  else if (item.views) bits.push(item.views);
  return bits.join(' • ');
}

function musicSleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function musicFetchJson(url, options, timeoutMs) {
  const opts = Object.assign({}, options || {});
  const external = opts.signal;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || 12000);
  if (external) {
    if (external.aborted) controller.abort();
    else external.addEventListener('abort', () => controller.abort(), { once: true });
  }
  opts.signal = controller.signal;
  try {
    const response = await fetch(url, opts);
    if (!response.ok) throw new Error('http_' + response.status);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function musicPostJson(url, body, timeoutMs) {
  return musicFetchJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  }, timeoutMs);
}

// ---------------------------------------------------------------------------
// Themed loading pill (vanilla port of the ProgressPill idea)
// ---------------------------------------------------------------------------
const musicPill = (() => {
  let frame = 0;
  let startedAt = 0;
  let hideTimer = 0;
  let shownAt = 0;

  const root = () => document.getElementById('music-loading');
  const pill = () => document.getElementById('music-pill');
  const label = () => document.getElementById('music-pill-label');
  const doneLabel = () => document.getElementById('music-pill-done-label');
  const fill = () => document.getElementById('music-pill-fill');

  function paint(progress) {
    const bar = fill();
    if (bar) bar.style.width = `${Math.max(3, Math.min(100, progress * 100)).toFixed(1)}%`;
  }

  function step(now) {
    if (!startedAt) return;
    const seconds = (now - startedAt) / 1000;
    // Ease toward 94%: it keeps moving during a slow resolve without ever lying.
    paint(Math.min(0.94, 0.94 * (1 - Math.exp(-seconds / 3.4))));
    frame = requestAnimationFrame(step);
  }

  return {
    start(text) {
      clearTimeout(hideTimer);
      startedAt = performance.now();
      shownAt = Date.now();
      const shell = root();
      const face = pill();
      if (!shell || !face) return;
      shell.classList.add('is-visible');
      shell.setAttribute('aria-hidden', 'false');
      face.classList.remove('is-done', 'is-error');
      face.classList.add('is-loading');
      if (label() && text) label().textContent = text;
      if (doneLabel()) doneLabel().textContent = 'Ready';
      paint(0.03);
      if (!frame) frame = requestAnimationFrame(step);
    },
    label(text) {
      if (label() && text) label().textContent = text;
    },
    done() {
      const shell = root();
      const face = pill();
      if (!shell || !face) return;
      startedAt = 0;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      paint(1);
      face.classList.remove('is-loading', 'is-error');
      face.classList.add('is-done');
      hideTimer = setTimeout(() => this.hide(), 950);
    },
    fail(text) {
      const shell = root();
      const face = pill();
      if (!shell || !face) return;
      startedAt = 0;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      if (label() && text) label().textContent = text;
      face.classList.remove('is-loading', 'is-done');
      face.classList.add('is-error');
      hideTimer = setTimeout(() => this.hide(), 1400);
    },
    hide() {
      const shell = root();
      const face = pill();
      startedAt = 0;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      clearTimeout(hideTimer);
      if (shell) {
        shell.classList.remove('is-visible');
        shell.setAttribute('aria-hidden', 'true');
      }
      if (face) face.classList.remove('is-loading', 'is-done', 'is-error');
      if (fill()) fill().style.width = '0%';
      shownAt = 0;
    },
    isVisible() {
      return !!root() && root().classList.contains('is-visible') && Date.now() - shownAt < 30000;
    }
  };
})();

function musicSetResolving(active, text, finish) {
  musicState.resolving = !!active;
  if (active) {
    musicPill.start(text || 'Loading track');
    return;
  }
  if (finish === 'ready') musicPill.done();
  else if (finish === 'error') musicPill.fail('Try another track');
  else musicPill.hide();
}

function musicSetEngineBadge(text, tone) {
  const badge = document.getElementById('music-engine-badge');
  if (badge) {
    badge.textContent = text;
    badge.dataset.tone = tone || 'audio';
  }
  const mini = document.getElementById('music-mini-engine');
  if (mini) mini.textContent = text.replace(/^[●•]\s*/, '');
}

// ---------------------------------------------------------------------------
// Modal and views
// ---------------------------------------------------------------------------
function musicRenderAll() {
  musicRenderResults();
  musicRenderFeed();
  musicRenderQueue();
  musicRenderRecent();
  musicRenderNowPlaying();
  musicUpdateToggles();
  musicSyncPlayControls();
}

function openMusicPlayer(initialQuery) {
  const modal = document.getElementById('music-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  document.body.classList.add('music-open');
  musicRenderAll();

  const input = document.getElementById('music-search-input');
  if (initialQuery && String(initialQuery).trim()) {
    musicSearch(String(initialQuery).trim(), true);
  } else {
    musicSetView('home');
    musicEnsureFeed();
    if (input) setTimeout(() => input.focus(), 80);
  }
}

function closeMusicPlayer() {
  const modal = document.getElementById('music-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.classList.remove('flex');
  document.body.classList.remove('music-open');
  musicPill.hide();
}

function musicSetView(view, options) {
  const wanted = ['home', 'results', 'queue', 'recent'].includes(view) ? view : 'home';
  musicState.view = wanted;
  ['home', 'results', 'queue', 'recent'].forEach(name => {
    const panel = document.getElementById(`music-panel-${name}`);
    const tab = document.getElementById(`music-tab-${name}`);
    if (panel) panel.classList.toggle('hidden', name !== wanted);
    if (tab) tab.classList.toggle('is-active', name === wanted);
  });
  const panels = document.getElementById('music-panels');
  if (panels) panels.scrollTop = 0;
  if (wanted === 'home') {
    musicEnsureFeed();
    if (options && options.focus === true) {
      const input = document.getElementById('music-search-input');
      if (input) input.focus();
    }
  }
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------
function musicOnSearchInput(value) {
  clearTimeout(musicSearchTimer);
  const query = String(value || '').trim();
  if (!query) {
    musicClearSearch(false);
    return;
  }
  musicSearchTimer = setTimeout(() => musicSearch(query, false), 320);
}

function musicOnSearchKey(event) {
  if (event.key === 'Enter') {
    event.preventDefault();
    clearTimeout(musicSearchTimer);
    musicSearch(document.getElementById('music-search-input').value.trim(), false);
  }
}

function musicClearSearch(focus) {
  const input = document.getElementById('music-search-input');
  if (input) input.value = '';
  clearTimeout(musicSearchTimer);
  musicSearchToken += 1;
  if (musicSearchAbort) musicSearchAbort.abort();
  musicState.results = [];
  musicState.query = '';
  musicState.loading = false;
  musicState.searchBusy = false;
  musicSetView('home', { focus: false });
  musicRenderResults();
  if (focus && input) input.focus();
}

async function musicSearch(query, autoPlay) {
  const cleaned = String(query || '').trim();
  if (!cleaned) return;
  const token = ++musicSearchToken;
  musicState.query = cleaned;
  musicState.loading = true;
  musicState.searchBusy = true;
  musicState.results = [];
  musicState.error = '';
  musicSetView('results', { focus: false });
  musicRenderResults();

  if (musicSearchAbort) musicSearchAbort.abort();
  musicSearchAbort = new AbortController();
  const signal = musicSearchAbort.signal;
  musicRenderSearchButton();

  let results = [];
  let failed = false;

  try {
    const data = await musicFetchJson(`${API_BASE}/music/search?q=${encodeURIComponent(cleaned)}`, { signal }, 14000);
    results = Array.isArray(data.results) ? data.results : [];
  } catch (err) {
    if (err && err.name === 'AbortError') return;
    failed = true;
  }

  if (token !== musicSearchToken) return;

  // If the app server is unreachable or its proxy is blocked, ask the relay directly.
  if (!results.length) {
    try {
      results = await musicRelaySearch(cleaned, 16);
      if (results.length) failed = false;
    } catch (e) { /* keep the friendly error */ }
  }

  if (token !== musicSearchToken || signal.aborted) return;
  musicState.results = musicUniqueTracks(results, { limit: 18 });
  musicState.loading = false;
  musicState.searchBusy = false;
  musicState.error = failed && !musicState.results.length ? 'Search failed' : '';
  musicRenderResults();

  if (autoPlay && musicState.results.length) {
    musicPlayResult(0);
  } else if (!musicState.results.length) {
    showInAppNotification(`No results for “${cleaned}”`);
  }
}

async function musicRelaySearch(query, limit) {
  const base = await musicRelayBaseUrl();
  if (!base) return [];
  try {
    const data = await musicFetchJson(`${base}/api/search?q=${encodeURIComponent(query)}&limit=${limit || 14}`, {}, 9000);
    return Array.isArray(data.results) ? data.results : [];
  } catch (e) {
    return [];
  }
}

function musicRenderSearchButton() {
  const button = document.getElementById('music-search-btn');
  if (!button) return;
  button.classList.toggle('is-busy', !!musicState.searchBusy);
  button.disabled = !!musicState.searchBusy;
  button.textContent = musicState.searchBusy ? 'Searching…' : 'Search';
}

function musicRenderResults() {
  const container = document.getElementById('music-results-list');
  if (!container) return;
  musicRenderSearchButton();

  if (musicState.loading && !musicState.results.length) {
    container.innerHTML = Array.from({ length: 6 }).map(() => `
      <div class="music-row music-skeleton">
        <div class="music-skel-thumb"></div>
        <div class="music-skel-lines">
          <div class="music-skel-line" style="width:72%"></div>
          <div class="music-skel-line" style="width:38%"></div>
        </div>
      </div>`).join('');
    return;
  }

  if (musicState.error) {
    container.innerHTML = `
      <div class="music-empty">
        <div class="music-empty-icon">${hdsfdIcon('triangle-alert')}</div>
        <div class="music-empty-title">Search failed</div>
        <div class="music-empty-sub">YouTube may be blocking this network. Check your connection and try again.</div>
        <button type="button" class="music-retry-btn" onclick="musicSearch(musicState.query, false)">Try again</button>
      </div>`;
    return;
  }

  if (!musicState.query) {
    container.innerHTML = `
      <div class="music-empty">
        <div class="music-empty-icon">${hdsfdIcon('headphones')}</div>
        <div class="music-empty-title">Search any song, artist or genre</div>
        <div class="music-empty-sub">Ad-free audio, full seek, smart radio and a queue that keeps going.</div>
      </div>`;
    return;
  }

  if (!musicState.results.length) {
    container.innerHTML = `
      <div class="music-empty">
        <div class="music-empty-icon">${hdsfdIcon('search')}</div>
        <div class="music-empty-title">No results for “${escapeHtml(musicState.query)}”</div>
        <div class="music-empty-sub">Try the artist name, a shorter phrase, or one of the genre chips.</div>
      </div>`;
    return;
  }

  container.innerHTML = musicState.results.map((item, index) => musicRowHtml(item, {
    play: `musicPlayResult(${index})`,
    add: `musicQueueAddResult(${index})`
  })).join('');
}

// ---------------------------------------------------------------------------
// Home feed (trending first, personalised once there is taste)
// ---------------------------------------------------------------------------
function musicFeedCacheKey(signature) {
  return `${MUSIC_KEYS.feed}:${signature}`;
}

function musicFeedCacheGet(signature) {
  const raw = musicSafeParse(musicStoreGet(MUSIC_KEYS.feed) || 'null', null);
  if (!raw || raw.signature !== signature || !Array.isArray(raw.results)) return null;
  if (Date.now() - (Number(raw.at) || 0) > 15 * 60 * 1000) return null;
  return raw;
}

function musicFeedCacheSet(signature, payload) {
  musicStoreSet(MUSIC_KEYS.feed, JSON.stringify({
    signature,
    at: Date.now(),
    mode: payload.mode,
    title: payload.title,
    subtitle: payload.subtitle,
    results: payload.results.slice(0, 24)
  }));
}

function musicEnsureFeed() {
  if (musicState.feedLoading) return;
  const signature = musicFeedSignature(musicProfile());
  const cached = musicFeedCacheGet(signature);
  if (cached) {
    musicApplyFeed(cached);
    return;
  }
  if (!musicState.feed.length) musicLoadFeed(false);
}

function musicFeedSignature(profile) {
  return JSON.stringify({
    a: profile.artists.slice(0, 6),
    t: profile.terms.slice(0, 6),
    p: Math.min(50, profile.plays)
  });
}

async function musicLoadFeed(force) {
  if (musicState.feedLoading) return;
  const profile = musicProfile();
  const signature = musicFeedSignature(profile);
  const cached = !force && musicFeedCacheGet(signature);
  if (cached) {
    musicApplyFeed(cached);
    return;
  }

  musicState.feedLoading = true;
  musicRenderFeed();
  try {
    const data = await musicPostJson(`${API_BASE}/music/feed`, { profile: profile, limit: 18 }, 18000);
    const results = musicUniqueTracks(data.results || [], { limit: 18 });
    if (!results.length) throw new Error('empty_feed');
    const payload = {
      mode: data.mode === 'personalized' ? 'personalized' : 'trending',
      title: data.title || (data.mode === 'personalized' ? 'Made for you' : 'Trending now'),
      subtitle: data.subtitle || (data.mode === 'personalized'
        ? 'Built from what you play, skip and like'
        : 'What everyone is playing right now'),
      results
    };
    musicFeedCacheSet(signature, payload);
    musicApplyFeed(payload);
  } catch (err) {
    // Relay-only fallback so the Home tab still fills when the app server is down.
    try {
      const queries = musicHasTaste(profile)
        ? profile.artists.slice(0, 2).map(name => `${name} songs`)
        : ['top hits this week', 'trending music'];
      const lists = [];
      for (const query of queries) lists.push(await musicRelaySearch(query, 10));
      const results = musicUniqueTracks([].concat.apply([], lists), { limit: 18 });
      if (results.length) {
        musicApplyFeed({
          mode: musicHasTaste(profile) ? 'personalized' : 'trending',
          title: musicHasTaste(profile) ? 'Made for you' : 'Trending now',
          subtitle: 'Fresh picks while the server catches up',
          results
        });
      } else {
        musicState.feed = [];
        musicState.feedMode = 'trending';
        musicState.feedTitle = 'Trending now';
        musicState.feedSubtitle = 'The feed could not load — search anything above';
      }
    } catch (e) {
      musicState.feedSubtitle = 'The feed could not load — search anything above';
    }
  } finally {
    musicState.feedLoading = false;
    musicRenderFeed();
  }
}

function musicApplyFeed(payload) {
  musicState.feed = Array.isArray(payload.results) ? payload.results : [];
  musicState.feedMode = payload.mode === 'personalized' ? 'personalized' : 'trending';
  musicState.feedTitle = payload.title || (musicState.feedMode === 'personalized' ? 'Made for you' : 'Trending now');
  musicState.feedSubtitle = payload.subtitle || '';
  musicRenderFeed();
}

function musicRenderFeed() {
  const container = document.getElementById('music-feed-list');
  const title = document.getElementById('music-feed-title');
  const subtitle = document.getElementById('music-feed-sub');
  const badge = document.getElementById('music-feed-badge');
  if (title) title.textContent = musicState.feedTitle;
  if (subtitle) subtitle.textContent = musicState.feedSubtitle;
  if (badge) {
    badge.textContent = musicState.feedMode === 'personalized' ? 'For you' : 'Trending';
    badge.dataset.mode = musicState.feedMode;
  }
  if (!container) return;

  if (musicState.feedLoading && !musicState.feed.length) {
    container.innerHTML = Array.from({ length: 8 }).map(() => `
      <div class="music-card music-skeleton-card">
        <div class="music-card-skel-art"></div>
        <div class="music-skel-line" style="width:82%"></div>
        <div class="music-skel-line" style="width:48%"></div>
      </div>`).join('');
    return;
  }

  if (!musicState.feed.length) {
    container.innerHTML = `
      <div class="music-empty">
        <div class="music-empty-icon">${hdsfdIcon('flame')}</div>
        <div class="music-empty-title">Nothing here yet</div>
        <div class="music-empty-sub">Search for a track, or pull the feed again.</div>
        <button type="button" class="music-retry-btn" onclick="musicLoadFeed(true)">Load the feed</button>
      </div>`;
    return;
  }

  container.innerHTML = musicState.feed.map((item, index) => musicCardHtml(item, index)).join('');
  musicSyncPlayControls();
}

function musicCardHtml(item, index) {
  const active = !!(musicState.current && musicState.current.id === item.id);
  const iconName = active && musicIsPlaying() ? 'pause' : 'play';
  const liked = musicIsLiked(item.id);
  return `
    <div class="music-card ${active ? 'is-current' : ''}" data-music-row="${item.id}">
      <button type="button" class="music-card-art" onclick="musicPlayFeed(${index})" aria-label="Play ${escapeHtml(item.title)}">
        <img src="${escapeHtml(item.thumbnail)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
        <span class="music-card-play" data-music-play="${item.id}">${hdsfdIcon(iconName)}</span>
      </button>
      <div class="music-card-body">
        <button type="button" class="music-card-title" onclick="musicPlayFeed(${index})">${escapeHtml(item.title)}</button>
        <div class="music-card-sub">${escapeHtml(item.channel)}</div>
      </div>
      <div class="music-card-tools">
        <button type="button" class="music-icon-btn music-like-btn ${liked ? 'is-liked' : ''}" data-music-like="${item.id}" onclick="musicToggleLikeById('${item.id}')" title="${liked ? 'Remove from taste' : 'Like'}" aria-label="Like">${hdsfdIcon('star')}</button>
        <button type="button" class="music-icon-btn" onclick="musicQueueAddFeed(${index})" title="Add to queue" aria-label="Add to queue">${hdsfdIcon('plus')}</button>
      </div>
    </div>`;
}

function musicPlayFeed(index) {
  const item = musicState.feed[index];
  if (item) musicPlayItem(item, true);
}

function musicQueueAddFeed(index) {
  const item = musicState.feed[index];
  if (!item) return;
  musicQueueAdd(item);
  showInAppNotification(`Added to queue: ${item.title}`);
}

// ---------------------------------------------------------------------------
// Shared row renderer
// ---------------------------------------------------------------------------
function musicRowHtml(item, options) {
  const opts = options || {};
  const active = !!(musicState.current && musicState.current.id === item.id);
  const iconName = active && musicIsPlaying() ? 'pause' : 'play';
  const liked = musicIsLiked(item.id);
  const thumb = escapeHtml(item.thumbnail || `https://i.ytimg.com/vi/${item.id}/mqdefault.jpg`);
  return `
    <div class="music-row ${active ? 'is-current' : ''}" data-music-row="${item.id}">
      <button type="button" class="music-row-main" onclick="${opts.play}">
        <img class="music-thumb" src="${thumb}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
        <span class="music-row-text">
          <span class="music-row-title">${escapeHtml(item.title || 'Untitled')}</span>
          <span class="music-row-sub">${escapeHtml(musicMetaLine(item))}</span>
        </span>
      </button>
      <button type="button" class="music-icon-btn music-like-btn ${liked ? 'is-liked' : ''}" data-music-like="${item.id}" onclick="musicToggleLikeById('${item.id}')" title="${liked ? 'Remove from taste' : 'Like'}" aria-label="Like">${hdsfdIcon('star')}</button>
      ${opts.add ? `<button type="button" class="music-icon-btn" onclick="${opts.add}" title="Add to queue" aria-label="Add to queue">${hdsfdIcon('plus')}</button>` : ''}
      <button type="button" class="music-play-btn" data-music-play="${item.id}" onclick="${opts.play}" title="Play">${hdsfdIcon(iconName)}</button>
    </div>`;
}

// ---------------------------------------------------------------------------
// Playback
// ---------------------------------------------------------------------------
function musicAudioEl() {
  return document.getElementById('music-audio');
}

function musicKnownDuration() {
  const audio = musicAudioEl();
  if (audio && isFinite(audio.duration) && audio.duration > 0) return audio.duration;
  const item = musicState.current;
  return item && Number(item.seconds) > 0 ? Number(item.seconds) : 0;
}

function musicIsPlaying() {
  if (musicState.engine === 'youtube') return !!isYTPlaying;
  const audio = musicAudioEl();
  return !!(audio && audio.src && !audio.paused && !audio.ended);
}

function musicPlayResult(index) {
  const item = musicState.results[index];
  if (item) musicPlayItem(item, true);
}

function musicQueueAddResult(index) {
  const item = musicState.results[index];
  if (!item) return;
  musicQueueAdd(item);
  showInAppNotification(`Added to queue: ${item.title}`);
}

function musicHandleQuery(queryOrUrl) {
  const raw = String(queryOrUrl || '').trim();
  if (!raw) return;
  const ids = parseYouTubeUrl(raw);
  if (ids.videoId) {
    openMusicPlayer();
    musicPlayItem({
      id: ids.videoId,
      title: 'YouTube track',
      channel: 'YouTube',
      thumbnail: `https://i.ytimg.com/vi/${ids.videoId}/mqdefault.jpg`,
      url: `https://www.youtube.com/watch?v=${ids.videoId}`
    }, true);
    return;
  }
  if (ids.playlistId) {
    openMusicPlayer();
    musicPlayLegacyPlaylist(ids.playlistId, raw);
    return;
  }
  openMusicPlayer(raw);
}

function musicPlayLegacyPlaylist(playlistId, rawUrl) {
  const input = document.getElementById('yt-song-input');
  if (input) input.value = rawUrl;
  ytCurrentVideoId = null;
  ytCurrentPlaylistId = null;
  isYTPlaying = false;
  musicState.engine = 'youtube';
  musicSetEngineBadge('YouTube playlist', 'youtube');
  toggleYouTubePlayback();
}

function musicPlayItem(item, playNow) {
  const track = musicNormalizeTrack(item);
  if (!track) return;
  item = track;

  musicState.current = item;
  let existing = musicState.queue.findIndex(entry => entry.id === item.id);
  if (existing < 0) {
    // Same recording under a different upload is not a second queue entry.
    const key = musicTrackKey(item);
    existing = musicState.queue.findIndex(entry => musicTrackKey(entry) === key);
  }
  if (existing >= 0) {
    musicState.index = existing;
  } else if (playNow) {
    const insertAt = Math.max(0, musicState.index + 1);
    musicState.queue.splice(insertAt, 0, item);
    musicState.index = insertAt;
  } else {
    musicState.queue.push(item);
    musicState.index = musicState.queue.length - 1;
  }

  musicAddRecent(item);
  musicPersistState();
  musicRenderNowPlaying();
  musicRenderQueue();
  musicRenderResults();
  musicRenderFeed();
  musicStartAudio(item);
}

function musicQueueAdd(item) {
  const track = musicNormalizeTrack(item);
  if (!track) return;
  const key = musicTrackKey(track);
  if (musicState.queue.some(entry => entry.id === track.id || musicTrackKey(entry) === key)) {
    if (!musicState.current) musicState.current = track;
    return;
  }
  musicState.queue.push(track);
  if (musicState.index < 0 && musicState.queue.length === 1) musicState.index = 0;
  musicPersistState();
  musicRenderQueue();
  musicSyncPlayControls();
}

// The relay resolves Innertube formats and proxies the bytes, so the app host
// never has to reach YouTube and the browser never sees an ad.
async function musicRelayBaseUrl() {
  if (musicRelayBase !== null) return musicRelayBase;
  if (!musicRelayPromise) {
    musicRelayPromise = fetch(`${API_BASE}/music/config`, { cache: 'no-store' })
      .then(res => res.json())
      .then(data => {
        musicRelayBase = (data && data.relay_base) || '';
        return musicRelayBase;
      })
      .catch(() => { musicRelayBase = ''; return ''; });
  }
  return musicRelayPromise;
}

async function musicRelayResolve(item, onAttempt) {
  const base = await musicRelayBaseUrl();
  if (!base) return null;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (onAttempt) onAttempt(attempt + 1, 5);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 9000);
    try {
      const res = await fetch(`${base}/api/player?attempt=${attempt}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId: item.id }),
        signal: controller.signal
      });
      if (res.ok) {
        const data = await res.json();
        const formats = Array.isArray(data.audio) ? data.audio.filter(entry => entry && entry.url) : [];
        if (formats.length) {
          if (data.length_seconds) item.seconds = Number(data.length_seconds);
          if (data.title && (!item.title || item.title === 'YouTube track')) item.title = data.title;
          if (data.author && (!item.channel || item.channel === 'YouTube')) item.channel = data.author;
          return { base, formats };
        }
      }
    } catch (err) {
      // A timeout is a refusal we can retry; only a cancelled track stops here.
      if (musicState.current !== item) return null;
    } finally {
      clearTimeout(timer);
    }
    await musicSleep(200 + attempt * 140);
  }
  return null;
}

function musicPickAudioFormat(audio, formats) {
  const canPlay = audio && typeof audio.canPlayType === 'function' ? audio.canPlayType.bind(audio) : null;
  const usable = formats.filter(format => {
    const mime = String(format.mime || '').split(';')[0].trim();
    return !canPlay || !mime || canPlay(mime);
  });
  const pool = usable.length ? usable : formats;
  return pool.find(format => /^audio\/mp4/i.test(String(format.mime || ''))) || pool[0] || null;
}

async function musicStartAudio(item) {
  const audio = musicAudioEl();
  const token = ++musicPlayToken;
  musicState.engine = 'audio';
  musicState.resolvingItem = item;
  musicSetEngineBadge('Connecting…', 'audio');
  musicSetResolving(true, 'Loading track');
  musicSetPlayingUI(true);
  updateYTTrackTitle(item.title || 'Loading…');
  musicTasteListenStart(item);

  if (!audio) {
    musicSetResolving(false);
    musicFallbackYouTube(item);
    return;
  }

  try {
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  } catch (e) { /* noop */ }

  audio.volume = musicState.volume;
  audio.dataset.videoId = item.id;

  let resolved = null;
  try {
    resolved = await musicRelayResolve(item, (attempt, total) => {
      if (token !== musicPlayToken) return;
      musicPill.label(attempt > 1 ? `Finding audio · try ${attempt}/${total}` : 'Loading track');
    });
  } catch (e) {
    resolved = null;
  }
  if (token !== musicPlayToken || musicState.current !== item) return;

  const format = resolved ? musicPickAudioFormat(audio, resolved.formats) : null;
  if (!format) {
    musicState.resolving = false;
    musicPill.fail('No audio — switching player');
    musicFallbackYouTube(item);
    return;
  }

  musicSetEngineBadge('Ad-free audio', 'audio');
  musicState.resolving = false;
  musicStartStream(
    audio,
    `${resolved.base}/api/stream?url=${encodeURIComponent(format.url)}&id=${encodeURIComponent(item.id)}`
  );
  setTimeout(() => {
    if (token === musicPlayToken && musicPill.isVisible()) musicPill.done();
  }, 9000);
  musicRenderNowPlaying();
  musicMaybeExtendQueue();
}

function musicStartStream(audio, url) {
  audio.crossOrigin = 'anonymous';
  audio.src = url;
  const promise = audio.play();
  if (promise && promise.catch) {
    promise.catch(() => { /* error listener handles fallback */ });
  }
}

function musicFallbackYouTube(item) {
  if (!item || !item.id) return;
  const audio = musicAudioEl();
  if (audio) {
    try {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    } catch (e) { /* noop */ }
  }
  musicState.resolving = false;
  musicPill.fail('Using YouTube player');
  musicState.engine = 'youtube';
  musicSetEngineBadge('YouTube embed', 'youtube');
  const input = document.getElementById('yt-song-input');
  if (input) input.value = `https://www.youtube.com/watch?v=${item.id}`;
  ytCurrentVideoId = null;
  ytCurrentPlaylistId = null;
  isYTPlaying = false;
  toggleYouTubePlayback();
  musicSyncPlayControls();
}

function musicToggle() {
  if (musicState.engine === 'youtube') {
    toggleYouTubePlayback();
    setTimeout(musicSyncPlayControls, 120);
    return;
  }
  const audio = musicAudioEl();
  if (!audio || !audio.src) {
    if (musicState.current) musicStartAudio(musicState.current);
    else openMusicPlayer();
    return;
  }
  if (audio.paused) {
    const promise = audio.play();
    if (promise && promise.catch) promise.catch(() => {});
  } else {
    audio.pause();
  }
}

function musicPlayQueueIndex(index) {
  const item = musicState.queue[index];
  if (!item) return;
  musicState.index = index;
  musicPlayItem(item, true);
}

function musicNext(source) {
  const fromEnded = source === 'ended';
  if (!fromEnded && musicState.current) musicTasteMaybeSkip(musicState.current);

  if (musicState.engine === 'youtube' && ytPlayer && ytCurrentPlaylistId && ytPlayer.nextVideo) {
    ytPlayer.nextVideo();
    return;
  }
  if (!musicState.queue.length) {
    if (musicState.radio && musicState.current) musicStartMoreRadio();
    return;
  }

  let nextIndex = null;
  if (musicState.shuffle && musicState.queue.length > 1) {
    let candidate = musicState.index;
    for (let tries = 0; tries < 12 && candidate === musicState.index; tries += 1) {
      candidate = Math.floor(Math.random() * musicState.queue.length);
    }
    nextIndex = candidate;
  } else if (musicState.index + 1 < musicState.queue.length) {
    nextIndex = musicState.index + 1;
  } else if (musicState.repeat === 'all') {
    nextIndex = 0;
  }

  if (nextIndex === null) {
    if (musicState.radio) {
      musicStartMoreRadio(fromEnded);
    } else {
      musicSetPlayingUI(false);
    }
    return;
  }

  musicState.index = nextIndex;
  const item = musicState.queue[musicState.index];
  if (!item) return;
  musicState.current = item;
  musicAddRecent(item);
  musicPersistState();
  musicRenderNowPlaying();
  musicRenderQueue();
  musicRenderResults();
  musicRenderFeed();
  musicStartAudio(item);
}

function musicPrev() {
  if (musicState.engine === 'youtube' && ytPlayer && ytCurrentPlaylistId && ytPlayer.previousVideo) {
    ytPlayer.previousVideo();
    return;
  }
  if (!musicState.queue.length) return;
  if (musicState.current) musicTasteMaybeSkip(musicState.current);
  musicState.index = musicState.index > 0 ? musicState.index - 1 : 0;
  const item = musicState.queue[musicState.index];
  if (!item) return;
  musicState.current = item;
  musicAddRecent(item);
  musicPersistState();
  musicRenderNowPlaying();
  musicRenderQueue();
  musicRenderResults();
  musicRenderFeed();
  musicStartAudio(item);
}

function musicHandleEnded() {
  if (musicState.current) musicTasteCountPlay(musicState.current);
  const audio = musicAudioEl();
  if (musicState.repeat === 'one' && audio) {
    audio.currentTime = 0;
    const promise = audio.play();
    if (promise && promise.catch) promise.catch(() => {});
    return;
  }
  if (!musicState.autoplay) {
    musicSetPlayingUI(false);
    return;
  }
  musicNext('ended');
}

function musicSeek(percent) {
  const value = Number(percent) || 0;
  if (musicState.engine === 'youtube' && ytPlayer && ytPlayer.getDuration && ytPlayer.seekTo) {
    const duration = ytPlayer.getDuration() || 0;
    if (duration > 0) ytPlayer.seekTo((value / 100) * duration, true);
    return;
  }
  const audio = musicAudioEl();
  const duration = musicKnownDuration();
  if (audio && duration > 0) {
    audio.currentTime = (value / 100) * duration;
    musicUpdateProgress();
  }
}

function musicSetVolume(value) {
  const numeric = Math.min(100, Math.max(0, Number(value) || 0));
  musicState.volume = numeric / 100;
  const audio = musicAudioEl();
  if (audio) audio.volume = musicState.volume;
  if (ytPlayer && ytPlayer.setVolume) ytPlayer.setVolume(numeric);
  const label = document.getElementById('music-volume-label');
  if (label) label.textContent = `${Math.round(numeric)}%`;
  const slider = document.getElementById('music-volume');
  if (slider && String(slider.value) !== String(Math.round(numeric))) slider.value = String(Math.round(numeric));
  musicStoreSet(MUSIC_KEYS.volume, String(musicState.volume));
}

function musicUpdateProgress() {
  const audio = musicAudioEl();
  if (!audio) return;
  const duration = musicKnownDuration();
  const current = audio.currentTime || 0;
  const percent = duration > 0 ? (current / duration) * 100 : 0;

  const seek = document.getElementById('music-seek');
  const cur = document.getElementById('music-cur-time');
  const dur = document.getElementById('music-dur-time');
  const legacyTime = document.getElementById('yt-time-display');
  if (seek && document.activeElement !== seek) seek.value = String(percent);
  if (cur) cur.textContent = musicFmt(current);
  if (dur) dur.textContent = duration > 0 ? musicFmt(duration) : '--:--';
  if (legacyTime) legacyTime.textContent = `${musicFmt(current)} / ${musicFmt(duration)}`;
}

function musicSetPlayingUI(playing) {
  const icon = document.getElementById('music-play-icon');
  if (icon) icon.innerHTML = hdsfdIcon(playing ? 'pause' : 'play');
  const miniIcon = document.getElementById('yt-btn-icon');
  if (miniIcon) miniIcon.innerHTML = hdsfdIcon(playing ? 'pause' : 'play');
  musicSyncPlayControls();
}

// Every play/pause surface in the player mirrors the real audio state: the
// transport, each result/queue/feed row and the home mini deck. Nothing is left
// showing a stale triangle.
function musicSyncPlayControls() {
  const playing = musicIsPlaying();
  const currentId = musicState.current ? musicState.current.id : null;

  const transport = document.getElementById('music-play-icon');
  if (transport) transport.innerHTML = hdsfdIcon(playing ? 'pause' : 'play');
  const transportButton = document.getElementById('music-transport-toggle');
  if (transportButton) {
    transportButton.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    transportButton.title = playing ? 'Pause' : 'Play';
  }

  document.querySelectorAll('[data-music-play]').forEach(button => {
    const id = button.getAttribute('data-music-play');
    const active = !!id && id === currentId;
    const wanted = active && playing ? 'pause' : 'play';
    if (button.dataset.state !== wanted) {
      button.dataset.state = wanted;
      button.innerHTML = hdsfdIcon(wanted);
    }
    button.classList.toggle('is-current', active);
    button.classList.toggle('is-playing', active && playing);
    button.title = wanted === 'pause' ? 'Pause' : 'Play';
    button.setAttribute('aria-label', wanted === 'pause' ? 'Pause' : 'Play');
  });

  document.querySelectorAll('[data-music-row]').forEach(row => {
    const id = row.getAttribute('data-music-row');
    const active = !!id && id === currentId;
    row.classList.toggle('is-current', active);
    row.classList.toggle('is-playing', active && playing);
  });

  document.querySelectorAll('[data-music-like]').forEach(button => {
    const liked = musicIsLiked(button.getAttribute('data-music-like'));
    button.classList.toggle('is-liked', liked);
    button.title = liked ? 'Remove from taste' : 'Like';
  });
}

function musicToggleShuffle() {
  musicState.shuffle = !musicState.shuffle;
  musicStoreSet(MUSIC_KEYS.shuffle, String(musicState.shuffle));
  const btn = document.getElementById('music-shuffle-btn');
  if (btn) btn.classList.toggle('is-active', musicState.shuffle);
  musicUpdateToggles();
}

function musicCycleRepeat() {
  musicState.repeat = musicState.repeat === 'off' ? 'all' : (musicState.repeat === 'all' ? 'one' : 'off');
  musicStoreSet(MUSIC_KEYS.repeat, musicState.repeat);
  const btn = document.getElementById('music-repeat-btn');
  if (btn) {
    btn.classList.toggle('is-active', musicState.repeat !== 'off');
    btn.innerHTML = hdsfdIcon(musicState.repeat === 'one' ? 'repeat-1' : 'repeat');
    btn.title = musicState.repeat === 'off' ? 'Repeat off' : (musicState.repeat === 'all' ? 'Repeat all' : 'Repeat one');
  }
  musicUpdateToggles();
}

function musicToggleRadio() {
  musicState.radio = !musicState.radio;
  musicStoreSet(MUSIC_KEYS.radio, String(musicState.radio));
  musicUpdateToggles();
  if (musicState.radio) {
    showInAppNotification('Smart radio on — it will keep the queue going');
    musicMaybeExtendQueue();
  } else {
    showInAppNotification('Smart radio off');
  }
}

function musicToggleAutoplay() {
  musicState.autoplay = !musicState.autoplay;
  musicStoreSet(MUSIC_KEYS.autoplay, String(musicState.autoplay));
  musicUpdateToggles();
  showInAppNotification(musicState.autoplay ? 'Autoplay on' : 'Autoplay off');
}

function musicUpdateToggles() {
  const radio = document.getElementById('music-radio-toggle');
  if (radio) {
    radio.classList.toggle('is-on', musicState.radio);
    radio.setAttribute('aria-pressed', musicState.radio ? 'true' : 'false');
    radio.innerHTML = `${hdsfdIcon('radio')}<span>Smart radio ${musicState.radio ? 'on' : 'off'}</span>`;
  }
  const autoplay = document.getElementById('music-autoplay-toggle');
  if (autoplay) {
    autoplay.classList.toggle('is-on', musicState.autoplay);
    autoplay.setAttribute('aria-pressed', musicState.autoplay ? 'true' : 'false');
    autoplay.innerHTML = `${hdsfdIcon('play')}<span>Autoplay ${musicState.autoplay ? 'on' : 'off'}</span>`;
  }
  const shuffle = document.getElementById('music-shuffle-btn');
  if (shuffle) shuffle.classList.toggle('is-active', musicState.shuffle);
  const repeat = document.getElementById('music-repeat-btn');
  if (repeat) repeat.classList.toggle('is-active', musicState.repeat !== 'off');
  musicRenderSearchButton();
}

// ---------------------------------------------------------------------------
// Smart radio / auto-play queue
// ---------------------------------------------------------------------------
async function musicLoadRadio(options) {
  const opts = options || {};
  const seed = opts.seed || musicState.current;
  if (!seed || !seed.id) return [];
  if (musicState.radioLoading && musicRadioPromise) return musicRadioPromise;

  musicState.radioLoading = true;
  musicRadioPromise = (async () => {
    const profile = musicProfile();
    const exclude = Array.from(new Set(
      Array.from(musicQueueIds()).concat(musicState.recent.map(entry => entry.id))
    )).slice(0, 80);

    let candidates = [];
    try {
      const data = await musicPostJson(`${API_BASE}/music/radio`, {
        videoId: seed.id,
        title: seed.title || '',
        channel: seed.channel || '',
        exclude: exclude,
        artists: profile.artists,
        terms: profile.terms,
        limit: 12
      }, 16000);
      candidates = Array.isArray(data.results) ? data.results : [];
    } catch (e) {
      candidates = [];
    }

    if (!candidates.length) {
      const queries = [];
      if (seed.channel) queries.push(`${seed.channel} radio`, `${seed.channel} songs`);
      const words = musicTokens(seed.title).slice(0, 3).join(' ');
      if (words) queries.push(`${seed.channel ? seed.channel + ' ' : ''}${words}`);
      for (const query of queries) {
        const found = await musicRelaySearch(query, 10);
        candidates = candidates.concat(found);
        if (candidates.length >= 14) break;
      }
    }

    return musicUniqueTracks(candidates, {
      excludeIds: new Set(exclude),
      excludeKeys: musicQueueKeys(),
      limit: 10
    });
  })();

  try {
    const fresh = await musicRadioPromise;
    fresh.forEach(item => musicState.queue.push(item));
    if (fresh.length) {
      musicPersistState();
      musicRenderQueue();
      musicSyncPlayControls();
      musicUpdateFeedNote(fresh.length);
    }
    return fresh;
  } finally {
    musicState.radioLoading = false;
    musicRadioPromise = null;
    musicRenderQueue();
  }
}

function musicUpdateFeedNote(count) {
  const note = document.getElementById('music-queue-note');
  if (note) note.textContent = count ? `Smart radio added ${count} track${count === 1 ? '' : 's'}` : '';
}

function musicMaybeExtendQueue() {
  if (!musicState.radio || !musicState.current || musicState.radioLoading) return;
  const remaining = musicState.queue.length - musicState.index - 1;
  if (remaining > 2) return;
  musicLoadRadio().catch(() => {});
}

async function musicStartMoreRadio(fromEnded) {
  if (!musicState.current || musicState.radioLoading) return;
  musicPill.start('Building radio');
  musicState.radioLoading = true;
  try {
    const added = await musicLoadRadio();
    if (!added.length) {
      musicPill.fail('Radio came up empty');
      if (!fromEnded) showInAppNotification('Radio found nothing new — try another track');
      return;
    }
    musicState.index = musicState.queue.length - added.length;
    const first = musicState.queue[musicState.index];
    if (first) musicPlayItem(first, true);
  } catch (e) {
    musicPill.fail('Radio unavailable');
  } finally {
    musicState.radioLoading = false;
  }
}

// ---------------------------------------------------------------------------
// Rendering: now playing, queue, recent
// ---------------------------------------------------------------------------
function musicRenderNowPlaying() {
  const item = musicState.current;
  const thumb = document.getElementById('music-np-thumb');
  const title = document.getElementById('music-np-title');
  const channel = document.getElementById('music-np-channel');
  const mini = document.getElementById('music-mini');
  const miniThumb = document.getElementById('music-mini-thumb');
  const miniTitle = document.getElementById('music-mini-title');
  const miniArtist = document.getElementById('music-mini-artist');
  const likeBtn = document.getElementById('music-np-like');

  if (item) {
    if (thumb) thumb.src = item.thumbnail;
    if (title) title.textContent = item.title || 'Unknown track';
    if (channel) channel.textContent = item.channel || 'YouTube';
    if (mini) mini.classList.add('is-visible');
    if (miniThumb) miniThumb.src = item.thumbnail;
    if (miniTitle) miniTitle.textContent = item.title || 'Unknown track';
    if (miniArtist) miniArtist.textContent = item.channel || 'YouTube';
    if (likeBtn) {
      likeBtn.classList.toggle('is-liked', musicIsLiked(item.id));
      likeBtn.setAttribute('aria-pressed', musicIsLiked(item.id) ? 'true' : 'false');
    }
    updateYTTrackTitle(item.title || '');
  } else {
    if (title) title.textContent = 'Nothing playing';
    if (channel) channel.textContent = 'Pick a track to start';
    if (mini) mini.classList.remove('is-visible');
    if (likeBtn) likeBtn.classList.remove('is-liked');
  }
  musicUpdateMediaSession();
  musicSyncPlayControls();
}

function musicUpdateMediaSession() {
  if (!('mediaSession' in navigator) || !musicState.current) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: musicState.current.title || 'HDSFD Music',
      artist: musicState.current.channel || 'HDSFD',
      album: 'HDSFD Music',
      artwork: [{ src: musicState.current.thumbnail, sizes: '320x180', type: 'image/jpeg' }]
    });
    navigator.mediaSession.setActionHandler('play', () => musicToggle());
    navigator.mediaSession.setActionHandler('pause', () => musicToggle());
    navigator.mediaSession.setActionHandler('nexttrack', () => musicNext());
    navigator.mediaSession.setActionHandler('previoustrack', () => musicPrev());
  } catch (e) { /* noop */ }
}

function musicRenderQueue() {
  const container = document.getElementById('music-queue-list');
  const count = document.getElementById('music-queue-count');
  if (count) count.textContent = String(musicState.queue.length);
  musicUpdateToggles();
  if (!container) return;
  if (!musicState.queue.length) {
    container.innerHTML = `<div class="music-empty"><div class="music-empty-title">Queue is empty</div><div class="music-empty-sub">Play something, or add tracks from Home and Search. Smart radio fills the rest.</div></div>`;
    return;
  }

  container.innerHTML = musicState.queue.map((item, index) => `
    <div class="music-row ${index === musicState.index ? 'is-current' : ''}" data-music-row="${item.id}">
      <button type="button" class="music-row-main" onclick="musicPlayQueueIndex(${index})">
        <img class="music-thumb" src="${escapeHtml(item.thumbnail)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
        <span class="music-row-text">
          <span class="music-row-title">${escapeHtml(item.title || 'Untitled')}</span>
          <span class="music-row-sub">${escapeHtml(item.channel || 'YouTube')}${index === musicState.index ? ' • now' : ''}</span>
        </span>
      </button>
      <button type="button" class="music-icon-btn" onclick="musicRemoveQueueIndex(${index})" title="Remove" aria-label="Remove">${hdsfdIcon('x')}</button>
    </div>
  `).join('');
  musicSyncPlayControls();
}

function musicRemoveQueueIndex(index) {
  if (index < 0 || index >= musicState.queue.length) return;
  if (index === musicState.index) {
    // Removing the current track does not stop it; it just leaves the queue, so
    // "next" continues with the track that followed it.
    musicState.queue.splice(index, 1);
    musicState.index = index - 1;
  } else {
    musicState.queue.splice(index, 1);
    if (musicState.index > index) musicState.index -= 1;
    if (musicState.index >= musicState.queue.length) musicState.index = musicState.queue.length - 1;
  }
  musicPersistState();
  musicRenderQueue();
}

function musicAddRecent(item) {
  if (!item || !item.id) return;
  musicState.recent = musicState.recent.filter(entry => entry.id !== item.id);
  musicState.recent.unshift({
    id: item.id,
    title: item.title || 'Untitled',
    channel: item.channel || 'YouTube',
    thumbnail: item.thumbnail || `https://i.ytimg.com/vi/${item.id}/mqdefault.jpg`,
    url: item.url || `https://www.youtube.com/watch?v=${item.id}`,
    seconds: Number(item.seconds) || 0,
    duration: item.duration || '',
    played_at: Date.now()
  });
  if (musicState.recent.length > 30) musicState.recent = musicState.recent.slice(0, 30);
  musicStoreSet(MUSIC_KEYS.recent, JSON.stringify(musicState.recent));
  musicRenderRecent();
}

function musicRenderRecent() {
  const container = document.getElementById('music-recent-list');
  if (!container) return;
  if (!musicState.recent.length) {
    container.innerHTML = `<div class="music-empty"><div class="music-empty-title">No history yet</div><div class="music-empty-sub">Everything you play is saved here — and only here, never on the home screen.</div></div>`;
    return;
  }
  container.innerHTML = musicState.recent.map((item, index) => musicRowHtml(item, {
    play: `musicPlayRecent(${index})`
  })).join('');
  musicSyncPlayControls();
}

function musicPlayRecent(index) {
  const item = musicState.recent[index];
  if (!item) return;
  musicPlayItem(item, true);
}

function musicPersistState() {
  try {
    musicStoreSet(MUSIC_KEYS.queue, JSON.stringify(musicState.queue.slice(0, 60)));
    musicStoreSet(MUSIC_KEYS.index, String(musicState.index));
  } catch (e) { /* noop */ }
}

function musicRestoreState() {
  try {
    const queue = musicSafeParse(musicStoreGet(MUSIC_KEYS.queue) || '[]', []);
    const index = parseInt(musicStoreGet(MUSIC_KEYS.index) || '-1', 10);
    if (Array.isArray(queue) && queue.length) {
      musicState.queue = queue.map(item => musicNormalizeTrack(item)).filter(Boolean);
      musicState.index = Number.isInteger(index) && index >= 0 && index < musicState.queue.length ? index : 0;
      musicState.current = musicState.queue[musicState.index] || null;
      musicState.engine = 'idle';
      musicRenderNowPlaying();
      musicRenderQueue();
    }
  } catch (e) { /* noop */ }
  musicSetVolume(musicState.volume * 100);
  musicUpdateToggles();
  musicRenderRecent();
  musicSyncPlayControls();
}

function bindMusicAudio() {
  const audio = musicAudioEl();
  if (!audio || audio.dataset.bound === '1') return;
  audio.dataset.bound = '1';
  audio.volume = musicState.volume;
  audio.addEventListener('timeupdate', musicUpdateProgress);
  audio.addEventListener('loadedmetadata', musicUpdateProgress);
  audio.addEventListener('durationchange', musicUpdateProgress);
  audio.addEventListener('play', () => musicSetPlayingUI(true));
  audio.addEventListener('playing', () => {
    musicSetPlayingUI(true);
    if (musicPill.isVisible() && !musicState.resolving) musicPill.done();
  });
  audio.addEventListener('pause', () => {
    if (musicState.engine !== 'youtube') musicSetPlayingUI(false);
  });
  audio.addEventListener('ended', musicHandleEnded);
  audio.addEventListener('waiting', () => {
    if (musicState.engine === 'audio' && musicState.current && !musicState.resolving) {
      musicSetEngineBadge('Buffering…', 'audio');
    }
  });
  audio.addEventListener('error', () => {
    const current = musicState.current;
    // Removing the source while switching tracks also fires error; ignore that.
    if (!current || musicState.engine !== 'audio' || musicState.resolving || !audio.src) return;
    musicFallbackYouTube(current);
  });
  if ('mediaSession' in navigator) {
    try {
      navigator.mediaSession.setActionHandler('seekto', (details) => {
        if (audio && details.seekTime != null) audio.currentTime = details.seekTime;
      });
    } catch (e) { /* noop */ }
  }
  musicSetVolume(musicState.volume * 100);
}

// ===== CUSTOM IN-APP MODAL FOR CLEARING GEMINI HISTORY =====
function openClearGeminiModal() {
  const modal = document.getElementById('clear-gemini-history-modal');
  if (modal) modal.classList.remove('hidden');
}

function closeClearGeminiModal() {
  const modal = document.getElementById('clear-gemini-history-modal');
  if (modal) modal.classList.add('hidden');
}

async function executeConfirmedClearGeminiHistory() {
  const currentOwner = currentOwnerKey();
  closeClearGeminiModal();
  if (!hdsfdSessionUser()) {
    geminiChatHistory = [];
    renderGeminiDefaultGreeting();
    return;
  }
  try {
    await fetch(`${API_BASE}/gemini/history?username=${encodeURIComponent(currentOwner)}`, { method: 'DELETE', headers: hdsfdAuthHeaders() });
  } catch (err) {
    console.warn('Clear history error:', err);
  }
  geminiChatHistory = [];
  renderGeminiDefaultGreeting();
}

// ===== CUSTOM IN-APP MODAL FOR GEMINI API KEY =====
function openGeminiApiKeyModal() {
  const modal = document.getElementById('gemini-api-key-modal');
  const input = document.getElementById('gemini-api-key-input');
  if (input) input.value = localStorage.getItem('hdsfd_gemini_api_key') || '';
  if (modal) modal.classList.remove('hidden');
}

function closeGeminiApiKeyModal() {
  const modal = document.getElementById('gemini-api-key-modal');
  if (modal) modal.classList.add('hidden');
}

function saveGeminiApiKey() {
  const input = document.getElementById('gemini-api-key-input');
  const key = input ? input.value.trim() : '';
  if (key) {
    localStorage.setItem('hdsfd_gemini_api_key', key);
  } else {
    localStorage.removeItem('hdsfd_gemini_api_key');
  }
  closeGeminiApiKeyModal();
}

function updateStatsOverview() {
  const mult = getGrowthMultiplier();
  const lifetimeCoins = getLifetimeCoins();
  const currentCoins = getUserCoinsBalance();

  const sessions = allData.filter(d => d.type === 'focus_session');
  const mins = sessions.reduce((sum, s) => sum + (s.minutes || 0), 0);
  const tasks = allData.filter(d => d.type === 'task');
  const completedTasks = tasks.filter(t => t.completed).length;

  const focusEl = document.getElementById('stat-focus-time');
  const tasksEl = document.getElementById('stat-tasks-done');
  const streakEl = document.getElementById('stat-streak');
  const coinsEl = document.getElementById('stat-coins');
  const headerCoins = document.getElementById('header-coins');
  const multBadge = document.getElementById('stat-tree-multiplier-badge');

  if (focusEl) focusEl.textContent = `${mins} mins`;
  if (tasksEl) tasksEl.textContent = `${completedTasks} done`;
  if (streakEl) streakEl.textContent = `1 Day`;
  if (coinsEl) coinsEl.innerHTML = `${hdsfdIcon('coins')} ${currentCoins}`;
  if (headerCoins) headerCoins.textContent = `${currentCoins}`;
  if (multBadge) multBadge.textContent = `${mult.toFixed(1)}x Growth`;

  // 100+ Dynamic Tree Stage and Progress Bar Calculation
  const stageInfo = getTreeStageInfo(lifetimeCoins);

  const stageEl = document.getElementById('stat-tree-stage');
  const xpLabelEl = document.getElementById('stat-tree-xp-label');
  const pctEl = document.getElementById('stat-tree-pct');
  const iconEl = document.getElementById('stat-tree-icon');
  const barEl = document.getElementById('stat-tree-progress-bar');

  const stageIcons = ['sprout', 'leaf', 'tree-deciduous', 'flower-2', 'leaf', 'star', 'sparkles', 'crown'];
  const curIcon = stageIcons[Math.min(stageIcons.length - 1, Math.floor(stageInfo.stageNumber / 10))];

  if (stageEl) stageEl.textContent = stageInfo.stageName;
  if (xpLabelEl) xpLabelEl.textContent = `${lifetimeCoins} / ${stageInfo.stageNextXP} Lifetime Coins XP`;
  if (pctEl) pctEl.textContent = `${stageInfo.progressPct}%`;
  if (iconEl) iconEl.innerHTML = hdsfdIcon(curIcon);
  if (barEl) barEl.style.width = `${stageInfo.progressPct}%`;

  renderSanctuaryTree();
  syncUserStatsToServer();
}

let statsSyncDebounceTimer = null;
function syncUserStatsToServer() {
  clearTimeout(statsSyncDebounceTimer);
  statsSyncDebounceTimer = setTimeout(() => {
    const owner = googleAccount || userName || 'Guest';
    // Save raw bonus_xp (manually awarded coins) — this is what we restore cross-device
    const rawBonusXP = parseInt(localStorage.getItem('hdsfd_lifetime_bonus_xp') || '0', 10);
    const currentCoins = getUserCoinsBalance();
    const sessions = allData.filter(d => d.type === 'focus_session');
    const mins = sessions.reduce((sum, s) => sum + (s.minutes || 0), 0);
    const tasks = allData.filter(d => d.type === 'task');
    const completedTasks = tasks.filter(t => t.completed).length;
    const streak = parseInt(localStorage.getItem('hdsfd_streak_days') || '1', 10);

    if (!hdsfdSessionUser()) return;
    fetch(`${API_BASE}/user/stats`, {
      method: 'POST',
      headers: hdsfdAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        username: owner,
        coins: currentCoins,
        lifetime_xp: rawBonusXP,
        focus_mins: mins,
        tasks_done: completedTasks,
        streak: streak,
        upgrades: JSON.parse(localStorage.getItem('hdsfd_upgrades') || '[]')
      })
    }).catch(() => {});
  }, 2000);
}

// ===== DIGITAL CLOCK WITH LIVE SECONDS =====
function startClockWithSeconds() {
  const clockEl = document.getElementById('lock-clock-seconds');
  const zenClockEl = document.getElementById('zen-clock-seconds');
  const dateEl = document.getElementById('lock-date');

  let tickCount = 0;
  function tick() {
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const dateStr = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

    if (clockEl) clockEl.textContent = timeStr;
    if (zenClockEl) zenClockEl.textContent = timeStr;
    if (dateEl) dateEl.textContent = dateStr;

    // Refresh live schedule status banner every 30 seconds
    tickCount++;
    if (tickCount % 30 === 0 && activeTab === 'focus') {
      renderHomeStatusAndNotifications();
    }
  }
  tick();
  setInterval(tick, 1000);
}

// ===== SOUNDSCAPE & AMBIENT MIXER =====
function toggleSoundscape() {
  const btn = document.getElementById('mixer-toggle-btn');
  const badge = document.getElementById('mixer-status-badge');
  const rain = document.getElementById('audio-rain');

  if (!isPlayingSoundscape) {
    isPlayingSoundscape = true;
    if (btn) btn.innerHTML = '<i data-lucide="square" class="w-4 h-4"></i> <span>Stop Soundscape</span>';
    if (badge) {
      badge.textContent = 'Active';
      badge.className = 'text-[9px] bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full font-bold';
    }
    if (rain) rain.play().catch(() => {});
    initBrownNoise();
  } else {
    isPlayingSoundscape = false;
    if (btn) btn.innerHTML = '<i data-lucide="play" class="w-4 h-4"></i> <span>Play Soundscape</span>';
    if (badge) {
      badge.textContent = 'Idle';
      badge.className = 'text-[9px] bg-white/10 text-white/50 px-2 py-0.5 rounded-full font-bold';
    }
    if (rain) rain.pause();
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
  const volNoise = document.getElementById('vol-noise');
  const rainAudio = document.getElementById('audio-rain');

  if (volRain && rainAudio) {
    rainAudio.volume = parseFloat(volRain.value);
    const pct = `${Math.round(volRain.value * 100)}%`;
    const rainLabel = document.getElementById('val-rain');
    const zenRainLabel = document.getElementById('zen-val-rain');
    if (rainLabel) rainLabel.textContent = pct;
    if (zenRainLabel) zenRainLabel.textContent = pct;
  }
  if (volNoise && noiseGainNode && audioContext) {
    noiseGainNode.gain.setValueAtTime(parseFloat(volNoise.value), audioContext.currentTime);
    const pct = `${Math.round(volNoise.value * 100)}%`;
    const noiseLabel = document.getElementById('val-noise');
    const zenNoiseLabel = document.getElementById('zen-val-noise');
    if (noiseLabel) noiseLabel.textContent = pct;
    if (zenNoiseLabel) zenNoiseLabel.textContent = pct;
  }
}

// ===== YOUTUBE SONG & PLAYLIST CONTROLLER =====
function toggleYouTubeDrawer() {
  const drawer = document.getElementById('yt-drawer-content');
  const icon = document.getElementById('yt-drawer-icon');
  if (!drawer) return;

  isYouTubeDrawerOpen = !isYouTubeDrawerOpen;
  if (isYouTubeDrawerOpen) {
    drawer.classList.remove('hidden');
    if (icon) icon.innerHTML = hdsfdIcon('chevron-up');
  } else {
    drawer.classList.add('hidden');
    if (icon) icon.innerHTML = hdsfdIcon('chevron-down');
  }
}

function parseYouTubeUrl(url) {
  if (!url) return { videoId: null, playlistId: null };
  let videoId = null;
  let playlistId = null;

  const playlistMatch = url.match(/[?&]list=([^#\&\?]+)/);
  if (playlistMatch && playlistMatch[1]) {
    playlistId = playlistMatch[1];
  }

  const videoMatch = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
  if (videoMatch && videoMatch[1]) {
    videoId = videoMatch[1];
  }

  return { videoId, playlistId };
}

window.onYouTubeIframeAPIReady = function() {
  isYTPlayerReady = true;
};

function ensureYTPlayer(onReadyCb) {
  if (ytPlayer && ytPlayer.playVideo) {
    onReadyCb();
    return;
  }
  if (typeof YT === 'undefined' || !YT.Player) {
    setTimeout(() => ensureYTPlayer(onReadyCb), 200);
    return;
  }

  ytPlayer = new YT.Player('yt-player-target', {
    height: '1',
    width: '1',
    playerVars: {
      autoplay: 1,
      controls: 0,
      disablekb: 1,
      fs: 0,
      loop: 1,
      modestbranding: 1
    },
    events: {
      onReady: () => {
        isYTPlayerReady = true;
        onReadyCb();
      },
      onStateChange: (event) => {
        if (event.data === YT.PlayerState.PLAYING) {
          isYTPlaying = true;
          updateYTButtonState(true);
          startYTProgressTracking();
          fetchAndSetVideoTitle();
        } else if (event.data === YT.PlayerState.PAUSED) {
          isYTPlaying = false;
          updateYTButtonState(false);
          stopYTProgressTracking();
        } else if (event.data === YT.PlayerState.ENDED) {
          // The embed fallback is also part of the smart queue: advance normally
          // (and let radio extend it) instead of looping the same video forever.
          if (musicState.engine === 'youtube' && musicState.current && !ytCurrentPlaylistId) {
            musicHandleEnded();
          } else if (ytCurrentPlaylistId && ytPlayer.nextVideo) {
            ytPlayer.nextVideo();
          } else {
            ytSavedTime = 0;
            if (ytPlayer.seekTo) ytPlayer.seekTo(0, true);
            ytPlayer.playVideo();
          }
        }
      }
    }
  });
}

function fetchAndSetVideoTitle() {
  if (ytPlayer && ytPlayer.getVideoData) {
    const data = ytPlayer.getVideoData();
    if (data && data.title && data.title.trim().length > 0) {
      updateYTTrackTitle(data.title);
      saveToYTHistory(data.title, document.getElementById('yt-song-input').value || `https://youtu.be/${data.video_id}`);
    }
  }
}

function toggleYouTubePlayback() {
  const input = document.getElementById('yt-song-input');
  const url = input ? input.value.trim() : '';

  if (isYTPlaying) {
    if (ytPlayer && ytPlayer.pauseVideo) {
      ytSavedTime = ytPlayer.getCurrentTime() || 0;
      ytPlayer.pauseVideo();
    }
    isYTPlaying = false;
    updateYTButtonState(false);
    return;
  }

  if (!url && !ytCurrentVideoId && !ytCurrentPlaylistId) {
    alert('Please paste a YouTube song or playlist link.');
    return;
  }

  const { videoId, playlistId } = parseYouTubeUrl(url);
  const isNewSource = (videoId && videoId !== ytCurrentVideoId) || (playlistId && playlistId !== ytCurrentPlaylistId);

  ensureYTPlayer(() => {
    if (isNewSource || (!ytCurrentVideoId && !ytCurrentPlaylistId)) {
      ytCurrentVideoId = videoId;
      ytCurrentPlaylistId = playlistId;
      ytSavedTime = 0;

      if (playlistId) {
        ytPlayer.loadPlaylist({ list: playlistId, listType: 'playlist' });
        updateYTTrackTitle(`Playlist: ${playlistId}`);
        saveToYTHistory(`Playlist: ${playlistId}`, url);
      } else if (videoId) {
        ytPlayer.loadVideoById({ videoId: videoId, startSeconds: 0 });
        updateYTTrackTitle(`YouTube Track (${videoId})`);
        saveToYTHistory(`Track: ${videoId}`, url);
      }
    } else {
      if (ytSavedTime > 0) {
        ytPlayer.seekTo(ytSavedTime, true);
      }
      ytPlayer.playVideo();
    }
    isYTPlaying = true;
    updateYTButtonState(true);
  });
}

function playPreviousTrack() {
  if (ytPlayer && ytCurrentPlaylistId && ytPlayer.previousVideo) {
    ytPlayer.previousVideo();
  } else if (ytSongHistory.length > 1) {
    playFromYTHistory(encodeURIComponent(ytSongHistory[1].url));
  }
}

function playNextTrack() {
  if (ytPlayer && ytCurrentPlaylistId && ytPlayer.nextVideo) {
    ytPlayer.nextVideo();
  } else if (ytSongHistory.length > 0) {
    playFromYTHistory(encodeURIComponent(ytSongHistory[0].url));
  }
}

function seekRelative(deltaSeconds) {
  if (ytPlayer && ytPlayer.getCurrentTime && ytPlayer.seekTo) {
    const cur = ytPlayer.getCurrentTime() || 0;
    const dur = ytPlayer.getDuration() || 100;
    const next = Math.max(0, Math.min(dur, cur + deltaSeconds));
    ytSavedTime = next;
    ytPlayer.seekTo(next, true);
  }
}

function updateYTButtonState(playing) {
  const icon = document.getElementById('yt-btn-icon');
  const btn = document.getElementById('yt-toggle-btn');
  if (playing) {
    if (icon) icon.innerHTML = hdsfdIcon('pause');
    if (btn) btn.className = 'bg-white/15 hover:bg-white/25 text-white font-black w-8 h-8 rounded-full border border-white/20 flex items-center justify-center shadow transition-all';
  } else {
    if (icon) icon.innerHTML = hdsfdIcon('play');
    if (btn) btn.className = 'bg-rose-500 hover:bg-rose-400 text-white font-black w-8 h-8 rounded-full flex items-center justify-center shadow transition-all';
  }
  if (typeof musicSyncPlayControls === 'function') musicSyncPlayControls();
}

function updateYTTrackTitle(title) {
  const titleEl = document.getElementById('yt-track-title');
  if (titleEl) titleEl.textContent = title;
}

function startYTProgressTracking() {
  stopYTProgressTracking();
  ytProgressInterval = setInterval(() => {
    if (ytPlayer && ytPlayer.getCurrentTime && ytPlayer.getDuration) {
      const cur = ytPlayer.getCurrentTime() || 0;
      const dur = ytPlayer.getDuration() || 1;
      ytSavedTime = cur;

      const timeDisplay = document.getElementById('yt-time-display');
      const seekBar = document.getElementById('yt-seek-bar');

      if (timeDisplay) timeDisplay.textContent = `${formatTime(cur)} / ${formatTime(dur)}`;
      if (seekBar && dur > 0) seekBar.value = (cur / dur) * 100;
    }
  }, 1000);
}

function stopYTProgressTracking() {
  if (ytProgressInterval) {
    clearInterval(ytProgressInterval);
    ytProgressInterval = null;
  }
}

function onYouTubeSeek(percent) {
  if (ytPlayer && ytPlayer.getDuration && ytPlayer.seekTo) {
    const dur = ytPlayer.getDuration();
    if (dur > 0) {
      const targetSecs = (percent / 100) * dur;
      ytSavedTime = targetSecs;
      ytPlayer.seekTo(targetSecs, true);
    }
  }
}

function updateYouTubeVolume(val) {
  const num = parseInt(val, 10);
  const label = document.getElementById('val-yt-vol');
  if (label) label.textContent = `${num}%`;
  if (ytPlayer && ytPlayer.setVolume) {
    ytPlayer.setVolume(num);
  }
}

function saveToYTHistory(title, url) {
  if (!url) return;
  ytSongHistory = ytSongHistory.filter(item => item.url !== url);
  ytSongHistory.unshift({ title, url, timestamp: Date.now() });
  if (ytSongHistory.length > 10) ytSongHistory = ytSongHistory.slice(0, 10);
  localStorage.setItem('hdsfd_yt_history', JSON.stringify(ytSongHistory));
  renderYTHistory();
}

function renderYTHistory() {
  const container = document.getElementById('yt-history-list');
  const countEl = document.getElementById('yt-history-count');
  if (countEl) countEl.textContent = `${ytSongHistory.length}`;
  if (!container) return;

  if (ytSongHistory.length === 0) {
    container.innerHTML = '<span class="text-[10px] text-white/30 italic">No previous tracks</span>';
    return;
  }

  container.innerHTML = ytSongHistory.map(item => `
    <button onclick="playFromYTHistory('${encodeURIComponent(item.url)}')" class="w-full text-left bg-white/5 hover:bg-white/10 p-1.5 rounded-lg flex items-center justify-between text-[9px] text-white/70 hover:text-white transition-all truncate group">
      <span class="truncate font-medium flex items-center gap-1.5">${hdsfdIcon('music')} ${item.title}</span>
      <span class="text-amber-300 ml-1 group-hover:scale-110 transition-transform">${hdsfdIcon('play')}</span>
    </button>
  `).join('');
}

function playFromYTHistory(encodedUrl) {
  const url = decodeURIComponent(encodedUrl);
  const input = document.getElementById('yt-song-input');
  if (input) input.value = url;
  toggleYouTubePlayback();
}

function formatTime(seconds) {
  const s = Math.floor(seconds);
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${rem.toString().padStart(2, '0')}`;
}

// ===== POMODORO TIMER =====
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

let pomoSessionElapsedSeconds = 0;

function startTimer() {
  if (pomoTimerId) return;
  document.getElementById('pomo-start-btn').classList.add('hidden');
  document.getElementById('pomo-pause-btn').classList.remove('hidden');

  pomoTimerId = setInterval(() => {
    if (pomoRemainingSeconds > 0) {
      pomoRemainingSeconds--;
      pomoSessionElapsedSeconds++;
      updatePomoDisplay();
    } else {
      pauseTimer();
      const minsEarned = Math.max(1, Math.round(pomoDurationSeconds / 60));
      const isSunlight = isSunlightEssenceActive();
      const baseCoinRate = isSunlight ? 4 : 2; // 2x on Sunlight (4 coins/min)

 awardActivityCoins(minsEarned * baseCoinRate, `Focus Session Completed (${minsEarned}m)${isSunlight ? ' Sunlight 2x' : ''}`);
      
      // Consume Sunlight Essence after 1 completed session
      if (isSunlight) {
        consumeSunlightEssence();
      }

      healSanctuaryTree(20);
      createData({
        type: 'focus_session',
        minutes: minsEarned,
        created_at: new Date().toISOString()
      });
      pomoSessionElapsedSeconds = 0;
      updateStatsOverview();
    }
  }, 1000);
}

function pauseTimer() {
  if (pomoTimerId) {
    clearInterval(pomoTimerId);
    pomoTimerId = null;

    // Partial session reward if stopped early (at least 60 seconds elapsed)
    if (pomoSessionElapsedSeconds >= 60) {
      const partialMins = pomoSessionElapsedSeconds / 60;
      const partialCoins = Math.max(1, Math.round(partialMins * 2));
 awardActivityCoins(partialCoins, `Focus Progress (${Math.round(partialMins)}m)`);
      healSanctuaryTree(Math.round(partialMins * 2));
      pomoSessionElapsedSeconds = 0;
    }
  }
  document.getElementById('pomo-start-btn').classList.remove('hidden');
  document.getElementById('pomo-pause-btn').classList.add('hidden');
}

function resetTimer() {
  pauseTimer();
  pomoSessionElapsedSeconds = 0;
  pomoRemainingSeconds = pomoDurationSeconds;
  updatePomoDisplay();
}

function setPomoPreset(mins, exactSeconds = 0) {
  pauseTimer();
  pomoDurationSeconds = exactSeconds > 0 ? exactSeconds : mins * 60;
  pomoRemainingSeconds = pomoDurationSeconds;
  
  const slider = document.getElementById('pomo-slider');
  const sliderVal = document.getElementById('slider-val');
  const customInput = document.getElementById('custom-pomo-input');
  
  let sliderPos = 25;
  if (mins <= 90) {
    sliderPos = Math.round(((mins - 5) / 85) * 50);
  } else {
    sliderPos = Math.round(50 + ((mins - 90) / 30) * 50);
  }
  
  if (slider) slider.value = Math.max(0, Math.min(100, sliderPos));
  if (sliderVal) sliderVal.textContent = `${mins}m`;
  if (customInput) customInput.value = exactSeconds > 0 ? (exactSeconds / 60).toFixed(2).replace(/\.00$/, '') : mins;
  updatePomoDisplay();
}

function onDynamicSliderChange(val) {
  const num = parseFloat(val);
  let mins = 25;
  if (num <= 50) {
    mins = Math.round(5 + (num / 50) * 85);
  } else {
    mins = Math.round(90 + ((num - 50) / 50) * 30);
  }

  pomoDurationSeconds = mins * 60;
  pomoRemainingSeconds = pomoDurationSeconds;
  const sliderVal = document.getElementById('slider-val');
  const customInput = document.getElementById('custom-pomo-input');
  if (sliderVal) sliderVal.textContent = `${mins}m`;
  if (customInput) customInput.value = mins;
  updatePomoDisplay();
}

function adjustCustomTimeStep(delta) {
  const input = document.getElementById('custom-pomo-input');
  let currentVal = input ? parseFloat(input.value) || 25 : 25;
  currentVal = Math.max(1, Math.min(300, currentVal + delta));
  if (input) input.value = currentVal;
  setPomoPreset(Math.floor(currentVal));
}

function setCustomPomoFromInput() {
  const input = document.getElementById('custom-pomo-input');
  const rawStr = input ? input.value.trim() : '';
  if (!rawStr) return;

  if (rawStr.includes('.')) {
    const parts = rawStr.split('.');
    const mins = parseInt(parts[0], 10) || 0;
    let secPart = parts[1] || '0';
    if (secPart.length === 1) secPart = secPart + '0';
    else if (secPart.length > 2) secPart = secPart.slice(0, 2);

    let secs = parseInt(secPart, 10);
    if (secs >= 60) {
      setPomoPreset(mins + 1);
    } else {
      const totalSecs = mins * 60 + secs;
      setPomoPreset(mins, totalSecs);
    }
  } else {
    const mins = parseInt(rawStr, 10) || 25;
    setPomoPreset(mins);
  }
}

// ===== ZEN MODE =====
let zenHoldTimer = null;
let zenStartTime = null;
let zenFadeTimeout = null;
let zenHoldProgress = 0;

function enterZenMode() {
  const zenOverlay = document.getElementById('zen-overlay');
  const holdMsg = document.getElementById('zen-hold-msg');
  if (zenOverlay) zenOverlay.classList.remove('hidden');
  renderHomeStarredTasks();
  zenStartTime = Date.now();

  if (holdMsg) {
    holdMsg.classList.remove('opacity-0');
    clearTimeout(zenFadeTimeout);
    zenFadeTimeout = setTimeout(() => {
      holdMsg.classList.add('opacity-0');
    }, 10000);
  }

  if (document.documentElement.requestFullscreen) {
    document.documentElement.requestFullscreen().catch(() => {});
  }
}

function exitZenMode() {
  const zenOverlay = document.getElementById('zen-overlay');
  const popover = document.getElementById('zen-assistive-popover');
  if (zenOverlay) zenOverlay.classList.add('hidden');
  if (popover) popover.classList.add('hidden');
  clearTimeout(zenFadeTimeout);

  if (zenStartTime) {
    const elapsedSeconds = Math.round((Date.now() - zenStartTime) / 1000);
    const elapsedMinutes = Math.floor(elapsedSeconds / 60);
    if (elapsedMinutes >= 1) {
      const curZenMins = parseInt(localStorage.getItem('hdsfd_zen_minutes') || '0', 10);
      localStorage.setItem('hdsfd_zen_minutes', String(curZenMins + elapsedMinutes));
 awardActivityCoins(elapsedMinutes * 3, `Zen Mode (${elapsedMinutes}m)`);
    }
    zenStartTime = null;
  }

  if (document.fullscreenElement && document.exitFullscreen) {
    document.exitFullscreen().catch(() => {});
  }
}

function onZenScreenTouch(e) {
  if (e && e.target && (e.target.closest('#zen-assistive-ball') || e.target.closest('#zen-assistive-popover'))) return;
  
  const holdMsg = document.getElementById('zen-hold-msg');
  if (holdMsg) {
    holdMsg.classList.remove('opacity-0');
    clearTimeout(zenFadeTimeout);
    zenFadeTimeout = setTimeout(() => {
      holdMsg.classList.add('opacity-0');
    }, 5000);
  }
}

function toggleZenAssistiveMenu(e) {
  if (e) e.stopPropagation();
  const popover = document.getElementById('zen-assistive-popover');
  const ball = document.getElementById('zen-assistive-ball');
  if (!popover || !ball) return;

  if (popover.classList.contains('hidden')) {
    const rect = ball.getBoundingClientRect();
    if (rect.left > window.innerWidth / 2) {
      popover.style.left = `${Math.max(10, rect.left - 295)}px`;
    } else {
      popover.style.left = `${Math.min(window.innerWidth - 300, rect.right + 10)}px`;
    }
    popover.style.top = `${Math.max(10, Math.min(window.innerHeight - 380, rect.top - 20))}px`;
    popover.classList.remove('hidden');
  } else {
    popover.classList.add('hidden');
  }
}

function initZenAssistiveTouch() {
  const ball = document.getElementById('zen-assistive-ball');
  if (!ball) return;

  let isDragging = false;
  let startX, startY, initialLeft, initialTop;

  function onPointerDown(e) {
    isDragging = false;
    startX = e.clientX || (e.touches && e.touches[0].clientX);
    startY = e.clientY || (e.touches && e.touches[0].clientY);
    const rect = ball.getBoundingClientRect();
    initialLeft = rect.left;
    initialTop = rect.top;

    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
  }

  function onPointerMove(e) {
    const curX = e.clientX || (e.touches && e.touches[0].clientX);
    const curY = e.clientY || (e.touches && e.touches[0].clientY);
    const dx = curX - startX;
    const dy = curY - startY;

    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
      isDragging = true;
      ball.style.left = `${initialLeft + dx}px`;
      ball.style.top = `${initialTop + dy}px`;
      ball.style.right = 'auto';
    }
  }

  function onPointerUp() {
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerUp);

    if (isDragging) {
      const rect = ball.getBoundingClientRect();
      const snapX = rect.left < window.innerWidth / 2 ? 16 : window.innerWidth - 64;
      const clampedY = Math.max(16, Math.min(window.innerHeight - 64, rect.top));

      ball.style.transition = 'left 0.3s ease, top 0.3s ease';
      ball.style.left = `${snapX}px`;
      ball.style.top = `${clampedY}px`;
      setTimeout(() => { ball.style.transition = ''; }, 300);
    }
  }

  ball.addEventListener('pointerdown', onPointerDown);
}

// Hold Spacebar to exit Zen Mode
document.addEventListener('keydown', (e) => {
  const zenOverlay = document.getElementById('zen-overlay');
  if (zenOverlay && !zenOverlay.classList.contains('hidden')) {
    onZenScreenTouch();
    if (e.code === 'Space' || e.key === ' ') {
      e.preventDefault();
      if (!zenHoldTimer) {
        zenHoldProgress = 0;
        zenHoldTimer = setInterval(() => {
          zenHoldProgress += 7;
          const fill = document.getElementById('zen-fill');
          if (fill) fill.style.width = `${zenHoldProgress}%`;
          if (zenHoldProgress >= 100) {
            clearInterval(zenHoldTimer);
            zenHoldTimer = null;
            exitZenMode();
          }
        }, 100);
      }
    }
  }
});

document.addEventListener('keyup', (e) => {
  if (e.code === 'Space' || e.key === ' ') {
    if (zenHoldTimer) {
      clearInterval(zenHoldTimer);
      zenHoldTimer = null;
    }
    zenHoldProgress = 0;
    const fill = document.getElementById('zen-fill');
    if (fill) fill.style.width = '0%';
  }
});

// Hold / Touchscreen on Zen Overlay
const zenOverlayEl = document.getElementById('zen-overlay');
if (zenOverlayEl) {
  let touchHoldTimer = null;
  zenOverlayEl.addEventListener('pointerdown', (e) => {
    if (e.target.closest('#zen-assistive-ball') || e.target.closest('#zen-assistive-popover')) return;
    onZenScreenTouch(e);
    zenHoldProgress = 0;
    touchHoldTimer = setInterval(() => {
      zenHoldProgress += 8;
      const fill = document.getElementById('zen-fill');
      if (fill) fill.style.width = `${zenHoldProgress}%`;
      if (zenHoldProgress >= 100) {
        clearInterval(touchHoldTimer);
        touchHoldTimer = null;
        exitZenMode();
      }
    }, 100);
  });

  const stopTouchHold = () => {
    if (touchHoldTimer) {
      clearInterval(touchHoldTimer);
      touchHoldTimer = null;
    }
    zenHoldProgress = 0;
    const fill = document.getElementById('zen-fill');
    if (fill) fill.style.width = '0%';
  };

  zenOverlayEl.addEventListener('pointerup', stopTouchHold);
  zenOverlayEl.addEventListener('pointerleave', stopTouchHold);
}

// ===== SETTINGS, THEMES & SHOP =====
function saveNameFromSettings() {
  const input = document.getElementById('settings-name-input');
  const name = input ? input.value.trim() : '';
  if (!name) return;
  userName = name;
  localStorage.setItem('hdsfd_user_name', name);
  initializeUserSession();
  
  const saveBtn = document.getElementById('settings-name-save-btn');
  if (saveBtn) {
    const originalText = saveBtn.textContent;
    saveBtn.textContent = 'Saved!';
    saveBtn.classList.remove('bg-white', 'text-slate-900');
    saveBtn.classList.add('bg-emerald-400', 'text-slate-950');
    setTimeout(() => {
      saveBtn.textContent = originalText;
      saveBtn.classList.remove('bg-emerald-400', 'text-slate-950');
      saveBtn.classList.add('bg-white', 'text-slate-900');
    }, 1500);
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
    const rawEmail = (event.data.username || '').trim();
    if (rawEmail && rawEmail.includes('@')) {
      googleAccount = rawEmail;
      localStorage.setItem('hdsfd_google_account', googleAccount);
    }

    const rawName = (event.data.name || '').trim();
    if (rawName && !rawName.includes('PRIZW') && rawName !== 'User') {
      googleAccountName = rawName;
      localStorage.setItem('hdsfd_google_name', googleAccountName);
      userName = googleAccountName;
      localStorage.setItem('hdsfd_user_name', googleAccountName);
      const nameInput = document.getElementById('settings-name-input');
      if (nameInput) nameInput.value = googleAccountName;
    } else if (googleAccount && googleAccount.includes('@')) {
      const emailPrefix = googleAccount.split('@')[0];
      const formattedName = emailPrefix.replace(/[._-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      userName = formattedName;
      googleAccountName = formattedName;
      localStorage.setItem('hdsfd_user_name', formattedName);
      localStorage.setItem('hdsfd_google_name', formattedName);
      const nameInput = document.getElementById('settings-name-input');
      if (nameInput) nameInput.value = formattedName;
    }

    // Check server-backed single claim for Cosmic Key
    initializeUserSession();
    setTimeout(() => {
      const claimKey = 'hdsfd_cosmic_claimed_' + (googleAccount || '');
      const localUpgrades = JSON.parse(localStorage.getItem('hdsfd_upgrades') || '[]');
      if (googleAccount && googleAccount.includes('@') && localStorage.getItem(claimKey) !== 'true' && !localUpgrades.includes('cosmic_claimed')) {
        localStorage.setItem(claimKey, 'true');
        localUpgrades.push('cosmic_claimed');
        localStorage.setItem('hdsfd_upgrades', JSON.stringify(localUpgrades));
 awardActivityCoins(200, ' Cosmic Theme Key & Google Link Bonus');
        syncUserStatsToServer();
      }
      updateStatsOverview();
      updateShopCardsUI();
    }, 500);
  }
});

function disconnectGoogleAccount() {
  googleAccount = null;
  googleAccountName = null;
  localStorage.removeItem('hdsfd_google_account');
  localStorage.removeItem('hdsfd_google_name');
  initializeUserSession();
  updateStatsOverview();
  updateShopCardsUI();
 showInAppNotification(' Disconnected Google Account. Returned to Guest Mode.');
}

function setTheme(theme) {
  if (!theme) return;
  let normalized = theme.toLowerCase().trim();
  if (normalized === 'cyberpunk') normalized = 'cyber';
  
  const validThemes = ['midnight', 'obsidian', 'cyber', 'ocean', 'sunset', 'forest', 'aurora', 'rose'];
  if (!validThemes.includes(normalized)) {
    normalized = 'midnight';
  }

  // Theme Locking for Non-Signed-In Users
  if (normalized !== 'midnight' && !googleAccount && !localStorage.getItem('hdsfd_theme_unlocked_override')) {
 showInAppNotification(' Sign in with Google to unlock all 8 fluid gradient themes + get 200 Free Coins!');
    return;
  }

  const app = document.getElementById('app');
  if (app) {
    validThemes.forEach(t => app.classList.remove(`theme-${t}`));
    app.classList.remove('theme-cyberpunk');
    app.classList.add(`theme-${normalized}`);
  }
  
  localStorage.setItem('hdsfd_theme', normalized);

  const badge = document.getElementById('current-theme-badge');
  if (badge) {
    badge.textContent = normalized.charAt(0).toUpperCase() + normalized.slice(1);
  }

  document.querySelectorAll('.theme-select-btn').forEach(btn => {
    if (btn.getAttribute('data-theme') === normalized) {
      btn.classList.add('bg-purple-500/30', 'border-purple-400');
      btn.classList.remove('border-white/10');
    } else {
      btn.classList.remove('bg-purple-500/30', 'border-purple-400');
      btn.classList.add('border-white/10');
    }
  });
}

// ===== DIGITAL SANCTUARY TREE & LIFETIME COIN ENGINE =====

// Multipliers & Active Buffs
function getFertileDewTier() {
  return parseInt(localStorage.getItem('hdsfd_dew_tier') || '0', 10);
}

function isSunlightEssenceActive() {
  return localStorage.getItem('hdsfd_sunlight_active') === 'true';
}

function consumeSunlightEssence() {
  localStorage.removeItem('hdsfd_sunlight_active');
  const aura = document.getElementById('timer-sunlight-aura');
  if (aura) aura.classList.add('hidden');
}

function isGlowingVinesActive() {
  const exp = parseInt(localStorage.getItem('hdsfd_vines_expiry') || '0', 10);
  return exp > Date.now();
}

function getGlowingVinesMultiplier() {
  if (!isGlowingVinesActive()) return 1.0;
  const tier = parseInt(localStorage.getItem('hdsfd_vines_tier') || '1', 10);
  return 1.0 + (tier * 0.5); // Tier 1 = 1.5x, Tier 2 = 2.0x, Tier 3 = 2.5x...
}

function isBlossomPetalsActive() {
  const exp = parseInt(localStorage.getItem('hdsfd_petals_expiry') || '0', 10);
  return exp > Date.now();
}

function isStarlightAuraActive() {
  const exp = parseInt(localStorage.getItem('hdsfd_starlight_expiry') || '0', 10);
  return exp > Date.now();
}

function isStreakShieldActive() {
  const exp = parseInt(localStorage.getItem('hdsfd_freeze_expiry') || '0', 10);
  return exp > Date.now();
}

function getGrowthMultiplier() {
  let mult = 1.0;
  // Fertile Dew (+10% per tier)
  mult += (getFertileDewTier() * 0.10);
  // Glowing Vines (1.5x, 2.0x, 2.5x...)
  if (isGlowingVinesActive()) {
    mult *= getGlowingVinesMultiplier();
  }
  // Starlight Aura (2x Growth)
  if (isStarlightAuraActive()) {
    mult *= 2.0;
  }
  return parseFloat(mult.toFixed(2));
}

function getCoinsMultiplier() {
  let mult = 1.0;
  // Blossom Petals (1.5x coins)
  if (isBlossomPetalsActive()) {
    mult *= 1.5;
  }
  // Starlight Aura (2x coins)
  if (isStarlightAuraActive()) {
    mult *= 2.0;
  }
  return parseFloat(mult.toFixed(2));
}

function getLifetimeCoins() {
  const growthMult = getGrowthMultiplier();
  const bonusXP = parseInt(localStorage.getItem('hdsfd_lifetime_bonus_xp') || '0', 10);
  
  // 1. Focus Sessions (Pomodoro) -> 2 coins per minute * growthMult
  const sessions = allData.filter(d => d.type === 'focus_session');
  const sessionMins = sessions.reduce((sum, s) => sum + (s.minutes || 0), 0);
  const sessionCoins = Math.round(sessionMins * 2 * growthMult);

  // 2. Completed Tasks
  const tasksDone = allData.filter(d => d.type === 'task' && d.completed);
  const taskCoins = tasksDone.reduce((sum, t) => sum + (t.earned_coins || (t.is_important ? 20 : 10)), 0);

  // 3. Schedule Classes -> 5 coins per class * growthMult
  const schedClasses = allData.filter(d => d.type === 'schedule_entry').length;
  const schedCoins = Math.round(schedClasses * 5 * growthMult);

  // 4. Completed Exams
  const examsDone = allData.filter(d => d.type === 'exam_entry' && d.completed);
  const examCoins = examsDone.reduce((sum, e) => sum + (e.reward || 250), 0);

  // 5. Notes Created -> 5 coins per note * growthMult
  const notesCount = allData.filter(d => d.type === 'note').length;
  const notesCoins = Math.round(notesCount * 5 * growthMult);

  // 6. Zen Mode Minutes -> 3 coins per min * growthMult
  const zenMins = parseInt(localStorage.getItem('hdsfd_zen_minutes') || '0', 10);
  const zenCoins = Math.round(zenMins * 3 * growthMult);

  return Math.max(0, sessionCoins + taskCoins + schedCoins + examCoins + notesCoins + zenCoins + bonusXP);
}

function getUserCoinsBalance() {
  const lifetime = getLifetimeCoins();
  const spent = parseInt(localStorage.getItem('hdsfd_spent_coins') || '0', 10);
  return Math.max(0, lifetime - spent);
}

function awardActivityCoins(baseAmount, activityName) {
  const coinMult = getCoinsMultiplier();
  const actualAmount = Math.round(baseAmount * coinMult);
  const curBonus = parseInt(localStorage.getItem('hdsfd_lifetime_bonus_xp') || '0', 10);
  localStorage.setItem('hdsfd_lifetime_bonus_xp', String(curBonus + actualAmount));
  updateStatsOverview();
  if (activityName) {
 showInAppNotification(` +${actualAmount} earned (${activityName})!`);
  }
  checkStageMilestoneBonus();
  // Sync to server so coins persist across devices
  syncUserStatsToServer();
}

function deductActivityCoins(baseAmount, reason) {
  const curBonus = parseInt(localStorage.getItem('hdsfd_lifetime_bonus_xp') || '0', 10);
  localStorage.setItem('hdsfd_lifetime_bonus_xp', String(Math.max(0, curBonus - baseAmount)));
  updateStatsOverview();
  if (reason) {
 showInAppNotification(` -${baseAmount} (${reason})`);
  }
  // Sync to server so deductions persist across devices
  syncUserStatsToServer();
}

// 100+ Dynamic Sanctuary Tree Stages Engine
const SANCTUARY_STAGE_NAMES = [
  'Mystical Sprout', 'Radiant Sapling', 'Flourishing Young Oak', 'Emerald Blossom', 'Luminous Birch',
  'Verdant Willow', 'Golden Ash', 'Bioluminescent Maple', 'Silverleaf Cedar', 'Sacred Pine',
  'Ancient Redwood', 'Sylvan Monarch', 'Solaris Canopy', 'Celestial Arbor', 'Starfall Grove Tree',
  'Moonlit Cypress', 'Whispering Aspen', 'Titan Ironwood', 'Frostbloom Spire', 'Arcane Elderwood',
  'Sunburst Sequoia', 'Aetherium Yew', 'Cosmic Pillar', 'Evergreen Heart', 'Spiritwood Great Oak',
  'Astral Banyan', 'Chronos Sequoia', 'Prismatic Elm', 'Voidbloom Arbor', 'Elysian Willow',
  'Stardust Redwood', 'Aurora Canopy', 'Glimmering Baobab', 'Zenith World-Stem', 'Chrono-Blossom',
  'Eldritch Spire', 'Mythic Sylvan', 'Hyperion Great Tree', 'Harmonic Timber', 'Resonant Ygg',
  'Gilded Blossom', 'Nebula Root Tree', 'Solstice Sequoia', 'Equinox Birch', 'Valhalla Oak',
  'Olympus Cedar', 'Nirvana Banyan', 'Genesis Sprout Monarch', 'Apex Arbor', 'World Hearth Tree',
  'Cosmic World Tree (Yggdrasil Prime)'
];

function getTreeStageInfo(lifetimeXP) {
  // Base XP curve: Stage 0 = 0, Stage 1 = 50, Stage 2 = 150, Stage 3 = 300, Stage 4 = 600, Stage 5 = 1000...
  // For higher stages: nextStageXP = Math.round(50 * Math.pow(stage + 1, 1.45))
  let stage = 0;
  let currentTierXP = 0;
  let nextTierXP = 50;

  while (lifetimeXP >= nextTierXP && stage < 150) {
    stage++;
    currentTierXP = nextTierXP;
    nextTierXP = Math.round(50 * Math.pow(stage + 1, 1.45));
  }

  let stageName = '';
  if (stage < SANCTUARY_STAGE_NAMES.length) {
    stageName = `Stage ${stage}: ${SANCTUARY_STAGE_NAMES[stage]}`;
  } else {
    const prefixes = ['Cosmic', 'Astral', 'Eternal', 'Divine', 'Primordial', 'Infinite', 'Mythic', 'Omniscient'];
    const suffixes = ['World Tree', 'Arbor of Eternity', 'Yggdrasil Apex', 'Star-Bough', 'Sylvan Titan'];
    const p = prefixes[stage % prefixes.length];
    const s = suffixes[(Math.floor(stage / prefixes.length)) % suffixes.length];
    stageName = `Stage ${stage}: ${p} ${s} (+${stage * 10} Mastery)`;
  }

  const range = nextTierXP - currentTierXP;
  const progressInStage = lifetimeXP - currentTierXP;
  const pct = Math.min(100, Math.max(0, Math.round((progressInStage / range) * 100)));

  return {
    stageNumber: stage,
    stageName: stageName,
    currentXP: lifetimeXP,
    stageMinXP: currentTierXP,
    stageNextXP: nextTierXP,
    progressPct: pct
  };
}

function checkStageMilestoneBonus() {
  const xp = getLifetimeCoins();
  const info = getTreeStageInfo(xp);
  if (info.stageNumber >= 100 && !localStorage.getItem('hdsfd_stage_100_awarded')) {
    localStorage.setItem('hdsfd_stage_100_awarded', 'true');
    const curBonus = parseInt(localStorage.getItem('hdsfd_lifetime_bonus_xp') || '0', 10);
    localStorage.setItem('hdsfd_lifetime_bonus_xp', String(curBonus + 10000));
 showInAppNotification(' CONGRATULATIONS! You reached Stage 100 and unlocked the 10,000 World Tree Blessing!');
    updateStatsOverview();
  }
}

// Tree Vitality, Decay & Healing Mechanics
function getTreeVitality() {
  const saved = parseInt(localStorage.getItem('hdsfd_tree_vitality') || '100', 10);
  return Math.max(10, Math.min(100, saved));
}

function healSanctuaryTree(amount = 15) {
  const current = getTreeVitality();
  const nextVal = Math.min(100, current + amount);
  localStorage.setItem('hdsfd_tree_vitality', String(nextVal));
  localStorage.setItem('hdsfd_last_active_ts', String(Date.now()));
  renderSanctuaryTree();
}

function checkTreeDecayLoop() {
  if (isStreakShieldActive()) {
    localStorage.setItem('hdsfd_tree_vitality', '100');
    return;
  }
  const lastActive = parseInt(localStorage.getItem('hdsfd_last_active_ts') || String(Date.now()), 10);
  const diffHours = (Date.now() - lastActive) / (1000 * 60 * 60);

  // Grace period scales with tree growth: higher stage trees are deeply rooted and resist decay for 48h to 72h
  const lifetimeXP = getLifetimeCoins();
  const stage = (getTreeStageInfo(lifetimeXP) && getTreeStageInfo(lifetimeXP).stageNumber) || 0;
  const decayGraceHours = stage >= 10 ? 72 : (stage >= 3 ? 48 : 24);

  if (diffHours >= decayGraceHours) {
    const intervalsMissed = Math.floor((diffHours - decayGraceHours) / 24) + 1;
    let vitality = parseInt(localStorage.getItem('hdsfd_tree_vitality') || '100', 10);
    const decayRate = stage >= 10 ? 4 : (stage >= 3 ? 6 : 10);
    vitality = Math.max(30, vitality - (intervalsMissed * decayRate));
    localStorage.setItem('hdsfd_tree_vitality', String(vitality));
  }
}

// Passive Income Check (Blossom Petals 10 coins/hour)
function processBlossomPassiveIncome() {
  if (!isBlossomPetalsActive()) return;
  const lastClaim = parseInt(localStorage.getItem('hdsfd_petals_last_claim') || String(Date.now()), 10);
  const hoursElapsed = Math.floor((Date.now() - lastClaim) / (1000 * 60 * 60));

  if (hoursElapsed >= 1) {
    const hoursToAward = Math.min(24, hoursElapsed);
    const earned = hoursToAward * 10;
    const curBonus = parseInt(localStorage.getItem('hdsfd_lifetime_bonus_xp') || '0', 10);
    localStorage.setItem('hdsfd_lifetime_bonus_xp', String(curBonus + earned));
    localStorage.setItem('hdsfd_petals_last_claim', String(Date.now()));
 showInAppNotification(` Drifting Blossom Petals harvested +${earned} passive income!`);
    updateStatsOverview();
  }
}

// ===== SHOP BUY HANDLERS =====

// 1. Fertile Spring Dew (Tiered +10% Multiplier)
function buyFertileDew() {
  const currentCoins = getUserCoinsBalance();
  const currentTier = getFertileDewTier();
  const cost = 50 * (currentTier + 1);

  if (currentCoins < cost) {
 showInAppNotification(` Not enough coins! You need ${cost} (Have: ${currentCoins} ).`);
    return;
  }

  const currentSpent = parseInt(localStorage.getItem('hdsfd_spent_coins') || '0', 10);
  localStorage.setItem('hdsfd_spent_coins', String(currentSpent + cost));
  localStorage.setItem('hdsfd_dew_tier', String(currentTier + 1));

  updateStatsOverview();
  updateShopCardsUI();
  renderSanctuaryTree();
 showInAppNotification(` Upgraded Fertile Spring Dew to Tier ${currentTier + 1}! Growth multiplier increased by +10%.`);
}

// 2. Sunlight Essence (2x Focus/Zen for 1 Session)
function buySunlightEssence() {
  const currentCoins = getUserCoinsBalance();
  const cost = 100;

  if (currentCoins < cost) {
 showInAppNotification(` Not enough coins! You need ${cost} (Have: ${currentCoins} ).`);
    return;
  }

  if (isSunlightEssenceActive()) {
 showInAppNotification(` Sunlight Essence is already active! Complete your next focus session to consume it.`);
    return;
  }

  const currentSpent = parseInt(localStorage.getItem('hdsfd_spent_coins') || '0', 10);
  localStorage.setItem('hdsfd_spent_coins', String(currentSpent + cost));
  localStorage.setItem('hdsfd_sunlight_active', 'true');

  const aura = document.getElementById('timer-sunlight-aura');
  if (aura) aura.classList.remove('hidden');

  updateStatsOverview();
  updateShopCardsUI();
 showInAppNotification(` Sunlight Essence activated! Your next focus session will earn 2x Coins with a radiant timer aura.`);
}

// 3. Glowing Vines (1.5x Growth - 1 Day)
function buyGlowingVines() {
  const currentCoins = getUserCoinsBalance();
  const currentTier = parseInt(localStorage.getItem('hdsfd_vines_tier') || '1', 10);
  const cost = 150 + ((currentTier - 1) * 50);

  if (currentCoins < cost) {
 showInAppNotification(` Not enough coins! You need ${cost} (Have: ${currentCoins} ).`);
    return;
  }

  const currentSpent = parseInt(localStorage.getItem('hdsfd_spent_coins') || '0', 10);
  localStorage.setItem('hdsfd_spent_coins', String(currentSpent + cost));
  localStorage.setItem('hdsfd_vines_expiry', String(Date.now() + (24 * 3600 * 1000)));
  localStorage.setItem('hdsfd_vines_tier', String(currentTier + 1));

  updateStatsOverview();
  updateShopCardsUI();
  renderSanctuaryTree();
 showInAppNotification(` Enchanted tree with Glowing Vines for 24 Hours! (Growth x${(1.0 + currentTier * 0.5).toFixed(1)})`);
}

// 4. Blossom Petals (1.5x Coins + 10 coins/hr passive - 1 Day)
function buyBlossomPetals() {
  const currentCoins = getUserCoinsBalance();
  const cost = 200;

  if (currentCoins < cost) {
 showInAppNotification(` Not enough coins! You need ${cost} (Have: ${currentCoins} ).`);
    return;
  }

  const currentSpent = parseInt(localStorage.getItem('hdsfd_spent_coins') || '0', 10);
  localStorage.setItem('hdsfd_spent_coins', String(currentSpent + cost));
  localStorage.setItem('hdsfd_petals_expiry', String(Date.now() + (24 * 3600 * 1000)));
  localStorage.setItem('hdsfd_petals_last_claim', String(Date.now()));

  initFallingPetals();
  updateStatsOverview();
  updateShopCardsUI();
  renderSanctuaryTree();
 showInAppNotification(` Drifting Blossom Petals active for 24 Hours! (1.5x Coins + 10/hr Passive Harvest).`);
}

// 5. Starlight Aura (2x Coins & 2x Growth - 1 Week)
function buyStarlightAura() {
  const currentCoins = getUserCoinsBalance();
  const cost = 500;

  if (currentCoins < cost) {
 showInAppNotification(` Not enough coins! You need ${cost} (Have: ${currentCoins} ).`);
    return;
  }

  const currentSpent = parseInt(localStorage.getItem('hdsfd_spent_coins') || '0', 10);
  localStorage.setItem('hdsfd_spent_coins', String(currentSpent + cost));
  localStorage.setItem('hdsfd_starlight_expiry', String(Date.now() + (7 * 24 * 3600 * 1000)));

  const aura = document.getElementById('tree-starlight-aura');
  if (aura) aura.classList.remove('opacity-0');

  updateStatsOverview();
  updateShopCardsUI();
  renderSanctuaryTree();
 showInAppNotification(` Starlight Cosmic Aura active for 1 Whole Week! (2x Coins & 2x Tree Growth).`);
}

// 6. Streak Shield (2 Days Protection)
function buyStreakShield() {
  const currentCoins = getUserCoinsBalance();
  const cost = 250;

  if (currentCoins < cost) {
 showInAppNotification(` Not enough coins! You need ${cost} (Have: ${currentCoins} ).`);
    return;
  }

  const currentSpent = parseInt(localStorage.getItem('hdsfd_spent_coins') || '0', 10);
  localStorage.setItem('hdsfd_spent_coins', String(currentSpent + cost));
  localStorage.setItem('hdsfd_freeze_expiry', String(Date.now() + (2 * 24 * 3600 * 1000)));
  localStorage.setItem('hdsfd_tree_vitality', '100');

  updateStatsOverview();
  updateShopCardsUI();
 showInAppNotification(` Streak Freeze Shield activated! Protects daily streak & tree vitality for 48 Hours.`);
}

// 7. Cosmic Theme Key Action
function handleThemeKeyAction() {
  if (googleAccount) {
 showInAppNotification(' All premium fluid themes are already unlocked with your connected Google account!');
  } else {
    connectGoogleAccount();
  }
}

// 8. YouTube Subscription Verification Flow (Zen Master Crown)
let ytSubTimer = null;
function openYouTubeSubFlow() {
  if (localStorage.getItem('hdsfd_has_crown') === 'true') {
 showInAppNotification(' Zen Master Crown is already unlocked and active on your profile!');
    return;
  }
  const modal = document.getElementById('yt-sub-modal');
  const verifyBtn = document.getElementById('yt-verify-btn');
  if (verifyBtn) {
    verifyBtn.disabled = true;
    verifyBtn.className = 'w-full bg-white/10 text-white/40 border border-white/10 font-bold py-2 px-4 rounded-xl text-xs transition-all cursor-not-allowed';
    verifyBtn.innerHTML = `Verify & Claim Reward (+1000 ${hdsfdIcon('coins')})`;
  }
  if (modal) modal.classList.remove('hidden');
}

function closeYouTubeSubModal() {
  const modal = document.getElementById('yt-sub-modal');
  if (modal) modal.classList.add('hidden');
  if (ytSubTimer) {
    clearTimeout(ytSubTimer);
    ytSubTimer = null;
  }
}

let ytChannelLinkClicked = false;
let ytSubCountdownInterval = null;

function onYouTubeSubChannelClicked() {
  ytChannelLinkClicked = true;
  const verifyBtn = document.getElementById('yt-verify-btn');
  if (!verifyBtn) return;

  if (ytSubCountdownInterval) clearInterval(ytSubCountdownInterval);

  verifyBtn.textContent = 'Verifying Subscription (5s)...';
  verifyBtn.disabled = true;
  verifyBtn.className = 'w-full bg-amber-500/30 text-amber-200 border border-amber-500/40 font-bold py-2 px-4 rounded-xl text-xs transition-all animate-pulse';

  let countdown = 5;
  ytSubCountdownInterval = setInterval(() => {
    countdown--;
    if (countdown > 0) {
      verifyBtn.textContent = `Verifying Subscription (${countdown}s)...`;
    } else {
      clearInterval(ytSubCountdownInterval);
      ytSubCountdownInterval = null;
      verifyBtn.disabled = false;
      verifyBtn.className = 'w-full bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black py-2.5 px-4 rounded-xl text-xs transition-all active:scale-95 shadow-lg shadow-emerald-500/30 animate-bounce';
      verifyBtn.innerHTML = `Claim Reward (+1,000 ${hdsfdIcon('coins')} & Crown)`;
    }
  }, 1000);
}

function verifyYouTubeSubscription() {
  const localUpgrades = JSON.parse(localStorage.getItem('hdsfd_upgrades') || '[]');
  if (localStorage.getItem('hdsfd_has_crown') === 'true' || localUpgrades.includes('crown_claimed')) {
 showInAppNotification(' Zen Master Crown has already been claimed on your account!');
    closeYouTubeSubModal();
    return;
  }

  if (!ytChannelLinkClicked) {
 showInAppNotification(' Please click "Subscribe on YouTube" to open @HyperHrishiHD channel first!');
    return;
  }

  localStorage.setItem('hdsfd_has_crown', 'true');
  if (!localUpgrades.includes('crown_claimed')) {
    localUpgrades.push('crown_claimed');
    localStorage.setItem('hdsfd_upgrades', JSON.stringify(localUpgrades));
  }
 awardActivityCoins(1000, ' Zen Master YouTube Crown');
  syncUserStatsToServer();

  closeYouTubeSubModal();
  initializeUserSession();
  updateStatsOverview();
  updateShopCardsUI();
 showInAppNotification(' Zen Master Crown unlocked! +1,000 Coins added to your sanctuary balance.');
}

// Update Dynamic Shop Cards Labels & Buttons
function updateShopCardsUI() {
  // 1. Dew
  const dewTier = getFertileDewTier();
  const dewCost = 50 * (dewTier + 1);
  const dewBadge = document.getElementById('dew-tier-badge');
  const dewDesc = document.getElementById('dew-desc');
  const dewBtn = document.getElementById('buy-dew-btn');
  if (dewBadge) dewBadge.textContent = `Tier ${dewTier + 1}`;
  if (dewDesc) dewDesc.textContent = `+${(dewTier + 1) * 10}% Permanent growth multiplier`;
  if (dewBtn) dewBtn.innerHTML = `Buy (${dewCost} ${hdsfdIcon('coins')})`;

  // 2. Sunlight
  const sunlightBtn = document.getElementById('buy-sunlight-btn');
  if (sunlightBtn) {
    if (isSunlightEssenceActive()) {
      sunlightBtn.textContent = 'Active (1 Session)';
      sunlightBtn.className = 'mt-2.5 bg-amber-500/40 text-amber-200 border border-amber-400 px-2.5 py-1.5 rounded-lg text-[10px] font-bold cursor-default';
    } else {
      sunlightBtn.innerHTML = `Buy (100 ${hdsfdIcon('coins')})`;
      sunlightBtn.className = 'mt-2.5 bg-amber-500/20 text-amber-200 border border-amber-500/30 px-2.5 py-1.5 rounded-lg text-[10px] font-bold hover:bg-amber-500/30 active:scale-95 transition-all';
    }
  }

  // 3. Vines
  const vinesTier = parseInt(localStorage.getItem('hdsfd_vines_tier') || '1', 10);
  const vinesCost = 150 + ((vinesTier - 1) * 50);
  const vinesBadge = document.getElementById('vines-tier-badge');
  const vinesBtn = document.getElementById('buy-vines-btn');
  if (vinesBadge) vinesBadge.textContent = `${(1.0 + vinesTier * 0.5).toFixed(1)}x`;
  if (vinesBtn) {
    if (isGlowingVinesActive()) {
      const exp = parseInt(localStorage.getItem('hdsfd_vines_expiry') || '0', 10);
      const hoursLeft = Math.max(1, Math.round((exp - Date.now()) / (1000 * 3600)));
      vinesBtn.textContent = `Active (${hoursLeft}h left)`;
      vinesBtn.className = 'mt-2.5 bg-teal-500/40 text-teal-200 border border-teal-400 px-2.5 py-1.5 rounded-lg text-[10px] font-bold cursor-default';
    } else {
      vinesBtn.innerHTML = `Buy (${vinesCost} ${hdsfdIcon('coins')})`;
      vinesBtn.className = 'mt-2.5 bg-teal-500/20 text-teal-200 border border-teal-500/30 px-2.5 py-1.5 rounded-lg text-[10px] font-bold hover:bg-teal-500/30 active:scale-95 transition-all';
    }
  }

  // 4. Petals
  const petalsBtn = document.getElementById('buy-petals-btn');
  if (petalsBtn) {
    if (isBlossomPetalsActive()) {
      const exp = parseInt(localStorage.getItem('hdsfd_petals_expiry') || '0', 10);
      const hoursLeft = Math.max(1, Math.round((exp - Date.now()) / (1000 * 3600)));
      petalsBtn.textContent = `Active (${hoursLeft}h left)`;
      petalsBtn.className = 'mt-2.5 bg-rose-500/40 text-rose-200 border border-rose-400 px-2.5 py-1.5 rounded-lg text-[10px] font-bold cursor-default';
    } else {
      petalsBtn.innerHTML = `Buy (200 ${hdsfdIcon('coins')})`;
      petalsBtn.className = 'mt-2.5 bg-rose-500/20 text-rose-200 border border-rose-500/30 px-2.5 py-1.5 rounded-lg text-[10px] font-bold hover:bg-rose-500/30 active:scale-95 transition-all';
    }
  }

  // 5. Starlight
  const starlightBtn = document.getElementById('buy-starlight-btn');
  if (starlightBtn) {
    if (isStarlightAuraActive()) {
      const exp = parseInt(localStorage.getItem('hdsfd_starlight_expiry') || '0', 10);
      const daysLeft = Math.max(1, Math.round((exp - Date.now()) / (1000 * 3600 * 24)));
      starlightBtn.textContent = `Active (${daysLeft}d left)`;
      starlightBtn.className = 'mt-2.5 bg-yellow-400/40 text-yellow-100 border border-yellow-300 px-2.5 py-1.5 rounded-lg text-[10px] font-bold cursor-default';
    } else {
      starlightBtn.innerHTML = `Buy (500 ${hdsfdIcon('coins')})`;
      starlightBtn.className = 'mt-2.5 bg-yellow-400/20 text-yellow-100 border border-yellow-400/30 px-2.5 py-1.5 rounded-lg text-[10px] font-bold hover:bg-yellow-400/30 active:scale-95 transition-all';
    }
  }

  // 6. Freeze
  const freezeBtn = document.getElementById('buy-freeze-btn');
  if (freezeBtn) {
    if (isStreakShieldActive()) {
      const exp = parseInt(localStorage.getItem('hdsfd_freeze_expiry') || '0', 10);
      const hoursLeft = Math.max(1, Math.round((exp - Date.now()) / (1000 * 3600)));
      freezeBtn.textContent = `Shield Active (${hoursLeft}h)`;
      freezeBtn.className = 'mt-2.5 bg-cyan-500/40 text-cyan-200 border border-cyan-400 px-2.5 py-1.5 rounded-lg text-[10px] font-bold cursor-default';
    } else {
      freezeBtn.innerHTML = `Buy (250 ${hdsfdIcon('coins')})`;
      freezeBtn.className = 'mt-2.5 bg-cyan-500/20 text-cyan-200 border border-cyan-500/30 px-2.5 py-1.5 rounded-lg text-[10px] font-bold hover:bg-cyan-500/30 active:scale-95 transition-all';
    }
  }

  // 7. Theme Key
  const themeBtn = document.getElementById('buy-theme-btn');
  if (themeBtn) {
    if (googleAccount) {
      themeBtn.textContent = 'Unlocked (+200 coins claimed)';
      themeBtn.className = 'mt-2.5 bg-purple-500/40 text-purple-200 border border-purple-400 px-2.5 py-1.5 rounded-lg text-[10px] font-bold cursor-default opacity-80';
      themeBtn.disabled = true;
    } else {
      themeBtn.textContent = 'Sign in (+200 coins)';
      themeBtn.className = 'mt-2.5 bg-purple-500/20 text-purple-200 border border-purple-500/30 px-2.5 py-1.5 rounded-lg text-[10px] font-bold hover:bg-purple-500/30 active:scale-95 transition-all';
      themeBtn.disabled = false;
    }
  }

  // 8. Crown
  const crownBtn = document.getElementById('buy-crown-btn');
  if (crownBtn) {
    const localUpgrades = JSON.parse(localStorage.getItem('hdsfd_upgrades') || '[]');
    if (localStorage.getItem('hdsfd_has_crown') === 'true' || localUpgrades.includes('crown_claimed')) {
      crownBtn.textContent = 'Crown unlocked (+1,000 coins claimed)';
      crownBtn.className = 'mt-2.5 bg-amber-400/40 text-amber-100 border border-amber-300 px-2.5 py-1.5 rounded-lg text-[10px] font-bold cursor-default opacity-80';
      crownBtn.disabled = true;
    } else {
      crownBtn.textContent = 'Subscribe to HyperHrishi HD';
      crownBtn.className = 'mt-2.5 bg-amber-400/20 text-amber-100 border border-amber-400/30 px-2.5 py-1.5 rounded-lg text-[10px] font-bold hover:bg-amber-400/30 active:scale-95 transition-all';
      crownBtn.disabled = false;
    }
  }
}

// ===== EXAMS & ASSESSMENTS MANAGEMENT SYSTEM =====
function openAddExamModal(editId = null) {
  const modal = document.getElementById('add-exam-modal');
  const titleInput = document.getElementById('exam-title-input');
  const dateInput = document.getElementById('exam-date-input');
  const timeInput = document.getElementById('exam-time-input');
  const locInput = document.getElementById('exam-loc-input');
  const rewardSelect = document.getElementById('exam-reward-select');
  const editIdInput = document.getElementById('exam-edit-id');

  if (editId) {
    const exam = allData.find(d => d.id === editId && d.type === 'exam_entry');
    if (exam) {
      if (editIdInput) editIdInput.value = exam.id;
      if (titleInput) titleInput.value = exam.title || '';
      if (dateInput) dateInput.value = exam.date || '';
      if (timeInput) timeInput.value = exam.time || '09:00';
      if (locInput) locInput.value = exam.location || '';
      if (rewardSelect) rewardSelect.value = String(exam.reward || 250);
    }
  } else {
    if (editIdInput) editIdInput.value = '';
    if (titleInput) titleInput.value = '';
    if (dateInput) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 7);
      dateInput.value = tomorrow.toISOString().split('T')[0];
    }
    if (timeInput) timeInput.value = '09:00';
    if (locInput) locInput.value = '';
    if (rewardSelect) rewardSelect.value = '250';
  }

  if (modal) modal.classList.remove('hidden');
}

function closeAddExamModal() {
  const modal = document.getElementById('add-exam-modal');
  if (modal) modal.classList.add('hidden');
}

function saveExamEntry() {
  const titleInput = document.getElementById('exam-title-input');
  const dateInput = document.getElementById('exam-date-input');
  const timeInput = document.getElementById('exam-time-input');
  const locInput = document.getElementById('exam-loc-input');
  const rewardSelect = document.getElementById('exam-reward-select');
  const editIdInput = document.getElementById('exam-edit-id');

  const title = titleInput ? titleInput.value.trim() : '';
  const dateVal = dateInput ? dateInput.value : '';
  if (!title || !dateVal) {
 showInAppNotification(' Please enter an exam name and date.');
    return;
  }

  const timeVal = timeInput ? timeInput.value : '09:00';
  const location = locInput ? locInput.value.trim() : '';
  const reward = parseInt(rewardSelect ? rewardSelect.value : '250', 10);
  const editId = editIdInput ? editIdInput.value : '';
  const currentOwner = googleAccount || userName || 'Guest';

  const examObj = {
    id: editId || `exam_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    type: 'exam_entry',
    title: title,
    date: dateVal,
    time: timeVal,
    location: location,
    reward: reward,
    completed: false,
    created_at: new Date().toISOString(),
    username: currentOwner
  };

  if (editId) {
    const idx = allData.findIndex(d => d.id === editId);
    if (idx !== -1) allData[idx] = { ...allData[idx], ...examObj };
  } else {
    allData.push(examObj);

    // Auto-create matching Task Folder for this Exam Subject
    populateTaskFolderMenus();

    // Auto-create initial study checkpoint task
    const studyTask = {
      id: `task_exam_${Date.now()}`,
      type: 'task',
      title: `Study for ${title}`,
      folder: title,
      due: `${dateVal}T${timeVal}:00.000Z`,
      deadline: dateVal,
      completed: false,
      is_important: true,
      created_at: new Date().toISOString(),
      username: currentOwner,
      subtasks: [
        { id: 'st_1', title: 'Review lecture notes & formulas', completed: false },
        { id: 'st_2', title: 'Complete practice exam / problem set', completed: false }
      ]
    };
    allData.unshift(studyTask);
  }

  localStorage.setItem(`hdsfd_data_${currentOwner}`, JSON.stringify(allData));
  createData(examObj);

  // Sync to Google Calendar as Exam Event
  fetch(`${API_BASE}/google/calendar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: currentOwner,
      title: `EXAM: ${title}`,
      start_date: `${dateVal}T${timeVal}:00`,
      location: location
    })
  }).catch(err => console.warn('Exam calendar sync warning:', err));

  closeAddExamModal();
  renderScheduleGrid();
  renderExamCardsList();
  populateTaskFolderMenus();
  renderDirectGTasks();
  renderDarkCalendarGrid();
  renderHomeStatusAndNotifications();
 showInAppNotification(` Exam added: ${title}! Task folder created.`);
  triggerGoogleBackup();
}

function deleteExamEntry(id) {
  const currentOwner = googleAccount || userName || 'Guest';
  allData = allData.filter(d => d.id !== id);
  localStorage.setItem(`hdsfd_data_${currentOwner}`, JSON.stringify(allData));
  deleteData(id);
  renderScheduleGrid();
  renderExamCardsList();
  renderDarkCalendarGrid();
  renderHomeStatusAndNotifications();
  triggerGoogleBackup();
}

function toggleExamCompleted(id) {
  const currentOwner = googleAccount || userName || 'Guest';
  const exam = allData.find(d => d.id === id && d.type === 'exam_entry');
  if (!exam) return;

  exam.completed = !exam.completed;
  localStorage.setItem(`hdsfd_data_${currentOwner}`, JSON.stringify(allData));

  if (exam.completed) {
 awardActivityCoins(exam.reward || 250, `Exam Completed: ${exam.title} `);
    healSanctuaryTree(50);
  } else {
    deductActivityCoins(exam.reward || 250, 'Exam Unchecked');
  }

  renderExamCardsList();
  renderDarkCalendarGrid();
  updateStatsOverview();
}

function renderExamCardsList() {
  const container = document.getElementById('exam-cards-list');
  if (!container) return;

  const exams = allData.filter(d => d.type === 'exam_entry');
  if (exams.length === 0) {
    container.innerHTML = `
      <div class="glass p-3 rounded-xl border border-white/10 text-center text-xs text-white/40 italic">
        No upcoming exams added. Click "+ Add Exam" to set your exam dates and reward!
      </div>
    `;
    return;
  }

  // Sort by date ascending
  exams.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  container.innerHTML = exams.map(ex => {
    const isCompleted = !!ex.completed;
    const dateObj = new Date(ex.date + 'T' + (ex.time || '09:00'));
    const dateFormatted = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const timeFormatted = formatTime12h(ex.time || '09:00');

    return `
      <div class="glass p-3 rounded-xl border border-rose-500/20 border-l-4 border-l-rose-500 flex items-center justify-between hover:bg-white/[0.08] transition-all group ${isCompleted ? 'opacity-50' : ''}">
        <div class="space-y-1">
          <div class="flex items-center gap-2">
            <button onclick="toggleExamCompleted('${ex.id}')" class="w-4 h-4 rounded border ${isCompleted ? 'bg-rose-500 border-rose-400 text-white' : 'border-rose-400/60 bg-transparent'} flex items-center justify-center text-[10px] font-bold">
              ${isCompleted ? hdsfdIcon('check') : ''}
            </button>
            <h4 class="text-xs font-bold ${isCompleted ? 'line-through text-white/50' : 'text-white'}">${escapeHtml(ex.title)}</h4>
            <span class="text-[9px] font-black bg-amber-500/20 text-amber-300 border border-amber-500/30 px-1.5 py-0.5 rounded">+${ex.reward || 250} ${hdsfdIcon('coins')}</span>
          </div>
          <div class="flex items-center gap-2.5 text-[10px] text-white/60">
            <span class="text-rose-300 font-semibold inline-flex items-center gap-1">${hdsfdIcon('calendar')} ${dateFormatted} • ${timeFormatted}</span>
            ${ex.location ? `<span class="inline-flex items-center gap-1">${hdsfdIcon('pin')} ${escapeHtml(ex.location)}</span>` : ''}
          </div>
        </div>

        <div class="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
          <button onclick="openAddExamModal('${ex.id}')" class="w-6 h-6 rounded bg-white/5 hover:bg-white/15 text-white/70 flex items-center justify-center text-xs" title="Edit Exam">${hdsfdIcon('pencil')}</button>
          <button onclick="deleteExamEntry('${ex.id}')" class="w-6 h-6 rounded bg-red-500/10 hover:bg-red-500/30 text-red-300 flex items-center justify-center text-xs" title="Delete Exam">${hdsfdIcon('trash-2')}</button>
        </div>
      </div>
    `;
  }).join('');
}

// ===== LIVING SANCTUARY TREE SVG RENDERER =====
function renderSanctuaryTree() {
  const wrapper = document.getElementById('tree-svg-wrapper');
  if (!wrapper) return;

  const lifetimeXP = getLifetimeCoins();
  const stageInfo = getTreeStageInfo(lifetimeXP);
  const vitality = getTreeVitality();
  const hasVines = isGlowingVinesActive();
  const hasStarlight = isStarlightAuraActive();
  const hasPetals = isBlossomPetalsActive();

  // Handle cosmetic aura overlays
  const starlightAura = document.getElementById('tree-starlight-aura');
  if (starlightAura) {
    starlightAura.style.opacity = hasStarlight ? '0.45' : '0';
  }

  if (hasPetals) {
    initFallingPetals();
  }

  // Determine base SVG model from stage bracket (0 to 5)
  let modelIdx = 0;
  if (stageInfo.stageNumber >= 50) modelIdx = 5;
  else if (stageInfo.stageNumber >= 20) modelIdx = 4;
  else if (stageInfo.stageNumber >= 10) modelIdx = 3;
  else if (stageInfo.stageNumber >= 3) modelIdx = 2;
  else if (stageInfo.stageNumber >= 1) modelIdx = 1;
  else modelIdx = 0;

  // Apply Vitality / Browning Filter
  let treeFilter = '';
  if (vitality < 50) {
    treeFilter = 'filter: sepia(0.85) hue-rotate(-45deg) saturate(0.55);';
  } else if (vitality < 80) {
    treeFilter = 'filter: sepia(0.35) hue-rotate(-20deg);';
  }

  let svgContent = '';

  if (modelIdx === 0) {
    // Sprout Model
    svgContent = `
      <svg viewBox="0 0 400 300" style="${treeFilter}" class="w-full h-full filter drop-shadow-[0_0_15px_rgba(52,211,153,0.35)] animate-pulse-slow" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="soilGlow" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#10b981" stop-opacity="0.2"/>
            <stop offset="50%" stop-color="#34d399" stop-opacity="0.6"/>
            <stop offset="100%" stop-color="#10b981" stop-opacity="0.2"/>
          </linearGradient>
          <linearGradient id="stemGrad" x1="0%" y1="100%" x2="0%" y2="0%">
            <stop offset="0%" stop-color="#059669"/>
            <stop offset="100%" stop-color="#6ee7b7"/>
          </linearGradient>
        </defs>
        <ellipse cx="200" cy="285" rx="80" ry="12" fill="url(#soilGlow)"/>
        <path d="M192,275 Q200,265 208,275 Z" fill="#854d0e" opacity="0.8"/>
        <path d="M200,275 Q198,235 200,210" stroke="url(#stemGrad)" stroke-width="4.5" stroke-linecap="round" fill="none"/>
        <path d="M200,210 Q175,195 180,215 Q190,225 200,210 Z" fill="#34d399" opacity="0.9"/>
        <path d="M200,210 Q225,195 220,215 Q210,225 200,210 Z" fill="#6ee7b7" opacity="0.95"/>
        <circle cx="200" cy="202" r="3.5" fill="#a7f3d0" opacity="0.9"/>
      </svg>
    `;
  } else if (modelIdx === 1) {
    // Sapling Model
    svgContent = `
      <svg viewBox="0 0 400 350" style="${treeFilter}" class="w-full h-full filter drop-shadow-[0_0_20px_rgba(52,211,153,0.4)]" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="saplingStem" x1="0%" y1="100%" x2="0%" y2="0%">
            <stop offset="0%" stop-color="#065f46"/>
            <stop offset="50%" stop-color="#10b981"/>
            <stop offset="100%" stop-color="#6ee7b7"/>
          </linearGradient>
        </defs>
        <ellipse cx="200" cy="330" rx="100" ry="14" fill="#10b981" opacity="0.25"/>
        <path d="M200,325 Q196,250 200,160 Q202,120 200,80" stroke="url(#saplingStem)" stroke-width="6" stroke-linecap="round" fill="none"/>
        <path d="M198,220 Q160,190 150,180" stroke="url(#saplingStem)" stroke-width="3.5" stroke-linecap="round" fill="none"/>
        <path d="M200,180 Q240,150 250,140" stroke="url(#saplingStem)" stroke-width="3.5" stroke-linecap="round" fill="none"/>
        <path d="M150,180 Q130,160 145,175 Q160,190 150,180 Z" fill="#34d399"/>
        <path d="M160,195 Q140,180 155,200 Z" fill="#6ee7b7"/>
        <path d="M250,140 Q270,120 255,135 Q240,150 250,140 Z" fill="#34d399"/>
        <path d="M240,155 Q260,140 245,160 Z" fill="#6ee7b7"/>
        <path d="M200,80 Q180,50 195,70 Q205,85 200,80 Z" fill="#a7f3d0"/>
        <path d="M200,80 Q220,50 205,70 Q195,85 200,80 Z" fill="#6ee7b7"/>
        <circle cx="200" cy="65" r="4" fill="#ecfdf5"/>
      </svg>
    `;
  } else if (modelIdx === 2) {
    // Young Oak Model
    svgContent = `
      <svg viewBox="0 0 500 400" style="${treeFilter}" class="w-full h-full filter drop-shadow-[0_0_25px_rgba(16,185,129,0.35)]" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="trunkGrad" x1="0%" y1="100%" x2="0%" y2="0%">
            <stop offset="0%" stop-color="#1e293b"/>
            <stop offset="40%" stop-color="#334155"/>
            <stop offset="100%" stop-color="#475569"/>
          </linearGradient>
        </defs>
        <path d="M220,380 Q250,370 280,380 Q260,350 255,300 L245,300 Q240,350 220,380 Z" fill="url(#trunkGrad)"/>
        <path d="M245,300 Q240,220 250,160" stroke="url(#trunkGrad)" stroke-width="18" stroke-linecap="round" fill="none"/>
        <path d="M248,220 Q180,180 150,140" stroke="url(#trunkGrad)" stroke-width="9" stroke-linecap="round" fill="none"/>
        <path d="M250,190 Q320,150 350,120" stroke="url(#trunkGrad)" stroke-width="9" stroke-linecap="round" fill="none"/>
        <path d="M250,160 Q250,110 250,80" stroke="url(#trunkGrad)" stroke-width="8" stroke-linecap="round" fill="none"/>
        <circle cx="150" cy="130" r="45" fill="#059669" opacity="0.6"/>
        <circle cx="140" cy="120" r="35" fill="#10b981" opacity="0.75"/>
        <circle cx="350" cy="110" r="48" fill="#059669" opacity="0.6"/>
        <circle cx="360" cy="100" r="38" fill="#10b981" opacity="0.75"/>
        <circle cx="250" cy="70" r="60" fill="#047857" opacity="0.65"/>
        <circle cx="250" cy="60" r="48" fill="#10b981" opacity="0.8"/>
        <circle cx="250" cy="50" r="35" fill="#6ee7b7" opacity="0.85"/>
        ${hasVines ? '<path d="M242,320 Q252,260 244,200 Q254,160 248,120" stroke="#2dd4bf" stroke-width="2.5" stroke-dasharray="4,4" fill="none"/>' : ''}
      </svg>
    `;
  } else if (modelIdx === 3) {
    // Sakura Blossom Canopy Model
    svgContent = `
      <svg viewBox="0 0 600 450" style="${treeFilter}" class="w-full h-full filter drop-shadow-[0_0_30px_rgba(244,114,182,0.4)]" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="sakuraTrunk" x1="0%" y1="100%" x2="0%" y2="0%">
            <stop offset="0%" stop-color="#0f172a"/>
            <stop offset="50%" stop-color="#1e293b"/>
            <stop offset="100%" stop-color="#334155"/>
          </linearGradient>
        </defs>
        <path d="M270,420 Q300,400 330,420 Q310,340 305,260 L295,260 Q290,340 270,420 Z" fill="url(#sakuraTrunk)"/>
        <path d="M300,260 Q285,180 300,120" stroke="url(#sakuraTrunk)" stroke-width="22" stroke-linecap="round" fill="none"/>
        <path d="M295,220 Q190,170 140,120 Q110,90 90,80" stroke="url(#sakuraTrunk)" stroke-width="12" stroke-linecap="round" fill="none"/>
        <path d="M305,190 Q410,140 460,100 Q490,75 510,60" stroke="url(#sakuraTrunk)" stroke-width="12" stroke-linecap="round" fill="none"/>
        <path d="M300,140 Q250,90 230,50" stroke="url(#sakuraTrunk)" stroke-width="9" stroke-linecap="round" fill="none"/>
        <path d="M300,140 Q350,90 370,50" stroke="url(#sakuraTrunk)" stroke-width="9" stroke-linecap="round" fill="none"/>
        <ellipse cx="120" cy="90" rx="75" ry="55" fill="#f472b6" opacity="0.65"/>
        <ellipse cx="130" cy="80" rx="55" ry="40" fill="#fbcfe8" opacity="0.8"/>
        <ellipse cx="480" cy="70" rx="80" ry="60" fill="#ec4899" opacity="0.6"/>
        <ellipse cx="470" cy="60" rx="60" ry="45" fill="#fbcfe8" opacity="0.85"/>
        <ellipse cx="300" cy="50" rx="105" ry="70" fill="#db2777" opacity="0.55"/>
        <ellipse cx="300" cy="40" rx="85" ry="55" fill="#f472b6" opacity="0.75"/>
        <ellipse cx="300" cy="30" rx="60" ry="40" fill="#fdf2f8" opacity="0.9"/>
        ${hasVines ? '<path d="M290,380 Q310,300 292,210 Q310,150 298,90" stroke="#34d399" stroke-width="3" fill="none"/>' : ''}
      </svg>
    `;
  } else if (modelIdx === 4) {
    // Ancient Redwood Model
    svgContent = `
      <svg viewBox="0 0 700 500" style="${treeFilter}" class="w-full h-full filter drop-shadow-[0_0_35px_rgba(52,211,153,0.45)]" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="elderTrunk" x1="0%" y1="100%" x2="0%" y2="0%">
            <stop offset="0%" stop-color="#022c22"/>
            <stop offset="40%" stop-color="#064e3b"/>
            <stop offset="100%" stop-color="#0f766e"/>
          </linearGradient>
        </defs>
        <path d="M280,480 Q350,450 420,480 Q380,360 365,270 L335,270 Q320,360 280,480 Z" fill="url(#elderTrunk)"/>
        <path d="M350,270 Q340,170 350,100" stroke="url(#elderTrunk)" stroke-width="34" stroke-linecap="round" fill="none"/>
        <path d="M340,220 Q200,160 140,100 Q90,60 60,40" stroke="url(#elderTrunk)" stroke-width="18" stroke-linecap="round" fill="none"/>
        <path d="M360,180 Q500,130 560,80 Q610,40 640,20" stroke="url(#elderTrunk)" stroke-width="18" stroke-linecap="round" fill="none"/>
        <circle cx="100" cy="70" r="95" fill="#047857" opacity="0.6"/>
        <circle cx="110" cy="60" r="75" fill="#10b981" opacity="0.75"/>
        <circle cx="600" cy="50" r="100" fill="#047857" opacity="0.6"/>
        <circle cx="590" cy="40" r="80" fill="#10b981" opacity="0.75"/>
        <circle cx="350" cy="40" r="130" fill="#065f46" opacity="0.65"/>
        <circle cx="350" cy="30" r="105" fill="#10b981" opacity="0.8"/>
        <circle cx="350" cy="20" r="75" fill="#6ee7b7" opacity="0.9"/>
        <path d="M330,440 Q370,360 338,260 Q368,180 345,90" stroke="#34d399" stroke-width="4.5" stroke-dasharray="8,6" fill="none"/>
        <path d="M370,430 Q330,340 362,240 Q332,160 355,80" stroke="#2dd4bf" stroke-width="3.5" fill="none"/>
      </svg>
    `;
  } else {
    // Celestial World Tree Model
    svgContent = `
      <svg viewBox="0 0 800 550" style="${treeFilter}" class="w-full h-full filter drop-shadow-[0_0_50px_rgba(251,191,36,0.5)]" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="cosmicTrunk" x1="0%" y1="100%" x2="0%" y2="0%">
            <stop offset="0%" stop-color="#312e81"/>
            <stop offset="40%" stop-color="#4f46e5"/>
            <stop offset="80%" stop-color="#9333ea"/>
            <stop offset="100%" stop-color="#fbbf24"/>
          </linearGradient>
          <radialGradient id="celestialHalo" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stop-color="#fef08a" stop-opacity="0.9"/>
            <stop offset="50%" stop-color="#ec4899" stop-opacity="0.4"/>
            <stop offset="100%" stop-color="#6366f1" stop-opacity="0"/>
          </radialGradient>
        </defs>
        <circle cx="400" cy="180" r="230" fill="url(#celestialHalo)"/>
        <path d="M320,530 Q400,490 480,530 Q430,390 415,280 L385,280 Q370,390 320,530 Z" fill="url(#cosmicTrunk)"/>
        <path d="M400,280 Q390,170 400,90" stroke="url(#cosmicTrunk)" stroke-width="40" stroke-linecap="round" fill="none"/>
        <path d="M390,220 Q220,150 140,80 Q70,40 30,10" stroke="url(#cosmicTrunk)" stroke-width="22" stroke-linecap="round" fill="none"/>
        <path d="M410,180 Q580,120 660,60 Q730,20 770,0" stroke="url(#cosmicTrunk)" stroke-width="22" stroke-linecap="round" fill="none"/>
        <ellipse cx="100" cy="50" rx="120" ry="85" fill="#818cf8" opacity="0.65"/>
        <ellipse cx="100" cy="40" rx="95" ry="65" fill="#c084fc" opacity="0.8"/>
        <ellipse cx="700" cy="30" rx="120" ry="85" fill="#818cf8" opacity="0.65"/>
        <ellipse cx="700" cy="20" rx="95" ry="65" fill="#f472b6" opacity="0.8"/>
        <ellipse cx="400" cy="30" rx="170" ry="110" fill="#a855f7" opacity="0.6"/>
        <ellipse cx="400" cy="15" rx="130" ry="85" fill="#fbbf24" opacity="0.85"/>
        <ellipse cx="400" cy="0" rx="80" ry="50" fill="#fef9c3" opacity="0.95"/>
        <path d="M375,480 Q425,380 385,270 Q425,180 395,80" stroke="#fde047" stroke-width="5" stroke-dasharray="10,6" fill="none"/>
        <path d="M425,470 Q375,360 415,250 Q375,160 405,70" stroke="#67e8f9" stroke-width="4.5" fill="none"/>
        <circle cx="260" cy="180" r="6" fill="#fef08a" opacity="0.9"/>
        <circle cx="540" cy="150" r="6" fill="#67e8f9" opacity="0.9"/>
        <circle cx="400" cy="120" r="8" fill="#ffffff" opacity="0.95"/>
      </svg>
    `;
  }

  wrapper.innerHTML = svgContent;
}

// Falling Sakura Petals
let petalsInterval = null;
function initFallingPetals() {
  const container = document.getElementById('tree-petals-container');
  if (!container) return;
  container.classList.remove('hidden');

  if (petalsInterval) return;

  function createPetal() {
    if (!container || container.classList.contains('hidden')) return;
    const petal = document.createElement('div');
    const size = Math.random() * 8 + 6;
    const startX = Math.random() * window.innerWidth;
    const duration = Math.random() * 7 + 6;

    petal.className = 'absolute rounded-full pointer-events-none opacity-70';
    petal.style.width = `${size}px`;
    petal.style.height = `${size * 1.3}px`;
    petal.style.backgroundColor = Math.random() > 0.5 ? '#fbcfe8' : '#f472b6';
    petal.style.left = `${startX}px`;
    petal.style.top = '-20px';
    petal.style.transform = `rotate(${Math.random() * 360}deg)`;
    petal.style.transition = `transform ${duration}s linear, top ${duration}s linear, left ${duration}s ease-in-out`;
    petal.style.boxShadow = '0 0 6px rgba(244, 114, 182, 0.5)';

    container.appendChild(petal);

    setTimeout(() => {
      petal.style.top = `${window.innerHeight + 20}px`;
      petal.style.left = `${startX + (Math.random() * 120 - 60)}px`;
      petal.style.transform = `rotate(${Math.random() * 720}deg)`;
    }, 50);

    setTimeout(() => {
      if (petal.parentNode) petal.parentNode.removeChild(petal);
    }, duration * 1000 + 200);
  }

  for (let i = 0; i < 5; i++) {
    setTimeout(createPetal, i * 600);
  }
  petalsInterval = setInterval(createPetal, 1500);
}

function showInAppNotification(message) {
  let toast = document.getElementById('in-app-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'in-app-toast';
    toast.className = 'fixed top-5 left-1/2 -translate-x-1/2 z-[9999999] glass px-4 py-2.5 rounded-2xl border border-purple-500/40 text-xs font-bold text-white shadow-2xl transition-all duration-300 pointer-events-none transform -translate-y-10 opacity-0';
    document.body.appendChild(toast);
  }

  toast.textContent = message;
  toast.classList.remove('-translate-y-10', 'opacity-0');
  toast.classList.add('translate-y-0', 'opacity-100');

  setTimeout(() => {
    toast.classList.remove('translate-y-0', 'opacity-100');
    toast.classList.add('-translate-y-10', 'opacity-0');
  }, 4000);
}

function refreshIcons() {
  if (typeof lucide !== 'undefined' && lucide.createIcons) {
    lucide.createIcons();
  }
}

// ===== SCROLL PAINT GUARD =====
// Glass uses backdrop-filter plus an animated refraction field. During fast
// scrolling the compositor can fall behind and paint a blank frame, so the
// expensive effects pause for the duration of the scroll and come back once
// it settles. Keeps scrolling smooth without changing the resting look.
let scrollPaintGuardTimer = null;

function markScrollActivity() {
  const body = document.body;
  if (!body.classList.contains('is-scrolling')) body.classList.add('is-scrolling');
  clearTimeout(scrollPaintGuardTimer);
  scrollPaintGuardTimer = setTimeout(() => {
    body.classList.remove('is-scrolling');
  }, 130);
}

function initScrollPaintGuard() {
  const scrollers = [
    document.getElementById('content-area'),
    document.getElementById('gemini-agent-chat-stream'),
    document.getElementById('notes-canvas-arena'),
    document.getElementById('gtasks-live-list')
  ].filter(Boolean);
  scrollers.forEach(el => el.addEventListener('scroll', markScrollActivity, { passive: true }));
  window.addEventListener('scroll', markScrollActivity, { passive: true });
}

// Google First-Time 200 Coin Bonus & Auto-Sync
function handleGoogleFirstTimeReward() {
  if (googleAccount && !localStorage.getItem('hdsfd_google_signin_bonus_claimed')) {
    localStorage.setItem('hdsfd_google_signin_bonus_claimed', 'true');
    const curBonus = parseInt(localStorage.getItem('hdsfd_lifetime_bonus_xp') || '0', 10);
    localStorage.setItem('hdsfd_lifetime_bonus_xp', String(curBonus + 200));
 showInAppNotification(' Welcome! Claimed +200 Free Coins for pairing your Google Account.');
    autoSyncGoogleTasksAndCalendar();
    updateStatsOverview();
    updateShopCardsUI();
  }
}

// ===== APP INITIALIZATION & PWA SERVICE WORKER =====
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
 console.log('HDSFD PWA Service Worker Registered:', reg.scope);
    }).catch(err => {
 console.log('SW registration error:', err);
    });
  });
}

let deferredPwaPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPwaPrompt = e;
  const installBtn = document.getElementById('pwa-install-header-btn');
  if (installBtn) installBtn.classList.remove('hidden');
});

function triggerPwaInstall() {
  if (deferredPwaPrompt) {
    deferredPwaPrompt.prompt();
    deferredPwaPrompt.userChoice.then((choiceResult) => {
      if (choiceResult.outcome === 'accepted') {
 console.log('User installed HDSFD PWA');
      }
      deferredPwaPrompt = null;
      const installBtn = document.getElementById('pwa-install-header-btn');
      if (installBtn) installBtn.classList.add('hidden');
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const savedTheme = localStorage.getItem('hdsfd_theme') || 'midnight';
  setTheme(savedTheme);
  startClockWithSeconds();
  checkFirstTimeUser();
  checkTreeDecayLoop();
  processBlossomPassiveIncome();
  renderExamCardsList();
  updateShopCardsUI();
  handleGoogleFirstTimeReward();
  updateSchoolAccountUI();
  refreshSchoolStatus();
  refreshIcons();

  // Music engine: bind the audio element and restore the saved session
  bindMusicAudio();
  musicRestoreState();
  updateAIContextBadge(buildAIWorkspaceContext());
  initScrollPaintGuard();

  // Passive income & decay checker interval (every 10 minutes)
  setInterval(() => {
    processBlossomPassiveIncome();
    checkTreeDecayLoop();
  }, 10 * 60 * 1000);
});

