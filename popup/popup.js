import * as anilist from '../src/trackers/anilist.js';
import * as mal from '../src/trackers/mal.js';
import * as mangabaka from '../src/trackers/mangabaka.js';

const $ = (s) => document.querySelector(s);
const send = (msg) => chrome.runtime.sendMessage(msg);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

const TRACKERS = [
  { id: 'anilist', name: 'AniList' },
  { id: 'mal', name: 'MAL' },
  { id: 'mangabaka', name: 'MB' },
];

let lib = { items: [], connected: {} };

function dots(links = {}, trackers = {}) {
  const wrap = el('div', 'dots');
  for (const t of TRACKERS) {
    if (!links[t.id]) continue;
    const d = el('i', 'dot ' + (trackers[t.id]?.state || ''));
    d.title = `${t.name}: ${trackers[t.id]?.state || 'not synced'}`;
    wrap.append(d);
  }
  return wrap;
}

function card(item) {
  const st = item.state || {};
  const total = item.total || 0;
  const pct = total ? Math.min(100, Math.round((st.chapter || 0) / total * 100)) : 0;

  const root = el('div', 'card-series');
  const cover = el('div', 'cover');
  if (item.cover) cover.style.backgroundImage = `url("${item.cover}")`;
  if (total) cover.append(el('span', 'total', `${total} ch`));
  const body = el('div', 'body');
  body.append(el('div', 'title', item.title));

  const meta = el('div', 'meta');
  meta.append(el('span', null, `ch ${st.chapter || 0}${total ? ' / ' + total : ''}`), dots(item.links, st.trackers));
  body.append(meta);

  const bar = el('div', 'progress');
  const fill = el('i'); fill.style.width = pct + '%'; bar.append(fill);
  body.append(bar);

  const actions = el('div', 'card-actions');
  const plus = el('button', 'primary', '+1');
  plus.onclick = async (e) => { e.stopPropagation(); await send({ type: 'bump', seriesId: item.id, by: 1 }); refresh(); };
  const sync = el('button', null, 'Sync');
  sync.onclick = async (e) => { e.stopPropagation(); sync.textContent = '…'; await send({ type: 'syncOne', seriesId: item.id }); refresh(); };
  actions.append(plus, sync);
  body.append(actions);

  root.append(cover, body);
  return root;
}

function paintChips() {
  const chips = $('#chips');
  chips.innerHTML = '';
  for (const t of TRACKERS) {
    const c = el('div', 'chip' + (lib.connected[t.id] ? ' on' : ''), t.name);
    c.prepend(el('i', 'dot'));
    c.onclick = () => show('settings');
    chips.append(c);
  }
}

function renderLibrary() {
  const grid = $('#grid');
  const q = ($('#filter').value || '').toLowerCase().trim();
  const items = lib.items.filter((i) => !q || i.title.toLowerCase().includes(q));
  grid.innerHTML = '';
  grid.hidden = items.length === 0;
  $('#empty').hidden = items.length > 0;
  for (const item of items) grid.append(card(item));
}

async function refresh() {
  lib = await send({ type: 'library' });
  paintChips();
  renderLibrary();
}

function show(view) {
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + view));
  if (view === 'settings') hydrateSettings();
  if (view === 'library') refresh();
}

/* ---------- search / add ---------- */
async function search() {
  const q = $('#q').value.trim();
  const out = $('#results');
  if (!q) return;
  out.innerHTML = '';
  out.append(el('p', 'muted', 'Searching…'));
  try {
    const rows = await mangabaka.search(q);
    out.innerHTML = '';
    if (!rows.length) out.append(el('p', 'muted', 'No match.'));
    for (const r of rows) {
      const row = el('div', 'result');
      const img = el('img'); if (r.cover) img.src = r.cover;
      const t = el('div', 't');
      t.append(el('div', null, r.title), el('div', 'muted', `${r.total || '?'} chapters`));
      const add = el('button', null, 'Add');
      add.onclick = async () => {
        add.textContent = '…';
        await send({ type: 'add', title: r.title, cover: r.cover, total: r.total, links: { mangabaka: r.id } });
        add.textContent = '✓';
        setTimeout(refresh, 400);
      };
      row.append(img, t, add);
      out.append(row);
    }
  } catch (e) {
    out.innerHTML = '';
    out.append(el('p', 'muted', 'Search failed: ' + e.message));
  }
}

