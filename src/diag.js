// diag.js — a small ring buffer of what Kura actually did, so failures can be read back
// instead of guessed at. Everything here is local, capped, and safe to show the user.
const KEY = 'kura.diag';
const MAX = 60;

export async function logEvent(kind, msg, data = {}) {
  try {
    const { [KEY]: list = [] } = await chrome.storage.local.get(KEY);
    // stamp the build: three of these conversations were spent working out which version was
    // actually running from the shape of the log
    const v = chrome.runtime?.getManifest?.().version || '?';
    list.unshift({ t: Date.now(), v, kind, msg, data });
    await chrome.storage.local.set({ [KEY]: list.slice(0, MAX) });
  } catch { /* diagnostics must never break the caller */ }
  console.log('[kura]', kind, msg, data);
}

export async function readEvents(limit = 20) {
  const { [KEY]: list = [] } = await chrome.storage.local.get(KEY);
  return list.slice(0, limit);
}

export async function clearEvents() {
  await chrome.storage.local.remove(KEY);
}
