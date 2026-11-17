// background.js — service worker: routes reader events, keeps the retry queue warm.
import { series as S, state as ST } from './db.js';
import { recordProgress, setProgress, drainQueue, syncSeries, pullInto, pushOut, connected, importTracker, backfillCovers, library as libAll, linkByTitle, trackers, dedupeSeries } from './sync.js';
import { newSeries, resolveLinks } from './mapping.js';
import { bestMatch, normalizeTitle, bestTitleScore, findSeries, findByAnyTitle } from './match.js';
import * as mangabaka from './trackers/mangabaka.js';
import { logEvent, readEvents, clearEvents } from './diag.js';

const log = (...a) => console.log('[kura]', ...a);

const VERSION = chrome.runtime.getManifest().version;

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('drain', { periodInMinutes: 1 });
  log('installed');
  logEvent('start', `Kura ${VERSION} installed`);
});

chrome.runtime.onStartup.addListener(() => logEvent('start', `Kura ${VERSION} started`));

chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name !== 'drain') return;
  try {
    const n = await drainQueue();
    if (n) log('drained', n);
  } catch (e) { log('drain failed', e.message); }
});

/**
 * The local record a reader page refers to, created once and never renamed away from the page.
 *
 * Three rules, each one paid for by a duplicate storm:
 *   1. The record keeps the title the page gave (or the one it is known by), not the search hit's
 *      title. Storing "Heisei Holdout Sumire-chan" for a page that says "Heisei Haizanhei Sumire-chan"
 *      meant the next visit could not find it and added another copy — 39 copies in four minutes.
 *   2. Every other name is kept as an alias, so the next visit matches by name.
 *   3. If the search hit's id is already on a local record, that record *is* this series under another
 *      name. A tracker id is a fact, and it bridges romaji and English where no title comparison can.
 */
async function ensureSeries(title, host) {
  const all = await S.all();
  const exact = findByAnyTitle(all, title);
  if (exact) return { series: exact, created: false };

  // readers decorate titles; an unmatched page becomes a duplicate entry with no links, which
  // never syncs. Try a tolerant match over the local library before creating anything new.
  const fuzzy = bestMatch(title, all);
  if (fuzzy) {
    await logEvent('match', `matched "${title}" to existing "${fuzzy.series.title}" (${fuzzy.how} ${fuzzy.score.toFixed(2)})`);
    return { series: fuzzy.series, created: false };
  }
  // try the metadata service before creating a bare entry
  let meta = null;
  try { meta = (await mangabaka.search(title))[0] || null; } catch { /* offline is fine */ }

  const owned = meta?.id ? all.find((x) => String(x.links?.mangabaka) === String(meta.id)) : null;
  if (owned) {
    const aliases = [...new Set([...(owned.aliases || []), title])].filter((a) => normalizeTitle(a) !== normalizeTitle(owned.title));
    if (aliases.length) owned.aliases = aliases;
    if (!owned.cover && meta.cover) owned.cover = meta.cover;
    if (!owned.total && meta.total) owned.total = meta.total;
    await S.put(owned);
    await logEvent('match', `"${title}" is the same series as "${owned.title}" (mangabaka=${meta.id})`, { host });
    return { series: owned, created: false };
  }

  const s = newSeries({
    title,
    cover: meta?.cover || null,
    total: meta?.total || 0,
    links: meta?.id ? { mangabaka: meta.id } : {},
    aliases: meta?.title ? [meta.title] : [],
  });
  if (!meta?.id) await logEvent('match', `no MangaBaka result for "${title}" — new series with no links yet`, { host });
  s.sourceHost = host;
  if (s.links.mangabaka) { try { await resolveLinks(s); } catch { /* bridge is best effort */ } }
  await S.put(s);
  return { series: s, created: true };
}

/**
 * A page-declared id is only as good as the link it came from: a chapter page can link other
 * series, and one of those once wrote a chapter into an unrelated AniList entry. Every id is
 * checked against that tracker's own title for it before it is trusted.
 */
async function verifiedIds(ids, title) {
  const keep = {};
  for (const [tracker, id] of Object.entries(ids || {})) {
    const t = trackers.find((x) => x.meta.id === tracker);
    if (!t) continue;
    // fail closed: an id for a tracker that is not connected is neither verifiable nor writable,
    // and an unverifiable id is exactly how a wrong series gets progress written into it
    if (!(await t.meta.connected())) continue;
    try {
      const titles = await t.titleFor(id);
      if (!titles?.length) {
        await logEvent('match', `ignored ${tracker}=${id}: no title to verify against`, { title });
        continue;
      }
      const best = bestTitleScore(title, titles);
      if (best.score >= 0.5) keep[tracker] = id;
      else await logEvent('match', `rejected ${tracker}=${id} from the page: it is "${best.title}" (${best.score.toFixed(2)})`, { title });
    } catch (e) {
      await logEvent('match', `ignored ${tracker}=${id}: verification failed (${e.message})`, { title });
    }
  }
  return keep;
}

