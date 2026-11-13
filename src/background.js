// background.js — service worker: routes reader events, keeps the retry queue warm.
import { series as S, state as ST, normTitle } from './db.js';
import { recordProgress, drainQueue, syncSeries, pullInto, pushOut, connected, importTracker, backfillCovers, library as libAll, linkByTitle, trackers } from './sync.js';
import { newSeries, resolveLinks } from './mapping.js';
import { bestMatch, normalizeTitle, bestTitleScore } from './match.js';
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

async function ensureSeries(title, host) {
  const norm = normTitle(title);
  let s = await S.byTitle(norm);
  if (s) return { series: s, created: false };

  // readers decorate titles; an unmatched page becomes a duplicate entry with no links, which
  // never syncs. Try a tolerant match over the local library before creating anything new.
  const fuzzy = bestMatch(title, await S.all());
  if (fuzzy) {
    await logEvent('match', `matched "${title}" to existing "${fuzzy.series.title}" (${fuzzy.how} ${fuzzy.score.toFixed(2)})`);
    return { series: fuzzy.series, created: false };
  }
  // try the metadata service before creating a bare entry
  let meta = null;
  try { meta = (await mangabaka.search(title))[0] || null; } catch { /* offline is fine */ }
  s = newSeries({ title: meta?.title || title, cover: meta?.cover || null, total: meta?.total || 0, links: meta?.id ? { mangabaka: meta.id } : {} });
  if (!meta?.id) await logEvent('match', `no MangaBaka result for "${title}" — new series with no links yet`, { host });
  s.sourceHost = host;
  if (s.links.mangabaka) { try { await resolveLinks(s); } catch { /* bridge is best effort */ } }
  s.normTitle = normalizeTitle(s.title) || s.normTitle;
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
  async status({ title }) {
    if (!title) return { found: false };
    const all = await S.all();
    let s = all.find((x) => x.normTitle === normTitle(title)) || null;
    if (!s) s = bestMatch(title, all)?.series || null;
    if (!s) return { found: false };
    const st = await ST.get(s.id);
    return {
      found: true, seriesId: s.id, title: s.title,
      chapter: st.chapter || 0, volume: st.volume || 0, total: s.total || 0,
      status: st.status || null, links: s.links || {}, trackers: st.trackers || {},
    };
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
