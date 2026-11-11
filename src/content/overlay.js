// overlay.js — content script for reader sites.
// Classic script (no imports). Detects the open series/chapter, shows a small pill, and reports
// progress to the service worker. Everything lives in a shadow root so site CSS cannot reach it.
(() => {
  if (window.__kuraLoaded) return;
  window.__kuraLoaded = true;

  const HOST_RULES = {
    'weebcentral.com': {
      // /chapters/<id>; the series title sits in the document title or the breadcrumb
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

  const style = `
    :host { all: initial; }
    .pill {
      position: fixed; right: 18px; bottom: 18px; z-index: 2147483000;
      display: flex; align-items: center; gap: 10px; padding: 9px 12px 9px 14px;
      font: 500 13px/1.2 system-ui, -apple-system, Segoe UI, sans-serif;
      color: #f4f4f5; background: #15151a; border: 1px solid #2a2a33;
      border-radius: 999px; box-shadow: 0 8px 30px rgba(0,0,0,.45); cursor: default;
      user-select: none;
    }
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
    input.ch {
      all: unset; width: 46px; padding: 5px 8px; border-radius: 8px; background: #23232c;
      color: #f4f4f5; font: 500 12px/1 system-ui, sans-serif; text-align: center;
    }
    input.ch::-webkit-outer-spin-button, input.ch::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
    button:active { transform: scale(.96); }
    .toast {
      margin-left: 4px; color: #9a9aa5; font-weight: 400; max-width: 220px;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
  `;

  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;inset:auto 0 0 auto;z-index:2147483000';
  const root = host.attachShadow({ mode: 'open' });
  const styleEl = document.createElement('style');
  styleEl.textContent = style;
  const pill = document.createElement('div');
  pill.className = 'pill';
  pill.innerHTML = `<span class="label">…</span><div class="dots"></div><input class="ch" type="number" min="0" step="0.1" placeholder="ch" hidden><button title="Mark chapter read">+1</button><span class="toast"></span>`;
  root.append(styleEl, pill);

  let current = null;
  const dots = pill.querySelector('.dots');
  const label = pill.querySelector('.label');
  const toast = pill.querySelector('.toast');
  const chInput = pill.querySelector('input.ch');
  const action = pill.querySelector('button');

  /** no chapter in the URL/title? ask once instead of failing silently */
  function manualMode(on) {
    chInput.hidden = !on;
    action.textContent = on ? 'Set' : '+1';
    if (on) chInput.focus();
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

  async function send(type, payload) {
    return chrome.runtime.sendMessage({ type, ...payload });
  }

  async function report(rescan = false) {
    const d = detect();
    if (!d.title) { pill.style.display = 'none'; return; }
    pill.style.display = '';
    if (!d.chapter) {
      label.innerHTML = `<b>${d.title}</b> · ch ?`;
      pill.classList.add('manual');
      manualMode(true);
      return;
    }
    manualMode(false);
    const key = d.title + '|' + d.chapter;
    if (!rescan && current === key) return;
    current = key;
    label.innerHTML = `<b>${d.title}</b> · ch ${d.chapter}`;
    const r = await send('reading', d);
    if (r?.ok) paintDots(r.trackers || {});
    else toast.textContent = r?.reason ? String(r.reason).slice(0, 40) : '';
  }

  action.addEventListener('click', async () => {
    const d = detect();
    if (!d.title) return;
    let target = d.chapter ? d.chapter + 1 : Number(chInput.value);
    if (!Number.isFinite(target) || target <= 0) { chInput.focus(); return; }
    const r = await send('reading', { ...d, chapter: target });
    if (r?.ok) {
      current = `${d.title}|${target}`;
      label.innerHTML = `<b>${d.title}</b> · ch ${target}`;
      manualMode(false);
      paintDots(r.trackers || {});
      toast.textContent = 'saved';
      setTimeout(() => (toast.textContent = ''), 1800);
    } else {
      toast.textContent = r?.reason ? String(r.reason).slice(0, 40) : 'not saved';
    }
  });

  function mount() {
    if (!document.body) return;
    document.body.append(host);
    report();
  }

  // SPAs change chapters without a reload
  let lastHref = location.href;
  new MutationObserver(() => {
    if (location.href !== lastHref) { lastHref = location.href; current = null; }
    report();
  }).observe(document.documentElement, { subtree: true, childList: true });
  window.addEventListener('popstate', () => { current = null; report(true); });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
