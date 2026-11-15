// atsu.js — https://atsu.moe/manga/<id>
let lastList = null;   // chapter-list lookup cache: ensure() asks for it every 1.2s
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
  // Its chapter list ("Chapters") sits thousands of pixels below the synopsis, so anchoring the
  // panel to it drops the card far out of view. Return null: no landmark, and the series card that
  // holds the heading and the synopsis becomes the placement.
  placement: () => null,
  // The description is a single leaf block. The shared finder climbs to a container that also holds
  // the first chapter rows, which put the panel under the chapters on 4 of 10 series. atsu answers
  // for itself: the description is the longest leaf block in the content column.
  synopsis: () => {
    const main = document.querySelector('main, [role="main"], article') || document.body;
    const leaves = [...main.querySelectorAll('p, div, section')]
      .filter((el) => el.children.length === 0)
      .filter((el) => !el.closest('nav, footer, [class*="comment" i], [id*="comment" i]'))
      // a real, visible box: at narrow widths atsu swaps in a collapsed description and leaves the
      // desktop one in the DOM. Picking the hidden one put the panel at the end of the page, below
      // the chapter list.
      .filter((el) => el.getClientRects().length > 0 && el.getBoundingClientRect().height > 8)
      .map((el) => ({ el, t: (el.textContent || '').trim() }))
      .filter(({ t }) => t.length > 40 && !/^(chapter|ch\.?|episode|ep\.?)\s*\d/i.test(t));
    if (!leaves.length) return null;   // no description: the panel falls back to above the chapter list
    leaves.sort((a, b) => b.t.length - a.t.length);
    return leaves[0].el;
  },
  // The chapter rows themselves, for when the description cannot be found: the panel anchors above
  // this container rather than at the end of the page. The shared finder looks for the word
  // "Chapters", which this layout does not always print as a heading.
  // The first "Chapter N" match is the sidebar's open-chapter button, so this picks the container
  // that holds the most rows instead of the first one it meets.
  chapterList: () => {
    const now = Date.now();
    if (lastList && lastList.node?.isConnected && lastList.path === location.pathname && now - lastList.at < 3000) {
      return lastList.node;
    }
    const rowish = (n) => n.children.length < 3
      && /^(chapter|ch\.?|episode|ep\.?)\s*[\d.]+\b/i.test((n.textContent || '').trim());
    const rows = [...document.querySelectorAll('a, button, div, li')].filter(rowish);
    if (!rows.length) return null;
    // count rows per ancestor in one pass, then take the ancestor that holds the most of them: the
    // sidebar button and the row groups all score lower than the list itself
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
  },
  // what the per-site audit should verify here, so no shared check has to guess
  expect: 'afterSynopsis',
});
