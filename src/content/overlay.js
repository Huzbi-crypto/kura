// overlay.js — reader pill for manga sites.
// Classic script (no imports). Reads the open series/chapter, reports progress to the service
// worker, shows how far through the chapter you are, and reports when you reach the end.
// It stays out of the way: it fades out after a few seconds and leaves a small dot in the corner.
(() => {
  if (window.__kuraLoaded) return;
  window.__kuraLoaded = true;

  const HOST_RULES = {
    'weebcentral.com': {
      chapter: () => (document.title.match(/(?:chapter|ch\.?)\s*([0-9]+(?:\.[0-9]+)?)/i) || [])[1],
    },
    'atsu.moe': {},
    'stonescape.xyz': {},
    'mangadot.com': {},
  };

  const cleanTitle = (t) =>
    String(t || '')
      .replace(/\s*[|·—-]\s*(read|chapter|ch\.?|vol\.?|manga|online|free).*$/i, '')
      .replace(/\s*(chapter|ch\.?)\s*[0-9]+(\.[0-9]+)?/gi, '')
      .replace(/\s*[-–—:|]\s*$/g, '')
      .trim();

  function detect() {
    const host = location.hostname.replace(/^www\./, '');
    const rule = HOST_RULES[host] || {};
    const og = (p) => document.querySelector(`meta[property="${p}"], meta[name="${p}"]`)?.content || '';
    const title = cleanTitle(og('og:title') || document.title || '');
    let chapter = rule.chapter ? rule.chapter() : null;
    if (!chapter) {
      const m = (document.title + ' ' + location.pathname + ' ' + location.href).match(
        /(?:chapter|chap|ch\.?|episode|vol(?:ume)?\.?\s*[0-9]+\s*chapter)\s*[-_/ ]?\s*([0-9]+(?:\.[0-9]+)?)/i,
      );
      chapter = m?.[1] || (location.pathname.match(/\/chapters?\/[^/]*?(\d+(?:\.\d+)?)/) || [])[1] || null;
    }
    if (!chapter) {
      const m = location.pathname.match(/(?:^|\/)(\d+(?:\.\d+)?)\/?$/);
      chapter = m?.[1] || null;
    }
    return { title, chapter: chapter ? Number(chapter) : null, host, url: location.href };
  }

  /** the element that actually scrolls: readers often put the pages in an inner container */
  function scroller() {
    const de = document.scrollingElement || document.documentElement;
    if (de && de.scrollHeight - de.clientHeight > 80) return de;
    let best = null;
    for (const el of document.querySelectorAll('div, main, section')) {
      const cs = getComputedStyle(el);
      if (!/(auto|scroll)/.test(cs.overflowY)) continue;
      const span = el.scrollHeight - el.clientHeight;
      if (span > 120 && (!best || span > best.scrollHeight - best.clientHeight)) best = el;
    }
    return best || de;
  }

  function readPercent() {
    const el = scroller();
    if (!el) return 0;
    const max = el.scrollHeight - el.clientHeight;
    if (max <= 8) return 100; // a one-screen chapter is read as soon as you see it
    return Math.min(100, Math.max(0, Math.round((el.scrollTop / max) * 100)));
  }

  const CSS = `
    :host { all: initial; }
    .wrap {
      position: fixed; right: 18px; bottom: 18px; z-index: 2147483000;
      display: flex; align-items: center; gap: 8px; pointer-events: none;
    }
    .pill {
      display: flex; align-items: center; gap: 10px; padding: 8px 10px 8px 14px;
      font: 500 13px/1.2 system-ui, -apple-system, "Segoe UI", sans-serif;
      color: #f4f4f5; background: #15151a; border: 1px solid #2a2a33;
      border-radius: 999px; box-shadow: 0 10px 34px rgba(0,0,0,.45);
      pointer-events: auto; opacity: 1; transform: none;
      transition: opacity .22s ease, transform .22s ease;
    }
    .wrap.idle .pill { opacity: 0; transform: translateY(6px); pointer-events: none; }
    .pill b { font-weight: 650; color: #fff; }
    .read { color: #a9a9b6; font-variant-numeric: tabular-nums; }
    .read.done { color: #46d39a; }
    .track { position: relative; width: 44px; height: 3px; border-radius: 2px; background: #2c2c36; overflow: hidden; }
    .track i { position: absolute; inset: 0 auto 0 0; width: 0; background: #f0526b; transition: width .18s ease; }
    .track.done i { background: #46d39a; }
    .dots { display: flex; gap: 4px; }
    .dot { width: 7px; height: 7px; border-radius: 50%; background: #3a3a45; }
    .dot.synced { background: #46d39a; }
    .dot.pending { background: #e7b34a; }
    .dot.error { background: #ef5f5f; }
    button {
      all: unset; cursor: pointer; padding: 5px 11px; border-radius: 999px;
      background: #f4f4f5; color: #111; font: 650 12px/1 system-ui, sans-serif;
    }
    button:active { transform: scale(.96); }
    input.ch {
      all: unset; width: 44px; padding: 5px 8px; border-radius: 8px; background: #23232c;
      color: #f4f4f5; font: 500 12px/1 system-ui, sans-serif; text-align: center;
    }
    input.ch::-webkit-outer-spin-button, input.ch::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
    /* all: unset beats the UA rule for [hidden], so hide it explicitly */
    input.ch[hidden] { display: none; }
    .toast { color: #9a9aa5; font-weight: 400; max-width: 170px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .handle {
      width: 22px; height: 22px; border-radius: 50%; background: #15151a; border: 1px solid #2a2a33;
      color: #8b8b98; font: 700 10px/20px system-ui, sans-serif; text-align: center;
      pointer-events: auto; cursor: pointer; opacity: 0; transition: opacity .22s ease;
    }
    .wrap.idle .handle { opacity: .55; }
    .handle:hover { opacity: 1; }
  `;

  const host = document.createElement('div');
  const root = host.attachShadow({ mode: 'open' });
  const styleEl = document.createElement('style');
  styleEl.textContent = CSS;
  const wrap = document.createElement('div');
  wrap.className = 'wrap';
  wrap.innerHTML = `
    <div class="pill">
      <span class="label">…</span>
      <span class="read">0%</span>
      <div class="track"><i></i></div>
      <div class="dots"></div>
      <input class="ch" type="number" min="0" step="0.1" placeholder="ch" hidden />
      <button title="Mark chapter read">+1</button>
      <span class="toast"></span>
    </div>
    <div class="handle" title="Kura — click to show">K</div>`;
  root.append(styleEl, wrap);

  const pill = wrap.querySelector('.pill');
  const dots = wrap.querySelector('.dots');
  const label = wrap.querySelector('.label');
  const readEl = wrap.querySelector('.read');
  const track = wrap.querySelector('.track');
  const bar = track.querySelector('i');
  const toast = wrap.querySelector('.toast');
  const chInput = wrap.querySelector('input.ch');
  const action = wrap.querySelector('button');

  let current = null;
  let hideTimer = null;
  let completedFor = null;
  let lastPct = -1;
  const IDLE_AFTER = 6000;

  function reveal(ms = IDLE_AFTER) {
    wrap.classList.remove('idle');
    clearTimeout(hideTimer);
    if (ms > 0) hideTimer = setTimeout(() => wrap.classList.add('idle'), ms);
  }
  function hide() { wrap.classList.add('idle'); clearTimeout(hideTimer); }

  wrap.querySelector('.handle').addEventListener('mouseenter', () => reveal(9000));
  wrap.querySelector('.handle').addEventListener('click', () => reveal(9000));
  pill.addEventListener('mouseenter', () => clearTimeout(hideTimer));
  pill.addEventListener('mouseleave', () => reveal(IDLE_AFTER / 2));

  function manualMode(on) {
    chInput.hidden = !on;
    action.textContent = on ? 'Set' : '+1';
  }

  function paintDots(trackers = {}) {
    dots.innerHTML = '';
    for (const [id, t] of Object.entries(trackers)) {
      const d = document.createElement('i');
      d.className = 'dot ' + (t.state || '');
      d.title = `${id}: ${t.state || 'unknown'}${t.error ? ' — ' + t.error : ''}`;
      dots.append(d);
    }
  }

  function paintProgress(pct, done) {
    readEl.textContent = done ? '✓ read' : `${pct}%`;
    readEl.className = 'read' + (done ? ' done' : '');
    bar.style.width = `${done ? 100 : pct}%`;
    track.className = 'track' + (done ? ' done' : '');
  }

  const send = (type, payload) => chrome.runtime.sendMessage({ type, ...payload });
  const flash = (msg, ms = 2200) => { toast.textContent = msg; setTimeout(() => { if (toast.textContent === msg) toast.textContent = ''; }, ms); };

  async function report(force = false) {
    const d = detect();
    if (!d.title) {
      // tell the worker anyway: "Kura ran here but could not read the page" is the log line
      // that explains a silent no-op on a reader layout we do not parse yet
      send('reading', { ...d, title: '', chapter: null });
      hide();
      return;
    }
    const key = d.title + '|' + (d.chapter ?? '?');
    if (!force && current === key) return;
    current = key;
    completedFor = null;

    if (!d.chapter) {
      // no chapter in the URL or title: ask once instead of doing nothing
      label.innerHTML = `<b>${d.title}</b> · ch ?`;
      manualMode(true);
      reveal(12000);
      dots.innerHTML = '';
      paintProgress(0, false);
      return;
    }
    manualMode(false);
    label.innerHTML = `<b>${d.title}</b> · ch ${d.chapter}`;
    paintProgress(readPercent(), false);
    reveal();
    const r = await send('reading', d);
    if (r?.ok) paintDots(r.trackers || {});
    else if (r?.reason) flash(String(r.reason).slice(0, 40));
  }

  /** scroll position inside the chapter, plus the "finished this chapter" signal */
  let raf = 0;
  function onScroll() {
    if (raf) return;
    raf = requestAnimationFrame(async () => {
      raf = 0;
      const d = detect();
      if (!d.title || !d.chapter) return;
      const pct = readPercent();
      if (pct !== lastPct) {
        lastPct = pct;
        paintProgress(pct, completedFor === d.chapter);
      }
      if (pct >= 95 && completedFor !== d.chapter) {
        completedFor = d.chapter;
        paintProgress(100, true);
        const r = await send('reading', { ...d, completed: true });
        if (r?.ok) { paintDots(r.trackers || {}); reveal(4000); }
        else flash(r?.reason ? String(r.reason).slice(0, 40) : 'not saved');
      }
    });
  }

  action.addEventListener('click', async () => {
    const d = detect();
    if (!d.title) return;
    const target = d.chapter ? d.chapter + 1 : Number(chInput.value);
    if (!Number.isFinite(target) || target <= 0) { chInput.focus(); return; }
    const r = await send('reading', { ...d, chapter: target, completed: true });
    if (r?.ok) {
      current = `${d.title}|${target}`;
      label.innerHTML = `<b>${d.title}</b> · ch ${target}`;
      manualMode(false);
      paintDots(r.trackers || {});
      paintProgress(0, false);
      flash('saved');
      reveal();
    } else {
      flash(r?.reason ? String(r.reason).slice(0, 40) : 'not saved');
      reveal();
    }
  });

  function mount() {
    if (!document.body) return;
    document.body.append(host);
    window.addEventListener('scroll', onScroll, { passive: true, capture: true });
    document.addEventListener('scroll', onScroll, { passive: true, capture: true });
    report(true);
    reveal();
  }

  let lastHref = location.href;
  new MutationObserver(() => {
    if (location.href !== lastHref) { lastHref = location.href; current = null; lastPct = -1; report(true); }
    else if (current === null) report();
  }).observe(document.documentElement, { subtree: true, childList: true });
  window.addEventListener('popstate', () => { current = null; report(true); });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
