// overlay.js — reader pill for manga sites.
// Classic script (no imports). Reads the open series/chapter, reports progress to the service
// worker, shows how far through the chapter you are, and reports when you reach the end.
// It stays out of the way: it fades out after a few seconds and leaves a small dot in the corner.
(() => {
  if (window.__kuraLoaded) return;
  window.__kuraLoaded = true;

  // One definition per reader site, in src/sites/. Nothing here knows a hostname: the registry
  // returns the site's own title/chapter/page-type functions, and the generic fallback fills gaps.
  const site = window.__kura.forHost(location.hostname);

  const stripNoise = (t) =>
    String(t || '')
      .replace(/\s*[|·—-]\s*(read|chapter|ch\.?|vol\.?|manga|online|free|raw|english).*$/i, '')
      .replace(/\s*(chapter|ch\.?)\s*[0-9]+(\.[0-9]+)?/gi, '')
      .replace(/\s*[-–—:|]\s*$/g, '')
      .trim();

  const squash = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]/g, '');

  // Bot walls ("Just a moment...", "Please wait", "Checking your browser") are not manga.
  // One of these was recorded as a series called "Just a Moment" on mangadot, which is exactly
  // the kind of junk entry that pollutes the library and syncs to every tracker.
  // The rule lives in the registry so the panel and this pill can never disagree about it.
  const isInterstitial = () => window.__kura.isInterstitial();

  const TRACKER_LINK = {
    anilist: /anilist\.co\/manga\/(\d+)/i,
    mal: /myanimelist\.net\/manga\/(\d+)/i,
    mangabaka: /mangabaka\.org\/(?:manga|manhwa|manhua)\/?(\d+)/i,
  };

  /** pull tracker ids out of a page's links: the site already knows which series this is */
  function extractTrackerIds(html) {
    const ids = {};
    for (const [tracker, re] of Object.entries(TRACKER_LINK)) {
      const m = String(html || '').match(re);
      if (m) ids[tracker] = Number(m[1]);
    }
    return Object.keys(ids).length ? ids : null;
  }

  const norm = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  /** does a fetched page describe the series we are reading? guards against sidebar/recommended links */
  function pageIsThisSeries(html, title) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const candidates = [
      doc.querySelector('h1')?.textContent,
      doc.querySelector('meta[property="og:title"]')?.content,
      doc.title,
    ].filter(Boolean).map((t) => norm(t.split(/[|—–]/)[0]));
    const mine = norm(title);
    if (!mine) return false;
    return candidates.some((c) => c && (c === mine || c.includes(mine) || mine.includes(c)));
  }

  let idCache = null;
  /**
   * Fetch candidate series pages and keep the ids of the one that actually describes this series.
   * A chapter page can link several other series (related, recommended, promoted); taking the first
   * `/series/` anchor once linked an unrelated manga and wrote a chapter into it.
   */
  async function collectIds(title) {
    if (idCache !== null) return idCache;
    idCache = undefined;
    const anchors = [...document.querySelectorAll('a[href*="/series/"], a[href*="/manga/"]')]
      .map((a) => a.href)
      .filter(Boolean);
    const urls = [...new Set(anchors)].slice(0, 5);
    for (const url of urls) {
      try {
        const res = await fetch(url, { credentials: 'same-origin' });
        if (!res.ok) continue;
        const html = await res.text();
        if (!pageIsThisSeries(html, title)) continue;   // not the series we are reading
        const ids = extractTrackerIds(html);
        if (ids) { idCache = ids; break; }
      } catch { /* try the next candidate */ }
    }
    return idCache;
  }

  /** real manga pages are images: a reader view with none is a bot wall, an error, or a stub */
  function hasPages() {
    return [...document.querySelectorAll('img')].some((i) => {
      const r = i.getBoundingClientRect();
      return r.width > 200 || i.naturalWidth > 300;
    });
  }

  // Reader words that are never a series name. Anything host-specific is handled structurally by
  // the registry (a brand is a prefix of its own hostname), so this list stays free of site names.
  const READER_BRANDS = ['reader', 'home', 'read manga online', 'manga', 'read', 'chapter'];

  /** the site's own name must never stand in for the series name (stonescape.xyz does this) */
  function isSiteName(text, host) {
    const a = squash(text);
    if (!a || a.length < 3) return true;
    if (window.__kura.isBrand(text)) return true;
    return READER_BRANDS.some((b) => squash(b) === a);
  }

  /** last resort: the series slug in the URL, e.g. /manga/kyuu-ketsu-hirotte/chapter-65 */
  function titleFromUrl() {
    const m = location.pathname.match(/\/(?:manga|series|comic|comics|title|read)\/([^/]+)/i);
    if (!m) return '';
    let slug = decodeURIComponent(m[1]).replace(/[-_+]+/g, ' ').trim();
    slug = slug.replace(/\b(chapter|chap|ch|vol|volume|read|raw|en)\b.*$/i, '').trim();
    if (!slug || /^\d+$/.test(slug.replace(/\s/g, ''))) return '';
    return slug.replace(/\b[a-z]/g, (c) => c.toUpperCase());
  }

  function detectTitle(host) {
    const rule = site;
    const og = (p) => document.querySelector(`meta[property="${p}"], meta[name="${p}"]`)?.content || '';
    if (rule.title) {
      const t = stripNoise(rule.title() || '');
      if (t && !isSiteName(t, host)) return t;
    }
    const headings = [...document.querySelectorAll(
      'h1, [itemprop="name"], .title, .manga-title, .series-title, .chapter-title, [data-title], [data-manga-title]',
    )]
      .map((el) => (el.getAttribute('data-title') || el.getAttribute('data-manga-title') || el.textContent || '').trim())
      .filter(Boolean);
    // a link back to the series page is the most reliable name on single-chapter views
    const seriesLink = [...document.querySelectorAll('a[href*="/manga/"], a[href*="/series/"], a[href*="/comic/"]')]
      .map((a) => (a.textContent || '').trim())
      .filter((t) => t.length > 1 && t.length < 120);

    const candidates = [...headings, ...seriesLink.slice(0, 3), og('og:title'), document.title, titleFromUrl()];
    for (const raw of candidates) {
      const t = stripNoise(raw);
      if (t && !isSiteName(t, host)) return t;
    }
    return '';
  }

  function detect() {
    const host = location.hostname.replace(/^www\./, '');
    const rule = site;
    const title = detectTitle(host);
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
    // chapter 0 is a real chapter (mangadot and others use prologues numbered 0)
    const num = chapter === null || chapter === undefined || chapter === '' ? null : Number(chapter);
    return { title, chapter: Number.isFinite(num) ? num : null, host, url: location.href };
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

  /**
   * How far through the chapter, or null when it cannot be known yet. A page that has not laid
   * out its images is not "100% read" — reporting that was a lie the pill used to tell.
   */
  function readPercent() {
    const el = scroller();
    if (!el) return null;
    const max = el.scrollHeight - el.clientHeight;
    if (max <= 8) return null; // one screen so far: unknown, not finished
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
      pointer-events: auto; opacity: 1; transform: none; max-width: min(78vw, 460px);
      transition: opacity .22s ease, transform .22s ease;
    }
    .wrap.idle .pill { opacity: 0; transform: translateY(6px); pointer-events: none; }
    .label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .label b { font-weight: 650; color: #fff; }
    .read { color: #a9a9b6; font-variant-numeric: tabular-nums; }
    .read.done { color: #46d39a; }
    .track { position: relative; width: 44px; height: 3px; border-radius: 2px; background: #2c2c36; overflow: hidden; flex: 0 0 auto; }
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
      <span class="read">—</span>
      <div class="track"><i></i></div>
      <div class="dots"></div>
      <input class="ch" type="number" min="0" step="0.1" placeholder="ch" hidden />
      <button title="Mark this chapter read">✓</button>
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
  let completedKey = null;   // `${title}|${chapter}` that was completed, stable across re-renders
  let userScrolled = false;  // you moved the page yourself, on this chapter
  let armed = false;         // the opening position has been recorded for this chapter
  let openTop = 0;
  let lastPath = location.pathname;
  const keyOf = (d) => `${d.title}|${d.chapter}`;
  let lastPct = 'init';
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
    action.textContent = on ? 'Set' : '✓';
    action.title = on ? 'Save this chapter number' : 'Mark this chapter read';
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
    readEl.textContent = done ? '✓ read' : pct == null ? '—' : `${pct}%`;
    readEl.className = 'read' + (done ? ' done' : '');
    bar.style.width = `${done ? 100 : pct == null ? 0 : pct}%`;
    track.className = 'track' + (done ? ' done' : '');
  }

  const send = (type, payload) => chrome.runtime.sendMessage({ type, ...payload });
  const flash = (msg, ms = 2200) => { toast.textContent = msg; setTimeout(() => { if (toast.textContent === msg) toast.textContent = ''; }, ms); };

  /** a synopsis page is not a chapter: recording there created junk entries with impossible numbers */
  function isChapterPage() {
    // the site's own pattern when it has one, otherwise the generic table's
    if (site.chapterPage) return site.chapterPage.test(location.pathname);
    return false;
  }

  async function report(force = false) {
    if (isInterstitial()) { hide(); return; } // a bot wall is not content
    if (!isChapterPage()) { hide(); return; }  // series pages belong to the status panel, not the pill
    const d = detect();
    if (!d.title) {
      // tell the worker anyway: "Kura ran here but could not read the page" is the log line
      // that explains a no-op on a reader layout we do not parse yet
      send('reading', { ...d, title: '', chapter: null });
      // and stay visible instead of vanishing: a missing pill looked like a missing extension
      label.textContent = 'Kura · page not recognised';
      readEl.textContent = '';
      dots.innerHTML = '';
      manualMode(false);
      reveal(9000);
      return;
    }
    const key = d.title + '|' + (d.chapter ?? '?');
    if (!force && current === key) return;

    // on a site Kura has no rule for, only record what actually looks like a chapter view:
    // stay visible so the user knows Kura is here, but create nothing
    if (!site.chapter && d.chapter == null && !hasPages()) {
      current = key;
      label.textContent = 'Kura · page not recognised';
      readEl.textContent = '';
      dots.innerHTML = '';
      manualMode(false);
      reveal(9000);
      return;
    }
    // only a real navigation resets the scroll evidence: a re-render makes detect() briefly return a
    // different title, and clearing the flags on that let a completed chapter complete again
    if (lastPath !== location.pathname) {
      lastPath = location.pathname;
      userScrolled = false;
      armed = false;
      openTop = 0;
    }
    current = key;

    if (d.chapter == null) {
      // no chapter in the URL or title: ask once instead of doing nothing
      label.innerHTML = `<b>${d.title}</b> · ch ?`;
      manualMode(true);
      reveal(12000);
      dots.innerHTML = '';
      paintProgress(null, false);
      return;
    }
    manualMode(false);
    label.innerHTML = `<b>${d.title}</b> · ch ${d.chapter}`;
    paintProgress(readPercent(), false);
    reveal();
    const ids = await collectIds(d.title);
    const r = await send('reading', ids ? { ...d, ids } : d);
    if (r?.ok) paintDots(r.trackers || {});
    else if (r?.reason) flash(String(r.reason).slice(0, 40));
  }

  /**
   * The chapter is finished when the last page of it has been on screen. Scroll percentage alone
   * misses paged, lazy-loading and infinite readers, where the height keeps changing under you.
   */
  let completing = false;

  async function finishChapter() {
    const d = detect();
    // chapter 0 is a real chapter: compare against null, never falsiness
    if (!d.title || d.chapter == null || completedKey === keyOf(d) || completing) return;
    completing = true;
    completedKey = keyOf(d);
    paintProgress(100, true);
    const r = await send('reading', { ...d, completed: true });
    completing = false;
    if (r?.ok) { paintDots(r.trackers || {}); reveal(4000); }
    else flash(r?.reason ? String(r.reason).slice(0, 40) : 'not saved');
  }

  /** an explicit "end of chapter" marker in view — mangadot prints one after the last page */
  function endMarkerVisible() {
    const re = /\b(end of (this )?chapter|you'?ve reached the end|chapter (is )?(complete|finished))\b/i;
    const vh = window.innerHeight || document.documentElement.clientHeight;
    for (const el of document.querySelectorAll('p, div, span, h2, h3, section')) {
      if (el.children.length) continue; // leaf text only, so a whole page never matches
      const text = el.textContent || '';
      if (text.length > 120 || !re.test(text)) continue;
      const r = el.getBoundingClientRect();
      if (r.bottom > 0 && r.top < vh) return true;
    }
    return false;
  }

  /**
   * Paged readers announce their position: "Page 3 of 3", "3 / 3 · 100 %". Anything else that happens
   * to read "N of M" is not a page counter — atsu.moe renders achievement tiers ("tier 4 of 4"), and
   * treating that as the last page marked a chapter read on load, before a single page was seen, then
   * pushed it to every tracker. So the match must be a pager: the word "page", or a bare counter.
   */
  function pagedAtLastPage() {
    const RE_PAGE = /\bpage\s*(\d+)\s*(?:of|\/)\s*(\d+)/i;
    const RE_BARE = /^(\d+)\s*(?:of|\/)\s*(\d+)(?:\s*[·|]\s*\d+\s*%)?$/i;
    for (const el of document.querySelectorAll('[aria-label], [class*=page], [class*=Page], [class*=progress]')) {
      if (el.children.length > 2) continue;                 // a pager label is a leaf, or nearly one
      // the two sources are checked apart: a pager often says "Page 3 of 3, open page selector" in the
      // aria-label while its text is "3 / 3 · 100 %", and joining them hides both
      const labels = [
        (el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim(),
        (el.textContent || '').replace(/\s+/g, ' ').trim(),
      ];
      for (const label of labels) {
        if (!label || label.length > 40) continue;          // badges, menus and summaries are longer
        const m = label.match(RE_PAGE) || label.match(RE_BARE);
        if (m && Number(m[1]) >= Number(m[2]) && Number(m[2]) > 0) return true;
      }
    }
    return false;
  }

  /**
   * The reader is at the end of what it holds. A percentage is not evidence: 95% of a long chapter is
   * still the middle of it, and any percentage rule marks chapters read that were only started.
   */
  function atScrollEnd(slack = 250) {
    const el = scroller();
    if (!el) return false;
    const max = el.scrollHeight - el.clientHeight;
    if (max <= 8) return false;
    return max - el.scrollTop <= slack;
  }

  /** scroll position inside the chapter, plus the "finished this chapter" signal */
  // a time-throttled check rather than requestAnimationFrame: rAF is throttled or paused in
  // background tabs, and paged readers never scroll at all, so this must run on a timer too
  let lastRun = 0, runs = 0, lastError = null, lastSeen = null;
  function onScroll(force = false) {
    const now = Date.now();
    // scroll events are throttled; a DOM change (new page, end marker) must not be dropped
    if (!force && now - lastRun < 150) return;
    lastRun = now;
    runs++;
    void (async () => {
      try {
      if (isInterstitial() || !isChapterPage()) return;
      const d = detect();
      if (!d.title || d.chapter == null) return;
      const pct = readPercent();
      if (pct != null && pct > 0) {
        const el = scroller();
        const top = el ? el.scrollTop : 0;
        // The position a chapter OPENS at is not evidence that you read it: atsu restores your place,
        // so the next chapter can appear at the bottom on its own. Record where it opened and only
        // count a real move away from there.
        if (!armed) { armed = true; openTop = top; }
        if (Math.abs(top - openTop) > 200) userScrolled = true;
      }
      if (pct !== lastPct) {
        lastPct = pct;
        paintProgress(pct, completedKey === keyOf(d));
      }
      // A chapter is finished when you reach the far end of it — at 95%, as MAL-Sync does, because
      // you cannot know what sits below (a comments section can be longer than the chapter), plus an
      // explicit end marker or a pager on its last page for readers that never scroll.
      const marker = endMarkerVisible();
      const paged = pagedAtLastPage();
      const farEnough = pct != null && pct >= 95;
      const atEnd = atScrollEnd();
      lastSeen = { pct, farEnough, atEnd, marker, paged, chapter: d.chapter, userScrolled };
      // userScrolled is not decoration: a reader that restores your position puts the next chapter on
      // screen at the bottom already, and without this the new chapter was completed the moment it
      // opened, which is how opening chapter 73 moved the trackers from 72 to 73.
      if (marker || paged || (userScrolled && (farEnough || atEnd))) await finishChapter();
      } catch (e) { lastError = String((e && e.message) || e); }
    })();
  }

  action.addEventListener('click', async () => {
    const d = detect();
    if (!d.title) return;
    // completion means "I read chapter N", so the button marks the chapter on screen — opening it
    // no longer counts, which is why this must not jump to chapter+1
    const target = d.chapter ?? Number(chInput.value);
    if (!Number.isFinite(target) || target <= 0) { chInput.focus(); return; }
    const r = await send('reading', { ...d, chapter: target, completed: true });
    if (r?.ok) {
      current = `${d.title}|${target}`;
      label.innerHTML = `<b>${d.title}</b> · ch ${target}`;
      manualMode(false);
      paintDots(r.trackers || {});
      paintProgress(100, true);
      flash(`ch ${target} read`);
      reveal();
    } else {
      flash(r?.reason ? String(r.reason).slice(0, 40) : 'not saved');
      reveal();
    }
  });

  // exposed for the test harness and for debugging a reader layout in the field
  window.__kuraDebug = {
    detect, readPercent, atScrollEnd, endMarkerVisible, pagedAtLastPage,
    state: () => ({ current, completedKey, userScrolled, lastRun, runs, lastError, completing, lastSeen }),
  };

  function mount() {
    if (!document.body) return;
    document.body.append(host);
    const scrollerEl = scroller();
    for (const el of [window, document, scrollerEl]) {
      if (el) el.addEventListener('scroll', onScroll, { passive: true, capture: true });
    }
    // paged readers change pages without scrolling and timers are throttled in background tabs,
    // so react to the DOM changing (page label, images, "end of chapter" marker) as well as to time
    new MutationObserver(() => onScroll(true)).observe(document.body, {
      subtree: true, childList: true, characterData: true,
      attributes: true, attributeFilter: ['aria-label', 'class', 'src'],
    });
    setInterval(onScroll, 1500);
    // a reader that swaps images in later changes the height without scrolling
    window.addEventListener('resize', onScroll, { passive: true });
    report(true);
    reveal();
  }

  let lastHref = location.href;
  new MutationObserver(() => {
    if (location.href !== lastHref) { lastHref = location.href; current = null; lastPct = 'init'; report(true); }
    else if (current === null) report();
  }).observe(document.documentElement, { subtree: true, childList: true });
  window.addEventListener('popstate', () => { current = null; report(true); });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
