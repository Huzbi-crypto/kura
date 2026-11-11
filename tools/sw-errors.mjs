// sw-errors.mjs — inspect the extension's service worker: are the message listeners registered?
// usage: node tools/sw-errors.mjs [extensionDir]
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const dir = resolve(process.argv[2] || 'C:/Users/huzbi/Projects/kura');
const EDGE = process.env.BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9455;
const profile = mkdtempSync(join(tmpdir(), 'kura-sw-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  `--disable-extensions-except=${dir}`, `--load-extension=${dir}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });

let version;
for (let i = 0; i < 60; i++) { try { version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); break; } catch { await sleep(300); } }
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pending = new Map(); const events = [];
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
  else if (m.method) events.push(m);
});
const send = (method, params = {}, sessionId) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });

let sw = null;
for (let i = 0; i < 40 && !sw; i++) {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  for (const c of list.filter((t) => t.type === 'service_worker')) {
    try {
      const { sessionId } = await send('Target.attachToTarget', { targetId: c.id, flatten: true });
      const m = await send('Runtime.evaluate', { expression: 'chrome.runtime.getManifest().name', returnByValue: true }, sessionId);
      if (String(m.result.value || '').startsWith('Kura')) { sw = { ...c, sessionId }; break; }
    } catch {}
  }
  if (!sw) await sleep(400);
}
if (!sw) { console.error('no service worker'); browser.kill(); process.exit(1); }

await send('Runtime.enable', {}, sw.sessionId);
await send('Log.enable', {}, sw.sessionId).catch(() => {});
await sleep(500);

const probe = await send('Runtime.evaluate', {
  expression: `JSON.stringify({
    listenersRegistered: chrome.runtime.onMessage.hasListeners(),
    alarmListeners: chrome.alarms.onAlarm.hasListeners(),
    manifestName: chrome.runtime.getManifest().name,
    redirects: ['anilist', 'mal', 'mangabaka'].map(p => chrome.identity.getRedirectURL(p))
  })`, returnByValue: true,
}, sw.sessionId);
console.log('probe:', probe.result.value);

for (const e of events) {
  if (e.method === 'Runtime.exceptionThrown') console.log('EXCEPTION:', JSON.stringify(e.params.exceptionDetails).slice(0, 600));
  if (e.method === 'Runtime.consoleAPICalled') console.log('console:', e.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 300));
  if (e.method === 'Log.entryAdded') console.log('log:', e.params.entry.level, e.params.entry.text.slice(0, 300));
}

// popup page: catch module-level exceptions
const extId = new URL(sw.url).host;
const page = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId: pageSession } = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
await send('Runtime.enable', {}, pageSession);
await send('Log.enable', {}, pageSession).catch(() => {});
await send('Page.enable', {}, pageSession);
await send('Page.navigate', { url: `chrome-extension://${extId}/popup/popup.html` }, pageSession);
await sleep(2500);
const pageProbe = await send('Runtime.evaluate', {
  expression: `JSON.stringify({ cards: document.querySelectorAll('.card-series').length, chips: document.querySelectorAll('.chip').length, hasImportAll: !!document.getElementById('import-all') })`,
  returnByValue: true,
}, pageSession);
console.log('popup probe:', pageProbe.result.value);

// Setup tab: no inputs should be visible, three Connect buttons should be
await send('Runtime.evaluate', { expression: `document.querySelector('[data-view=settings]').click()` }, pageSession);
await sleep(700);
const setupProbe = await send('Runtime.evaluate', {
  expression: `(() => {
    const vis = (el) => !!(el && el.offsetParent !== null);
    const inputs = [...document.querySelectorAll('#view-settings input')].filter(vis).length;
    const connects = [...document.querySelectorAll('#view-settings button')].filter(vis).map(b => b.id).filter(id => /connect$/.test(id));
    const fields = ['anilist-client','mal-client','mb-client'].map(id => {
      const el = document.getElementById(id);
      return { id, value: el.value, placeholder: (el.placeholder || '').slice(0, 34) };
    });
    return JSON.stringify({ visibleInputs: inputs, connectButtons: connects, fields, state: [...document.querySelectorAll('#view-settings .state')].map(e => e.textContent) });
  })()`, returnByValue: true,
}, pageSession);
console.log('setup probe:', setupProbe.result.value);
const shot = await send('Page.captureScreenshot', { format: 'png' }, pageSession);
const { writeFileSync } = await import('node:fs');
writeFileSync('C:/Users/huzbi/Projects/kura/debug-setup.png', Buffer.from(shot.data, 'base64'));
for (const e of events) {
  if (e.sessionId !== pageSession) continue;
  if (e.method === 'Runtime.exceptionThrown') console.log('POPUP EXCEPTION:', JSON.stringify(e.params.exceptionDetails).slice(0, 500));
  if (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error') console.log('popup error:', e.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 300));
  if (e.method === 'Log.entryAdded') console.log('popup log:', e.params.entry.level, e.params.entry.text.slice(0, 300));
}

ws.close(); browser.kill();
await sleep(300); try { rmSync(profile, { recursive: true, force: true }); } catch {}
