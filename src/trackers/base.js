// trackers/base.js — shared helpers and the internal status vocabulary.
export const STATUS = ['planning', 'reading', 'completed', 'paused', 'dropped', 'rereading'];

export async function jsonFetch(url, opts = {}) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) {
    const msg = (body && (body.message || body.error?.message || body.errors?.[0]?.message)) || text.slice(0, 200);
    const err = new Error(`${res.status} ${msg || res.statusText}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

export const clampChapter = (n) => {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? Math.round(v * 10) / 10 : 0;
};

/** every tracker reports a slightly different picture of the same series */
export function emptyRemote() {
  return { chapter: 0, volume: 0, status: null, rating: null, updatedAt: 0, raw: null };
}
