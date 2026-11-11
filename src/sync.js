// sync.js — local state is canonical; trackers are mirrors written in parallel.
// Rule (chosen by the user): the highest chapter wins, then it is pushed to everyone else.
import * as anilist from './trackers/anilist.js';
import * as mangabaka from './trackers/mangabaka.js';
import * as mal from './trackers/mal.js';
import { series as S, state as ST, queue as Q, normTitle } from './db.js';
import { resolveLinks, newSeries } from './mapping.js';

export const trackers = [anilist, mangabaka, mal];
export const trackerMeta = trackers.map((t) => t.meta);

export async function connected() {
  const out = {};
  for (const t of trackers) out[t.meta.id] = await t.meta.connected();
  return out;
}

const mark = (st, id, patch) => {
  st.trackers = st.trackers || {};
  st.trackers[id] = { ...(st.trackers[id] || {}), ...patch, at: Date.now() };
};

/** read every linked tracker, adopt the highest chapter, record per-tracker state */
export async function pullInto(s) {
  const st = await ST.get(s.id);
  let moved = false;
  for (const t of trackers) {
    const id = t.meta.id;
    if (!s.links?.[id]) continue;
    try {
      const remote = await t.pull(s);
      if (!remote) continue;
      mark(st, id, { state: 'synced', chapter: remote.chapter, status: remote.status, rating: remote.rating, error: null });
      if ((remote.chapter || 0) > (st.chapter || 0)) { st.chapter = remote.chapter; moved = true; }
      if (remote.volume && remote.volume > (st.volume || 0)) st.volume = remote.volume;
      if (!st.status && remote.status) st.status = remote.status;
      if (remote.rating && !st.rating) st.rating = remote.rating;
    } catch (e) {
      mark(st, id, { state: 'error', error: String(e.message || e) });
    }
  }
  await ST.put(st);
  return { st, moved };
}

/** write local state to every linked tracker; failures queue with backoff */
export async function pushOut(s, st, skip = []) {
  for (const t of trackers) {
    const id = t.meta.id;
    if (!s.links?.[id] || skip.includes(id)) continue;
    mark(st, id, { state: 'pending', error: null });
    try {
      await t.push(s, st);
      mark(st, id, { state: 'synced', error: null, chapter: st.chapter });
      const pending = (await Q.all()).filter((j) => j.seriesId === s.id && j.tracker === id);
      for (const j of pending) await Q.remove(j.id);
    } catch (e) {
      mark(st, id, { state: 'error', error: String(e.message || e) });
      await Q.add({
        seriesId: s.id, tracker: id, chapter: st.chapter, volume: st.volume,
        status: st.status, rating: st.rating, attempts: 0, nextAt: Date.now() + 60_000,
      });
    }
  }
  await ST.put(st);
  return st;
}

export async function syncSeries(seriesId) {
  const s = await S.get(seriesId);
  if (!s) return null;
  await resolveLinks(s);
  const { st } = await pullInto(s);
  return pushOut(s, st);
}

/** the reading event: from a reader page or a manual +1 */
export async function recordProgress(seriesId, chapter, { volume = 0 } = {}) {
  const s = await S.get(seriesId);
  if (!s) return null;
  const st = await ST.get(seriesId);
  const next = Math.max(st.chapter || 0, Number(chapter) || 0);
  const total = s.total || 0;
  if (next > (st.chapter || 0)) {
    st.chapter = next;
    st.updatedAt = Date.now();
    if (!st.status || st.status === 'planning') st.status = 'reading';
    if (total && next >= total) st.status = 'completed';
  }
  if (volume) st.volume = Math.max(st.volume || 0, volume);
  await ST.put(st);
  return pushOut(s, st);
}

