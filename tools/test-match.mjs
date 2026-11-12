// test-match.mjs — the reader-title matcher must accept decorated titles and refuse near-misses.
import { normalizeTitle, similarity, bestMatch } from '../src/match.js';

const library = [
  { id: 1, title: 'Solo Leveling', normTitle: normalizeTitle('Solo Leveling') },
  { id: 2, title: 'One Piece', normTitle: normalizeTitle('One Piece') },
  { id: 3, title: 'Blue Lock', normTitle: normalizeTitle('Blue Lock') },
  { id: 4, title: 'Chainsaw Man', normTitle: normalizeTitle('Chainsaw Man') },
];

const shouldMatch = [
  ['Solo Leveling (Official)', 1],
  ['Solo Leveling [Latest]', 1],
  ['Solo Leveling - Vol. 2', 1],
  ['solo leveling(2)', 1],
  ['One Piece Chapter 1090', 2],
  ['One Piece: Colored', 2],
  ['BLUE LOCK', 3],
  ['Chainsaw Man Official Colored', 4],
];

const shouldNotMatch = [
  'Bleach',
  'Solo Leveling: Ragnarok',
  'Blue Exorcist',
  'One Punch Man',
  'Tokyo Ghoul',
];

let fail = 0;
for (const [title, want] of shouldMatch) {
  const m = bestMatch(title, library);
  const ok = m && m.series.id === want;
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  match   ${title.padEnd(34)} -> ${m ? `${m.series.title} (${m.score.toFixed(2)})` : 'none'}`);
}
for (const title of shouldNotMatch) {
  const m = bestMatch(title, library);
  const ok = !m;
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  reject  ${title.padEnd(34)} -> ${m ? `${m.series.title} (${m.score.toFixed(2)})` : 'none'}`);
}
// direct checks used by the reader overlay path
const checks = [
  ['normalize keeps words', normalizeTitle('Solo Leveling (Official)') === 'solo leveling'],
  ['similarity is 1 for identical', similarity('one piece', 'one piece') === 1],
  ['empty title never matches', bestMatch('', library) === null],
];
for (const [name, ok] of checks) { if (!ok) fail++; console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}`); }

console.log(fail ? `\n${fail} failure(s)` : '\nall matcher checks passed');
process.exit(fail ? 1 : 0);
