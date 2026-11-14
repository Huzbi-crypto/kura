// atsu.js — https://atsu.moe/manga/<id>
window.__kura.site({
  id: 'atsu',
  hosts: ['atsu.moe'],
  seriesPage: [/^\/manga\/[^/]+\/?$/i],
  chapterPage: /^\/(read|chapter)\//i,
  // Its chapter list ("Chapters") sits thousands of pixels below the synopsis, so anchoring the
  // panel to it drops the card far out of view. Return null: no landmark, and the series card that
  // holds the heading and the synopsis becomes the placement.
  placement: () => null,
});
