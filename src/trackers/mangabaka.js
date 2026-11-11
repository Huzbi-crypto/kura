// trackers/mangabaka.js — MangaBaka via OAuth (public client + PKCE) or a personal access token.
//
// Auth rules from the MangaBaka docs, both easy to get wrong:
//   * a personal access token goes in the `x-api-key` header — NOT `Authorization: Bearer`
//     (that header is OAuth-only, and a PAT sent there fails with "Invalid access token")
//   * OAuth is a public client: no secret, PKCE S256, `openid` is mandatory in the scope
//     list, and each refresh rotates the refresh token.
import { jsonFetch, emptyRemote } from './base.js';

const API = 'https://api.mangabaka.org';
const AUTH_URL = 'https://mangabaka.org/auth/oauth2/authorize';
const TOKEN_URL = 'https://mangabaka.org/auth/oauth2/token';
const SCOPES = 'openid profile library.read library.write offline_access';

const K_PAT = 'mangabaka.token';       // personal access token
const K_OAUTH = 'mangabaka.oauth';     // { access, refresh, expires, sub }
const K_CLIENT = 'mangabaka.clientId'; // optional override for people running their own app

// Filled in once the Kura MangaBaka app exists (Native App / public / PKCE).
// Until then Connect explains what is missing instead of failing silently.
export const DEFAULT_CLIENT_ID = 'JsSOqiTcUOWAmxXDspFHLnxfisVuxutw';

const STATUS_OUT = { planning: 'plan_to_read', reading: 'reading', completed: 'completed', paused: 'paused', dropped: 'dropped', rereading: 'rereading' };
const STATUS_IN = Object.fromEntries(Object.entries(STATUS_OUT).map(([k, v]) => [v, k]));

/* ---------------- storage ---------------- */

export async function token() {
  const { [K_PAT]: t } = await chrome.storage.local.get(K_PAT);
  return t || null;
}

export async function setToken(t) {
  if (t) await chrome.storage.local.set({ [K_PAT]: t.trim() });
  else await chrome.storage.local.remove(K_PAT);
}

async function oauth() {
  const { [K_OAUTH]: o } = await chrome.storage.local.get(K_OAUTH);
  return o?.refresh || o?.access ? o : null;
}

async function saveTokens(tok) {
  const now = Math.floor(Date.now() / 1000);
  const prev = (await oauth()) || {};
  await chrome.storage.local.set({
    [K_OAUTH]: {
      access: tok.access_token || prev.access || null,
      // a rotated refresh token must replace the old one immediately: replaying a retired
      // token revokes every token the app holds for that user
      refresh: tok.refresh_token || prev.refresh || null,
      expires: tok.expires_in ? now + tok.expires_in : tok.expires_at || prev.expires || 0,
      sub: prev.sub || null,
      scope: tok.scope || prev.scope || null,
    },
  });
}

export async function clientId() {
  const { [K_CLIENT]: c } = await chrome.storage.local.get(K_CLIENT);
  return (c && c.trim()) || DEFAULT_CLIENT_ID || null;
}

export async function setClientId(id) {
  if (id) await chrome.storage.local.set({ [K_CLIENT]: id.trim() });
  else await chrome.storage.local.remove(K_CLIENT);
}

export async function disconnect() {
  await chrome.storage.local.remove([K_PAT, K_OAUTH]);
}

/* ---------------- oauth ---------------- */

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function pkcePair() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: b64url(digest) };
}

async function tokenRequest(params) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(params).toString(),
  });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* oauth errors are still json, but be safe */ }
  if (!res.ok) {
    const why = body?.error_description || body?.error || text.slice(0, 120) || res.status;
    throw new Error(`MangaBaka sign-in failed: ${why}`);
  }
  return body;
}

