// trackers/mangabaka.js — MangaBaka personal access token; /v1/my/library is read/write.
import { jsonFetch, emptyRemote } from './base.js';

const API = 'https://api.mangabaka.org/v1';
const TOKEN_KEY = 'mangabaka.token';

const STATUS_OUT = { planning: 'plan_to_read', reading: 'reading', completed: 'completed', paused: 'paused', dropped: 'dropped', rereading: 'rereading' };
const STATUS_IN = Object.fromEntries(Object.entries(STATUS_OUT).map(([k, v]) => [v, k]));

export async function token() {
  const { [TOKEN_KEY]: t } = await chrome.storage.local.get(TOKEN_KEY);
  return t || null;
}

export async function setToken(t) {
  if (t) await chrome.storage.local.set({ [TOKEN_KEY]: t.trim() });
  else await chrome.storage.local.remove(TOKEN_KEY);
}

async function api(path, opts = {}) {
  const tok = await token();
  if (!tok) throw new Error('MangaBaka is not connected');
  return jsonFetch(API + path, {
    ...opts,
    headers: { Accept: 'application/json', Authorization: `Bearer ${tok}`, ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers || {}) },
  });
}

export async function pull(series) {
  const id = series.links?.mangabaka;
  if (!id) return null;
  try {
    const d = await api(`/my/library/${id}`);
    const e = d?.data?.library_entry || d?.data || {};
    return {
      ...emptyRemote(),
      chapter: e.progress_chapter || 0,
      volume: e.progress_volume || 0,
      status: STATUS_IN[e.state] || null,
      rating: e.rating == null ? null : Math.round(e.rating / 10), // MangaBaka rates 0-100, we keep 0-10
      updatedAt: Date.parse(e.updated_at || '') || 0,
      raw: e,
    };
  } catch (e) {
    if (e.status === 404) return emptyRemote(); // not on the list yet
    throw e;
  }
}

export async function push(series, st) {
  const id = series.links?.mangabaka;
  if (!id) return null;
  const body = { progress_chapter: Math.max(0, Math.round(st.chapter || 0)) };
  if (st.volume) body.progress_volume = Math.round(st.volume);
  if (st.status) body.state = STATUS_OUT[st.status];
  if (st.rating) body.rating = Math.round(st.rating * 10);
  const d = await api(`/my/library/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
  return d?.data || null;
}

const seriesTitle = (s) => s.title || s.romanized_title || s.titles?.find?.((t) => t.is_primary)?.title
  || (Array.isArray(s.titles) ? s.titles[0]?.title : s.titles) || s.name || '';

const coverUrl = (s) => {
  const c = s.cover;
  if (!c) return null;
  if (typeof c === 'string') return c;
  if (typeof c.raw === 'string') return c.raw;          // v2: raw is a bare URL
  return c.raw?.url || c.x150?.url || c.large || c.medium || null;
};

export async function search(query) {
  let rows = [];
  try {
    const d = await jsonFetch(`https://api.mangabaka.org/v1/series/search?q=${encodeURIComponent(query)}&type=manga`, { headers: { Accept: 'application/json' } });
    rows = d?.data || d?.results || [];
  } catch {
    const d = await jsonFetch(`https://api.mangabaka.org/v2/series/search?q=${encodeURIComponent(query)}&type=manga&limit=10`, { headers: { Accept: 'application/json' } });
    rows = d?.data || [];
  }
  return rows.slice(0, 10).map((s) => ({
    tracker: 'mangabaka',
    id: s.id,
    title: seriesTitle(s),
    cover: coverUrl(s),
    total: s.total_chapters || s.final_volume || 0,
  })).filter((r) => r.id && r.title);
}

/** pull the user's MangaBaka library so it can seed the local one */
export async function importList() {
  const out = [];
  let page = 1;
  while (page <= 20) {
    const d = await api(`/my/library?limit=100&page=${page}`);
    const rows = d?.data || [];
    if (!rows.length) break;
    for (const e of rows) {
      const seriesId = e.series_id ?? e.series?.id ?? e.id ?? null;
      if (!seriesId) continue;
      out.push({
        tracker: 'mangabaka',
        id: seriesId,
        title: seriesTitle(e.series || e) || null,
        cover: coverUrl(e.series || e),
        total: (e.series || e).total_chapters || 0,
        chapter: e.progress_chapter || 0,
        volume: e.progress_volume || 0,
        status: STATUS_IN[e.state] || null,
        rating: e.rating == null ? null : Math.round(e.rating / 10),
      });
    }
    if (rows.length < 100) break;
    page++;
  }
  return out;
}

/** bridge: the same series on another tracker -> the MangaBaka series */
export async function fromSource(provider, externalId) {
  const map = { anilist: 'anilist', mal: 'my-anime-list' };
  const p = map[provider];
  if (!p) return null;
  try {
    const d = await jsonFetch(`https://api.mangabaka.org/v1/source/${p}/${externalId}`, { headers: { Accept: 'application/json' } });
    const s = d?.data || d;
    return s?.id ? s : null;
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
}

/** series metadata by id: cover, chapter count, and the bridged source ids */
export async function metaFor(id) {
  const d = await jsonFetch(`https://api.mangabaka.org/v1/series/${id}`, { headers: { Accept: 'application/json' } });
  const s = d?.data || d;
  if (!s?.id) return null;
  return { cover: coverUrl(s), total: s.total_chapters || s.final_volume || 0, title: seriesTitle(s), source: s.source, raw: s };
}

export const meta = { id: 'mangabaka', name: 'MangaBaka', colour: '#e35d3a', connected: async () => Boolean(await token()) };