/* ---------- import ---------- */
async function runImport(tracker) {
  const stateEl = tracker ? document.querySelector('#' + tracker + '-state') : null;
  if (stateEl) stateEl.textContent = 'importing…';
  try {
    const r = await send({ type: 'import', tracker });
    const n = tracker ? (r.created || 0) + (r.updated || 0)
      : (r.results || []).reduce((a, x) => a + (x.created || 0) + (x.updated || 0), 0);
    if (stateEl) stateEl.textContent = `connected · ${n} series`;
    await refresh();
    return n;
  } catch (e) {
    if (stateEl) stateEl.textContent = 'import failed: ' + e.message;
    return 0;
  }
}

/* ---------- settings ---------- */
const KEYS = { anilistClient: 'anilist.clientId', malClient: 'mal.clientId', malWorker: 'mal.worker' };

async function hydrateSettings() {
  const s = await chrome.storage.local.get(Object.values(KEYS));
  $('#anilist-client').value = s[KEYS.anilistClient] || '';
  $('#mal-client').value = s[KEYS.malClient] || '';
  $('#mal-worker').value = s[KEYS.malWorker] || '';
  $('#anilist-state').textContent = (await anilist.meta.connected()) ? 'connected' : 'not connected';
  $('#anilist-state').className = 'state ' + ((await anilist.meta.connected()) ? 'on' : '');
  $('#mal-state').textContent = (await mal.meta.connected()) ? 'connected' : 'not connected';
  $('#mal-state').className = 'state ' + ((await mal.meta.connected()) ? 'on' : '');
  $('#mb-state').textContent = (await mangabaka.meta.connected()) ? 'connected' : 'not connected';
  $('#mb-state').className = 'state ' + ((await mangabaka.meta.connected()) ? 'on' : '');
  $('#redirects').textContent = chrome.identity.getRedirectURL('anilist') + '\n' + chrome.identity.getRedirectURL('mal');
}

function bindSettings() {
  $('#anilist-connect').onclick = async () => {
    const id = $('#anilist-client').value.trim();
    if (id) await chrome.storage.local.set({ [KEYS.anilistClient]: id });
    else await chrome.storage.local.remove(KEYS.anilistClient);
    $('#anilist-state').textContent = 'waiting…';
    try { await anilist.connect(id || undefined); } catch (e) { $('#anilist-state').textContent = e.message; return; }
    await runImport('anilist');
    hydrateSettings();
  };
  $('#mal-connect').onclick = async () => {
    await mal.setConfig({ clientId: $('#mal-client').value, worker: $('#mal-worker').value });
    $('#mal-state').textContent = 'waiting…';
    try { await mal.connect(); } catch (e) { $('#mal-state').textContent = e.message; return; }
    await runImport('mal');
    hydrateSettings();
  };
  $('#mb-save').onclick = async () => {
    await mangabaka.setToken($('#mb-token').value);
    await runImport('mangabaka');
    hydrateSettings();
  };
  for (const t of ['anilist', 'mal', 'mangabaka']) {
    const b = $('#import-' + t);
    if (b) b.onclick = () => runImport(t);
  }
}

/* ---------- boot ---------- */
document.querySelectorAll('.tabs button').forEach((b) => (b.onclick = () => show(b.dataset.view)));
$('#filter').oninput = renderLibrary;
$('#go').onclick = search;
$('#q').addEventListener('keydown', (e) => { if (e.key === 'Enter') search(); });
$('#import-all').onclick = async () => {
  const b = $('#import-all'); b.textContent = 'Importing…'; b.disabled = true;
  try { await send({ type: 'import' }); } finally { b.textContent = 'Import from my trackers'; b.disabled = false; refresh(); }
};
$('#sync-all').onclick = async () => {
  const b = $('#sync-all'); b.textContent = 'Syncing…'; b.disabled = true;
  try { await send({ type: 'sync' }); } finally { b.textContent = 'Sync all'; b.disabled = false; refresh(); }
};
bindSettings();
refresh();
