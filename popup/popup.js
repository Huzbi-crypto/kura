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

/* a visible error surface: silent failures are worse than loud ones */
let toastTimer;
function showToast(msg, ms = 5000) {
  let t = document.getElementById('toast');
  if (!t) { t = el('div', 'toast'); t.id = 'toast'; document.body.append(t); }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

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
// the state element ids do not follow the tracker ids (mangabaka -> #mb-state); getting this wrong
// silently swallowed every MangaBaka import result and error
const STATE_SEL = { anilist: '#anilist-state', mal: '#mal-state', mangabaka: '#mb-state' };

async function runImport(tracker) {
  const stateEl = tracker ? $(STATE_SEL[tracker] || '#' + tracker + '-state') : null;
  if (stateEl) stateEl.textContent = 'importing…';
  try {
    const r = await send({ type: 'import', tracker });
    const n = tracker ? (r.created || 0) + (r.updated || 0)
      : (r.results || []).reduce((a, x) => a + (x.created || 0) + (x.updated || 0), 0);
    if (stateEl) {
      const bad = tracker ? null : (r.results || []).find((x) => x.error || x.note);
      stateEl.textContent = r.note ? `connected · ${r.note}`
        : n ? `connected · ${n} series`
        : bad ? `connected · ${bad.error || bad.note}`
        : 'connected · 0 series';
      stateEl.className = 'state ' + (r.note || bad ? 'warn' : 'on');
    }
    await refresh();
    return n;
  } catch (e) {
    if (stateEl) { stateEl.textContent = 'import failed: ' + e.message; stateEl.className = 'state err'; }
    showToast('import failed: ' + e.message);
    return 0;
  }
}

/* ---------- settings ---------- */
const KEYS = { anilistClient: 'anilist.clientId', malClient: 'mal.clientId', malWorker: 'mal.worker', mbClient: 'mangabaka.clientId' };

async function paintState(sel, ok, extra = 'connected') {
  const el = $(sel);
  el.textContent = ok ? extra : 'not connected';
  el.className = 'state ' + (ok ? 'on' : '');
}

async function hydrateSettings() {
  const s = await chrome.storage.local.get(Object.values(KEYS));
  // Kura's own ids are compiled in and identical for every user; they are shown as placeholders so
  // an empty box means "use Kura's app", and a filled box means "the user brought their own".
  // Older builds copied the default into storage, which read as if the user had set it.
  const showOverride = async (sel, key, dflt) => {
    const stored = s[key];
    if (stored && stored === dflt) await chrome.storage.local.remove(key);
    $(sel).value = stored && stored !== dflt ? stored : '';
    $(sel).placeholder = dflt ? `Kura's default — ${dflt}` : 'optional';
  };
  await showOverride('#anilist-client', KEYS.anilistClient, anilist.DEFAULT_CLIENT_ID);
  await showOverride('#mal-client', KEYS.malClient, mal.DEFAULT_CLIENT_ID);
  await showOverride('#mal-worker', KEYS.malWorker, mal.DEFAULT_WORKER);
  await showOverride('#mb-client', KEYS.mbClient, mangabaka.DEFAULT_CLIENT_ID);
  await paintState('#anilist-state', await anilist.meta.connected());
  await paintState('#mal-state', await mal.meta.connected());
  const kind = await mangabaka.connected();
  await paintState('#mb-state', Boolean(kind), kind === 'token' ? 'connected · token' : 'connected');
  $('#redirects').textContent = [chrome.identity.getRedirectURL('anilist'), chrome.identity.getRedirectURL('mal'), chrome.identity.getRedirectURL('mangabaka')].join('\n');
}

async function loadDiag() {
  const box = $('#diag-log');
  if (!box) return;
  try {
    const r = await send({ type: 'diag' });
    const events = r?.events || [];
    $('#diag-count').textContent = events.length ? `${events.length} recent` : '';
    box.textContent = events.length
      ? events.map((e) => {
        const t = new Date(e.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const extra = e.data && (e.data.host || e.data.title)
          ? ' · ' + [e.data.host, e.data.title, e.data.chapter != null ? 'ch ' + e.data.chapter : ''].filter(Boolean).join(' / ')
          : '';
        return `${t}  ${e.msg}${extra}`;
      }).join('\n')
      : 'no events yet — open a chapter on a reader site';
  } catch (e) {
    box.textContent = 'could not read activity: ' + e.message;
  }
  const sites = (chrome.runtime.getManifest().content_scripts || [])
    .flatMap((c) => c.matches.map((m) => m.replace(/^https:\/\//, '').replace(/\/\*$/, '')))
    .join(', ');
  $('#watch-sites').textContent = 'Reader sites Kura watches: ' + (sites || 'none');
}

function bindSettings() {
  $('#diag-refresh').onclick = () => loadDiag();
  $('#diag-clear').onclick = async () => { await send({ type: 'clearDiag' }); loadDiag(); };
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
    const id = $('#mb-client').value.trim();
    if (id) await chrome.storage.local.set({ [KEYS.mbClient]: id });
    else await chrome.storage.local.remove(KEYS.mbClient);
    await mangabaka.setToken($('#mb-token').value);
    await runImport('mangabaka');
    hydrateSettings();
  };
  $('#mb-connect').onclick = async () => {
    const id = $('#mb-client').value.trim();
    if (id) await chrome.storage.local.set({ [KEYS.mbClient]: id });
    $('#mb-state').textContent = 'waiting…';
    try { await mangabaka.connect(); } catch (e) { $('#mb-state').textContent = e.message; $('#mb-state').className = 'state err'; return; }
    await runImport('mangabaka');
    hydrateSettings();
  };
  for (const t of ['anilist', 'mal', 'mangabaka']) {
    const b = $('#import-' + t);
    if (b) b.onclick = () => runImport(t);
  }
}

/* ---------- boot ---------- */
document.querySelectorAll('.tabs button').forEach((b) => (b.onclick = () => { show(b.dataset.view); if (b.dataset.view === 'settings') loadDiag(); }));
$('#filter').oninput = renderLibrary;
$('#go').onclick = search;
$('#q').addEventListener('keydown', (e) => { if (e.key === 'Enter') search(); });
$('#import-all').onclick = async () => {
  const b = $('#import-all'); b.textContent = 'Importing…'; b.disabled = true;
  try {
    const r = await send({ type: 'import' });
    const bad = (r?.results || []).filter((x) => x.error || x.note);
    if (bad.length) showToast(bad.map((x) => `${x.tracker}: ${x.error || x.note}`).join(' · '));
  } catch (e) {
    showToast('import failed: ' + e.message);
  } finally { b.textContent = 'Import from my trackers'; b.disabled = false; refresh(); }
};
$('#sync-all').onclick = async () => {
  const b = $('#sync-all'); b.textContent = 'Syncing…'; b.disabled = true;
  try { await send({ type: 'sync' }); } finally { b.textContent = 'Sync all'; b.disabled = false; refresh(); }
};
bindSettings();
refresh();
