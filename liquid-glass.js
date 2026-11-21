// ===== QUICKLIQUID SURFACES =====
// Turns the existing .glass / .glass-card / .glass-panel / .glass-modal / .music-shell
// surfaces into real refractive liquid-glass layers using the vendored quickLiquid
// engine (MIT, /vendor/quick-liquid). The page keeps working exactly as before when
// the engine is unavailable or the browser cannot do backdrop refraction.
//
// How it stays layout-safe: the surface's utility classes are split in two — geometry,
// skin and state classes stay on the surface, while layout/typography/spacing classes
// move onto the engine's content wrapper. That keeps every flex/grid/padding rule
// identical while giving the engine its own stacking layer above the lens.
(async () => {
  let LiquidGlassEngine;
  try {
    ({ LiquidGlassEngine } = await import('./vendor/quick-liquid/index.mjs'));
  } catch (error) {
    console.warn('[liquid] engine unavailable, keeping CSS glass', error);
    return;
  }

  const GLASS_CLASSES = new Set(['glass', 'glass-card', 'glass-panel', 'glass-modal', 'music-shell']);
  const KEEP_PREFIXES = [
    'w-', 'h-', 'min-w-', 'min-h-', 'max-w-', 'max-h-', 'flex-1', 'flex-none', 'flex-shrink',
    'flex-grow', 'shrink', 'grow', 'order-', 'col-', 'row-', 'z-', 'inset-', 'top-', 'left-',
    'right-', 'bottom-', 'm-', 'mx-', 'my-', 'mt-', 'mb-', 'ml-', 'mr-',
    'rounded', 'border', 'shadow', 'ring-', 'outline-', 'bg-', 'from-', 'via-', 'to-',
    'overflow-', 'absolute', 'fixed', 'sticky', 'relative', 'hidden', 'block', 'inline-block',
    'opacity-', 'pointer-events-', 'cursor-', 'group', 'peer',
    'hover:', 'focus:', 'active:', 'disabled:', 'dark:'
  ];
  const KEEP_EXACT = new Set(['flex-1', 'flex-none', 'hidden', 'block', 'inline-block', 'relative', 'absolute', 'fixed', 'sticky', 'group', 'peer', 'rounded']);

  const engines = new Map();
  const lowPower = (navigator.hardwareConcurrency || 8) <= 4;
  const smallScreen = window.matchMedia('(max-width: 720px)').matches;

  function shouldKeep(cls) {
    const base = cls.replace(/^(?:[a-z0-9-]+:)+/, '');
    if (KEEP_EXACT.has(base)) return true;
    return KEEP_PREFIXES.some(prefix => prefix.endsWith(':') ? cls.includes(prefix) || cls === prefix.slice(0, -1) : base.startsWith(prefix));
  }

  function splitClasses(el) {
    const kept = [];
    const moved = [];
    Array.from(el.classList).forEach(cls => {
      if (GLASS_CLASSES.has(cls)) return;
      (shouldKeep(cls) ? kept : moved).push(cls);
    });
    return { kept, moved };
  }

  function roleOf(el) {
    if (el.classList.contains('glass-modal')) return 'ultra';
    if (el.classList.contains('glass-panel')) return 'thick';
    if (el.classList.contains('music-shell')) return 'thick';
    return 'regular';
  }

  function enhance(el) {
    if (!(el instanceof HTMLElement)) return;
    if (el.dataset.ql === 'off' || engines.has(el)) return;
    if (!el.isConnected || !el.offsetWidth || !el.offsetHeight) return;

    const width = el.offsetWidth;
    const height = el.offsetHeight;
    const area = width * height;
    // Panels, cards and modals get the full treatment; small chips keep the CSS glass
    // so a long task list does not spawn one engine per row.
    const primary = el.classList.contains('glass-card') || el.classList.contains('glass-panel')
      || el.classList.contains('glass-modal') || el.classList.contains('music-shell');
    if (!primary && (width < 200 || height < 36)) return;

    const { moved } = splitClasses(el);
    const content = document.createElement('div');
    content.className = ['ql-content', 'hdsfd-ql-content', ...moved].join(' ');
    content.style.cssText = 'position:relative;z-index:10;box-sizing:border-box;width:100%;height:100%;min-width:0;min-height:0;';
    while (el.firstChild) content.appendChild(el.firstChild);
    el.classList.remove(...moved);
    el.classList.add('hdsfd-liquid');
    el.appendChild(content);

    const computed = getComputedStyle(el);
    const radius = parseFloat(computed.borderTopLeftRadius) || 24;
    const tiny = area < 9000;
    const light = lowPower || smallScreen || tiny;

    try {
      const engine = new LiquidGlassEngine(el, {
        material: roleOf(el),
        appearance: 'dark',
        borderRadius: Math.round(radius),
        blur: light ? 6 : 10,
        saturation: 1.6,
        tint: '214, 226, 255',
        tintOpacity: 0.055,
        refractionStrength: light ? 0 : Math.min(20, Math.max(9, Math.round(width / 45))),
        bezelWidth: Math.min(34, Math.max(18, Math.round(radius))),
        chromaticAberration: 0.2,
        elevation: 0.55,
        quality: smallScreen ? 'low' : (light ? 'medium' : 'high'),
        refractionMode: 'auto',
        dynamicLighting: false,
        respectPreferences: true
      });
      engines.set(el, engine);
      el.dataset.qlEngine = 'quick-liquid';
    } catch (error) {
      // Put the surface back the way it was so the app never depends on the effect.
      el.classList.remove('hdsfd-liquid');
      content.classList.remove('ql-content', 'hdsfd-ql-content');
      el.classList.add(...moved);
      while (content.firstChild) el.insertBefore(content.firstChild, content);
      content.remove();
      el.dataset.qlFailed = '1';
      console.warn('[liquid] surface skipped', error);
    }
  }

  const observer = ('IntersectionObserver' in window)
    ? new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        observer.unobserve(entry.target);
        enhance(entry.target);
      });
    }, { rootMargin: '160px 0px' })
    : null;

  function inViewport(el) {
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0
      && rect.bottom > -160 && rect.top < window.innerHeight + 160
      && rect.right > 0 && rect.left < window.innerWidth;
  }

  function watch(el) {
    if (!(el instanceof HTMLElement) || engines.has(el) || el.dataset.qlFailed === '1') return;
    // On-screen surfaces are upgraded straight away (a background tab never fires
    // IntersectionObserver); hidden tabs wait until they are actually shown.
    if (!observer || inViewport(el)) {
      if (el.offsetWidth && el.offsetHeight) enhance(el);
      else if (observer) observer.observe(el);
    } else {
      observer.observe(el);
    }
  }

  function scan(root) {
    const scope = root && root.querySelectorAll ? root : document;
    if (scope.nodeType === 1 && scope.matches('.glass, .glass-card, .glass-panel, .glass-modal, .music-shell')) watch(scope);
    scope.querySelectorAll('.glass, .glass-card, .glass-panel, .glass-modal, .music-shell').forEach(watch);
  }

  function collectGarbage() {
    engines.forEach((engine, el) => {
      if (el.isConnected) return;
      try { engine.destroy(); } catch (error) { /* already gone */ }
      engines.delete(el);
    });
  }

  let scanTimer = null;
  // Throttle, not debounce: the dashboard mutates constantly (clock, timers, music
  // position), so a debounce would never fire and new surfaces would stay plain.
  const reScan = () => {
    if (scanTimer !== null) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      collectGarbage();
      scan(document);
    }, 300);
  };

  scan(document);
  new MutationObserver(reScan).observe(document.body, { childList: true, subtree: true });
  // Tab switches only toggle classes, so watch those too: surfaces inside a hidden
  // tab are upgraded the moment that tab is shown.
  document.querySelectorAll('.tab-content').forEach(tab => {
    new MutationObserver(reScan).observe(tab, { attributes: true, attributeFilter: ['class'] });
  });
  window.addEventListener('resize', reScan, { passive: true });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) reScan(); });

  window.hdsfdLiquid = {
    engines,
    refresh: reScan,
    metrics: () => (window.__QUICK_LIQUID__ ? window.__QUICK_LIQUID__.metrics() : null)
  };
})();
