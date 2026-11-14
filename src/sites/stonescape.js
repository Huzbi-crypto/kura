// stonescape.js — https://stonescape.xyz/series/<slug>/, chapters at /series/<slug>/ch-5/
// Two traps on this site: the logo is an h1 above the series heading (src/sites/registry.js rejects
// brand text), and the series page can render with no series content at all, in which case the panel
// must show nothing rather than a card named after the site.
window.__kura.site({
  id: 'stonescape',
  hosts: ['stonescape.xyz'],
  seriesPage: [/^\/series\/[^/]+\/?$/i],
  chapterPage: /^\/series\/[^/]+\/ch-[0-9]/i,
  // "Webtoon Character Na Kang Lim - Ch. 5 - StoneScape.~"
  title: () => (document.title.split(/\s+[-–—]\s+Ch\.?\s*[0-9]/i)[0] || '').trim(),
  chapter: () => {
    const m = location.pathname.match(/\/ch-([0-9]+(?:\.[0-9]+)?)/i);
    return m ? m[1] : (document.title.match(/\bCh\.?\s*([0-9]+(?:\.[0-9]+)?)/i) || [])[1];
  },
  seriesUrl: () => {
    const m = location.pathname.match(/^(\/series\/[^/]+)/i);
    return m ? `${location.origin}${m[1]}/` : null;
  },
});
