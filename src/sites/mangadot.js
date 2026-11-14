// mangadot.js — https://mangadot.net/manga/<id>, chapters at /chapter/<id>
window.__kura.site({
  id: 'mangadot',
  hosts: ['mangadot.net'],
  seriesPage: [/^\/manga\/[^/]+\/?$/i],
  chapterPage: /^\/chapter\//i,
  // "The Glutton: Devourer of Kings — Ch. 0: 0 | MangaDot"
  title: () => (document.title.split(/\s+[—–-]\s+Ch\./i)[0] || '').trim(),
  chapter: () => (document.title.match(/\bCh\.\s*([0-9]+(?:\.[0-9]+)?)/i) || [])[1],
  seriesUrl: () => document.querySelector('a[href*="/manga/"]')?.href || null,
  // The chapter list hides behind tabs. Insert above the tab strip but take the box of the panel
  // the tabs open: the strip itself is ~300px wide and the wrapper spans the whole page.
  placement: () => {
    const tabs = document.querySelector('main [role="tablist"], [role="tablist"]');
    if (!tabs) return null;
    const panel = document.querySelector('main [role="tabpanel"], [role="tabpanel"]');
    const geom = panel && panel.getBoundingClientRect().width > 400 ? panel : tabs;
    return { before: tabs, geom };
  },
  expect: 'aboveChapterList',
});
