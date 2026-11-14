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
  // never let a missing API kill the panel (older stubs, restricted contexts)
  try { document.documentElement.dataset.kuraStatus = chrome.runtime.getManifest().version; } catch { /* version is cosmetic */ }
  const norm = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  // reader sites put their own name in an <h1> too — stonescape renders "STONESCAPE" above the
  // series heading — so a naive `document.querySelector('h1')` reported the brand as the series
  // and the lookup matched nothing.
  const BRAND = /^(stones?scape|mangadot|weeb ?central|atsu(?:\.moe)?|kura)\b/i;
  // A brand also appears as a fragment, and the whole name is the trap when the logo is split up:
  // stonescape's logo is an h1 holding sibling spans "STONE" + "SCAPE", so the first text leaf named
  // a series "STONE" and every lookup missed. A logo is a link home, and a brand fragment is a
  // prefix of its own hostname, so both checks are structural rather than a keyword list.
  const HOST_LABEL = location.hostname.replace(/^www\./, '').split('.')[0].replace(/[^a-z0-9]/gi, '').toLowerCase();
  const isBrand = (t) => {
    if (!t) return false;
    if (BRAND.test(t)) return true;
    const key = norm(t).replace(/\s+/g, '');
    return key.length >= 4 && HOST_LABEL.length >= 4 && HOST_LABEL.startsWith(key);
  };
  const isLogoHeading = (h) => !!h.closest('a[href="/"]');
  const stripTail = (t) => String(t || '').split(/[|—–]/)[0].replace(/[\s\-–—·]+$/, '').trim();

  /**
   * A heading's own text. Series headings habitually carry the native/alternate titles in child
   * spans ("I Only Want to Beat You" + "Oroji Neonreul Igigo Sipeo 오로지 너를 이기고 싶어"), and
   * textContent glues them into one string that matches nothing.
   */
  function headingText(h) {
    // the first text-bearing leaf: mangadot nests the title and its alt titles as sibling spans
    // inside one wrapper, so neither textContent nor the first child is the series name alone
    const walker = document.createTreeWalker(h, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const t = stripTail(node.nodeValue || '');
      if (t.length >= 3) return t;
    }
    return stripTail(h.textContent);
  }

  /** the page's series heading: the first non-brand heading in the content column */
  function seriesHeading() {
    const heads = [...document.querySelectorAll('h1, h2')]
      .filter((h) => !h.closest('nav, footer, [role="navigation"]') && !isLogoHeading(h))
      .map((h) => ({ h, t: headingText(h) }))
      .filter(({ t }) => t.length >= 3 && !isBrand(t));
    return (heads.find((c) => c.h.closest('main, article, [role="main"]')) || heads[0])?.h || null;
  }

  function seriesTitle() {
    const og = document.querySelector('meta[property="og:title"]')?.content;
    const heading = seriesHeading();
    const candidates = [heading ? headingText(heading) : null, og, document.title]
      .map(stripTail)
      .filter((t) => t && !isBrand(t));
    return candidates[0] || '';
  }

  /** the card holding the series heading and its description: where the panel belongs */
  function findSynopsisBlock() {
    const heading = seriesHeading();
    const paras = [...document.querySelectorAll('p')]
      .filter((p) => (p.textContent || '').trim().length > 60 && !p.closest('nav, footer'));
    if (!paras.length) return null;

    let target = null;
    if (heading) {
      // the description that follows the heading: skip the one-line author/status meta row
      const after = paras.filter((p) => heading.compareDocumentPosition(p) & Node.DOCUMENT_POSITION_FOLLOWING);
      target = after.find((p) => (p.textContent || '').trim().length > 100) || after[0] || null;
    }
    target ||= paras.sort((a, b) => (b.textContent || '').length - (a.textContent || '').length)[0];

    // climb to the card that holds both the heading and its description, stopping before the
    // page's own layout containers so the panel never lands at the bottom of the article
    let block = target;
    for (let i = 0; i < 6 && block.parentElement; i++) {
      const parent = block.parentElement;
      if (!parent || /^(MAIN|BODY|HTML|ARTICLE)$/.test(parent.tagName)) break;
      block = parent;
      // stop at the card that holds both the title and its description (the hero card), not at the
      // title's own wrapper, or the panel lands between the heading and the synopsis
      if (heading && block.contains(heading) && block.contains(target)) break;
    }
    // A "card" that swallows the whole page (atsu's info column also holds the chapter list) would
    // drop the panel thousands of pixels down; the synopsis paragraph itself is the honest anchor.
    const bh = block.getBoundingClientRect().height;
    const ph = target.getBoundingClientRect().height;
    if (bh > Math.max(ph * 3, ph + 240)) block = target;
    return block;
  }

  /**
   * The chapter list section: every reader site has one, and it is exactly where the reader's eye
   * goes next. Placing the panel immediately above it keeps it out of the hero (which varies wildly
   * per site) and directly under the description.
   */
  function chaptersLandmark() {
    const label = /^(chapter list|chapters?|episodes?)\b/i;
    const hits = [...document.querySelectorAll('h1, h2, h3, h4, [role="tab"], button, a')]
      .filter((e) => label.test((e.textContent || '').trim()) && !e.closest('nav, footer'));
    // A label alone is not a landmark: "Chapters" also appears in sidebars and detail tables, and
    // inserting the panel there wedges it into a 250px rail and breaks the page's layout.
    const minWidth = Math.max(320, Math.min(window.innerWidth * 0.45, 700));
    for (const hit of hits) {
      let el = hit;
      for (let i = 0; i < 4 && el.parentElement && !/^(MAIN|BODY|ARTICLE|HTML)$/.test(el.parentElement.tagName); i++) {
        el = el.parentElement;
        const r = el.getBoundingClientRect();
        if (r.width >= minWidth && r.height > 80) return el;
      }
    }
    return null;
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

    // Contrast is a rule, not a sample: reader sites include light themes (stonescape is pale
    // lavender), where lifting the surface and keeping the page's ink produced invisible text.
    const rgb = (c) => (String(c).match(/\d+(?:\.\d+)?/g) || []).slice(0, 3).map(Number);
    const relLum = ([r, g, b]) => {
      const f = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const contrast = (a, b) => {
      const [hi, lo] = [relLum(a), relLum(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };
    const bgRgb = rgb(bg);
    const light = bgRgb.length === 3 ? relLum(bgRgb) > 0.5 : false;
    const surfaceRgb = bgRgb.length === 3
      ? bgRgb.map((v) => (light ? Math.max(0, v - 8) : Math.min(255, v + 7)))
      : [36, 37, 40];
    let inkRgb = rgb(cs.color);
    if (inkRgb.length < 3 || contrast(inkRgb, surfaceRgb) < 4.5) inkRgb = light ? [17, 17, 20] : [245, 245, 247];
    const inkCss = `rgb(${inkRgb.join(', ')})`;

    return {
      font: cs.fontFamily,
      size: cs.fontSize,
      height: cs.lineHeight,
      ink: inkCss,
      muted: `rgba(${inkRgb.join(', ')}, 0.74)`,
      surface: `rgb(${surfaceRgb.join(', ')})`,
      width: content?.width || null,
      offset: content?.offset || 0,
      accent,
      line: `rgba(${inkRgb.join(', ')}, 0.14)`,
      // take the panel's own corner radius so the block reads as one more panel on the page
      radius: panelCs.borderRadius && panelCs.borderRadius !== '0px' ? panelCs.borderRadius : '8px',
    };
  }

  // Where the panel belongs, per site: the section it sits above. Matching that section's box is
  // what makes it look like part of the page grid rather than a card nested under the synopsis.
  const ANCHORS = {
    // insert above the chapter tabs, but take the width of the chapter panel they open: on mangadot
    // the tab strip itself is narrow and the wrapper spans the whole page
    // atsu.moe lists chapters thousands of pixels below the synopsis, so the panel belongs under
    // the synopsis there; an empty rule means "use the series card, do not use the chapter list"
    'atsu.moe': () => null,
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
      margin: '16px 0 12px', padding: '14px 16px', background: t.surface,
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
    track.append(el('i', { position: 'absolute', inset: '0 auto 0 0', borderRadius: '999px', width: `${pct}%`, background: t.accent || t.ink, opacity: '0.9', display: 'block' }));
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
  const note = (msg, data) => Promise.resolve(send({ type: 'note', kind: 'panel', msg, data })).catch(() => {});

  const CARD = 'section[aria-label="Kura progress"]';
  let rendering = false;

  /** Exactly one card may exist. Sites move and clone nodes, and a superseded render must never
   *  survive next to the current one, so every mount ends by removing everything but its own node. */
  const purge = (keep) => {
    for (const el of document.querySelectorAll(CARD)) if (el !== keep) el.remove();
  };

  // single flight: render() awaits the worker and a frame, and a second entry in that window used to
  // insert a second card that nothing ever removed
  async function render() {
    if (rendering) return;
    rendering = true;
    try { await renderNow(); } finally { rendering = false; }
  }

  async function renderNow() {
    const title = seriesTitle();
    if (!title) { purge(mounted); await note('no series title on this page'); return; }
    let data;
    try {
      // the worker sleeps often: one retry, and never fail silently
      data = await send({ type: 'status', title }).catch(() => send({ type: 'status', title }));
    } catch (e) {
      await note(`status lookup failed: ${e.message}`, { title });
      return;
    }
    if (!data?.found) { mounted?.remove(); mounted = null; await note(`not in the library: "${title}"`, { title }); return; }

    // synopsis block when the layout is readable, otherwise the end of the content column: a
    // panel that silently fails to appear is worse than one placed a little lower than ideal
    const host = location.hostname.replace(/^www\./, '');
    const hasSiteRule = Object.prototype.hasOwnProperty.call(ANCHORS, host);
    const anchor = hasSiteRule ? (ANCHORS[host]() || null) : (() => {
      const list = chaptersLandmark();
      return list ? { before: list, geom: list } : null;
    })();
    const block = findSynopsisBlock() || fallbackAnchor();
    if (!anchor && (!block || !block.parentElement)) { await note('no place to insert the panel', { title }); return; }

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
    const geomEl = anchor?.geom || anchor?.before;
    const tooNarrow = geomEl && geomEl.getBoundingClientRect().width < Math.max(320, window.innerWidth * 0.3);

    // Candidate positions, best first. Every one is checked for a real, visible box before it is
    // accepted: reader sites are SPAs that re-render, and a node can be "inserted" into a container
    // that is zero-height, hidden, or about to be replaced.
    const content = document.querySelector('main, article, [role="main"]') || document.body;
    // The synopsis is where the reader is looking; the chapter list is only a fallback, because on
    // atsu.moe it sits thousands of pixels further down. A spot that would place the panel above
    // the synopsis (over the title) is rejected.
    const heading = seriesHeading();
    const afterSynopsis = (n) => !heading || !heading.isConnected
      || (heading.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    const spots = [];
    if (anchor?.before?.parentElement && !tooNarrow) {
      spots.push({ how: 'above the chapter list', run: () => anchor.before.insertAdjacentElement('beforebegin', node) });
    }
    if (block?.parentElement) {
      spots.push({ how: 'after the series card', run: () => block.insertAdjacentElement('afterend', node) });
    }
    spots.push({ how: 'end of the content column', run: () => content.append(node) });

    let placed = null;
    for (const spot of spots) {
      try { spot.run(); } catch { continue; }
      await nextFrame();
      const box = node.getBoundingClientRect();
      if (node.isConnected && box.height > 8 && box.width > 120 && afterSynopsis(node)) { placed = spot; break; }
    }

    purge(node);
    mounted = node;
    if (!placed) { await note(`panel could not be placed visibly on "${title}"`, { title }); return; }
    if (lastNoteFor !== title) { lastNoteFor = title; await note(`panel shown for "${title}" (${placed.how})`, { title }); }
  }

  let last = '';
  let lastNoteFor = '';
  let remounts = 0;
  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

  function tick() {
    const key = location.pathname + '|' + seriesTitle();
    if (key === last) return;
    last = key;
    if (isSeriesPage()) render();
  }

  /**
   * Chrome's reader sites are SPAs: they mount, then re-render and drop anything they did not
   * create. Watching for the panel's own removal and putting it back is what MAL-Sync does too;
   * re-running tick() here was useless because the URL had not changed.
   *
   * "Removed" and "hidden" are both failure: a site that sets display:none on our node leaves it
   * connected and zero-height, so connectivity alone must never count as placed.
   *
   * There is no "put it back" path. Re-inserting a node a past render captured is what produced
   * duplicate panels: the closure held an old node while `mounted` had moved on, so the old card
   * came back next to the new one. A fresh render is the only repair.
   */
  const visible = (n) => !!n && n.isConnected && n.getBoundingClientRect().height > 8;

  function keepMounted() {
    if (rendering) return;
    purge(mounted);                       // stray cards from an older render never outlive a tick
    if (!mounted) return;
    if (visible(mounted)) { remounts = 0; return; }
    if (remounts >= 12) {
      if (remounts === 12) { remounts++; note('the site keeps removing the panel; leaving it off'); }
      return;
    }
    remounts++;
    render();
  }

  const start = () => {
    tick();
    // SPAs render late and swap the whole tree on navigation
    setTimeout(tick, 1200);
    setTimeout(tick, 3000);
    new MutationObserver(() => keepMounted())
      .observe(document.documentElement, { subtree: true, childList: true });
    // a site that hides the panel without removing it never fires a mutation on our node
    setInterval(keepMounted, 1500);
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
