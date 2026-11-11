// mapping.js — one series, three tracker ids.
// MangaBaka is the bridge: /v1/series/{id} carries source.anilist.id and source.my_anime_list.id,
// and /v1/source/{anilist|my-anime-list}/{id} goes the other way.
import { jsonFetch } from './trackers/base.js';
import * as mangabaka from './trackers/mangabaka.js';
import { series as S, uid, normTitle } from './db.js';

const MB = 'https://api.mangabaka.org/v1';

export function newSeries({ title, cover = null, total = 0, links = {} }) {
  return { id: uid(), title, normTitle: normTitle(title), cover, total, links: { ...links }, createdAt: Date.now() };
}

async function mbSeries(id) {
  try {
    const d = await jsonFetch(`${MB}/series/${id}`, { headers: { Accept: 'application/json' } });
    return d?.data || d || null;
  } catch { return null; }
}

/** fill in whatever ids are still missing */
export async function resolveLinks(s) {
  const before = JSON.stringify(s.links || {});
  s.links = s.links || {};

  if (s.links.mangabaka) {
    const d = await mbSeries(s.links.mangabaka);
    if (d) {
      if (!s.cover) s.cover = d.cover?.raw?.url || d.cover?.x150?.url || d.cover?.large || null;
      if (!s.total) s.total = d.total_chapters || d.final_volume || 0;
      if (d.source?.anilist?.id && !s.links.anilist) s.links.anilist = d.source.anilist.id;
      if (d.source?.my_anime_list?.id && !s.links.mal) s.links.mal = d.source.my_anime_list.id;
    }
  }

  if (!s.links.mangabaka) {
    for (const [tracker, provider] of [['mal', 'mal'], ['anilist', 'anilist']]) {
      if (!s.links[tracker]) continue;
      const hit = await mangabaka.fromSource(provider, s.links[tracker]);
      if (hit?.id) { s.links.mangabaka = hit.id; break; }
    }
    if (s.links.mangabaka) return resolveLinks(s); // one more pass now that MangaBaka is known
  }

  if (JSON.stringify(s.links) !== before) await S.put(s);
  return s;
}

export const findByTitle = (title) => S.byTitle(normTitle(title));
