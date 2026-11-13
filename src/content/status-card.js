// status-card.js — shows Kura's state for a series on the site's own series page, in the site's
// own visual language: typography, colours and surface are read from the page rather than imposed,
// so the panel looks like it belongs there instead of being pasted on top.
(() => {
  if (window.__kuraStatus) return;
  window.__kuraStatus = true;

  const SERIES_PAGE = [
    /^\/manga\/[^/]+\/?$/i,      // atsu.moe, mangadot.net
    /^\/series\/[^/]+\/?$/i,     // weebcentral, stonescape
    /^\/comic\/[^/]+\/?$/i,
  ];
  const isSeriesPage = () => SERIES_PAGE.some((re) => re.test(location.pathname))
    && !/\/(chapter|chapters|read)\b/i.test(location.pathname);
  if (!isSeriesPage()) return;

  const send = (msg) => chrome.runtime.sendMessage(msg);
  document.documentElement.dataset.kuraStatus = chrome.runtime.getManifest().version;
  const norm = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  function seriesTitle() {
    const og = document.querySelector('meta[property="og:title"]')?.content;
    const h1 = document.querySelector('h1')?.textContent;
    const t = (h1 || og || document.title || '').split(/[|—–]/)[0].trim();
    return norm(t) ? t : '';
  }

  /** the synopsis paragraph block: the longest text block in main, and its container */
  function findSynopsisBlock() {
    const scope = document.querySelector('main') || document.body;
    const paras = [...scope.querySelectorAll('p')]
      .filter((p) => (p.textContent || '').trim().length > 80 && !p.closest('nav, footer, header'));
    if (!paras.length) return null;
    paras.sort((a, b) => (b.textContent || '').length - (a.textContent || '').length);
    const first = paras[0];
    // walk up while the ancestor holds nothing but synopsis-like content; stop at anything
    // structural (a heading, a list, a table) so the card never lands mid-page
    let block = first.parentElement;
    for (let i = 0; i < 2 && block?.parentElement; i++) {
      const parent = block.parentElement;
      const others = [...parent.children].filter((c) => c !== block);
      if (others.some((c) => /^(H1|H2|H3|UL|OL|TABLE|IMG|BUTTON)$/.test(c.tagName))) break;
      if (others.some((c) => (c.textContent || '').length > 400)) break;
      block = parent;
    }
    return block;
  }

  /** last resort: the end of the content column, before comments/chapters */
  function fallbackAnchor() {
    const main = document.querySelector('main, article, [role="main"]') || document.body;
    const kids = [...main.children].filter((c) => (c.textContent || '').trim().length > 60 || c.querySelector?.('p, img'));
    return kids.length ? kids[kids.length - 1] : main.lastElementChild;
  }

  /** pull the page's own design values so the panel matches it */
  function theme(block, para) {
    const content = (() => {
      // match the column the prose lives in, not the whole page container: a full-bleed band that
      // spans a sidebar gutter reads as an injected widget, and mangadot puts the text in a
      // narrower column than its wrapper
      const b = block.getBoundingClientRect();
      const p = (para || block).getBoundingClientRect();
      const width = Math.round(Math.min(p.width || b.width, b.width));
      const offset = Math.round(Math.max(0, p.left - b.left));
      return width > 240 ? { width, offset } : null;
    })();
    const accent = (() => {
      const a = block.closest('main, article, body')?.querySelector('a[href]');
      const c = a ? getComputedStyle(a).color : null;
      // only trust a real accent, not near-white/near-grey link colours
      return c && c !== 'rgba(0, 0, 0, 0)' ? c : null;
    })();
    // typography comes from the prose itself, surface from the nearest painted panel
    const cs = getComputedStyle(para || block);
    const panel = (() => {
      for (let e = block; e && e !== document.body; e = e.parentElement) {
        const c = getComputedStyle(e).backgroundColor;
        if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') return e;
      }
      return document.body;
    })();
    const bg = getComputedStyle(panel).backgroundColor || '#1d1e20';
    const panelCs = getComputedStyle(panel);
    const rgb = (bg.match(/\d+/g) || [0, 0, 0]).map(Number);
    const lift = rgb.length >= 3 ? `rgb(${rgb[0] + 7}, ${rgb[1] + 7}, ${rgb[2] + 8})` : '#242528';
    return {
      font: cs.fontFamily,
      size: cs.fontSize,
      height: cs.lineHeight,
      ink: cs.color,
      muted: (() => {
        const sib = block.querySelector('p');
        return sib ? getComputedStyle(sib).opacity : '0.72';
      })(),
      surface: rgb.length >= 3 ? lift : bg,
      width: content?.width || null,
      offset: content?.offset || 0,
      accent,
      line: 'rgba(255,255,255,0.10)',
      // take the panel's own corner radius so the block reads as one more panel on the page
      radius: panelCs.borderRadius && panelCs.borderRadius !== '0px' ? panelCs.borderRadius : '8px',
    };
  }

  // Where the panel belongs, per site: the section it sits above. Matching that section's box is
  // what makes it look like part of the page grid rather than a card nested under the synopsis.
  const ANCHORS = {
    // insert above the chapter tabs, but take the width of the chapter panel they open: on mangadot
    // the tab strip itself is narrow and the wrapper spans the whole page
    'mangadot.net': () => {
      const tabs = document.querySelector('main [role="tablist"], [role="tablist"]');
      if (!tabs) return null;
      const panel = document.querySelector('main [role="tabpanel"], [role="tabpanel"]');
      const geom = panel && panel.getBoundingClientRect().width > 400 ? panel : tabs;
      return { before: tabs, geom };
    },
  };

  const STATE_TEXT = { reading: 'Reading', completed: 'Completed', paused: 'Paused', dropped: 'Dropped', planning: 'Plan to read', rereading: 'Re-reading' };
  const TRACKERS = { anilist: 'AniList', mal: 'MyAnimeList', mangabaka: 'MangaBaka' };

  function el(tag, css, text) {
    const e = document.createElement(tag);
    if (css) Object.assign(e.style, css);
    if (text != null) e.textContent = text;
    return e;
  }

  function card(data, t) {
    const wrap = el('section', {
      margin: '20px 0', padding: '14px 16px', background: t.surface,
      width: t.width ? `${t.width}px` : undefined,
      maxWidth: t.width ? `${t.width}px` : undefined, marginLeft: t.offset ? `${t.offset}px` : undefined,
      boxSizing: 'border-box',
      border: `1px solid ${t.line}`, borderRadius: t.radius,
      fontFamily: t.font, fontSize: t.size, lineHeight: t.height, color: t.ink,
      display: 'flex', flexDirection: 'column', gap: '12px',
    });
    wrap.setAttribute('aria-label', 'Kura progress');

    const head = el('div', { display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap' });
    const mark = el('span', { fontWeight: '600', letterSpacing: '0.03em', fontSize: `calc(${t.size} * 0.82)`, opacity: '0.66' }, 'KURA');
    const state = el('span', { fontWeight: '600' }, STATE_TEXT[data.status] || 'Tracking');
    const prog = el('span', { opacity: '0.82', marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' },
      `Ch. ${data.chapter || 0}${data.total ? ' / ' + data.total : ''}${data.volume ? ` · Vol. ${data.volume}` : ''}`);
    head.append(mark, state, prog);
    wrap.append(head);

    // progress bar: replaces the site's own rating line, so neutral rather than a brand colour
    const track = el('div', { position: 'relative', height: '5px', borderRadius: '3px', background: 'rgba(255,255,255,0.18)', overflow: 'hidden', flex: '0 0 auto' });
    const pct = data.total ? Math.min(100, Math.round(((data.chapter || 0) / data.total) * 100)) : 0;
    track.append(el('i', { position: 'absolute', inset: '0 auto 0 0', width: `${pct}%`, background: t.accent || t.ink, opacity: '0.9', display: 'block' }));
    wrap.append(track);

    const rows = el('div', { display: 'flex', columnGap: '20px', rowGap: '8px', flexWrap: 'wrap', opacity: '0.85' });
    for (const [id, name] of Object.entries(TRACKERS)) {
      if (!data.links?.[id]) continue;
      const st = data.trackers?.[id] || {};
      const row = el('span', { display: 'inline-flex', alignItems: 'center', gap: '6px' });
      const dot = el('i', {
        width: '6px', height: '6px', borderRadius: '50%', display: 'inline-block',
        background: st.state === 'error' ? '#ef5f5f' : st.state === 'pending' ? '#e7b34a' : '#46d39a',
      });
      const detail = st.chapter != null && st.chapter !== data.chapter ? ` · Ch. ${st.chapter}` : '';
      row.append(dot, document.createTextNode(`${name}${detail}`));
      row.title = st.error ? `${name}: ${st.error}` : `${name}: ${st.state || 'unknown'}`;
      rows.append(row);
    }
    if (rows.childNodes.length) wrap.append(rows);
    return wrap;
  }

  let mounted = null;

  async function render() {
    const title = seriesTitle();
    if (!title) return;
    let data;
    try { data = await send({ type: 'status', title }); } catch { return; }
    if (!data?.found) { mounted?.remove(); mounted = null; return; }

    // synopsis block when the layout is readable, otherwise the end of the content column: a
    // panel that silently fails to appear is worse than one placed a little lower than ideal
    const host = location.hostname.replace(/^www\./, '');
    const anchor = ANCHORS[host]?.() || null;
    const block = findSynopsisBlock() || fallbackAnchor();
    if (!anchor && (!block || !block.parentElement)) return;

    const para = block?.querySelector?.('p') || block;
    // geometry from the section this panel introduces, so it lines up with the content grid
    // instead of inheriting either the prose column or the page container
    const themeTarget = anchor?.geom || block;
    const themed = theme(themeTarget, para || themeTarget);
    if (anchor?.geom && anchor.before?.parentElement) {
      const g = anchor.geom.getBoundingClientRect();
      const host_ = anchor.before.parentElement.getBoundingClientRect();
      themed.width = Math.round(g.width);
      themed.offset = Math.max(0, Math.round(g.left - host_.left));
    }
    const node = card(data, themed);
    if (mounted?.isConnected) mounted.replaceWith(node);
    else if (anchor?.before?.parentElement) anchor.before.insertAdjacentElement('beforebegin', node);
    else block.insertAdjacentElement('afterend', node);
    mounted = node;
  }

  let last = '';
  function tick() {
    const key = location.pathname + '|' + seriesTitle();
    if (key === last) return;
    last = key;
    if (isSeriesPage()) render();
  }

  const start = () => {
    tick();
    // SPAs render late and swap the whole tree on navigation
    setTimeout(tick, 1200);
    setTimeout(tick, 3000);
    new MutationObserver(() => {
      if (mounted && !mounted.isConnected) tick();
    }).observe(document.documentElement, { subtree: true, childList: true });
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
