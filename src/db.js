// db.js — IndexedDB store. Series are local-first; trackers are mirrors.
const DB_NAME = 'kura';
const DB_VERSION = 1;

let dbp = null;
export function db() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('series')) d.createObjectStore('series', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('state')) d.createObjectStore('state', { keyPath: 'seriesId' });
      if (!d.objectStoreNames.contains('queue')) d.createObjectStore('queue', { keyPath: 'id', autoIncrement: true });
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    try { out = fn(s); } catch (e) { reject(e); return; }
    t.oncomplete = () => resolve(out && out.__req ? out.__req.result : out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}
const wrap = (req) => ({ __req: req });

export const kv = {
  async get(key, fallback = null) { const v = await tx('kv', 'readonly', (s) => wrap(s.get(key))); return v === undefined ? fallback : v; },
  async set(key, value) { return tx('kv', 'readwrite', (s) => s.put(value, key)); },
};

export const series = {
  async all() { return (await tx('series', 'readonly', (s) => wrap(s.getAll()))) || []; },
  async get(id) { return tx('series', 'readonly', (s) => wrap(s.get(id))); },
  async put(obj) { return tx('series', 'readwrite', (s) => s.put(obj)); },
  async del(id) { await tx('series', 'readwrite', (s) => s.delete(id)); await tx('state', 'readwrite', (s) => s.delete(id)); },
  async byTitle(norm) {
    const all = await series.all();
    return all.find((s) => s.normTitle === norm) || null;
  },
};

export const state = {
  async get(seriesId) { return (await tx('state', 'readonly', (s) => wrap(s.get(seriesId)))) || { seriesId, chapter: 0, volume: 0, status: null, rating: null, trackers: {} }; },
  async put(obj) { return tx('state', 'readwrite', (s) => s.put(obj)); },
  async all() { return (await tx('state', 'readonly', (s) => wrap(s.getAll()))) || []; },
};

export const queue = {
  async add(job) { const id = await tx('queue', 'readwrite', (s) => wrap(s.add(job))); return id; },
  async due(now = Date.now()) {
    const all = (await tx('queue', 'readonly', (s) => wrap(s.getAll()))) || [];
    return all.filter((j) => (j.nextAt || 0) <= now);
  },
  async remove(id) { return tx('queue', 'readwrite', (s) => s.delete(id)); },
  async bump(id, job) { return tx('queue', 'readwrite', (s) => s.put({ ...job, id })); },
  async all() { return (await tx('queue', 'readonly', (s) => wrap(s.getAll()))) || []; },
};

export function normTitle(t) {
  return String(t || '')
    .toLowerCase()
    .replace(/[’'`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(the|a|an|manga|manhwa|manhua)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
