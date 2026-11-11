// debug-library.mjs — seed the library with representative rows, then report what the popup
// actually renders (rects + computed styles), so layout bugs are diagnosed, not guessed.
// usage: node tools/debug-library.mjs [count]
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const dir = resolve('C:/Users/huzbi/Projects/kura');
const count = Number(process.argv[2] || 6);
const EDGE = process.env.BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9466;
const profile = mkdtempSync(join(tmpdir(), 'kura-dbg-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  `--disable-extensions-except=${dir}`, `--load-extension=${dir}`, '--no-first-run', '--window-size=430,600', 'about:blank'], { stdio: 'ignore' });

let version;
for (let i = 0; i < 60; i++) { try { version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); break; } catch { await sleep(300); } }
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pending = new Map();
ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } });
const send = (method, params = {}, sessionId) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });

let sw = null, extId = null;
for (let i = 0; i < 40 && !sw; i++) {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  for (const c of list.filter((t) => t.type === 'service_worker')) {
    try {
      const { sessionId } = await send('Target.attachToTarget', { targetId: c.id, flatten: true });
      const m = await send('Runtime.evaluate', { expression: 'chrome.runtime.getManifest().name', returnByValue: true }, sessionId);
      if (String(m.result.value || '').startsWith('Kura')) { sw = { ...c, sessionId }; extId = new URL(c.url).host; break; }
    } catch {}
  }
  if (!sw) await sleep(400);
}
if (!sw) { console.error('no service worker'); browser.kill(); process.exit(1); }

const page = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
await send('Runtime.enable', {}, sessionId);
await send('Page.enable', {}, sessionId);
await send('Emulation.setDeviceMetricsOverride', { width: 430, height: 580, deviceScaleFactor: 2, mobile: false }, sessionId);
await send('Page.navigate', { url: `chrome-extension://${extId}/popup/popup.html` }, sessionId);
await sleep(2500);

// seed through the real message router, with the shapes import produces
const seed = await send('Runtime.evaluate', {
  expression: `(async () => {
    const out = [];
    for (let i = 0; i < ${count}; i++) {
      const withCover = i % 3 !== 0;
      const total = i % 4 === 0 ? 0 : 100 + i;
      const s = await chrome.runtime.sendMessage({ type: 'add',
        title: 'Series Number ' + (i + 1) + (i % 2 ? ' — a rather long imported title that will wrap' : ''),
        cover: withCover ? 'https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx30261-yZ0h1mZ0.jpg' : null,
        total, links: {} });
      if (i % 2) await chrome.runtime.sendMessage({ type: 'bump', seriesId: s.id, by: i });
      out.push(s.id);
    }
    return out.length;
  })()`, awaitPromise: true, returnByValue: true,
}, sessionId);
console.log('seeded:', seed.result.value);
await sleep(600);
await send('Runtime.evaluate', { expression: 'location.reload()' }, sessionId);
await sleep(1800);


const report = await send('Runtime.evaluate', {
  expression: `(() => {
    const cards = [...document.querySelectorAll('.card-series')].slice(0, 4);
    const grid = document.querySelector('#grid');
    const cs = grid ? getComputedStyle(grid) : null;
    return JSON.stringify({
      cards: document.querySelectorAll('.card-series').length,
      grid: cs ? { display: cs.display, cols: cs.gridTemplateColumns, rows: cs.gridAutoRows, h: Math.round(grid.getBoundingClientRect().height) } : null,
      sample: cards.map(c => {
        const cover = c.querySelector('.cover');
        const title = c.querySelector('.title');
        const r = c.getBoundingClientRect();
        const cr = cover ? cover.getBoundingClientRect() : null;
        return {
          card: { w: Math.round(r.width), h: Math.round(r.height) },
          cover: cr ? { w: Math.round(cr.width), h: Math.round(cr.height), ar: getComputedStyle(cover).aspectRatio, bg: getComputedStyle(cover).backgroundImage.slice(0, 40) } : null,
          title: title ? { text: title.textContent.slice(0, 40), h: Math.round(title.getBoundingClientRect().height) } : null,
        };
      }),
    });
  })()`, returnByValue: true,
}, sessionId);
console.log('report:', report.result.value);

const experiment = await send('Runtime.evaluate', {
  expression: `(() => {
    const card = document.querySelector('.card-series');
    const cover = card && card.querySelector('.cover');
    if (!card || !cover) return 'no card';
    const cs = getComputedStyle(card), cvs = getComputedStyle(cover);
    const before = { card: Math.round(card.getBoundingClientRect().height), cover: Math.round(cover.getBoundingClientRect().height) };
    const steps = [];
    const measure = (label) => steps.push({ label, card: Math.round(card.getBoundingClientRect().height), cover: Math.round(cover.getBoundingClientRect().height) });
    measure('as-is');
    card.style.height = 'auto'; measure('card height auto');
    cover.style.height = '294px'; measure('cover fixed height');
    cover.style.aspectRatio = 'auto'; measure('cover no aspect-ratio');
    const grid = document.querySelector('#grid');
    grid.style.gridAutoRows = 'max-content'; measure('grid rows max-content');
    grid.style.alignItems = 'start'; measure('grid align-items start');
    grid.style.flex = 'none'; grid.style.height = 'auto'; measure('grid unconstrained');
    return JSON.stringify({
      cardScrollH: card.scrollHeight, gridScrollH: grid.scrollHeight, gridClientH: grid.clientHeight,
      coverOffsetH: cover.offsetHeight, coverScrollH: cover.scrollHeight,
      steps,
    });
    return JSON.stringify({
      computed: { cardDisplay: cs.display, cardHeight: cs.height, cardOverflow: cs.overflow, coverHeight: cvs.height, coverFlex: cvs.flex, coverPos: cvs.position },
      steps,
    });
  })()`, returnByValue: true,
}, sessionId);
console.log('experiment:', experiment.result.value);

const shot = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
const out = join(dir, 'debug-library.png');
writeFileSync(out, Buffer.from(shot.data, 'base64'));
console.log('screenshot ->', out);

ws.close(); browser.kill();
await sleep(300); try { rmSync(profile, { recursive: true, force: true }); } catch {}
