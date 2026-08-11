// ================= HD SFD V2 LIGHTWEIGHT & OPTIMIZED APP LOGIC =================

let userName = localStorage.getItem('hdsfd_user_name') || null;
let googleAccount = localStorage.getItem('hdsfd_google_account') || null;
let googleAccountName = localStorage.getItem('hdsfd_google_name') || null;
let activeTab = 'focus';
let allData = [];
let isLowPowerMode = localStorage.getItem('hdsfd_low_power') === 'true';

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
  const currentOwner = googleAccount || userName || 'Guest';
  try {
    const res = await fetch(`${API_BASE}/items?username=${encodeURIComponent(currentOwner)}`);
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
  const currentOwner = googleAccount || userName || 'Guest';
  item.username = currentOwner;
  item.id = item.id || 'item_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);

  try {
    await fetch(`${API_BASE}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(item)
    });
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
  const targetItem = allData.find(d => d.id === id);

  if (targetItem && targetItem.type === 'task' && !id.startsWith('task_') && !id.startsWith('item_')) {
    fetch(`${API_BASE}/google/tasks/${encodeURIComponent(id)}?username=${encodeURIComponent(currentOwner)}&tasklist_id=${encodeURIComponent(targetItem.tasklist_id || '@default')}`, {
      method: 'DELETE'
    }).catch(err => console.warn('Google Task delete failed:', err));
  }

  try {
    await fetch(`${API_BASE}/items`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: id, username: currentOwner })
    });
  } catch (e) {
    console.warn('API delete warning:', e);
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
  
  const fullContext = {
    username: owner,
    google_account: googleAccount,
    timestamp: new Date().toISOString(),
    stats: {
      coins: userCoins,
      lifetime_xp: userLifetimeXP,
      focus_time_mins: totalFocusTimeMinutes,
      tasks_completed: totalTasksCompleted,
      streak_days: currentStreakDays
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
      msgEl.textContent = res.drive_synced ? '✅ Backup saved to Google Drive (Notes.json, data.db, ai.json)!' : '⚠️ Saved locally.';
      setTimeout(() => msgEl.classList.add('hidden'), 4000);
    }
  })
  .catch(() => {
    if (msgEl) {
      msgEl.textContent = '⚠️ Backup error occurred.';
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
  if (nameDisplay) nameDisplay.textContent = (hasCrown ? '👑 ' : '') + displayName;
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

  const statsUser = (googleAccount && googleAccount.includes('@')) ? googleAccount : activeName;
  fetch(`${API_BASE}/user/stats?username=${encodeURIComponent(statsUser)}`)
    .then(r => r.json())
    .then(stats => {
      if (stats && stats.status === 'success') {
        if (typeof stats.coins === 'number') {
          localStorage.setItem(`hdsfd_coins_${statsUser}`, stats.coins.toString());
        }
        if (typeof stats.lifetime_xp === 'number') {
          localStorage.setItem(`hdsfd_lifetime_coins_${statsUser}`, stats.lifetime_xp.toString());
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
        <span class="truncate">📁 ${f}</span>
        ${selectedNewTaskFolder === f ? '<span class="text-purple-300 text-[10px]">✓</span>' : ''}
      </button>
    `).join('');
  }

  // 2. Calendar Day Add Folder Menu
  const calDayMenu = document.getElementById('cal-day-folder-menu');
  if (calDayMenu) {
    calDayMenu.innerHTML = folders.map(f => `
      <button type="button" onclick="selectCalDayFolder('${f}')" class="w-full text-left px-2.5 py-1.5 rounded-xl hover:bg-purple-500/20 text-xs flex items-center justify-between transition-all ${calDaySelectedFolder === f ? 'text-purple-300 font-bold bg-purple-500/10' : 'text-white/80'}">
        <span class="truncate">📁 ${f}</span>
        ${calDaySelectedFolder === f ? '<span class="text-purple-300 text-[10px]">✓</span>' : ''}
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
      repeatLabel = `🔁 Every ${t.repeat_config.interval || 1} ${t.repeat_config.unit}`;
      if (t.repeat_config.time) repeatLabel += ` (${t.repeat_config.time})`;
    } else if (t.repeat && t.repeat !== 'none') {
      repeatLabel = `🔁 ${t.repeat}`;
    }

    return `
      <div class="glass p-3 rounded-2xl border border-white/10 hover:border-purple-500/40 transition-all ${t.completed ? 'opacity-50' : ''} space-y-2" data-task-id="${t.id}">
        <div class="flex items-start justify-between gap-2">
          
          <!-- Reorder Up/Down Buttons -->
          <div class="flex flex-col gap-0.5 pt-0.5">
            <button onclick="reorderTask('${t.id}', 'up')" class="w-4 h-4 rounded bg-white/5 hover:bg-white/20 text-[9px] text-white/60 hover:text-white flex items-center justify-center transition-all ${indexInPartition === 0 ? 'opacity-30 pointer-events-none' : ''}" title="Move Up">▲</button>
            <button onclick="reorderTask('${t.id}', 'down')" class="w-4 h-4 rounded bg-white/5 hover:bg-white/20 text-[9px] text-white/60 hover:text-white flex items-center justify-center transition-all ${indexInPartition === partitionTotal - 1 ? 'opacity-30 pointer-events-none' : ''}" title="Move Down">▼</button>
          </div>

          <div class="flex items-start gap-2.5 overflow-hidden flex-1">
            <input type="checkbox" ${t.completed ? 'checked' : ''} onchange="toggleTaskState('${t.id}')" class="w-4 h-4 mt-0.5 accent-purple-400 cursor-pointer flex-shrink-0">
            
            <div class="flex flex-col truncate flex-1 text-left">
              <span class="text-xs ${t.completed ? 'line-through text-white/40' : 'text-white font-semibold'} truncate">${t.title}</span>
              ${t.details ? `<p class="text-[10px] text-white/50 line-clamp-2 mt-0.5">${t.details}</p>` : ''}
              
              <!-- Badges: Folder, Due Date/Time, Deadline, Repeat -->
              <div class="flex flex-wrap items-center gap-1.5 mt-1.5">
                ${t.folder ? `<span class="text-[9px] bg-purple-500/20 text-purple-200 border border-purple-500/30 px-1.5 py-0.2 rounded-md font-bold">📁 ${t.folder}</span>` : ''}
                ${dueFormatted ? `<span class="text-[9px] bg-sky-500/20 text-sky-200 border border-sky-500/30 px-1.5 py-0.2 rounded-md font-bold">📅 ${dueFormatted}</span>` : ''}
                ${deadlineFormatted ? `<span class="text-[9px] bg-amber-500/20 text-amber-200 border border-amber-500/30 px-1.5 py-0.2 rounded-md font-bold">🎯 Deadline: ${deadlineFormatted}</span>` : ''}
                ${repeatLabel ? `<span class="text-[9px] bg-emerald-500/20 text-emerald-200 border border-emerald-500/30 px-1.5 py-0.2 rounded-md font-bold">${repeatLabel}</span>` : ''}
              </div>

              <!-- Attachments Chips -->
              ${attachments.length > 0 ? `
                <div class="flex flex-wrap items-center gap-1.5 mt-1.5">
                  ${attachments.map(att => `
                    <a href="${att.url || '#'}" target="_blank" class="text-[9px] bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 border border-cyan-500/30 px-2 py-0.5 rounded-md font-bold flex items-center gap-1 transition-all">
                      <span>📎</span> <span class="truncate max-w-[120px]">${att.name || 'Drive File'}</span> <span>↗</span>
                    </a>
                  `).join('')}
                </div>
              ` : ''}
            </div>
          </div>

          <!-- Star & 3-Dots Button -->
          <div class="flex items-center gap-1">
            <button onclick="toggleTaskImportance('${t.id}')" class="text-xs px-1 ${isImp ? 'text-amber-300' : 'text-white/20 hover:text-white/60'} transition-all" title="Toggle Starred">
              ${isImp ? '⭐' : '☆'}
            </button>
            <button onclick="openTaskFloatingMenu('${t.id}', this, event)" class="text-white/40 hover:text-white text-xs px-1.5 py-0.5 rounded-lg font-bold hover:bg-white/10 transition-all" title="Options">⋮</button>
          </div>
        </div>

        <!-- Subtasks Expand / Collapse & Indented Scrollable Section -->
        ${subtasks.length > 0 ? `
          <div class="pt-1">
            <div class="flex items-center justify-between text-[10px] text-white/50 font-bold mb-1">
              <button onclick="toggleSubtasksExpanded('${t.id}')" class="flex items-center gap-1 hover:text-purple-300 transition-all">
                <span>${isSubtasksExpanded ? '▾' : '▸'}</span>
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
                    <button onclick="removeSubtask('${t.id}', ${sIdx})" class="opacity-0 group-hover:opacity-100 text-white/30 hover:text-red-400 text-[10px] px-1 transition-all">✕</button>
                  </div>
                `).join('')}
              </div>
            ` : ''}
          </div>
        ` : ''}
      </div>
    `;
  }

  let html = uncompleted.map((t, idx) => renderTaskCard(t, idx, uncompleted.length, false)).join('');

  if (completed.length > 0) {
    html += `
      <div class="pt-3 border-t border-white/10 mt-3 space-y-2">
        <div class="flex items-center justify-between text-[10px] font-black uppercase tracking-wider text-white/40 px-1">
          <span>Completed (${completed.length})</span>
        </div>
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
      <span>${isImp ? '★' : '☆'}</span> <span>${isImp ? 'Remove from Starred' : 'Add to Starred'}</span>
    </button>

    <button onclick="openCustomDateTimeModal('deadline', '${task.id}'); closeTaskFloatingMenu();" class="w-full text-left px-2.5 py-1.5 rounded-xl hover:bg-white/10 text-xs flex items-center gap-2 text-white/90">
      <span>🎯</span> <span>Add / Edit Deadline</span>
    </button>

    <button onclick="openGDriveAttachModal('${task.id}'); closeTaskFloatingMenu();" class="w-full text-left px-2.5 py-1.5 rounded-xl hover:bg-white/10 text-xs flex items-center gap-2 text-cyan-300 font-medium">
      <span>📎</span> <span>Add Drive Attachment</span>
    </button>

    <button onclick="promptAddSubtask('${task.id}'); closeTaskFloatingMenu();" class="w-full text-left px-2.5 py-1.5 rounded-xl hover:bg-white/10 text-xs flex items-center gap-2 text-white/90">
      <span>↳</span> <span>Add a Subtask</span>
    </button>

    <button onclick="deleteData('${task.id}'); closeTaskFloatingMenu();" class="w-full text-left px-2.5 py-1.5 rounded-xl hover:bg-red-500/20 text-xs flex items-center gap-2 text-red-300 font-medium">
      <span>🗑️</span> <span>Delete Task</span>
    </button>

    <div class="border-t border-white/10 pt-1.5 mt-1 max-h-36 overflow-y-auto">
      <span class="text-[9px] uppercase font-bold text-white/40 px-2 block mb-1">Move to List</span>
      ${folders.map(f => `
        <button onclick="moveTaskFolder('${task.id}', '${f}'); closeTaskFloatingMenu();" class="w-full text-left px-2.5 py-1 rounded-lg hover:bg-white/10 text-[11px] flex items-center justify-between ${task.folder === f ? 'text-purple-300 font-bold' : 'text-white/70'}">
          <span class="truncate">${f}</span>
          ${task.folder === f ? '<span>✓</span>' : ''}
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
    <button type="button" onclick="this.parentElement.remove(); tempSubtasksList.splice(${subIdx}, 1);" class="text-white/40 hover:text-red-400 text-xs px-1">✕</button>
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
      chipName.textContent = `📎 ${name}`;
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
            <div class="cal-event-chip bg-rose-500/40 text-rose-100 border border-rose-400/50 font-bold" title="🎯 Exam: ${escapeHtml(ex.title)}">
              🎯 ${escapeHtml(ex.title)}
            </div>
          `).join('')}

          ${daySchedules.map(s => `
            <div class="cal-event-chip bg-emerald-500/30 text-emerald-200 border border-emerald-500/40 font-semibold" title="🕒 Class: ${escapeHtml(s.title)} (${s.start_time || ''})">
              🕒 ${escapeHtml(s.title)}
            </div>
          `).join('')}

          ${dayEvents.map(e => `
            <div class="cal-event-chip bg-sky-500/30 text-sky-200 border border-sky-500/40" title="Event: ${escapeHtml(e.summary || 'Event')}">
              🔵 ${escapeHtml(e.summary || 'Event')}
            </div>
          `).join('')}

          ${dayTasks.map(t => `
            <div class="cal-event-chip bg-purple-500/30 text-purple-200 border border-purple-500/40 ${t.completed ? 'line-through opacity-40' : ''}" title="Task: ${escapeHtml(t.title)}">
              📋 ${escapeHtml(t.title)}
            </div>
          `).join('')}

          ${dayDeadlines.map(t => `
            <div class="cal-event-chip bg-amber-500/30 text-amber-200 border border-amber-500/40 font-bold" title="Deadline: ${escapeHtml(t.title)}">
              🎯 ${escapeHtml(t.title)}
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
              <span class="text-rose-400 font-black">🎯 Exam:</span>
              <span class="text-white font-bold">${escapeHtml(ex.title)}</span>
              <span class="text-[9px] bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded font-bold">+${ex.reward || 250} 🪙</span>
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
              <span class="text-purple-300 font-bold">🕒 Class:</span>
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
              <span class="text-sky-300 font-bold">🔵 Event</span>
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
              <span class="text-purple-300 font-bold">📋 Task:</span>
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
              <span class="text-amber-300 font-bold">🎯 Deadline:</span>
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
let selectedScheduleDays = ['Mon', 'Wed', 'Fri'];
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
      selectedScheduleDays = Array.isArray(entry.days) ? [...entry.days] : ['Mon', 'Wed', 'Fri'];
      selectedScheduleColor = entry.color || 'purple';
    }
  } else {
    if (modalTitle) modalTitle.textContent = 'Add Class / Schedule Period';
    if (editIdInput) editIdInput.value = '';
    if (titleInput) titleInput.value = '';
    if (startTimeInput) startTimeInput.value = '09:00';
    if (endTimeInput) endTimeInput.value = '10:15';
    if (locInput) locInput.value = '';
    selectedScheduleDays = ['Mon', 'Wed', 'Fri'];
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
      console.log('✅ Google Calendar Schedule Synced:', res.event);
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
        <div class="text-3xl">🕒</div>
        <div>
          <h4 class="text-sm font-bold text-white">No Schedule Entries for ${activeScheduleDayFilter === 'all' ? 'this week' : activeScheduleDayFilter}</h4>
          <p class="text-xs text-white/50 mt-1">Add your daily classes, study periods, or routine blocks.</p>
        </div>
        <button onclick="openAddScheduleModal()" class="px-4 py-2 rounded-xl bg-purple-500/30 text-purple-200 border border-purple-500/40 text-xs font-bold hover:bg-purple-500/50 transition-all">
          ➕ Add Class / Period
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
            <span class="flex items-center gap-1 text-purple-300 font-semibold">🕒 ${timeDisplay}</span>
            ${item.location ? `<span class="flex items-center gap-1 text-white/50">📍 ${escapeHtml(item.location)}</span>` : ''}
          </div>
        </div>

        <div class="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
          <button onclick="openAddScheduleModal('${item.id}')" class="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/15 text-white/70 hover:text-white flex items-center justify-center text-xs transition-all" title="Edit Class">✏️</button>
          <button onclick="deleteScheduleEntry('${item.id}')" class="w-7 h-7 rounded-lg bg-red-500/10 hover:bg-red-500/30 text-red-300 flex items-center justify-center text-xs transition-all" title="Delete Class">🗑️</button>
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
            <span>📚</span>
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
            <span>📅</span>
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

  // Restore saved ratio
  const savedRatio = parseFloat(localStorage.getItem('hdsfd_split_ratio')) || 56;
  calPanel.style.width = `${savedRatio}%`;
  tasksPanel.style.width = `${100 - savedRatio}%`;

  let isDragging = false;

  handle.addEventListener('pointerdown', (e) => {
    isDragging = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    function onPointerMove(e) {
      if (!isDragging) return;
      const rect = container.getBoundingClientRect();
      const offset = e.clientX - rect.left;
      let pct = Math.max(20, Math.min(80, (offset / rect.width) * 100));

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
        const curWidth = parseFloat(calPanel.style.width) || 50;
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
  if (calPanel && tasksPanel) {
    calPanel.style.width = `${targetPct}%`;
    tasksPanel.style.width = `${100 - targetPct}%`;
    localStorage.setItem('hdsfd_split_ratio', targetPct);
  }
}

// ===== STARRED TASKS VIEW (INSTANT & AUTOMATIC SYNC) =====
function renderHomeStarredTasks() {
  const listEl = document.getElementById('home-starred-tasks-list');
  const zenListEl = document.getElementById('zen-quick-tasks-list');
  if (!listEl && !zenListEl) return;

  const tasks = allData.filter(d => d.type === 'task' && d.is_important);

  if (tasks.length === 0) {
    const emptyMsg = '<p class="text-white/40 text-[11px] italic text-center py-8">No starred tasks! Click ☆ on any task in Tasks tab to pin here.</p>';
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
          <span>📁</span> <span>${folderName}</span>
        </div>
        ${groupTasks.map(t => {
          const dueFormatted = t.due ? new Date(t.due).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '';
          return `
            <div class="glass p-2.5 rounded-2xl flex items-center justify-between border border-white/10 hover:border-white/20 text-left transition-all ${t.completed ? 'opacity-40' : ''}">
              <div class="flex items-center gap-2 overflow-hidden flex-1">
                <input type="checkbox" ${t.completed ? 'checked' : ''} onchange="toggleTaskState('${t.id}')" class="w-3.5 h-3.5 accent-amber-400 cursor-pointer flex-shrink-0">
                <div class="flex flex-col truncate">
                  <span class="text-xs ${t.completed ? 'line-through text-white/40' : 'text-white font-medium'} truncate">${t.title}</span>
                  ${dueFormatted ? `<span class="text-[8px] text-amber-300/80">📅 ${dueFormatted}</span>` : ''}
                </div>
              </div>
              <button onclick="toggleTaskImportance('${t.id}')" class="text-xs text-amber-300 px-1 hover:scale-110 transition-all" title="Unstar to remove from Home">⭐</button>
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
    awardActivityCoins(baseCoins, task.is_important ? 'Starred Task Completed ⭐' : 'Task Completed');
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

        <!-- Top Left Corner: Mode Toggle (✏️ / ✍️) -->
        <button type="button" onclick="toggleNoteDrawMode('${note.id}', event)" class="note-corner-btn-left" title="${isDrawMode ? 'Switch to Typing' : 'Switch to Drawing'}">
          <span class="${isDrawMode ? 'text-purple-950 font-bold scale-110' : 'text-black/60'}">${isDrawMode ? '✏️' : '✍️'}</span>
        </button>

        <!-- Top Right Corner: Delete ✕ (Triggers Custom In-App Modal) -->
        <button type="button" onclick="openDeleteNoteModal('${note.id}', event)" class="note-corner-btn-right" title="Delete Sticky Note">
          ✕
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
function debounceUpdateNoteText(id, text) {
  const currentOwner = googleAccount || userName || 'Guest';
  const target = allData.find(d => d.id === id);
  if (target) {
    target.content = text;
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

async function loadGeminiChatHistory() {
  const stream = document.getElementById('gemini-agent-chat-stream');
  const userBadge = document.getElementById('gemini-user-email-text');
  const currentOwner = googleAccount || userName || 'Guest';
  if (userBadge) {
    const userLabel = googleAccountName || userName || 'Guest (Offline)';
    userBadge.textContent = googleAccount ? userLabel : 'Guest (Offline)';
    userBadge.title = googleAccount ? `Connected: ${googleAccount}` : 'Guest Mode';
  }

  try {
    const res = await fetch(`/api/gemini/history?username=${encodeURIComponent(currentOwner)}`);
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
          <div class="w-7 h-7 rounded-full bg-gradient-to-tr from-blue-500 via-indigo-500 to-pink-500 flex items-center justify-center text-white text-xs font-bold shrink-0 shadow-md">✦</div>
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
        <span>⚡ Action:</span>
        <span class="truncate">Added Task: <b>"${escapeHtml(act.title)}"</b> (${act.folder || 'General'})</span>
      </div>
    `;
  } else if (act.type === 'create_note') {
    return `
      <div class="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-amber-500/20 border border-amber-500/30 text-amber-200 text-[11px] font-semibold">
        <span>📌 Action:</span>
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
        <span>🎧 Action:</span>
        <span>Updated focus soundscape</span>
      </div>
    `;
  } else if (act.type === 'change_theme') {
    return `
      <div class="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-indigo-500/20 border border-indigo-500/30 text-indigo-200 text-[11px] font-semibold">
        <span>🎨 Action:</span>
        <span>Changed theme to ${escapeHtml(act.theme)}</span>
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
      <div class="w-7 h-7 rounded-full bg-gradient-to-tr from-blue-500 via-indigo-500 to-pink-500 flex items-center justify-center text-white text-xs font-bold shrink-0 shadow-md animate-pulse">✦</div>
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
    const res = await fetch('/api/gemini/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: text,
        username: currentOwner,
        api_key: savedApiKey
      })
    });

    const data = await res.json();
    const thinkEl = document.getElementById(thinkingId);
    if (thinkEl) thinkEl.remove();

    if (data.status === 'success') {
      const responseText = data.text || '';
      const actions = data.actions || [];

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
      content: `⚠️ Error executing request: ${err.message}. Please check connection.`,
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

  console.log('⚡ Gemini Agent Executing Action:', action);

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
      content: action.text || '',
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
  else if (action.type === 'play_youtube' || action.type === 'play_song') {
    const songUrl = action.url || '';
    const query = action.query || action.song || action.title || '';
    playCuratedOrSearchedYouTube(songUrl || query);
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

// ===== CURATED & DYNAMIC YOUTUBE MUSIC SEARCH PLAYER =====
function playCuratedOrSearchedYouTube(queryOrUrl) {
  if (!queryOrUrl) return;
  let raw = queryOrUrl.trim();
  let url = raw;

  const lower = raw.toLowerCase();
  const curatedStreams = {
    'lofi': 'https://www.youtube.com/watch?v=jfKfPfyJRdk',
    'rain': 'https://www.youtube.com/watch?v=mPZkdNFkNps',
    'piano': 'https://www.youtube.com/watch?v=4xDzrJKXOOY',
    'mozart': 'https://www.youtube.com/watch?v=Rb0UmrCXxVA',
    'beethoven': 'https://www.youtube.com/watch?v=W-fFHeTX70Q',
    'chopin': 'https://www.youtube.com/watch?v=wygy721nzRc',
    'classical': 'https://www.youtube.com/watch?v=jgpJVI3tDbY',
    'synthwave': 'https://www.youtube.com/watch?v=4xDzrJKXOOY',
    'chill': 'https://www.youtube.com/watch?v=jfKfPfyJRdk',
    'jazz': 'https://www.youtube.com/watch?v=Dx5qFachd3A',
    'nature': 'https://www.youtube.com/watch?v=eKFTSSKCzWA',
    'interstellar': 'https://www.youtube.com/watch?v=UDVtMYqUAyw',
    'hans zimmer': 'https://www.youtube.com/watch?v=UDVtMYqUAyw',
    'lofi girl': 'https://www.youtube.com/watch?v=jfKfPfyJRdk',
    'study beats': 'https://www.youtube.com/watch?v=jfKfPfyJRdk',
    'coffee': 'https://www.youtube.com/watch?v=5qap5aO4i9A'
  };

  for (const [key, streamUrl] of Object.entries(curatedStreams)) {
    if (lower.includes(key)) {
      url = streamUrl;
      break;
    }
  }

  if (!url.startsWith('http') && !url.includes('youtu')) {
    url = `https://www.youtube.com/results?search_query=${encodeURIComponent(raw)}`;
  }

  const ytInput = document.getElementById('yt-song-input');
  if (ytInput) ytInput.value = url;

  // Open YouTube player drawer in Home tab so it is immediately visible
  const drawer = document.getElementById('yt-drawer-content');
  const icon = document.getElementById('yt-drawer-icon');
  if (drawer && drawer.classList.contains('hidden')) {
    drawer.classList.remove('hidden');
    if (icon) icon.textContent = '▲';
  }

  isYTPlaying = false;
  toggleYouTubePlayback();
  showInAppNotification(`🎵 Loading on YouTube: ${raw}`);
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
  const currentOwner = googleAccount || userName || 'Guest';
  closeClearGeminiModal();
  try {
    await fetch(`/api/gemini/history?username=${encodeURIComponent(currentOwner)}`, { method: 'DELETE' });
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
  if (coinsEl) coinsEl.textContent = `🪙 ${currentCoins}`;
  if (headerCoins) headerCoins.textContent = `${currentCoins}`;
  if (multBadge) multBadge.textContent = `${mult.toFixed(1)}x Growth`;

  // 100+ Dynamic Tree Stage and Progress Bar Calculation
  const stageInfo = getTreeStageInfo(lifetimeCoins);

  const stageEl = document.getElementById('stat-tree-stage');
  const xpLabelEl = document.getElementById('stat-tree-xp-label');
  const pctEl = document.getElementById('stat-tree-pct');
  const iconEl = document.getElementById('stat-tree-icon');
  const barEl = document.getElementById('stat-tree-progress-bar');

  const stageIcons = ['🌱', '🌿', '🌳', '🌸', '🍃', '🌟', '✨', '👑'];
  const curIcon = stageIcons[Math.min(stageIcons.length - 1, Math.floor(stageInfo.stageNumber / 10))];

  if (stageEl) stageEl.textContent = stageInfo.stageName;
  if (xpLabelEl) xpLabelEl.textContent = `${lifetimeCoins} / ${stageInfo.stageNextXP} Lifetime Coins XP`;
  if (pctEl) pctEl.textContent = `${stageInfo.progressPct}%`;
  if (iconEl) iconEl.textContent = curIcon;
  if (barEl) barEl.style.width = `${stageInfo.progressPct}%`;

  renderSanctuaryTree();
  syncUserStatsToServer();
}

let statsSyncDebounceTimer = null;
function syncUserStatsToServer() {
  clearTimeout(statsSyncDebounceTimer);
  statsSyncDebounceTimer = setTimeout(() => {
    const owner = googleAccount || userName || 'Guest';
    const lifetimeCoins = getLifetimeCoins();
    const currentCoins = getUserCoinsBalance();
    const sessions = allData.filter(d => d.type === 'focus_session');
    const mins = sessions.reduce((sum, s) => sum + (s.minutes || 0), 0);
    const tasks = allData.filter(d => d.type === 'task');
    const completedTasks = tasks.filter(t => t.completed).length;

    fetch(`${API_BASE}/user/stats`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: owner,
        coins: currentCoins,
        lifetime_xp: lifetimeCoins,
        focus_mins: mins,
        tasks_done: completedTasks,
        streak: 1,
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
      badge.textContent = 'Active 🎵';
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
    if (icon) icon.textContent = '▲';
  } else {
    drawer.classList.add('hidden');
    if (icon) icon.textContent = '▼';
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
          if (ytCurrentPlaylistId && ytPlayer.nextVideo) {
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
    if (icon) icon.textContent = '⏹';
    if (btn) btn.className = 'bg-red-500 hover:bg-red-400 text-white font-black w-8 h-7 rounded-lg flex items-center justify-center text-xs shadow transition-all';
  } else {
    if (icon) icon.textContent = '▶';
    if (btn) btn.className = 'bg-amber-400 hover:bg-amber-300 text-slate-950 font-black w-8 h-7 rounded-lg flex items-center justify-center text-xs shadow transition-all';
  }
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
      <span class="truncate font-medium">🎵 ${item.title}</span>
      <span class="text-[8px] text-amber-300 font-bold ml-1 group-hover:scale-110 transition-transform">▶</span>
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

      awardActivityCoins(minsEarned * baseCoinRate, `Focus Session Completed (${minsEarned}m)${isSunlight ? ' ⚡ Sunlight 2x' : ''}`);
      
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
    saveBtn.textContent = 'Saved! ✓';
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
        awardActivityCoins(200, '🌟 Cosmic Theme Key & Google Link Bonus');
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
  showInAppNotification('👋 Disconnected Google Account. Returned to Guest Mode.');
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
    showInAppNotification('🔒 Sign in with Google to unlock all 8 fluid gradient themes + get 200 Free Coins!');
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
    showInAppNotification(`✨ +${actualAmount} 🪙 earned (${activityName})!`);
  }
  checkStageMilestoneBonus();
}

function deductActivityCoins(baseAmount, reason) {
  const curBonus = parseInt(localStorage.getItem('hdsfd_lifetime_bonus_xp') || '0', 10);
  localStorage.setItem('hdsfd_lifetime_bonus_xp', String(Math.max(0, curBonus - baseAmount)));
  updateStatsOverview();
  if (reason) {
    showInAppNotification(`🔻 -${baseAmount} 🪙 (${reason})`);
  }
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
    showInAppNotification('🎊 CONGRATULATIONS! You reached Stage 100 and unlocked the 10,000 🪙 World Tree Blessing!');
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
    showInAppNotification(`🌸 Drifting Blossom Petals harvested +${earned} 🪙 passive income!`);
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
    showInAppNotification(`⚠️ Not enough coins! You need ${cost} 🪙 (Have: ${currentCoins} 🪙).`);
    return;
  }

  const currentSpent = parseInt(localStorage.getItem('hdsfd_spent_coins') || '0', 10);
  localStorage.setItem('hdsfd_spent_coins', String(currentSpent + cost));
  localStorage.setItem('hdsfd_dew_tier', String(currentTier + 1));

  updateStatsOverview();
  updateShopCardsUI();
  renderSanctuaryTree();
  showInAppNotification(`💧 Upgraded Fertile Spring Dew to Tier ${currentTier + 1}! Growth multiplier increased by +10%.`);
}

// 2. Sunlight Essence (2x Focus/Zen for 1 Session)
function buySunlightEssence() {
  const currentCoins = getUserCoinsBalance();
  const cost = 100;

  if (currentCoins < cost) {
    showInAppNotification(`⚠️ Not enough coins! You need ${cost} 🪙 (Have: ${currentCoins} 🪙).`);
    return;
  }

  if (isSunlightEssenceActive()) {
    showInAppNotification(`⚡ Sunlight Essence is already active! Complete your next focus session to consume it.`);
    return;
  }

  const currentSpent = parseInt(localStorage.getItem('hdsfd_spent_coins') || '0', 10);
  localStorage.setItem('hdsfd_spent_coins', String(currentSpent + cost));
  localStorage.setItem('hdsfd_sunlight_active', 'true');

  const aura = document.getElementById('timer-sunlight-aura');
  if (aura) aura.classList.remove('hidden');

  updateStatsOverview();
  updateShopCardsUI();
  showInAppNotification(`⚡ Sunlight Essence activated! Your next focus session will earn 2x Coins with a radiant timer aura.`);
}

// 3. Glowing Vines (1.5x Growth - 1 Day)
function buyGlowingVines() {
  const currentCoins = getUserCoinsBalance();
  const currentTier = parseInt(localStorage.getItem('hdsfd_vines_tier') || '1', 10);
  const cost = 150 + ((currentTier - 1) * 50);

  if (currentCoins < cost) {
    showInAppNotification(`⚠️ Not enough coins! You need ${cost} 🪙 (Have: ${currentCoins} 🪙).`);
    return;
  }

  const currentSpent = parseInt(localStorage.getItem('hdsfd_spent_coins') || '0', 10);
  localStorage.setItem('hdsfd_spent_coins', String(currentSpent + cost));
  localStorage.setItem('hdsfd_vines_expiry', String(Date.now() + (24 * 3600 * 1000)));
  localStorage.setItem('hdsfd_vines_tier', String(currentTier + 1));

  updateStatsOverview();
  updateShopCardsUI();
  renderSanctuaryTree();
  showInAppNotification(`🌿 Enchanted tree with Glowing Vines for 24 Hours! (Growth x${(1.0 + currentTier * 0.5).toFixed(1)})`);
}

// 4. Blossom Petals (1.5x Coins + 10 🪙/hr passive - 1 Day)
function buyBlossomPetals() {
  const currentCoins = getUserCoinsBalance();
  const cost = 200;

  if (currentCoins < cost) {
    showInAppNotification(`⚠️ Not enough coins! You need ${cost} 🪙 (Have: ${currentCoins} 🪙).`);
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
  showInAppNotification(`🌸 Drifting Blossom Petals active for 24 Hours! (1.5x Coins + 10🪙/hr Passive Harvest).`);
}

// 5. Starlight Aura (2x Coins & 2x Growth - 1 Week)
function buyStarlightAura() {
  const currentCoins = getUserCoinsBalance();
  const cost = 500;

  if (currentCoins < cost) {
    showInAppNotification(`⚠️ Not enough coins! You need ${cost} 🪙 (Have: ${currentCoins} 🪙).`);
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
  showInAppNotification(`🌟 Starlight Cosmic Aura active for 1 Whole Week! (2x Coins & 2x Tree Growth).`);
}

// 6. Streak Shield (2 Days Protection)
function buyStreakShield() {
  const currentCoins = getUserCoinsBalance();
  const cost = 250;

  if (currentCoins < cost) {
    showInAppNotification(`⚠️ Not enough coins! You need ${cost} 🪙 (Have: ${currentCoins} 🪙).`);
    return;
  }

  const currentSpent = parseInt(localStorage.getItem('hdsfd_spent_coins') || '0', 10);
  localStorage.setItem('hdsfd_spent_coins', String(currentSpent + cost));
  localStorage.setItem('hdsfd_freeze_expiry', String(Date.now() + (2 * 24 * 3600 * 1000)));
  localStorage.setItem('hdsfd_tree_vitality', '100');

  updateStatsOverview();
  updateShopCardsUI();
  showInAppNotification(`🧊 Streak Freeze Shield activated! Protects daily streak & tree vitality for 48 Hours.`);
}

// 7. Cosmic Theme Key Action
function handleThemeKeyAction() {
  if (googleAccount) {
    showInAppNotification('🎨 All premium fluid themes are already unlocked with your connected Google account!');
  } else {
    connectGoogleAccount();
  }
}

// 8. YouTube Subscription Verification Flow (Zen Master Crown)
let ytSubTimer = null;
function openYouTubeSubFlow() {
  if (localStorage.getItem('hdsfd_has_crown') === 'true') {
    showInAppNotification('👑 Zen Master Crown is already unlocked and active on your profile!');
    return;
  }
  const modal = document.getElementById('yt-sub-modal');
  const verifyBtn = document.getElementById('yt-verify-btn');
  if (verifyBtn) {
    verifyBtn.disabled = true;
    verifyBtn.className = 'w-full bg-white/10 text-white/40 border border-white/10 font-bold py-2 px-4 rounded-xl text-xs transition-all cursor-not-allowed';
    verifyBtn.textContent = 'Verify & Claim Reward (+1000 🪙)';
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
      verifyBtn.textContent = 'Claim Reward (+1,000 🪙 & Crown) ✓';
    }
  }, 1000);
}

function verifyYouTubeSubscription() {
  const localUpgrades = JSON.parse(localStorage.getItem('hdsfd_upgrades') || '[]');
  if (localStorage.getItem('hdsfd_has_crown') === 'true' || localUpgrades.includes('crown_claimed')) {
    showInAppNotification('👑 Zen Master Crown has already been claimed on your account!');
    closeYouTubeSubModal();
    return;
  }

  if (!ytChannelLinkClicked) {
    showInAppNotification('⚠️ Please click "Subscribe on YouTube" to open @HyperHrishiHD channel first!');
    return;
  }

  localStorage.setItem('hdsfd_has_crown', 'true');
  if (!localUpgrades.includes('crown_claimed')) {
    localUpgrades.push('crown_claimed');
    localStorage.setItem('hdsfd_upgrades', JSON.stringify(localUpgrades));
  }
  awardActivityCoins(1000, '👑 Zen Master YouTube Crown');
  syncUserStatsToServer();

  closeYouTubeSubModal();
  initializeUserSession();
  updateStatsOverview();
  updateShopCardsUI();
  showInAppNotification('👑 Zen Master Crown unlocked! +1,000 Coins added to your sanctuary balance.');
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
  if (dewBtn) dewBtn.textContent = `Buy (${dewCost} 🪙)`;

  // 2. Sunlight
  const sunlightBtn = document.getElementById('buy-sunlight-btn');
  if (sunlightBtn) {
    if (isSunlightEssenceActive()) {
      sunlightBtn.textContent = 'Active (1 Session)';
      sunlightBtn.className = 'mt-2.5 bg-amber-500/40 text-amber-200 border border-amber-400 px-2.5 py-1.5 rounded-lg text-[10px] font-bold cursor-default';
    } else {
      sunlightBtn.textContent = 'Buy (100 🪙)';
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
      vinesBtn.textContent = `Buy (${vinesCost} 🪙)`;
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
      petalsBtn.textContent = 'Buy (200 🪙)';
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
      starlightBtn.textContent = 'Buy (500 🪙)';
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
      freezeBtn.textContent = 'Buy (250 🪙)';
      freezeBtn.className = 'mt-2.5 bg-cyan-500/20 text-cyan-200 border border-cyan-500/30 px-2.5 py-1.5 rounded-lg text-[10px] font-bold hover:bg-cyan-500/30 active:scale-95 transition-all';
    }
  }

  // 7. Theme Key
  const themeBtn = document.getElementById('buy-theme-btn');
  if (themeBtn) {
    if (googleAccount) {
      themeBtn.textContent = 'Unlocked ✓ (+200 🪙 Claimed)';
      themeBtn.className = 'mt-2.5 bg-purple-500/40 text-purple-200 border border-purple-400 px-2.5 py-1.5 rounded-lg text-[10px] font-bold cursor-default opacity-80';
      themeBtn.disabled = true;
    } else {
      themeBtn.textContent = 'Sign in (+200 🪙)';
      themeBtn.className = 'mt-2.5 bg-purple-500/20 text-purple-200 border border-purple-500/30 px-2.5 py-1.5 rounded-lg text-[10px] font-bold hover:bg-purple-500/30 active:scale-95 transition-all';
      themeBtn.disabled = false;
    }
  }

  // 8. Crown
  const crownBtn = document.getElementById('buy-crown-btn');
  if (crownBtn) {
    const localUpgrades = JSON.parse(localStorage.getItem('hdsfd_upgrades') || '[]');
    if (localStorage.getItem('hdsfd_has_crown') === 'true' || localUpgrades.includes('crown_claimed')) {
      crownBtn.textContent = 'Crown Unlocked 👑 (+1000 🪙 Claimed)';
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
    showInAppNotification('⚠️ Please enter an exam name and date.');
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
      title: `🎯 EXAM: ${title}`,
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
  showInAppNotification(`🎯 Exam added: ${title}! Task folder created.`);
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
    awardActivityCoins(exam.reward || 250, `Exam Completed: ${exam.title} 🎯`);
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
              ${isCompleted ? '✓' : ''}
            </button>
            <h4 class="text-xs font-bold ${isCompleted ? 'line-through text-white/50' : 'text-white'}">${escapeHtml(ex.title)}</h4>
            <span class="text-[9px] font-black bg-amber-500/20 text-amber-300 border border-amber-500/30 px-1.5 py-0.5 rounded">+${ex.reward || 250} 🪙</span>
          </div>
          <div class="flex items-center gap-2.5 text-[10px] text-white/60">
            <span class="text-rose-300 font-semibold">📅 ${dateFormatted} • ${timeFormatted}</span>
            ${ex.location ? `<span>📍 ${escapeHtml(ex.location)}</span>` : ''}
          </div>
        </div>

        <div class="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
          <button onclick="openAddExamModal('${ex.id}')" class="w-6 h-6 rounded bg-white/5 hover:bg-white/15 text-white/70 flex items-center justify-center text-xs" title="Edit Exam">✏️</button>
          <button onclick="deleteExamEntry('${ex.id}')" class="w-6 h-6 rounded bg-red-500/10 hover:bg-red-500/30 text-red-300 flex items-center justify-center text-xs" title="Delete Exam">🗑️</button>
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

// Google First-Time 200 Coin Bonus & Auto-Sync
function handleGoogleFirstTimeReward() {
  if (googleAccount && !localStorage.getItem('hdsfd_google_signin_bonus_claimed')) {
    localStorage.setItem('hdsfd_google_signin_bonus_claimed', 'true');
    const curBonus = parseInt(localStorage.getItem('hdsfd_lifetime_bonus_xp') || '0', 10);
    localStorage.setItem('hdsfd_lifetime_bonus_xp', String(curBonus + 200));
    showInAppNotification('🎉 Welcome! Claimed +200 Free Coins for pairing your Google Account.');
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
  refreshIcons();

  // Passive income & decay checker interval (every 10 minutes)
  setInterval(() => {
    processBlossomPassiveIncome();
    checkTreeDecayLoop();
  }, 10 * 60 * 1000);
});

