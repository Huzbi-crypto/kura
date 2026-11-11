// trackers/anilist.js — implicit grant: the token comes back in the URL fragment,
// so there is no client secret and no backend.
import { jsonFetch, emptyRemote } from './base.js';

const API = 'https://graphql.anilist.co';
// public client id of the Kura AniList app; implicit grant means there is no secret to protect
export const DEFAULT_CLIENT_ID = '56681';
const TOKEN_KEY = 'anilist.token';
const STATUS_OUT = { planning: 'PLANNING', reading: 'CURRENT', completed: 'COMPLETED', paused: 'PAUSED', dropped: 'DROPPED', rereading: 'REPEATING' };
const STATUS_IN = Object.fromEntries(Object.entries(STATUS_OUT).map(([k, v]) => [v, k]));

export async function token() {
  const { [TOKEN_KEY]: t } = await chrome.storage.local.get(TOKEN_KEY);
  return t || null;
}

export async function connect(clientId = DEFAULT_CLIENT_ID) {
  const redirect = chrome.identity.getRedirectURL('anilist');
  const url = `https://anilist.co/api/v2/oauth/authorize?client_id=${encodeURIComponent(clientId)}&response_type=token`;
  const back = await chrome.identity.launchWebAuthFlow({ url, interactive: true });
  const frag = new URL(back).hash.replace(/^#/, '');
  const params = new URLSearchParams(frag);
  const access = params.get('access_token');
  if (!access) throw new Error('AniList did not return a token');
  await chrome.storage.local.set({ [TOKEN_KEY]: access });
  return access;
}

export async function disconnect() {
  await chrome.storage.local.remove(TOKEN_KEY);
}

export async function gql(query, variables, t) {
  const tok = t || (await token());
  if (!tok) throw new Error('AniList is not connected');
  return jsonFetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${tok}` },
    body: JSON.stringify({ query, variables }),
  });
}

const PULL = `query ($id: Int) {
  Media(id: $id, type: MANGA) {
    id title { romaji english } coverImage { large } chapters
    mediaListEntry { id progress progressVolumes status score updatedAt }
  }
}`;

export async function pull(series) {
  const id = series.links?.anilist;
  if (!id) return null;
  const d = await gql(PULL, { id });
  const m = d.data?.Media;
  const e = m?.mediaListEntry;
  return {
    ...emptyRemote(),
    chapter: e?.progress || 0,
    volume: e?.progressVolumes || 0,
    status: STATUS_IN[e?.status] || null,
    rating: e?.score || null,
    updatedAt: (e?.updatedAt || 0) * 1000,
    raw: m,
  };
}

const PUSH = `mutation ($id: Int, $progress: Int, $volumes: Int, $status: MediaListStatus, $score: Float) {
  SaveMediaListEntry(mediaId: $id, progress: $progress, progressVolumes: $volumes, status: $status, score: $score) {
    id progress status score
  }
}`;

export async function push(series, st) {
  const id = series.links?.anilist;
  if (!id) return null;
  const vars = { id, progress: Math.max(0, Math.round(st.chapter || 0)) };
  if (st.volume) vars.volumes = Math.round(st.volume);
  if (st.status) vars.status = STATUS_OUT[st.status];
  if (st.rating) vars.score = Math.round(st.rating);
  const d = await gql(PUSH, vars);
  return d.data?.SaveMediaListEntry || null;
}

/** pull the whole AniList manga list so the library can start from it */
export async function importList() {
  const v = await gql('query { Viewer { id name } }');
  const userId = v.data?.Viewer?.id;
  if (!userId) throw new Error('AniList: no viewer id');
  const d = await gql(`query ($u: Int) {
    MediaListCollection(userId: $u, type: MANGA) {
      lists { entries { mediaId progress progressVolumes status score media {
        id title { romaji english } coverImage { large } chapters } } }
    }
  }`, { u: userId });
  const lists = d.data?.MediaListCollection?.lists || [];
  const out = [];
  for (const list of lists) {
    for (const e of list.entries || []) {
      const m = e.media || {};
      out.push({
        tracker: 'anilist',
        id: e.mediaId || m.id,
        title: m.title?.english || m.title?.romaji || null,
        cover: m.coverImage?.large || null,
        total: m.chapters || 0,
        chapter: e.progress || 0,
        volume: e.progressVolumes || 0,
        status: STATUS_IN[e.status] || null,
        rating: e.score || null,
      });
    }
  }
  return out;
}

export async function search(query) {
  const d = await gql(`query ($q: String) { Page(perPage: 8) { media(search: $q, type: MANGA) { id title { romaji english } coverImage { large } chapters } } }`, { q: query });
  return (d.data?.Page?.media || []).map((m) => ({ tracker: 'anilist', id: m.id, title: m.title.english || m.title.romaji, cover: m.coverImage?.large, total: m.chapters || 0 }));
}

export const meta = { id: 'anilist', name: 'AniList', colour: '#02a9ff', connected: async () => Boolean(await token()) };
