// generic.js — the fallback every site inherits from. It carries the shapes nearly every reader
// shares: series pages at /manga|series|comic/<id>, chapter pages at /chapter|chapters|ch|read.
// A site only overrides what it actually does differently.
window.__kura.site({
  id: 'generic',
  hosts: [],
  seriesPage: [
    /^\/manga\/[^/]+\/?$/i,
    /^\/series\/[^/]+\/?$/i,
    /^\/comic\/[^/]+\/?$/i,
  ],
  chapterPage: /\/(chapter|chapters|ch|read)(\/|[-_]|$)/i,
  // no placement function: the panel anchors above the chapter list, then falls back to the series
  // card. Every reader has a chapter list, which is why it is the default rather than a site rule.
});
