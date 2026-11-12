// test-overlay.mjs — runs the real overlay.js against fake reader pages and checks what it reports:
// in-chapter percentage, the completion signal, and (critically) that a site's own name in
// og:title is never mistaken for the series title.
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

const imgs = (n, h) => Array.from({ length: n }, (_, i) => `<img alt="p${i}" style="display:block;width:100%;height:${h}px;background:#333;margin-bottom:8px">`).join('');

const pages = {
  // a normal reader: title carries the series, content is tall
  '/manga/fake-manga/chapter-42': `<!doctype html><html><head><meta charset="utf-8">
    <title>Fake Manga Ch. 42 | Reader</title><meta property="og:title" content="Fake Manga Ch. 42 | Reader"></head>
    <body style="margin:0;background:#111">${imgs(8, 900)}</body></html>`,
  // stonescape-style: og:title and <title> are the site; the series is only in the h1
  '/manga/kyuu-ketsu-hirotte/chapter-65': `<!doctype html><html><head><meta charset="utf-8">
    <title>StoneScape</title><meta property="og:title" content="StoneScape"></head>
    <body style="margin:0;background:#111;color:#fff"><h1>Kyuuketsu Hirotte</h1>${imgs(1, 700)}</body></html>`,
  // a reader with a "next chapter" footer below the pages: the end of the chapter is on screen at
  // ~60% of the page, so a 95%-scrolled rule would never fire and progress would never move
  '/manga/lazy-reader/chapter-7': `<!doctype html><html><head><meta charset="utf-8">
    <title>Lazy Reader Ch. 7</title><meta property="og:title" content="Lazy Reader Ch. 7"></head>
    <body style="margin:0;background:#111">${imgs(3, 700)}<footer style="height:900px;background:#181818"></footer></body></html>`,
  // same, but with no heading at all: only the URL slug knows the series
  '/manga/hells-paradise/chapter-9': `<!doctype html><html><head><meta charset="utf-8">
    <title>StoneScape</title><meta property="og:title" content="StoneScape"></head>
    <body style="margin:0;background:#111">${imgs(1, 600)}</body></html>`,
};
const server = createServer((req, res) => {
  const path = req.url.split('?')[0];
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(pages[path] || pages['/manga/fake-manga/chapter-42']);
});
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

const STATE = `(() => {
  const host = document.querySelector('body > div:last-child');
  const root = host && host.shadowRoot;
  if (!root) return '{}';
  const q = (s) => root.querySelector(s);
  return JSON.stringify({
    label: q('.label')?.textContent,
    read: q('.read')?.textContent,
    inputVisible: !!(q('input.ch') && q('input.ch').offsetWidth > 0),
  });
})()`;

async function scenario(name, path, steps) {
  const { targetId } = await send('Target.createTarget', { url: `http://127.0.0.1:${PORT}${path}` });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Runtime.enable', {}, sessionId);
  await sleep(1200);
  await send('Runtime.evaluate', {
    expression: `window.__sent = []; window.chrome = { runtime: { sendMessage: (m) => { window.__sent.push(m); return Promise.resolve({ ok: true, trackers: { anilist: { state: 'synced' } } }); } } };`,
  }, sessionId);
  await send('Runtime.evaluate', { expression: overlaySrc }, sessionId);
  await sleep(900);
  console.log(`\n[${name}]`);
  let fail = 0;
  for (const [desc, expr, expect] of steps) {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId);
    const ok = expect(r.result.value);
    if (!ok) fail++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${desc}: ${String(r.result.value).slice(0, 150)}`);
  }
  const shot = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
  writeFileSync(join(dir, `debug-overlay-${name.replace(/[^a-z0-9]+/gi, '-')}.png`), Buffer.from(shot.data, 'base64'));
  await send('Target.closeTarget', { targetId });
  return fail;
}

const scrollTo = (f) => `(() => { window.scrollTo(0, document.body.scrollHeight * ${f}); return 'scrolled'; })()`;
const settle = `(async () => { await new Promise((r) => setTimeout(r, 450)); return 'settled'; })()`;

let fails = 0;

fails += await scenario('tall chapter', '/manga/fake-manga/chapter-42', [
  ['opens at 0%', STATE, (v) => v.includes('"read":"0%"') && v.includes('Fake Manga · ch 42')],
  ['scrolled 45%', scrollTo(0.45), (v) => v === 'scrolled'],
  ['settled', settle, (v) => v === 'settled'],
  ['reads about half', STATE, (v) => /"read":"(4\d|5\d)%"/.test(v)],
  ['scrolled to end', scrollTo(1), (v) => v === 'scrolled'],
  ['settled', settle, (v) => v === 'settled'],
  ['says read', STATE, (v) => v.includes('✓ read')],
  ['sent completion', `(async () => { await new Promise(r => setTimeout(r, 500)); return JSON.stringify(window.__sent.map(m => !!m.completed)); })()`, (v) => v === '[false,true]'],
]);

fails += await scenario('site name in og:title', '/manga/kyuu-ketsu-hirotte/chapter-65', [
  ['uses the h1, not the site', STATE, (v) => v.includes('Kyuuketsu Hirotte') && !v.includes('"label":"StoneScape')],
  ['short page never claims completion', STATE, (v) => !v.includes('✓ read') && !v.includes('"100%"')],
  ['no completion claim', `JSON.stringify(window.__sent.map(m => !!m.completed))`, (v) => v === '[false]'],
  ['sent the real title', `JSON.stringify(window.__sent[0]?.title)`, (v) => v.includes('Kyuuketsu Hirotte')],
]);

fails += await scenario('end of chapter before 95% scroll', '/manga/lazy-reader/chapter-7', [
  ['scrolled 30%', scrollTo(0.3), (v) => v === 'scrolled'],
  ['settled', settle, (v) => v === 'settled'],
  ['not finished yet', `JSON.stringify(window.__sent.map(m => !!m.completed))`, (v) => v === '[false]'],
  ['scrolled 60% (end of chapter on screen)', scrollTo(0.6), (v) => v === 'scrolled'],
  ['settled', settle, (v) => v === 'settled'],
  ['finished without reaching 95%', `JSON.stringify(window.__sent.map(m => !!m.completed))`, (v) => v === '[false,true]'],
]);

fails += await scenario('no heading at all', '/manga/hells-paradise/chapter-9', [
  ['falls back to the URL slug', STATE, (v) => v.includes('Hells Paradise')],
  ['still never claims completion', STATE, (v) => !v.includes('✓ read') && !v.includes('"100%"')],
]);

console.log(fails ? `\n${fails} overlay check(s) failed` : '\nall overlay checks passed');
ws.close(); browser.kill(); server.close();
await sleep(200); try { rmSync(profile, { recursive: true, force: true }); } catch {}
process.exit(fails ? 1 : 0);
