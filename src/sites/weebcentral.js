// weebcentral.js — https://weebcentral.com/series/<id>, chapters at /chapters/<opaque id>
// Chapter URLs carry no series name or number, so both come from <title>:
// "Chapter 20 | World Wide Web MIKO! | Weeb Central". Numbered chapters are sometimes published as
// "Episode N" on this site.
window.__kura.site({
  id: 'weebcentral',
  hosts: ['weebcentral.com'],
  seriesPage: [/^\/series\/[^/]+\/?$/i],
  chapterPage: /^\/chapters\//i,
  title: () => (document.title.match(/^[^|]+\|\s*(.+?)\s*\|\s*Weeb Central/i) || [])[1],
  chapter: () => (document.title.match(/^\s*(?:chapter|ch\.?|episode|ep\.?)\s*([0-9]+(?:\.[0-9]+)?)/i) || [])[1],
  seriesUrl: () => document.querySelector('a[href*="/series/"]')?.href || null,
});