const handlers = {
  /** a reader page told us which chapter is open */
  async reading({ title, chapter, volume, url, host, completed, ids }) {
    // defence in depth: a bot wall must never become a library entry, whatever the content script does
    if (title && /\b(just a moment|checking your browser|please wait|attention required|verify you are human|access denied|ddos-guard)\b/i.test(title)) {
      await logEvent('reading', `ignored a bot wall titled "${title}"`, { host });
      return { ok: false, reason: 'bot wall page, ignored' };
    }
    // a synopsis page or a mis-parsed number must never become a library entry
    const num = Number(chapter);
    if (Number.isFinite(num) && (num < 0 || num > 5000)) {
      await logEvent('reading', `ignored implausible chapter ${chapter} on ${host}`, { title });
      return { ok: false, reason: 'implausible chapter number' };
    }
    if (!title || chapter == null) {
      await logEvent('reading', 'page seen but no series/chapter parsed', { host, url: String(url || '').slice(0, 120) });
      return { ok: false, reason: 'no series/chapter detected' };
    }
    const { series: s, created } = await ensureSeries(title, host);
    await logEvent('reading', created ? 'new series added' : 'matched local series', { host, title, chapter, completed: Boolean(completed) });

    // The reader page often links to the trackers itself. Those ids are facts, while a title
    // match is a guess — "Surviving the Apocalypse" matched the wrong AniList series that way.
    if (ids && Object.keys(ids).length) ids = await verifiedIds(ids, s.title);
    if (ids && Object.keys(ids).length) {
      s.linkSource = s.linkSource || {};
      const replaced = [];
      for (const [tracker, id] of Object.entries(ids)) {
        if (s.links?.[tracker] && s.links[tracker] !== id) replaced.push(`${tracker}: ${s.links[tracker]} -> ${id}`);
        s.links = { ...(s.links || {}), [tracker]: id };
        s.linkSource[tracker] = 'page';
      }
      // anything derived from a now-corrected chain is untrustworthy; re-resolve instead of keeping it
      for (const tracker of Object.keys(s.links || {})) {
        if (ids[tracker] === undefined && s.linkSource[tracker] !== 'page') {
          delete s.links[tracker];
          delete s.linkSource[tracker];
        }
      }
      await S.put(s);
      await resolveLinks(s);
      await logEvent('match', `ids from the page: ${Object.entries(ids).map(([k, v]) => `${k}=${v}`).join(', ')}`
        + (replaced.length ? ` (corrected ${replaced.join('; ')})` : ''), { title: s.title });
    }

    // every connected tracker needs a link, not just "the series has none at all" — that gap is
    // why AniList and MangaBaka never appeared in the activity log: they were simply unlinked
    const missing = [];
    for (const t of trackers) if (!s.links?.[t.meta.id] && (await t.meta.connected())) missing.push(t.meta.id);
    if (missing.length) {
      const { log: line } = await linkByTitle(s, { force: true });
      await logEvent('match', `unlinked: ${missing.join(', ')} — ${line.join('; ') || 'nothing tried'}`, { title: s.title });
    }
    await logEvent('links', `linked: ${Object.entries(s.links || {}).map(([k, v]) => `${k}=${v}`).join(', ') || 'none'}`, { title: s.title });

    // opening a chapter records nothing on the trackers; only reaching the end does
    const st = await recordProgress(s.id, chapter, { volume, advance: Boolean(completed) });
    const marks = st?.trackers || {};
    if (!completed) {
      await logEvent('reading', `opened ch ${chapter} — not counted until you finish it`, { title: s.title, chapter });
      return { ok: true, created, seriesId: s.id, title: s.title, chapter: st?.chapter ?? 0, trackers: marks, openedOnly: true };
    }
    for (const id of Object.keys(s.links || {})) {
      const m = marks[id] || {};
      await logEvent('sync', `${id}: ${m.state || 'not attempted'}${m.error ? ' — ' + m.error : ''}`, { title: s.title, chapter });
    }
    return { ok: true, created, seriesId: s.id, title: s.title, chapter: st?.chapter ?? chapter, trackers: marks };
  },
  /** series-page panel: the local state for whatever series the page is about */
  async status({ title, ids }) {
    if (!title && !ids) return { found: false, reason: 'no title' };
    const all = await S.all();
    // the ids the page declares are facts; a title is a guess, and the two sides rarely agree on the
    // name ("Heisei Haizanhei Sumire-chan" on the page, "Heisei Holdout Sumire-chan" in the library)
    let s = null;
    let hits = 0;
    for (const candidate of all) {
      let n = 0;
      for (const [tracker, id] of Object.entries(ids || {})) {
        if (candidate.links?.[tracker] != null && String(candidate.links[tracker]) === String(id)) n++;
      }
      if (n > hits) { s = candidate; hits = n; }
    }
    if (s && title) {
      const known = [s.title, ...(s.aliases || [])].some((a) => normalizeTitle(a) === normalizeTitle(title));
      if (!known) {
        s.aliases = [...new Set([...(s.aliases || []), title])];
        await S.put(s);
        await logEvent('match', `page title "${title}" is "${s.title}" (matched by the page's own ids)`, { title: s.title });
      }
    }
    if (!s) s = title ? findSeries(title, all) : null;
    if (!s) {
      await logEvent('panel', `not in the library: "${title}"`, { title });
      return { found: false, reason: 'not in library' };
    }
    const st = await ST.get(s.id);
    return {
      found: true, seriesId: s.id, title: s.title,
      chapter: st.chapter || 0, volume: st.volume || 0, total: s.total || 0,
      status: st.status || null, links: s.links || {}, trackers: st.trackers || {},
    };
  },
  /** a page reporting why the panel did or did not appear */
  async note({ kind, msg, data }) {
    if (msg) await logEvent(kind || 'note', String(msg).slice(0, 160), data || {});
    return { ok: true };
  },
  async diag() { return { events: await readEvents(30) }; },
  async clearDiag() { await clearEvents(); return { ok: true }; },
  async library() {
    try { await backfillCovers(); } catch (e) { log('cover backfill skipped', e.message); }
    return libAll();
  },
  /** pull one tracker's whole list in; called right after Connect */
  async import({ tracker }) {
    if (!tracker) {
      const conn = await connected();
      const results = [];
      for (const [id, ok] of Object.entries(conn)) {
        if (!ok) continue;
        try { results.push(await importTracker(id)); } catch (e) { results.push({ tracker: id, error: String(e.message || e) }); }
      }
      return { results };
    }
    return importTracker(tracker);
  },
  async sync({ seriesId }) {
    if (seriesId) return syncSeries(seriesId);
    const all = await S.all();
    for (const s of all) { try { await syncSeries(s.id); } catch (e) { log('sync failed', s.title, e.message); } }
    return { ok: true, count: all.length };
  },
  async bump({ seriesId, by = 1 }) {
    const st = await ST.get(seriesId);
    const st2 = await recordProgress(seriesId, (st.chapter || 0) + by);
    return st2;
  },
  /** set the exact chapter, up or down, and push it: the correction for a chapter counted by mistake */
  async set({ seriesId, chapter }) {
    const before = await ST.get(seriesId);
    const st = await setProgress(seriesId, chapter);
    if (st) await logEvent('progress', `set ch ${before.chapter || 0} -> ${chapter}`, { seriesId });
    return st;
  },
  async add({ title, links = {}, cover = null, total = 0 }) {
    const s = newSeries({ title, links, cover, total });
    await resolveLinks(s);
    await S.put(s);
    return s;
  },
  async link({ seriesId, tracker, id }) {
    const s = await S.get(seriesId);
    if (!s) return { ok: false };
    s.links = { ...(s.links || {}), [tracker]: id };
    await resolveLinks(s);
    return s;
  },
  /** what the connected trackers have for a title: the reader picks the right one */
  async candidates({ title }) {
    if (!title) return { results: [] };
    const out = [];
    for (const t of trackers) {
      if (!(await t.meta.connected())) continue;
      try {
        const hits = (await t.search(title)) || [];
        for (const h of hits.slice(0, 8)) {
          out.push({ tracker: t.meta.id, id: h.id, title: h.title, total: h.total || 0, cover: h.cover || null });
        }
      } catch { /* one tracker failing must not hide the others */ }
    }
    return { results: out };
  },
  /**
   * The reader says which series this is. That choice is the truth: every other id on the record was a
   * guess from a title, so it is dropped and the bridge rebuilds from the chosen one.
   */
  async choose({ seriesId, tracker, id }) {
    const s = await S.get(seriesId);
    if (!s) return { ok: false, reason: 'that series is not in the library' };
    const t = trackers.find((x) => x.meta.id === tracker);
    if (!t) return { ok: false, reason: 'unknown tracker' };
    s.links = { [tracker]: id };
    s.linkSource = { [tracker]: 'manual' };
    await S.put(s);
    try { await resolveLinks(s); } catch { /* the bridge is best effort; the chosen id is kept */ }
    await S.put(s);
    await logEvent('match', `linked by hand: ${tracker}=${id}`, { title: s.title });
    // the same series may already be in the library under another name and another tracker: the pick
    // is what makes those two records provably one, so fold them before syncing
    let merged = 0;
    try { merged = (await dedupeSeries({ dryRun: false })).removed || 0; } catch { /* merging is best effort */ }
    const st = await syncSeries(s.id);
    return { series: s, state: st, merged };
  },
  /** one series, folded: the same record created many times by a linking bug */
  async dedupe({ dryRun = true }) { return dedupeSeries({ dryRun }); },
  async forget({ seriesId }) { await S.del(seriesId); return { ok: true }; },
  async syncOne({ seriesId }) { return syncSeries(seriesId); },
};

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  const fn = handlers[msg?.type];
  if (!fn) { respond({ ok: false, reason: 'unknown message ' + msg?.type }); return false; }
  Promise.resolve(fn(msg, sender))
    .then((r) => respond({ ok: true, ...(r || {}) }))
    .catch((e) => respond({ ok: false, reason: String(e.message || e) }));
  return true; // keep the channel open
});

log('service worker up');
