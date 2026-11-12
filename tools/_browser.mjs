// _browser.mjs — one place to launch a test browser and guarantee it dies.
// Leaking a headless window is not a cosmetic problem: it shows up in the user's own Edge
// session as stray windows. Every exit path kills the whole process tree.
import { spawn, spawnSync } from 'node:child_process';

export const EDGE = process.env.BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const alive = (child) => Boolean(child) && child.exitCode === null && !child.killed;

function waitExit(child, ms) {
  const end = Date.now() + ms;
  while (alive(child) && Date.now() < end) sleepSync(100);
  return !alive(child);
}

export function killTree(child) {
  if (!alive(child)) return;
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore' });
    else child.kill('SIGKILL');
  } catch { /* already gone */ }
}

/**
 * Graceful close first: `taskkill /F` on a Chromium browser leaves a stale Alt+Tab entry in
 * Windows until the shell restarts, which is exactly the ghost window the user saw.
 */
export function closeBrowser(child, { graceMs = 4000 } = {}) {
  if (!alive(child)) return;
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(child.pid), '/T'], { stdio: 'ignore' });
      if (waitExit(child, graceMs)) return;
      spawnSync('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore' });
    } else {
      child.kill('SIGTERM');
      if (waitExit(child, graceMs)) return;
      child.kill('SIGKILL');
    }
  } catch { /* caller's cleanup force-kills */ }
}

/** register cleanup for every way this process can end, including a hung await */
export function guardBrowser(child, { timeoutMs = 180_000, label = 'test' } = {}) {
  let done = false;
  const finish = (graceful) => {
    if (done) return;
    done = true;
    if (graceful) closeBrowser(child); else killTree(child);
  };
  process.on('exit', () => finish(true));
  process.on('SIGINT', () => { finish(true); process.exit(130); });
  process.on('SIGTERM', () => { finish(true); process.exit(143); });
  process.on('uncaughtException', (e) => { finish(false); console.error(e); process.exit(1); });
  process.on('unhandledRejection', (e) => { finish(false); console.error(e); process.exit(1); });
  const timer = setTimeout(() => { finish(false); console.error(`[${label}] timed out; browser killed`); process.exit(1); }, timeoutMs);
  timer.unref?.();
  return () => { clearTimeout(timer); finish(true); };
}
