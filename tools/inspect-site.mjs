// inspect-site.mjs — load a reader page in a real browser and report the structure and computed
// typography around a text snippet, so injected UI can look native instead of pasted on.
// usage: node tools/inspect-site.mjs <url> "<text snippet>"
import { spawn } from 'node:child_process';
import { guardBrowser, assertNoStragglers } from './_browser.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const url = process.argv[2];
const snippet = process.argv[3] || '';
const EDGE = process.env.BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9501;
const profile = mkdtempSync(join(tmpdir(), 'kura-inspect-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--window-size=1400,1000', 'about:blank'], { stdio: 'ignore' });
const closeBrowser = guardBrowser(browser, { label: 'inspect-site' });

let version;
for (let i = 0; i < 60; i++) { try { version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); break; } catch { await sleep(300); } }
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pending = new Map();
ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } });
const send = (method, params = {}, sessionId) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });

const { targetId } = await send('Target.createTarget', { url });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Runtime.enable', {}, sessionId);
await sleep(6000);

const report = await send('Runtime.evaluate', {
  expression: `(() => {
    const snip = ${JSON.stringify(snippet)};
    const styleOf = (el) => {
      const cs = getComputedStyle(el);
      return { font: cs.fontFamily, size: cs.fontSize, weight: cs.fontWeight, color: cs.color, bg: cs.backgroundColor,
               lh: cs.lineHeight, ls: cs.letterSpacing, radius: cs.borderRadius };
    };
    const chain = (el, n = 4) => {
      const out = [];
      for (let e = el, i = 0; e && i < n; e = e.parentElement, i++) {
        const r = e.getBoundingClientRect();
        out.push({ tag: e.tagName.toLowerCase(), cls: (e.className && String(e.className).slice(0, 90)) || '',
                   w: Math.round(r.width), h: Math.round(r.height), ...styleOf(e) });
      }
      return out;
    };
    const all = [...document.querySelectorAll('body *')];
    const hit = snip ? all.find((e) => e.children.length === 0 && (e.textContent || '').includes(snip)) : null;
    const anchor = hit ? hit.closest('p, div') : null;
    const after = anchor ? anchor.parentElement : null;
    const headings = [...document.querySelectorAll('h1, h2, h3')].slice(0, 8)
      .map((h) => ({ tag: h.tagName.toLowerCase(), cls: String(h.className).slice(0, 60), text: (h.textContent || '').trim().slice(0, 40) }));
    return JSON.stringify({
      title: document.title,
      found: Boolean(hit),
      snippetChain: hit ? chain(hit, 5) : [],
      siblings: after ? [...after.children].map((c) => ({ tag: c.tagName.toLowerCase(), cls: String(c.className).slice(0, 60),
                    text: (c.textContent || '').trim().slice(0, 50), h: Math.round(c.getBoundingClientRect().height) })).slice(0, 12) : [],
      headings,
      bodyBg: getComputedStyle(document.body).backgroundColor,
      // design tokens the site itself uses, so the injected UI can match its palette exactly
      rootVars: (() => {
        const cs = getComputedStyle(document.documentElement);
        const out = {};
        for (const name of ['--background','--foreground','--foreground2','--card','--card-foreground','--border','--muted','--muted-foreground','--primary','--primary-foreground','--radius','--accent','--popover']) {
          const v = cs.getPropertyValue(name).trim();
          if (v) out[name] = v;
        }
        return out;
      })(),
      accents: (() => {
        const pick = (sel, prop) => { const el = document.querySelector(sel); if (!el) return null; return getComputedStyle(el)[prop]; };
        const link = [...document.querySelectorAll('a')].map((a) => getComputedStyle(a).color).filter(Boolean);
        const btn = [...document.querySelectorAll('button')].map((b) => ({ bg: getComputedStyle(b).backgroundColor, color: getComputedStyle(b).color, radius: getComputedStyle(b).borderRadius }))
          .filter((b) => b.bg && b.bg !== 'rgba(0, 0, 0, 0)').slice(0, 4);
        return { linkColors: [...new Set(link)].slice(0, 4), buttons: btn, chip: pick('[class*=rounded]', 'backgroundColor') };
      })(),
      panelSample: (() => {
        const el = [...document.querySelectorAll('div,section,article')]
          .find((e) => { const cs = getComputedStyle(e); return cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && e.getBoundingClientRect().width > 300 && e.getBoundingClientRect().height > 60; });
        if (!el) return null;
        const cs = getComputedStyle(el);
        return { cls: String(el.className).slice(0, 80), bg: cs.backgroundColor, border: cs.borderColor, bw: cs.borderWidth, radius: cs.borderRadius, pad: cs.padding };
      })(),
    }, null, 1);
  })()`, returnByValue: true,
}, sessionId);
console.log(report.result.value);

const shot = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
const { writeFileSync } = await import('node:fs');
writeFileSync('C:/Users/huzbi/Projects/kura/inspect-site.png', Buffer.from(shot.data, 'base64'));

ws.close(); closeBrowser(); await sleep(1200); assertNoStragglers();
rmSync(profile, { recursive: true, force: true });
