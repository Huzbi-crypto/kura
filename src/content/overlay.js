// overlay.js — reader pill for manga sites.
// Classic script (no imports). Reads the open series/chapter, reports progress to the service
// worker, and stays out of the way: it fades out after a few seconds and leaves a small dot in
// the corner that brings it back on hover.
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
    .toast { color: #9a9aa5; font-weight: 400; max-width: 190px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
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
  const toast = wrap.querySelector('.toast');
  const chInput = wrap.querySelector('input.ch');
  const action = wrap.querySelector('button');

  let current = null;
  let hideTimer = null;
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

  const send = (type, payload) => chrome.runtime.sendMessage({ type, ...payload });
  const flash = (msg, ms = 1800) => { toast.textContent = msg; setTimeout(() => { if (toast.textContent === msg) toast.textContent = ''; }, ms); };

  async function report(force = false) {
    const d = detect();
    if (!d.title) { hide(); return; }
    const key = d.title + '|' + (d.chapter ?? '?');
    if (!force && current === key) return;
    current = key;

    if (!d.chapter) {
      // no chapter in the URL or title: ask once instead of doing nothing
      label.innerHTML = `<b>${d.title}</b> · ch ?`;
      manualMode(true);
      reveal(12000);
      dots.innerHTML = '';
      return;
    }
    manualMode(false);
    label.innerHTML = `<b>${d.title}</b> · ch ${d.chapter}`;
    reveal();
    const r = await send('reading', d);
    if (r?.ok) paintDots(r.trackers || {});
    else if (r?.reason) flash(String(r.reason).slice(0, 40));
  }

  action.addEventListener('click', async () => {
    const d = detect();
    if (!d.title) return;
    const target = d.chapter ? d.chapter + 1 : Number(chInput.value);
    if (!Number.isFinite(target) || target <= 0) { chInput.focus(); return; }
    const r = await send('reading', { ...d, chapter: target });
    if (r?.ok) {
      current = `${d.title}|${target}`;
      label.innerHTML = `<b>${d.title}</b> · ch ${target}`;
      manualMode(false);
      paintDots(r.trackers || {});
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
    report(true);
    // first run: show itself, then get out of the way
    reveal();
  }

  let lastHref = location.href;
  new MutationObserver(() => {
    if (location.href !== lastHref) { lastHref = location.href; current = null; report(true); }
    else if (current === null) report();
  }).observe(document.documentElement, { subtree: true, childList: true });
  window.addEventListener('popstate', () => { current = null; report(true); });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
