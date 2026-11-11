// sync.js — local state is canonical; trackers are mirrors written in parallel.
// Rule (chosen by the user): the highest chapter wins, then it is pushed to everyone else.
import * as anilist from './trackers/anilist.js';
import * as mangabaka from './trackers/mangabaka.js';
import * as mal from './trackers/mal.js';
import { series as S, state as ST, queue as Q } from './db.js';
import { resolveLinks } from './mapping.js';

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

export async function library() {
  const [all, states, conn] = await Promise.all([S.all(), ST.all(), connected()]);
  const byId = Object.fromEntries(states.map((s) => [s.seriesId, s]));
  return all
    .map((s) => ({ ...s, state: byId[s.id] || { seriesId: s.id, chapter: 0, trackers: {} } }))
    .sort((a, b) => (b.state.updatedAt || b.createdAt) - (a.state.updatedAt || a.createdAt))
    .map((s) => ({ ...s, connected: conn }));
}
