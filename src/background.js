// background.js — service worker: routes reader events, keeps the retry queue warm.
import { series as S, state as ST, normTitle } from './db.js';
import { recordProgress, drainQueue, syncSeries, pullInto, pushOut, connected, importTracker, backfillCovers, library as libAll } from './sync.js';
import { newSeries, resolveLinks } from './mapping.js';
import * as mangabaka from './trackers/mangabaka.js';

const log = (...a) => console.log('[kura]', ...a);

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('drain', { periodInMinutes: 1 });
  log('installed');
});

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
  // try the metadata service before creating a bare entry
  let meta = null;
  try { meta = (await mangabaka.search(title))[0] || null; } catch { /* offline is fine */ }
  s = newSeries({ title: meta?.title || title, cover: meta?.cover || null, total: meta?.total || 0, links: meta?.id ? { mangabaka: meta.id } : {} });
  s.sourceHost = host;
  if (s.links.mangabaka) { try { await resolveLinks(s); } catch { /* bridge is best effort */ } }
  await S.put(s);
  return { series: s, created: true };
}

const handlers = {
  /** a reader page told us which chapter is open */
  async reading({ title, chapter, volume, url, host }) {
    if (!title || !chapter) return { ok: false, reason: 'no series/chapter detected' };
    const { series: s, created } = await ensureSeries(title, host);
    const st = await recordProgress(s.id, chapter, { volume });
    return { ok: true, created, seriesId: s.id, title: s.title, chapter: st?.chapter ?? chapter, trackers: st?.trackers || {} };
  },
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