/** retry anything the queue is holding */
export async function drainQueue() {
  const due = await Q.due();
  let sent = 0;
  for (const job of due) {
    const s = await S.get(job.seriesId);
    if (!s) { await Q.remove(job.id); continue; }
    const t = trackers.find((x) => x.meta.id === job.tracker);
    if (!t) { await Q.remove(job.id); continue; }
    try {
      await t.push(s, { chapter: job.chapter, volume: job.volume, status: job.status, rating: job.rating });
      await Q.remove(job.id);
      const st = await ST.get(s.id);
      mark(st, job.tracker, { state: 'synced', error: null });
      await ST.put(st);
      sent++;
    } catch (e) {
      const attempts = (job.attempts || 0) + 1;
      if (attempts >= 5) await Q.remove(job.id);
      else await Q.bump(job.id, { ...job, attempts, nextAt: Date.now() + Math.min(30, 2 ** attempts) * 60_000, lastError: String(e.message || e) });
    }
  }
  return sent;
}

/** pull one tracker's whole list into the library; highest chapter wins per series */
export async function importTracker(trackerId) {
  const t = trackers.find((x) => x.meta.id === trackerId);
  if (!t) throw new Error('unknown tracker: ' + trackerId);
  if (!(await t.meta.connected())) throw new Error(`${t.meta.name} is not connected`);
  const rows = await t.importList();
  const existing = await S.all();
  const byLink = new Map();
  const byTitle = new Map();
  for (const s of existing) {
    const linked = s.links?.[trackerId];
    if (linked != null) byLink.set(String(linked), s);
    if (s.normTitle) byTitle.set(s.normTitle, s);
  }
  let created = 0, updated = 0, skipped = 0;
  for (const row of rows) {
    if (!row.id || !row.title) { skipped++; continue; }
    let s = byLink.get(String(row.id)) || byTitle.get(normTitle(row.title));
    if (!s) {
      s = newSeries({ title: row.title, cover: row.cover, total: row.total, links: { [trackerId]: row.id } });
      created++;
    } else {
      s.links = { ...(s.links || {}), [trackerId]: row.id };
      if (!s.cover && row.cover) s.cover = row.cover;
      if (!s.total && row.total) s.total = row.total;
      updated++;
    }
    if (!s.cover && row.cover) s.cover = row.cover;
    if (!s.total && row.total) s.total = row.total;
    await S.put(s);
    const st = await ST.get(s.id);
    if ((row.chapter || 0) > (st.chapter || 0)) st.chapter = row.chapter;
    if ((row.volume || 0) > (st.volume || 0)) st.volume = row.volume;
    if (!st.status && row.status) st.status = row.status;
    if (!st.rating && row.rating) st.rating = row.rating;
    st.updatedAt = st.updatedAt || Date.now();
    mark(st, trackerId, { state: 'synced', chapter: row.chapter || 0, status: row.status || null, rating: row.rating || null });
    await ST.put(st);
  }
  // an empty or unusable list is not a success: say why instead of reporting "0 series"
  if (!rows.length) {
    return { tracker: trackerId, rows: 0, created: 0, updated: 0, skipped: 0, note: `nothing in your ${t.meta.name} library to import` };
  }
  if (skipped === rows.length) {
    return { tracker: trackerId, rows: rows.length, created: 0, updated: 0, skipped, note: `${t.meta.name} returned ${rows.length} entries but none had a usable title` };
  }
  return { tracker: trackerId, rows: rows.length, created, updated, skipped };
}

/** fill in covers for series that were imported before metadata was read */
export async function backfillCovers(limit = 15) {
  const all = await S.all();
  let filled = 0;
  for (const s of all) {
    if (filled >= limit) break;
    if (s.cover || !s.links?.mangabaka) continue;
    try {
      const meta = await mangabaka.metaFor(s.links.mangabaka);
      if (meta?.cover) { s.cover = meta.cover; if (!s.total && meta.total) s.total = meta.total; await S.put(s); filled++; }
    } catch { /* metadata is optional */ }
  }
  return filled;
}

export async function library() {
  const [all, states, conn] = await Promise.all([S.all(), ST.all(), connected()]);
  const byId = Object.fromEntries(states.map((s) => [s.seriesId, s]));
  const items = all
    .map((s) => ({ ...s, state: byId[s.id] || { seriesId: s.id, chapter: 0, trackers: {} } }))
    .sort((a, b) => (b.state.updatedAt || b.createdAt) - (a.state.updatedAt || a.createdAt));
  return { items, connected: conn };
}
