// _browser.mjs — one place to launch a test browser and guarantee it dies.
// Leaking a headless window is not a cosmetic problem: it shows up in the user's own Edge
// session as stray windows. Every exit path kills the whole process tree.
import { spawn } from 'node:child_process';

export const EDGE = process.env.BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

export function killTree(child) {
  if (!child || child.killed || child.exitCode !== null) return;
  try {
    if (process.platform === 'win32') spawn('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore' });
    else child.kill('SIGKILL');
  } catch { /* already gone */ }
}

/** register cleanup for every way this process can end, including a hung await */
export function guardBrowser(child, { timeoutMs = 180_000, label = 'test' } = {}) {
  let done = false;
  const kill = () => { if (done) return; done = true; killTree(child); };
  process.on('exit', kill);
  process.on('SIGINT', () => { kill(); process.exit(130); });
  process.on('SIGTERM', () => { kill(); process.exit(143); });
  process.on('uncaughtException', (e) => { kill(); console.error(e); process.exit(1); });
  process.on('unhandledRejection', (e) => { kill(); console.error(e); process.exit(1); });
  const timer = setTimeout(() => { kill(); console.error(`[${label}] timed out; browser killed`); process.exit(1); }, timeoutMs);
  timer.unref?.();
  return () => { clearTimeout(timer); kill(); };
}
