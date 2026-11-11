// verify-extension.mjs — load the unpacked extension in headless Chrome/Edge over CDP and prove
// three things: the service worker registers, the popup renders, and the storage/DB layer opens.
// usage: node tools/verify-extension.mjs [extensionDir]
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const dir = resolve(process.argv[2] || 'C:/Users/huzbi/Projects/kura');
const EDGE = process.env.BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9444;
const profile = mkdtempSync(join(tmpdir(), 'kura-verify-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = spawn(EDGE, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  `--disable-extensions-except=${dir}`, `--load-extension=${dir}`,
  '--no-first-run', '--no-default-browser-check', 'about:blank',
], { stdio: 'ignore' });

let version;
for (let i = 0; i < 60; i++) {
  try { version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); break; } catch { await sleep(300); }
}
if (!version) { console.error('browser did not start'); process.exit(1); }

const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pending = new Map();
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
});
const send = (method, params = {}, sessionId) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });

// 1. find the extension's service worker
let sw = null, extId = null;
for (let i = 0; i < 40 && !sw; i++) {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const candidates = list.filter((t) => t.type === 'service_worker');
  for (const c of candidates) {
    try {
      const { sessionId } = await send('Target.attachToTarget', { targetId: c.id, flatten: true });
      const m = await send('Runtime.evaluate', { expression: 'chrome.runtime.getManifest().name', returnByValue: true }, sessionId);
      if (String(m.result.value || '').startsWith('Kura')) { sw = c; extId = new URL(c.url).host; break; }
    } catch { /* not ours */ }
  }
  if (!sw) await sleep(500);
}
if (!sw) {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  console.error('service worker not found. targets:', list.map((t) => `${t.type} ${t.url}`).join('\n  '));
  browser.kill(); process.exit(1);
}
console.log('service worker: OK  id=' + extId);

// 2. talk to the worker: is the message router alive?
const { sessionId: swSession } = await send('Target.attachToTarget', { targetId: sw.id, flatten: true });
const swEval = await send('Runtime.evaluate', {
  expression: `JSON.stringify({ id: chrome.runtime.id, hasIndexedDB: typeof indexedDB !== 'undefined', hasAlarms: typeof chrome.alarms !== 'undefined' })`,
  returnByValue: true,
}, swSession);
console.log('message router:', swEval.result.value);
const modCheck = await send('Runtime.evaluate', {
  expression: `(async () => {
    try {
      const db = await import(chrome.runtime.getURL('src/db.js'));
      const sync = await import(chrome.runtime.getURL('src/sync.js'));
      const bg = await import(chrome.runtime.getURL('src/background.js')).catch(e => ({ __err: e.message }));
      return JSON.stringify({ db: Object.keys(db), sync: Object.keys(sync), bg: bg.__err || 'loaded' });
    } catch (e) { return 'IMPORT FAIL: ' + (e && e.message); }
  })()`, awaitPromise: true, returnByValue: true,
}, swSession);
console.log('modules:', modCheck.result.value);

// 3. open the popup page and check it painted
const page = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
await send('Page.enable', {}, sessionId);
await send('Runtime.enable', {}, sessionId);
await send('Page.navigate', { url: `chrome-extension://${extId}/popup/popup.html` }, sessionId);
await sleep(2500);
const probe = await send('Runtime.evaluate', {
  expression: `JSON.stringify({ ready: document.readyState, html: document.documentElement.outerHTML.length, body: document.body ? document.body.innerText.slice(0,120) : null,
    title: document.title,
    tabs: [...document.querySelectorAll('.tabs button')].map(b => b.textContent.trim()),
    settingsCards: [...document.querySelectorAll('#view-settings h3')].map(h => h.textContent.trim()),
    empty: document.querySelector('#empty') ? !document.querySelector('#empty').hidden : null,
    error: window.__kuraError || null,
    moduleLoaded: !!document.querySelector('.tabs button.active')
  })`, returnByValue: true,
}, sessionId);
console.log('popup:', probe.result.value);

// 4. smoke: add a series through the message router and bump it, with no tracker connected
const smoke = await send('Runtime.evaluate', {
  expression: `(async () => {
    const added = await chrome.runtime.sendMessage({ type: 'add', title: 'Smoke Test Manga', links: {}, total: 120 });
    const bumped = await chrome.runtime.sendMessage({ type: 'bump', seriesId: added.id, by: 1 });
    const lib2 = await chrome.runtime.sendMessage({ type: 'library' });
    return JSON.stringify({ added: !!added.id, chapter: bumped.chapter, items: lib2.items.length, first: lib2.items[0]?.title });
  })()`, awaitPromise: true, returnByValue: true,
}, sessionId);
console.log('smoke:', smoke.result.value);
await send('Runtime.evaluate', { expression: 'location.reload()' }, sessionId);
await sleep(2000);
const cardProbe = await send('Runtime.evaluate', {
  expression: "(() => { const c = document.querySelector('.card-series'); if (!c) return 'no card'; return c.outerHTML.slice(0, 500).replace(/\\s+/g,' '); })()",
  returnByValue: true,
}, sessionId);
console.log('card:', cardProbe.result.value);
await send('Runtime.evaluate', { expression: 'location.reload()' }, sessionId);
await sleep(2000);

const shot = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
writeFileSync(join(dir, 'verify-popup.png'), Buffer.from(shot.data, 'base64'));
console.log('screenshot -> ' + join(dir, 'verify-popup.png'));

ws.close();
browser.kill();
await sleep(400);
try { rmSync(profile, { recursive: true, force: true }); } catch {}
