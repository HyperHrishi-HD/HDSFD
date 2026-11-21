// ===== HDSFD UI EXTRAS =====
// 1. Home-screen music deck: scrubber + transport + volume for the same player
//    the full modal drives (works for the server audio path and the YouTube embed).
// 2. Shared plus button + orbit navigator: radial quick actions that only appear
//    on empty pages, plus a right-click orbit menu scoped to those empty panels.
(() => {
  'use strict';

  const icon = name => '<svg class="hdsfd-icon" aria-hidden="true"><use href="#i-' + name + '"></use></svg>';
  const fmt = seconds => {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    return Math.floor(total / 60) + ':' + String(total % 60).padStart(2, '0');
  };
  const on = (el, evt, fn, opts) => { if (el) el.addEventListener(evt, fn, opts); };

  // ---------------------------------------------------------------- music deck
  function buildDeck() {
    const mini = document.getElementById('music-mini');
    if (!mini || document.getElementById('hdsfd-home-deck')) return;

    const deck = document.createElement('div');
    deck.id = 'hdsfd-home-deck';
    deck.className = 'hdsfd-deck is-idle';
    deck.innerHTML = `
      <div class="hdsfd-scrub">
        <span class="hdsfd-time" id="hdsfd-mini-cur">0:00</span>
        <input id="hdsfd-mini-seek" class="hdsfd-range" type="range" min="0" max="1000" step="1" value="0"
               aria-label="Track position" style="--p:0%">
        <span class="hdsfd-time" id="hdsfd-mini-dur">0:00</span>
      </div>
      <div class="hdsfd-deck-row">
        <button type="button" class="hdsfd-deck-btn" data-deck="prev" title="Previous track" aria-label="Previous track">${icon('skip-back')}</button>
        <button type="button" class="hdsfd-deck-btn is-primary" data-deck="play" title="Play / Pause" aria-label="Play or pause">
          <span id="hdsfd-mini-play-icon">${icon('play')}</span>
        </button>
        <button type="button" class="hdsfd-deck-btn" data-deck="next" title="Next track" aria-label="Next track">${icon('skip-forward')}</button>
        <button type="button" class="hdsfd-deck-btn" data-deck="shuffle" title="Shuffle" aria-label="Shuffle">${icon('shuffle')}</button>
        <div class="hdsfd-deck-vol">
          <button type="button" class="hdsfd-deck-btn" data-deck="mute" title="Mute" aria-label="Mute">
            <span id="hdsfd-mini-vol-icon">${icon('volume-2')}</span>
          </button>
          <input id="hdsfd-mini-vol" class="hdsfd-range hdsfd-range-vol" type="range" min="0" max="100" step="1" value="70"
                 aria-label="Volume" style="--p:70%">
        </div>
        <button type="button" class="hdsfd-deck-btn" data-deck="open" title="Open full player" aria-label="Open full player">${icon('music')}</button>
      </div>`;
    mini.insertAdjacentElement('afterend', deck);

    const seek = deck.querySelector('#hdsfd-mini-seek');
    const vol = deck.querySelector('#hdsfd-mini-vol');
    let seeking = false;
    let muted = false;
    let restoreVolume = 70;

    const setFill = el => {
      const max = Number(el.max) || 100;
      const pct = (Number(el.value) / max) * 100;
      el.style.setProperty('--p', Math.min(100, Math.max(0, pct)).toFixed(2) + '%');
    };

    on(seek, 'pointerdown', () => { seeking = true; });
    on(seek, 'pointerup', () => { seeking = false; });
    on(seek, 'pointercancel', () => { seeking = false; });
    on(seek, 'input', () => {
      setFill(seek);
      if (typeof musicSeek === 'function') musicSeek((Number(seek.value) / 1000) * 100);
    });
    on(vol, 'input', () => {
      setFill(vol);
      muted = Number(vol.value) === 0;
      if (!muted) restoreVolume = Number(vol.value);
      if (typeof musicSetVolume === 'function') musicSetVolume(vol.value);
    });

    deck.addEventListener('click', event => {
      const btn = event.target.closest('[data-deck]');
      if (!btn) return;
      const action = btn.dataset.deck;
      if (action === 'play') typeof musicToggle === 'function' && musicToggle();
      else if (action === 'next') typeof musicNext === 'function' && musicNext();
      else if (action === 'prev') typeof musicPrev === 'function' && musicPrev();
      else if (action === 'open') typeof openMusicPlayer === 'function' && openMusicPlayer();
      else if (action === 'shuffle') {
        typeof musicToggleShuffle === 'function' && musicToggleShuffle();
        syncShuffle();
      } else if (action === 'mute') {
        if (muted) {
          muted = false;
          vol.value = String(restoreVolume || 70);
          setFill(vol);
          typeof musicSetVolume === 'function' && musicSetVolume(vol.value);
        } else {
          muted = true;
          restoreVolume = Number(vol.value) || 70;
          vol.value = '0';
          setFill(vol);
          typeof musicSetVolume === 'function' && musicSetVolume(0);
        }
      }
    });

    const syncShuffle = () => {
      const active = typeof musicState !== 'undefined' && !!musicState.shuffle;
      const btn = deck.querySelector('[data-deck="shuffle"]');
      if (btn) btn.classList.toggle('is-on', active);
    };

    const idle = () => typeof musicState !== 'undefined' ? !musicState.current : true;

    const tick = () => {
      const progress = readProgress();
      deck.classList.toggle('is-idle', idle());
      if (!seeking) {
        const pct = progress.duration > 0 ? (progress.current / progress.duration) * 1000 : 0;
        seek.value = String(Math.round(pct));
        setFill(seek);
      }
      const cur = deck.querySelector('#hdsfd-mini-cur');
      const dur = deck.querySelector('#hdsfd-mini-dur');
      if (cur) cur.textContent = fmt(progress.current);
      if (dur) dur.textContent = progress.duration > 0 ? fmt(progress.duration) : '--:--';
      const playIcon = deck.querySelector('#hdsfd-mini-play-icon');
      if (playIcon) {
        const wanted = progress.playing ? 'pause' : 'play';
        if (playIcon.dataset.state !== wanted) {
          playIcon.dataset.state = wanted;
          playIcon.innerHTML = icon(wanted);
        }
      }
      const volIcon = deck.querySelector('#hdsfd-mini-vol-icon');
      const effective = Number(vol.value) || 0;
      if (volIcon) {
        const wanted = effective === 0 ? 'volume-x' : (effective < 45 ? 'volume-1' : 'volume-2');
        if (volIcon.dataset.state !== wanted) {
          volIcon.dataset.state = wanted;
          volIcon.innerHTML = icon(wanted);
        }
      }
      if (document.activeElement !== vol) {
        const globalVolume = typeof musicState !== 'undefined' ? Math.round((musicState.volume || 0) * 100) : Number(vol.value);
        if (String(globalVolume) !== vol.value) {
          vol.value = String(globalVolume);
          setFill(vol);
        }
      }
      syncShuffle();
    };

    setFill(vol);
    setFill(seek);
    syncShuffle();
    tick();
    setInterval(tick, 420);
  }

  function readProgress() {
    const state = typeof musicState !== 'undefined' ? musicState : null;
    const audio = document.getElementById('music-audio');
    const yt = typeof ytPlayer !== 'undefined' ? ytPlayer : null;
    if (state && state.engine === 'youtube' && yt && typeof yt.getDuration === 'function') {
      return {
        current: (typeof yt.getCurrentTime === 'function' && yt.getCurrentTime()) || 0,
        duration: yt.getDuration() || 0,
        playing: typeof isYTPlaying !== 'undefined' ? !!isYTPlaying : false
      };
    }
    if (audio) {
      return {
        current: audio.currentTime || 0,
        duration: isFinite(audio.duration) ? audio.duration : 0,
        playing: !!audio.src && !audio.paused
      };
    }
    return { current: 0, duration: 0, playing: false };
  }

  // ---------------------------------------------------------------- plus buttons
  function buildPlusButtons() {
    document.querySelectorAll('.glass-card, .glass-panel').forEach(panel => {
      if (panel.querySelector(':scope > .hdsfd-plus-rail')) return;
      let target = null;
      if (panel.id === 'tasks-panel') {
        target = {
          title: 'New task',
          run: () => {
            const input = document.getElementById('gtask-title-input');
            if (input) {
              input.focus();
              input.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          }
        };
      } else if (panel.id === 'calendar-panel') {
        target = {
          title: 'New event',
          run: () => (typeof openCustomDateTimeModal === 'function' ? openCustomDateTimeModal('due') : null)
        };
      }
      if (!target) return;
      if (getComputedStyle(panel).position === 'static') panel.style.position = 'relative';
      const rail = document.createElement('div');
      rail.className = 'hdsfd-plus-rail';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'hdsfd-plus hdsfd-plus-floating';
      btn.title = target.title;
      btn.setAttribute('aria-label', target.title);
      btn.innerHTML = icon('plus');
      btn.addEventListener('click', event => { event.stopPropagation(); target.run(); });
      rail.appendChild(btn);
      panel.appendChild(rail);
    });
  }

  // ---------------------------------------------------------------- orbit navigator
  const ORBIT_ACTIONS = [
    {
      key: 'task', label: 'New task', glyph: 'list-todo',
      run: () => {
        if (typeof switchTab === 'function') switchTab('tasks-notes');
        setTimeout(() => {
          const input = document.getElementById('gtask-title-input');
          if (input) { input.focus(); input.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
        }, 180);
      }
    },
    {
      key: 'note', label: 'Sticky note', glyph: 'sticky-note',
      run: () => {
        if (typeof switchTab === 'function') switchTab('notes');
        setTimeout(() => (typeof addPhysicsPostIt === 'function' ? addPhysicsPostIt() : null), 220);
      }
    },
    {
      key: 'event', label: 'Calendar', glyph: 'calendar',
      run: () => {
        if (typeof switchTab === 'function') switchTab('tasks-notes');
        if (typeof switchTab2Subview === 'function') switchTab2Subview('calendar');
        setTimeout(() => (typeof openCustomDateTimeModal === 'function' ? openCustomDateTimeModal('due') : null), 200);
      }
    },
    {
      key: 'music', label: 'Music', glyph: 'music',
      run: () => (typeof openMusicPlayer === 'function' ? openMusicPlayer() : null)
    },
    {
      key: 'ai', label: 'Ask Gemini', glyph: 'bot',
      run: () => {
        if (typeof switchTab === 'function') switchTab('notes');
        setTimeout(() => {
          const input = document.getElementById('gemini-agent-input');
          if (input) { input.focus(); input.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
        }, 220);
      }
    }
  ];

  let orbit = null;
  let orbitOpen = false;
  let orbitMode = 'fixed';

  function buildOrbit() {
    if (orbit) return orbit;
    orbit = document.createElement('div');
    orbit.id = 'hdsfd-orbit';
    orbit.className = 'hdsfd-orbit hidden';
    orbit.dataset.mode = 'fixed';

    const fan = document.createElement('div');
    fan.className = 'hdsfd-orbit-fan';
    const radius = 104;
    ORBIT_ACTIONS.forEach((action, index) => {
      const angle = 180 - (index * (90 / Math.max(1, ORBIT_ACTIONS.length - 1)));
      const rad = (angle * Math.PI) / 180;
      const x = Math.cos(rad) * radius;
      const y = -Math.sin(rad) * radius;
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'hdsfd-orbit-item';
      item.dataset.action = action.key;
      item.style.setProperty('--x', x.toFixed(1) + 'px');
      item.style.setProperty('--y', y.toFixed(1) + 'px');
      item.style.setProperty('--d', (index * 35) + 'ms');
      item.title = action.label;
      item.innerHTML = '<span class="hdsfd-orbit-glyph">' + icon(action.glyph) + '</span><span class="hdsfd-orbit-label">' + action.label + '</span>';
      item.addEventListener('click', event => {
        event.stopPropagation();
        closeOrbit();
        action.run();
      });
      fan.appendChild(item);
    });

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'hdsfd-plus hdsfd-orbit-trigger';
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-label', 'Quick actions');
    trigger.innerHTML = icon('plus');
    trigger.addEventListener('click', event => {
      event.stopPropagation();
      orbitOpen ? closeOrbit() : openOrbit();
    });

    orbit.appendChild(fan);
    orbit.appendChild(trigger);
    document.body.appendChild(orbit);

    document.addEventListener('click', event => {
      if (!orbitOpen) return;
      if (orbit.contains(event.target)) return;
      closeOrbit();
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && orbitOpen) closeOrbit();
    });
    window.addEventListener('resize', () => { if (orbitMode === 'context') closeOrbit(); }, { passive: true });
    return orbit;
  }

  function openOrbit(point) {
    const el = buildOrbit();
    el.classList.remove('hidden');
    el.classList.add('is-open');
    el.querySelector('.hdsfd-orbit-trigger').setAttribute('aria-expanded', 'true');
    orbitOpen = true;
    if (point) {
      orbitMode = 'context';
      el.dataset.mode = 'context';
      el.style.left = Math.max(16, Math.min(point.x, window.innerWidth - 220)) + 'px';
      el.style.top = Math.max(16, Math.min(point.y, window.innerHeight - 220)) + 'px';
    } else {
      orbitMode = 'fixed';
      el.dataset.mode = 'fixed';
      el.style.left = '';
      el.style.top = '';
    }
  }

  function closeOrbit() {
    if (!orbit) return;
    orbit.classList.remove('is-open');
    orbit.classList.remove('is-context-open');
    orbit.querySelector('.hdsfd-orbit-trigger').setAttribute('aria-expanded', 'false');
    orbitOpen = false;
    broadcastVisibility();
  }

  function tabIsEmpty() {
    const active = document.querySelector('.tab-content.active');
    if (!active) return false;
    if (active.id === 'tab-tasks-notes') {
      const list = document.getElementById('gtasks-live-list');
      if (!list) return false;
      if (/loading tasks/i.test(list.textContent || '')) return false;
      return !list.querySelector('[data-task-id]');
    }
    if (active.id === 'tab-notes') {
      const arena = document.getElementById('notes-canvas-arena');
      if (!arena) return false;
      return !arena.querySelector('.phys-post-it');
    }
    return false;
  }

  function broadcastVisibility() {
    const el = buildOrbit();
    if (orbitOpen) return;
    const empty = tabIsEmpty();
    el.classList.toggle('hidden', !empty);
    if (!empty) {
      el.classList.remove('is-open');
      el.querySelector('.hdsfd-orbit-trigger').setAttribute('aria-expanded', 'false');
    }
  }

  function watchEmptyZones() {
    ['gtasks-live-list', 'notes-canvas-arena'].forEach(id => {
      const host = document.getElementById(id);
      if (!host) return;
      new MutationObserver(() => broadcastVisibility()).observe(host, { childList: true, subtree: true, characterData: true });
    });

    ['tasks-panel', 'notes-workspace-panel'].forEach(id => {
      const panel = document.getElementById(id);
      if (!panel) return;
      panel.addEventListener('contextmenu', event => {
        if (!tabIsEmpty()) return;
        if (event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
        event.preventDefault();
        openOrbit({ x: event.clientX, y: event.clientY });
      });
    });

    document.querySelectorAll('.nav-btn').forEach(btn => btn.addEventListener('click', () => setTimeout(broadcastVisibility, 260)));
    setInterval(broadcastVisibility, 900);
  }

  function boot() {
    buildDeck();
    buildPlusButtons();
    buildOrbit();
    broadcastVisibility();
    watchEmptyZones();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
