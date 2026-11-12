// test-overlay.mjs — loads the real overlay.js against a fake chapter page and checks the two
// behaviours that were missing: in-chapter scroll percentage, and a "chapter finished" signal.
// chrome.runtime is stubbed so every message the overlay sends is observable.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';

const dir = resolve('C:/Users/huzbi/Projects/kura');
const overlaySrc = readFileSync(join(dir, 'src/content/overlay.js'), 'utf8');
const EDGE = process.env.BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9477;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// a reader page: tall images, chapter in the title, scrollable body
const page = `<!doctype html><html><head><meta charset="utf-8">
<title>Fake Manga Ch. 42 | Reader</title>
<meta property="og:title" content="Fake Manga Ch. 42 | Reader">
<style>body{margin:0;background:#111}img{display:block;width:100%;height:900px;background:#333;margin-bottom:8px}</style>
</head><body>${Array.from({ length: 8 }, (_, i) => `<img alt="page ${i}">`).join('')}</body></html>`;
const server = createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(page); });
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const profile = mkdtempSync(join(tmpdir(), 'kura-ovl-'));
const browser = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${PORT + 1}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--window-size=900,800', 'about:blank'], { stdio: 'ignore' });

let version;
for (let i = 0; i < 60; i++) { try { version = await (await fetch(`http://127.0.0.1:${PORT + 1}/json/version`)).json(); break; } catch { await sleep(300); } }
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pending = new Map();
ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } });
const send = (method, params = {}, sessionId) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });

const { targetId } = await send('Target.createTarget', { url: `http://127.0.0.1:${PORT}/chapter/42` });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Runtime.enable', {}, sessionId);
await send('Page.enable', {}, sessionId);
await sleep(1200);

// stub the extension bridge, then inject the real content script
await send('Runtime.evaluate', {
  expression: `window.__sent = []; window.chrome = { runtime: { sendMessage: (m) => { window.__sent.push(m); return Promise.resolve({ ok: true, trackers: { anilist: { state: 'synced' }, mangabaka: { state: 'synced' } } }); } } };`,
}, sessionId);
await send('Runtime.evaluate', { expression: overlaySrc, awaitPromise: false }, sessionId);
await sleep(900);

const readPill = `(() => {
  const host = document.querySelector('body > div:last-child');
  const root = host && host.shadowRoot;
  const read = root && root.querySelector('.read');
  const input = root && root.querySelector('input.ch');
  const btn = root && root.querySelector('button');
  return JSON.stringify({
    read: read ? read.textContent : null,
    label: root && root.querySelector('.label')?.textContent,
    chapterInputVisible: !!(input && input.offsetWidth > 0),
    action: btn ? btn.textContent : null,
  });
})()`;

const opened = await send('Runtime.evaluate', { expression: readPill, returnByValue: true }, sessionId);
console.log('on open       ->', opened.result.value);

await send('Runtime.evaluate', { expression: `window.scrollTo(0, document.body.scrollHeight * 0.45);` }, sessionId);
await sleep(300);
const mid = await send('Runtime.evaluate', { expression: readPill, returnByValue: true }, sessionId);
console.log('45% scrolled  ->', mid.result.value);

await send('Runtime.evaluate', { expression: `window.scrollTo(0, document.body.scrollHeight);` }, sessionId);
await sleep(700);
const end = await send('Runtime.evaluate', { expression: readPill, returnByValue: true }, sessionId);
console.log('at the end    ->', end.result.value);

const sent = await send('Runtime.evaluate', { expression: `JSON.stringify(window.__sent.map(m => ({ type: m.type, chapter: m.chapter, completed: m.completed })))`, returnByValue: true }, sessionId);
console.log('messages sent ->', sent.result.value);

const shot = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
writeFileSync(join(dir, 'debug-overlay.png'), Buffer.from(shot.data, 'base64'));
console.log('screenshot    -> debug-overlay.png');

ws.close(); browser.kill(); server.close();
await sleep(200); try { rmSync(profile, { recursive: true, force: true }); } catch {}
