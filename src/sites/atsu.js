// atsu.js — https://atsu.moe/manga/<id>
let lastList = null;   // chapter-list lookup cache: ensure() asks for it every 1.2s

const BLOCK_TAGS = new Set(['DIV', 'SECTION', 'P', 'ARTICLE', 'UL', 'OL', 'LI', 'TABLE', 'FORM', 'MAIN',
  'ASIDE', 'HEADER', 'FOOTER', 'NAV', 'H1', 'H2', 'H3', 'H4', 'DL', 'FIGURE']);

// The chapter rows. The shared finder looks for the word "Chapters", which this layout does not
// always print as a heading, and the first "Chapter N" match is the sidebar's open-chapter button,
// so this returns the container that holds the most rows.
function chapterListBox() {
  const now = Date.now();
  if (lastList && lastList.node?.isConnected && lastList.path === location.pathname && now - lastList.at < 3000) {
    return lastList.node;
  }
  const rowish = (n) => n.children.length < 3
    && /^(chapter|ch\.?|episode|ep\.?)\s*[\d.]+\b/i.test((n.textContent || '').trim());
  const rows = [...document.querySelectorAll('a, button, div, li')].filter(rowish);
  if (!rows.length) return null;
  const score = new Map();
  for (const row of rows.slice(0, 200)) {
    let el = row.parentElement;
    for (let i = 0; i < 6 && el && el.tagName !== 'BODY'; i++, el = el.parentElement) {
      score.set(el, (score.get(el) || 0) + 1);
    }
  }
  let best = null;
  let bestScore = 0;
  for (const [el, n] of score) if (n > bestScore) { bestScore = n; best = el; }
  if (bestScore < 3) return null;
  lastList = { node: best, path: location.pathname, at: now };
  return best;
}

// The series description. The shared finder climbs to a container that also holds the first chapter
// rows, which put the panel under the chapters on 4 of 10 series, so atsu answers for itself: the
// longest text block that has no block-level children and sits above the chapter list.
function descriptionBlock() {
  const main = document.querySelector('main, [role="main"], article') || document.body;
  const list = chapterListBox();
  const listTop = list ? list.getBoundingClientRect().top + scrollY : Infinity;
  const cands = [...main.querySelectorAll('p, div, section')]
    // inline children are fine (a <p> with <b> or <span> inside is still one paragraph); nested blocks
    // are not, because those containers hold the whole page
    .filter((el) => ![...el.children].some((c) => BLOCK_TAGS.has(c.tagName)))
    .filter((el) => !el.closest('nav, footer, [class*="comment" i], [id*="comment" i]'))
    // a real, visible box: at narrow widths atsu swaps in a collapsed description and leaves the
    // desktop one in the DOM. Picking the hidden one put the panel at the end of the page, below
    // the chapter list.
    .filter((el) => el.getClientRects().length > 0 && el.getBoundingClientRect().height > 8)
    // the description sits above the chapters; without this a long comment below them wins
    .filter((el) => el.getBoundingClientRect().top + scrollY < listTop)
    .map((el) => ({ el, t: (el.textContent || '').trim() }))
    // prose, not a row of tag chips: chips are long but hold almost no spaces between words
    .filter(({ t }) => t.length > 40 && (t.match(/ /g) || []).length >= 8)
    .filter(({ t }) => !/^(chapter|ch\.?|episode|ep\.?)\s*\d/i.test(t));
  // The description is a paragraph. A tag row is a div or a list, and it can be longer than the
  // description, so paragraphs win whenever there is one.
  const paras = cands.filter(({ el }) => el.tagName === 'P');
  const leaves = paras.length ? paras : cands;
  if (!leaves.length) return null;   // no description: the panel falls back to above the chapter list
  leaves.sort((a, b) => b.t.length - a.t.length);
  return leaves[0].el;
}

window.__kura.site({
  id: 'atsu',
  hosts: ['atsu.moe'],
  seriesPage: [/^\/manga\/[^/]+\/?$/i],
  chapterPage: /^\/(read|chapter)\//i,
  // The reader page (/read/<series>/<chapter>) has no h1, and its link back to the series carries a
  // label inside the same anchor: <a href="/manga/jqb3X">Manhwa Info<span>The Boxer</span></a>, so
  // the anchor's textContent reads "Manhwa InfoThe Boxer" and that is what the pill showed.
  // <title> is clean on both page types: "The Boxer - Episode 1".
  title: () => (document.title.split(/\s+[-–—]\s+(?:episode|ep\.?|chapter|ch\.?)\s*[0-9]/i)[0] || '').trim(),
  chapter: () => (document.title.match(/\b(?:episode|ep\.?|chapter|ch\.?)\s*([0-9]+(?:\.[0-9]+)?)/i) || [])[1],
  // Its chapter list ("Chapters") sits thousands of pixels below the synopsis, so anchoring the panel
  // to it drops the card far out of view. The description is the anchor instead, and the panel goes
  // *before* it: between the metadata table (type, status, year, author) and the description.
  placement: () => {
    const desc = descriptionBlock();
    return desc ? { before: desc, geom: desc, label: 'between the metadata and the description' } : null;
  },
  synopsis: descriptionBlock,
  chapterList: chapterListBox,
  // what the per-site audit should verify here, so no shared check has to guess
  expect: 'beforeSynopsis',
});
