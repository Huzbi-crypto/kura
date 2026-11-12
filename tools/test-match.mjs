// test-match.mjs — the reader-title matcher must accept decorated titles and refuse near-misses.
import { normalizeTitle, similarity, bestMatch, bestTitleScore } from '../src/match.js';

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
// real case: the reader says "I Only Want To Beat You"; AniList's main title is the romaji,
// and the English name exists only as a synonym. Matching must score every known title.
const anilistHit = {
  title: 'Oroji Neoreul Igigo Sipeo',
  alt: ['Oroji Neoreul Igigo Sipeo', 'I Only Want to Beat You  ', '오로지 너를 이기고 싶어'],
};
const syn = bestTitleScore('I Only Want To Beat You', [anilistHit.title, ...anilistHit.alt]);
const synOk = syn.score >= 0.85;
if (!synOk) fail++;
console.log(`${synOk ? 'ok  ' : 'FAIL'}  synonym match    -> ${syn.title} (${syn.score.toFixed(2)})`);

const romajiOnly = bestTitleScore('I Only Want To Beat You', [anilistHit.title]);
const rejected = romajiOnly.score < 0.85;
if (!rejected) fail++;
console.log(`${rejected ? 'ok  ' : 'FAIL'}  romaji alone is not enough (${romajiOnly.score.toFixed(2)}) - this was the bug`);

// direct checks used by the reader overlay path
const checks = [
  ['normalize keeps words', normalizeTitle('Solo Leveling (Official)') === 'solo leveling'],
  ['similarity is 1 for identical', similarity('one piece', 'one piece') === 1],
  ['empty title never matches', bestMatch('', library) === null],
];
for (const [name, ok] of checks) { if (!ok) fail++; console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}`); }

console.log(fail ? `\n${fail} failure(s)` : '\nall matcher checks passed');
process.exit(fail ? 1 : 0);
