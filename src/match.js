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
