// trackers/mal.js — MyAnimeList needs a client secret for the token exchange, so the code/refresh
// exchange happens in the Worker; the extension only ever holds a client_id and the tokens.
import { jsonFetch, emptyRemote } from './base.js';

const API = 'https://api.myanimelist.net/v2';
const STATUS_OUT = { planning: 'plan_to_read', reading: 'reading', completed: 'completed', paused: 'on_hold', dropped: 'dropped', rereading: 'reading' };
const STATUS_IN = { plan_to_read: 'planning', reading: 'reading', completed: 'completed', on_hold: 'paused', dropped: 'dropped' };

// A published build ships the project's own MAL app + Worker so users can just click Connect.
// Self-hosters override both in Setup; the client id is public, the secret lives only in the Worker.
const DEFAULT_CLIENT_ID = '90679c18c60bfeaec1949de73dc632e9';
const DEFAULT_WORKER = 'https://kura-mal.huzbipers-o-n-al.workers.dev';

const K = { clientId: 'mal.clientId', worker: 'mal.worker', token: 'mal.token', refresh: 'mal.refresh', expires: 'mal.expires' };

async function get() {
  const s = await chrome.storage.local.get(Object.values(K));
  return { ...s, [K.worker]: s[K.worker] || DEFAULT_WORKER, [K.clientId]: s[K.clientId] || DEFAULT_CLIENT_ID };
}

export async function configured() {
  const s = await get();
  return Boolean(s[K.clientId] && s[K.worker]);
}

export async function setConfig({ clientId, worker }) {
  const set = {};
  const clear = [];
  if (clientId && clientId.trim()) set[K.clientId] = clientId.trim(); else clear.push(K.clientId);
  if (worker && worker.trim()) set[K.worker] = worker.trim().replace(/\/$/, ''); else clear.push(K.worker);
  if (Object.keys(set).length) await chrome.storage.local.set(set);
  if (clear.length) await chrome.storage.local.remove(clear);
}

export async function token() {
  const s = await get();
  if (!s[K.token]) return null;
  if (s[K.expires] && Date.now() > s[K.expires] - 60_000) return refresh(s);
  return s[K.token];
}

async function refresh(s) {
  try {
    const d = await jsonFetch(`${s[K.worker]}/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: s[K.refresh] }) });
    await chrome.storage.local.set({ [K.token]: d.access_token, [K.refresh]: d.refresh_token || s[K.refresh], [K.expires]: Date.now() + (d.expires_in || 3600) * 1000 });
    return d.access_token;
  } catch {
    return null; // re-auth needed
  }
}

export async function connect() {
  const s = await get();
  if (!s[K.clientId] || !s[K.worker]) throw new Error('Set the MAL client id and Worker URL first');
  const verifier = Array.from(crypto.getRandomValues(new Uint8Array(48))).map((b) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[b % 62]).join('');
  const redirect = chrome.identity.getRedirectURL('mal');
  const authUrl = 'https://myanimelist.net/v1/oauth2/authorize?' + new URLSearchParams({
    response_type: 'code', client_id: s[K.clientId], state: crypto.randomUUID(),
    redirect_uri: redirect, code_challenge: verifier, code_challenge_method: 'plain',
  });
  const back = await chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true });
  const code = new URL(back).searchParams.get('code');
  if (!code) throw new Error('MAL did not return a code');
  const d = await jsonFetch(`${s[K.worker]}/exchange`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, code_verifier: verifier, redirect_uri: redirect }),
  });
  await chrome.storage.local.set({ [K.token]: d.access_token, [K.refresh]: d.refresh_token, [K.expires]: Date.now() + (d.expires_in || 3600) * 1000 });
  return d.access_token;
}

export async function disconnect() {
  await chrome.storage.local.remove([K.token, K.refresh, K.expires]);
}

async function api(path, opts = {}) {
  const t = await token();
  if (!t) throw new Error('MAL is not connected');
  return jsonFetch(API + path, { ...opts, headers: { Authorization: `Bearer ${t}`, ...(opts.headers || {}) } });
}

export async function pull(series) {
  const id = series.links?.mal;
  if (!id) return null;
  try {
    const d = await api(`/manga/${id}/my_list_status`);
    return {
      ...emptyRemote(),
      chapter: d.num_chapters_read || 0,
      volume: d.num_volumes_read || 0,
      status: STATUS_IN[d.status] || null,
      rating: d.score || null,
      updatedAt: Date.parse(d.updated_at || '') || 0,
      raw: d,
    };
  } catch (e) {
    if (e.status === 404) return emptyRemote();
    throw e;
  }
}

export async function push(series, st) {
  const id = series.links?.mal;
  if (!id) return null;
  const form = new URLSearchParams();
  form.set('num_chapters_read', String(Math.max(0, Math.round(st.chapter || 0))));
  if (st.volume) form.set('num_volumes_read', String(Math.round(st.volume)));
  if (st.status) form.set('status', STATUS_OUT[st.status]);
  if (st.rating) form.set('score', String(Math.round(st.rating)));
  return api(`/manga/${id}/my_list_status`, { method: 'PATCH', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() });
}

/** pull the whole MAL manga list (paged) */
export async function importList() {
  const out = [];
  let offset = 0;
  const fields = 'list_status,num_chapters,num_volumes,main_picture,title';
  while (offset < 5000) {
    const d = await api(`/users/@me/mangalist?fields=${fields}&limit=1000&offset=${offset}&nsfw=true`);
    const rows = d?.data || [];
    for (const r of rows) {
      const n = r.node || {};
      const s = r.list_status || {};
      out.push({
        tracker: 'mal',
        id: n.id,
        title: n.title || null,
        cover: n.main_picture?.medium || n.main_picture?.large || null,
        total: n.num_chapters || 0,
        chapter: s.num_chapters_read || 0,
        volume: s.num_volumes_read || 0,
        status: STATUS_IN[s.status] || null,
        rating: s.score || null,
      });
    }
    if (rows.length < 1000) break;
    offset += 1000;
  }
  return out;
}

export async function search(query) {
  const d = await api(`/manga?q=${encodeURIComponent(query)}&limit=8&fields=title,main_picture,num_chapters`);
  return (d?.data || []).map((r) => ({ tracker: 'mal', id: r.node.id, title: r.node.title, cover: r.node.main_picture?.medium, total: r.node.num_chapters || 0 }));
}

export const meta = { id: 'mal', name: 'MyAnimeList', colour: '#2e51a2', connected: async () => Boolean(await token()) };