/** one sign-in for the current user; the redirect is the extension's own callback */
export async function connect() {
  const cid = await clientId();
  if (!cid) {
    throw new Error('MangaBaka sign-in is not configured yet — use a personal access token under Advanced');
  }
  const redirect = chrome.identity.getRedirectURL('mangabaka');
  const { verifier, challenge } = await pkcePair();
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const url = `${AUTH_URL}?response_type=code`
    + `&client_id=${encodeURIComponent(cid)}`
    + `&redirect_uri=${encodeURIComponent(redirect)}`
    + `&scope=${encodeURIComponent(SCOPES)}`
    + `&state=${state}&code_challenge=${challenge}&code_challenge_method=S256`;

  const back = await chrome.identity.launchWebAuthFlow({ url, interactive: true });
  if (!back) throw new Error('MangaBaka sign-in was cancelled');
  const q = new URL(back).searchParams;
  if (q.get('error')) throw new Error(`MangaBaka sign-in failed: ${q.get('error_description') || q.get('error')}`);
  if (q.get('state') !== state) throw new Error('MangaBaka sign-in failed: state mismatch');
  const code = q.get('code');
  if (!code) throw new Error('MangaBaka sign-in failed: no code returned');

  const tok = await tokenRequest({
    grant_type: 'authorization_code', code, redirect_uri: redirect, client_id: cid, code_verifier: verifier,
  });
  await saveTokens(tok);
  // a stale personal token must not linger and shadow (or outlive) the OAuth session
  await chrome.storage.local.remove(K_PAT);
  return true;
}

let refreshing = null; // single-flight: two concurrent refreshes revoke the whole session

async function accessToken() {
  const o = await oauth();
  if (!o?.access) return null;
  const now = Math.floor(Date.now() / 1000);
  if (o.expires && o.expires - 90 > now) return o.access;
  if (!o.refresh) return o.access;
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const tok = await tokenRequest({ grant_type: 'refresh_token', refresh_token: o.refresh, client_id: await clientId() });
        await saveTokens(tok);
        return (await oauth())?.access || null;
      } catch (e) {
        if (/invalid_grant/.test(String(e.message))) await chrome.storage.local.remove(K_OAUTH);
        throw e;
      } finally {
        refreshing = null;
      }
    })();
  }
  return refreshing;
}

/* ---------------- api ---------------- */

export async function connected() {
  if (await token()) return 'token';
  if (await oauth()) return 'oauth';
  return null;
}

async function api(path, opts = {}) {
  const bearer = await accessToken();
  const pat = await token();
  if (!bearer && !pat) throw new Error('MangaBaka is not connected');
  const auth = bearer
    ? { Authorization: `Bearer ${bearer}` }
    : { 'x-api-key': pat };
  return jsonFetch(API + path, {
    ...opts,
    headers: { Accept: 'application/json', ...auth, ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers || {}) },
  });
}

export async function pull(series) {
  const id = series.links?.mangabaka;
  if (!id) return null;
  try {
    const d = await api(`/v2/my/library/${id}`);
    const e = d?.data?.entry || d?.data?.library_entry || d?.data || {};
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
  const d = await api(`/v2/my/library/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
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
    const d = await jsonFetch(`${API}/v1/series/search?q=${encodeURIComponent(query)}&type=manga`, { headers: { Accept: 'application/json' } });
    rows = d?.data || d?.results || [];
  } catch {
    const d = await jsonFetch(`${API}/v2/series/search?q=${encodeURIComponent(query)}&type=manga&limit=10`, { headers: { Accept: 'application/json' } });
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
    const d = await api(`/v2/my/library?limit=100&page=${page}`);
    const rows = d?.data || [];
    if (!rows.length) break;
    for (const e of rows) {
      const entry = e.entry || e;
      const s = e.series || e;
      const seriesId = entry.series_id ?? s.series_id ?? s.id ?? null;
      if (!seriesId) continue;
      out.push({
        tracker: 'mangabaka',
        id: seriesId,
        title: seriesTitle(s) || null,
        cover: coverUrl(s),
        total: s.total_chapters || 0,
        chapter: entry.progress_chapter || 0,
        volume: entry.progress_volume || 0,
        status: STATUS_IN[entry.state] || null,
        rating: entry.rating == null ? null : Math.round(entry.rating / 10),
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
    const d = await jsonFetch(`${API}/v1/source/${p}/${externalId}`, { headers: { Accept: 'application/json' } });
    const s = d?.data || d;
    return s?.id ? s : null;
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
}

/** series metadata by id: cover, chapter count, and the bridged source ids */
export async function metaFor(id) {
  const d = await jsonFetch(`${API}/v1/series/${id}`, { headers: { Accept: 'application/json' } });
  const s = d?.data || d;
  if (!s?.id) return null;
  return { cover: coverUrl(s), total: s.total_chapters || s.final_volume || 0, title: seriesTitle(s), source: s.source, raw: s };
}

export const meta = { id: 'mangabaka', name: 'MangaBaka', colour: '#e35d3a', connected: async () => Boolean(await connected()) };
