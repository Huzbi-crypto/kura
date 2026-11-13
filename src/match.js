// match.js — decide whether a reader page is one of the series already in the library.
// Exact string equality is not enough: readers decorate titles ("Solo Leveling (Official)",
// "Solo Leveling - Vol. 2", "Solo Leveling [Latest]"), and a missed match creates a duplicate
// entry with no tracker links, which then silently never syncs.
const NOISE = /\b(official|colored|coloured|colour|color|scan|scanlation|raw|raws|webtoon|manhwa|manhua|manga|comic|latest|new|updated|complete|ongoing|uncensored|uncensored ver|full|hd)\b/gi;

export function normalizeTitle(t) {
  let s = String(t || '').toLowerCase();
  s = s.replace(/[（(\[{][^)}\]）]*[)}\]）]/g, ' '); // parenthetical qualifiers
  s = s.replace(/\b(vol|volume|ch|chapter|ep|episode|season|part)\s*\.?\s*\d+(\s*[-–]\s*\d+)?/gi, ' ');
  s = s.replace(NOISE, ' ');
  s = s.replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
  return s;
}

function bigrams(s) {
  const flat = s.replace(/\s+/g, '');
  const out = new Map();
  for (let i = 0; i < flat.length - 1; i++) {
    const g = flat.slice(i, i + 2);
    out.set(g, (out.get(g) || 0) + 1);
  }
  return out;
}

/** Sørensen–Dice similarity over bigrams, 0..1 */
export function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = bigrams(a), B = bigrams(b);
  let shared = 0, total = 0;
  for (const [, n] of A) total += n;
  for (const [g, n] of B) { total += n; shared += Math.min(n, A.get(g) || 0); }
  return total ? (2 * shared) / total : 0;
}

/** best score across every title a tracker reports for one hit */
export function bestTitleScore(title, titles) {
  const mine = normalizeTitle(title);
  let best = { score: 0, title: null };
  for (const t of titles.filter(Boolean)) {
    const score = similarity(normalizeTitle(t), mine);
    if (score > best.score) best = { score, title: t };
  }
  return best;
}

/** find the local series a page title refers to: exact, then tolerant, never a guess */
export function findSeries(title, library) {
  const norm = normalizeTitle(title);
  if (!norm) return null;
  const exact = library.find((s) => (s.normTitle || normalizeTitle(s.title)) === norm);
  if (exact) return exact;
  return bestMatch(title, library)?.series || null;
}

/**
 * Decide which search hit a reader title refers to.
 *
 * Refusing is a feature: two AniList series can share one English title ("Surviving the
 * Apocalypse"), and linking the wrong one writes progress into a stranger's list. A near-tie is
 * reported as ambiguous and left unlinked rather than guessed.
 */
export function pickCandidate(title, hits, { min = 0.85, tieWithin = 0.05 } = {}) {
  const scored = (hits || [])
    .map((hit) => ({ hit, best: bestTitleScore(title, [hit.title, ...(hit.alt || [])]) }))
    .filter((x) => x.best.score >= min)
    .sort((a, b) => b.best.score - a.best.score);
  if (!scored.length) return { kind: 'none' };
  const top = scored[0];
  const rival = scored.find((x) => String(x.hit.id) !== String(top.hit.id) && top.best.score - x.best.score < tieWithin);
  if (rival) return { kind: 'ambiguous', top, rival };
  return { kind: 'match', top };
}

/**
 * Best candidate for a reader title. Returns null when nothing is close enough, so an unknown
 * series is still created (the reader page is real even if the library has never heard of it).
 */
export function bestMatch(title, candidates, threshold = 0.8) {
  const norm = normalizeTitle(title);
  if (!norm) return null;
  let best = null;
  for (const c of candidates) {
    const other = c.normTitle || normalizeTitle(c.title);
    if (!other) continue;
    // containment only when nearly the whole title is present: a sequel adds real words
    // ("Solo Leveling: Ragnarok"), which must not be merged into the original.
    const contains = (other.includes(norm) || norm.includes(other))
      && Math.min(norm.length, other.length) / Math.max(norm.length, other.length) >= 0.8;
    const score = contains ? Math.max(0.86, similarity(norm, other)) : similarity(norm, other);
    if (score >= threshold && (!best || score > best.score)) best = { series: c, score, how: contains ? 'contains' : 'similar' };
  }
  return best;
}
