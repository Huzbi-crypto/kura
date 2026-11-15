// status-card.js — shows Kura's state for a series on the site's own series page, in the site's
// own visual language: typography, colours and surface are read from the page rather than imposed,
// so the panel looks like it belongs there instead of being pasted on top.
(() => {
  if (window.__kuraStatus) return;
  window.__kuraStatus = true;

  // Everything site-specific lives in src/sites/. This file owns the panel: title ladder, theme
  // sampling, card markup and mounting.
  const site = window.__kura.forHost(location.hostname);
  const SERIES_PAGE = site.seriesPage || [];
  const isSeriesPage = () => SERIES_PAGE.some((re) => re.test(location.pathname))
    && !(site.chapterPage && site.chapterPage.test(location.pathname));
  if (!isSeriesPage()) return;

  const send = (msg) => chrome.runtime.sendMessage(msg);
  // never let a missing API kill the panel (older stubs, restricted contexts)
  try { document.documentElement.dataset.kuraStatus = chrome.runtime.getManifest().version; } catch { /* version is cosmetic */ }

  // reader sites put their own name in an <h1> too — stonescape renders "STONESCAPE" above the
  // series heading — so a naive `document.querySelector('h1')` reported the brand as the series
  // and the lookup matched nothing.
  // The site's own name must never stand in for the series name. The rule is structural and lives in
  // the registry: a logo is a fragment of its own hostname (stonescape's is an h1 split into "STONE"
  // + "SCAPE"), so this file needs no brand list.
  const isBrand = (t) => window.__kura.isBrand(t);
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
    const candidates = [heading ? headingText(heading) : null, site.title ? site.title() : null, og, document.title]
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

  // Where the panel belongs is a site's own answer (src/sites/<site>.js). A definition that returns
  // null means "no landmark here, place it after the series card"; one with no placement function
  // gets the generic anchor: the chapter list every reader has.
  const siteAnchor = () => {
    if (typeof site.placement === 'function') return site.placement() || null;
    const list = siteList();
    return list ? { before: list, geom: list } : null;
  };

  /** the chapter list: the site's own answer first, the shared word-match second */
  function siteList() {
    if (typeof site.chapterList === 'function') {
      const own = site.chapterList();
      if (own) return own;
    }
    return chaptersLandmark();
  }

  const STATE_TEXT = { reading: 'Reading', completed: 'Completed', paused: 'Paused', dropped: 'Dropped', planning: 'Plan to read', rereading: 'Re-reading' };
  const TRACKERS = { anilist: 'AniList', mal: 'MyAnimeList', mangabaka: 'MangaBaka' };

  function el(tag, css, text) {
    const e = document.createElement(tag);
    if (css) Object.assign(e.style, css);
    if (text != null) e.textContent = text;
    return e;
  }

  function card(data, t) {
    // The section is a wrapper, not the painted box: the box keeps the surface and the radius, and a
    // rule below it closes the panel off so it reads as its own section rather than a heading for the
    // description that follows.
    const wrap = el('section', {
      margin: '16px 0 12px',
      width: t.width ? `${t.width}px` : undefined,
      maxWidth: t.width ? `${t.width}px` : undefined, marginLeft: t.offset ? `${t.offset}px` : undefined,
      boxSizing: 'border-box',
      fontFamily: t.font, fontSize: t.size, lineHeight: t.height, color: t.ink,
    });
    wrap.setAttribute('aria-label', 'Kura progress');

    const box = el('div', {
      padding: '14px 16px', background: t.surface,
      border: `1px solid ${t.line}`, borderRadius: t.radius,
      display: 'flex', flexDirection: 'column', gap: '12px',
    });

    const divider = el('div', {
      height: '1px', background: t.line, border: '0',
      marginTop: '18px', marginBottom: '2px',
    });
    divider.setAttribute('role', 'separator');

    const head = el('div', { display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap' });
    const mark = el('span', { fontWeight: '600', letterSpacing: '0.03em', fontSize: `calc(${t.size} * 0.82)`, opacity: '0.66' }, 'KURA');
    const state = el('span', { fontWeight: '600' }, STATE_TEXT[data.status] || 'Tracking');
    const prog = el('span', { opacity: '0.82', marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' },
      `Ch. ${data.chapter || 0}${data.total ? ' / ' + data.total : ''}${data.volume ? ` · Vol. ${data.volume}` : ''}`);
    head.append(mark, state, prog);
    box.append(head);

    // progress bar: replaces the site's own rating line, so neutral rather than a brand colour
    const track = el('div', { position: 'relative', height: '5px', borderRadius: '3px', background: 'rgba(255,255,255,0.18)', overflow: 'hidden', flex: '0 0 auto' });
    const pct = data.total ? Math.min(100, Math.round(((data.chapter || 0) / data.total) * 100)) : 0;
    track.append(el('i', { position: 'absolute', inset: '0 auto 0 0', borderRadius: '999px', width: `${pct}%`, background: t.accent || t.ink, opacity: '0.9', display: 'block' }));
    box.append(track);

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
    if (rows.childNodes.length) box.append(rows);
    wrap.append(box, divider);
    return wrap;
  }

  let mounted = null;
  const note = (msg, data) => Promise.resolve(send({ type: 'note', kind: 'panel', msg, data })).catch(() => {});

  const CARD = 'section[aria-label="Kura progress"]';
  // settle → render once → verify once → watch for real loss. Page activity must never re-render a
  // mounted card, so each timer has one job and a bound.
  const SETTLE_MS = 600;    // quiet the page must hold before the first render
  const VERIFY_MS = 800;    // the one post-mount geometry check
  const WATCH_MS = 3000;    // how long loss detection may take
  const MAX_TRIES = 5;      // failed mount attempts before the page is left alone
  const MAX_REPAIRS = 3;    // consecutive watchdog repairs before giving up
  let rendering = false;
  let rerun = false;
  let watchedTitle = '';    // the document title the card was mounted under
  let placedParent = null;  // where the card was inserted; the site moving it is a loss
  let path = '';            // the pathname this page's state belongs to
  let quiet = 0;            // the settle debounce
  let verifyAt = 0;         // the one-shot verification
  let verified = false;     // the verification has been spent
  let corrections = 0;      // the single correction it may make
  let tries = 0;            // failed mount attempts on this page
  let repairs = 0;          // consecutive watchdog repairs
  let removals = 0;         // times the site took the mounted card out of its place
  let gaveUp = false;       // the repair budget is spent for this page
  let lastNote = '';

  /** Exactly one card may exist. Sites move and clone nodes, and a superseded render must never
   *  survive next to the current one, so every mount ends by removing everything but its own node. */
  const purge = (keep) => {
    for (const el of document.querySelectorAll(CARD)) if (el !== keep) el.remove();
  };

  const clearPanel = () => { purge(null); mounted = null; };

  /** the page can settle many times before a card sticks: one log line per outcome, not per try */
  const noteOnce = async (msg, data) => {
    if (msg === lastNote) return;
    lastNote = msg;
    await note(msg, data);
  };

  // single flight, plus a queued re-run: a second request that is simply dropped is how a panel goes
  // missing when the page changes while a render is already in flight
  async function render() {
    if (rendering) { rerun = true; return; }
    rendering = true;
    try { await renderNow(); } finally {
      rendering = false;
      if (rerun) { rerun = false; setTimeout(settle, 0); }
    }
  }

  async function renderNow() {
    // a challenge page is not a series page, whatever the URL says
    if (window.__kura.isInterstitial()) { clearPanel(); await noteOnce('challenge page, not content'); return; }
    const title = seriesTitle();
    // a title can vanish between the settle and here (an SPA swap); nothing renders without one,
    // and settle() owns the log line for that case
    if (!title) { clearPanel(); return; }
    let data;
    try {
      // the worker sleeps often: one retry, and never fail silently
      data = await send({ type: 'status', title }).catch(() => send({ type: 'status', title }));
    } catch (e) {
      tries++;
      await noteOnce(`status lookup failed: ${e.message}`, { title });
      scheduleSettle();   // a quiet page produces no mutations of its own to retry on
      return;
    }
    if (!data?.found) { clearPanel(); await noteOnce(`not in the library: "${title}"`, { title }); return; }

    // synopsis block when the layout is readable, otherwise the end of the content column: a
    // panel that silently fails to appear is worse than one placed a little lower than ideal
    const anchor = siteAnchor();
    // a site may answer "where is the description" itself: the shared finder climbs to a container,
    // and on atsu that container also holds the first chapter rows
    const block = (typeof site.synopsis === 'function' && site.synopsis()) || findSynopsisBlock() || fallbackAnchor();
    if (!anchor && (!block || !block.parentElement)) {
      tries++;
      await noteOnce('no place to insert the panel', { title });
      scheduleSettle();
      return;
    }

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
      spots.push({ how: anchor.label || 'above the chapter list', run: () => anchor.before.insertAdjacentElement('beforebegin', node) });
    }
    if (block?.parentElement) {
      spots.push({ how: 'after the series card', run: () => block.insertAdjacentElement('afterend', node) });
    }
    // A card below the whole chapter list reads as broken, so the chapter list is tried before the
    // page end: when the description cannot be found at all, "above the chapters" is still coherent.
    const list = siteList();
    if (list?.parentElement) {
      spots.push({ how: 'above the chapter list (fallback)', run: () => list.insertAdjacentElement('beforebegin', node) });
    }
    spots.push({ how: 'end of the content column', run: () => content.append(node) });

    let placed = null;
    for (const spot of spots) {
      try { spot.run(); } catch { continue; }
      await nextFrame();
      const box = node.getBoundingClientRect();
      // A panel below the chapter list is never correct, and the one verification catches it via
      // misplaced(); the spot loop only needs a visible box that follows the series heading.
      if (node.isConnected && box.height > 8 && box.width > 120 && afterSynopsis(node)) { placed = spot; break; }
    }

    purge(node);
    if (!placed) {
      node.remove();
      mounted = null;
      tries++;
      await noteOnce(`panel could not be placed visibly on "${title}"`, { title });
      scheduleSettle();
      return;
    }
    mounted = node;
    watchedTitle = document.title;
    placedParent = node.parentElement;
    tries = 0;
    // the one verification per page-load; the correction it may make does not schedule another
    if (!verified) { verified = true; verifyAt = setTimeout(verifyOnce, VERIFY_MS); }
    await noteOnce(`panel shown for "${title}" (${placed.how})`, { title });
  }

  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  const visible = (n) => !!n && n.isConnected && n.getBoundingClientRect().height > 8;

  /** Below the end of the chapter list is wrong on any site; only the one verification asks this. */
  function misplaced() {
    if (!mounted || !mounted.isConnected) return false;
    const list = siteList();
    if (!list || !list.isConnected) return false;
    const box = list.getBoundingClientRect();
    if (box.height < 200) return false;    // not a real chapter list, no opinion
    // a card that starts below the end of the whole chapter list has landed at the page end. This does
    // not depend on finding the description: when it cannot be found the card still must not sink.
    return mounted.getBoundingClientRect().top > box.bottom - 8;
  }

  /**
   * The one post-mount check, VERIFY_MS after the card lands: a visible box, above the chapter list,
   * and — where the site declares it — right above its description. It runs once and may correct
   * once; a check that re-arms itself is the loop this lifecycle exists to remove.
   */
  function verifyOnce() {
    if (!mounted || !mounted.isConnected) return;   // gone is the watchdog's business
    if (corrections) return;
    const desc = site.expect === 'beforeSynopsis' && typeof site.synopsis === 'function' ? site.synopsis() : null;
    let beside = true;
    if (desc) {
      const box = mounted.getBoundingClientRect();
      const d = desc.getBoundingClientRect();
      const gap = d.top - box.bottom;
      // the panel ends at its divider, so a small negative gap is the rule sitting between the card
      // and the blurb — that is the intended look, not a misplacement
      beside = (mounted.compareDocumentPosition(desc) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
        && gap >= -40 && gap <= 140;
    }
    if (visible(mounted) && !misplaced() && beside) return;
    corrections = 1;
    render();
  }

  /**
   * The settle point: the only place that decides a page needs a card. Mutations, DOMContentLoaded
   * and load all funnel through the same debounce, so nothing renders while the page still moves —
   * reader sites re-render their tree for seconds after load, and that is what flickered the panel.
   */
  function settle() {
    if (mounted) return;                 // one card per page; the settling phase is over
    if (gaveUp) return;                  // the repair budget is spent for this page
    if (document.readyState === 'loading') return;   // DOMContentLoaded re-arms the debounce
    if (!isSeriesPage()) { clearPanel(); return; }
    if (window.__kura.isInterstitial()) { clearPanel(); noteOnce('challenge page, not content'); return; }
    if (!seriesTitle()) { clearPanel(); noteOnce('no series title on this page'); return; }
    if (tries >= MAX_TRIES) { noteOnce('the panel could not be placed on this page; leaving it off'); return; }
    render();
  }

  // every quiet-period path funnels through this trailing-edge debounce
  const scheduleSettle = () => {
    if (mounted) return;
    clearTimeout(quiet);
    quiet = setTimeout(settle, SETTLE_MS);
  };

  const onMutations = (records) => {
    if (mounted) {
      // a mounted card is never re-rendered because the page moved; what the page did to it is
      // counted instead, so the activity log can tell the truth about churn
      for (const r of records) for (const n of r.removedNodes) {
        if (n === mounted || (n.nodeType === 1 && n.contains(mounted))) removals++;
      }
      routeReset();   // only a real pathname change resets; the guard is inside
      return;
    }
    scheduleSettle();
  };

  /** Repairs in a row mean the site wants the panel gone: say so once, with the churn, and stop. */
  function repair() {
    if (gaveUp) return;
    if (repairs >= MAX_REPAIRS) {
      gaveUp = true;
      clearPanel();
      note(`the site keeps taking the panel off (${removals} removals); leaving it off`);
      return;
    }
    repairs++;
    render();
  }

  /** The card is placed; this notices only real loss — gone, hidden, moved by the site, or a new route. */
  function watch() {
    if (!mounted) return;
    if (location.pathname !== path) { routeReset(); return; }
    // hidden counts as lost: a node the site set display:none on is not a panel the reader can use,
    // and one height check every 3s costs nothing
    if (document.title !== watchedTitle || !mounted.isConnected || mounted.parentElement !== placedParent || !visible(mounted)) {
      repair();
      return;
    }
    repairs = 0;
  }

  /** A new pathname is a new page: drop everything and settle again. */
  const routeReset = () => {
    if (location.pathname === path) return;   // hash and history noise
    clearTimeout(quiet);
    clearTimeout(verifyAt);
    clearPanel();
    path = location.pathname;
    watchedTitle = '';
    placedParent = null;
    tries = repairs = removals = corrections = 0;
    verified = gaveUp = false;
    lastNote = '';
    scheduleSettle();
  };

  const start = () => {
    path = location.pathname;
    new MutationObserver(onMutations).observe(document.documentElement, { subtree: true, childList: true, characterData: true });
    setInterval(watch, WATCH_MS);   // the only timer that may re-render, and only on loss
    document.addEventListener('DOMContentLoaded', scheduleSettle, { once: true });
    window.addEventListener('load', scheduleSettle, { once: true });
    window.addEventListener('popstate', routeReset);
    scheduleSettle();
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
