// atsu.js — https://atsu.moe/manga/<id>
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
      .filter(({ t }) => t.length > 80 && !/^(chapter|ch\.?|episode|ep\.?)\s*\d/i.test(t));
    if (!leaves.length) return null;   // no description: the panel falls back to above the chapter list
    leaves.sort((a, b) => b.t.length - a.t.length);
    return leaves[0].el;
  },
  // The chapter rows themselves, for when the description cannot be found: the panel anchors above
  // this container rather than at the end of the page. The shared finder looks for the word
  // "Chapters", which this layout does not always print as a heading.
  chapterList: () => {
    const row = [...document.querySelectorAll('a, button, div, li')]
      .filter((el) => el.children.length < 3)
      .find((el) => /^chapter\s*[\d.]+\b/i.test((el.textContent || '').trim()));
    if (!row) return null;
    let el = row;
    for (let i = 0; i < 4 && el.parentElement; i++) {
      const rows = [...el.parentElement.querySelectorAll('a, button, div, li')]
        .filter((n) => /^chapter\s*[\d.]+\b/i.test((n.textContent || '').trim())).length;
      if (rows >= 2 || el.parentElement.tagName === 'MAIN' || el.parentElement.tagName === 'BODY') break;
      el = el.parentElement;
    }
    return el;
  },
  // what the per-site audit should verify here, so no shared check has to guess
  expect: 'afterSynopsis',
});
