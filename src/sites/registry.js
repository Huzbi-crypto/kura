// registry.js — every reader site is a definition, and no file outside src/sites/ may branch on a
// hostname. Modeled on MAL-Sync, where each site is its own folder carrying its URL match plus its
// own title/chapter extractors; here a site is one self-registering script (content scripts cannot
// import, so order in the manifest is what wires them).
//
// A definition is data plus a few nullable functions. Nothing is required:
//
//   Kura.site({
//     id: 'mangadot',                       // stable name, used in logs
//     hosts: ['mangadot.net'],              // matched after stripping a leading www.
//     seriesPage: [/^\/manga\/[^/]+\/?$/i], // pathname patterns that are a series page
//     chapterPage: /^\/chapter\//i,         // pathname pattern for a chapter page
//     title: () => '...',                   // optional: the site's own series title
//     chapter: () => '42',                  // optional: the site's own chapter number
//     seriesUrl: () => 'https://...',       // optional: the series page, for tracker ids
//     placement: () => ({ before, geom }),  // optional: where the panel goes on a series page.
//                                           //   null means "no landmark, use the series card",
//                                           //   absent means "use the generic chapter list".
//   })
//
// Anything a definition leaves out falls back to the generic table in src/sites/generic.js.
(() => {
  if (window.__kura) return;

  const sites = [];
  const byHost = new Map();
  const brands = new Set();
  const squash = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]/g, '');

  /** the site's own name, from its hostname: stonescape.xyz -> stonescape */
  const brandOf = (host) => squash(String(host || '').replace(/^www\./, '').split('.')[0]);

  /**
   * A site's name must never stand in for a series name. Structural rather than a keyword list: a
   * logo is a fragment of its own hostname ("STONE" for stonescape, whose logo is an h1 split into
   * spans), and the full name is that same string.
   *
   * Every registered site's name counts, not only the current host's: mirrored and mis-hosted pages
   * carry another site's name in <title>, which used to be caught by a hardcoded brand list.
   */
  function isBrand(text) {
    const key = squash(text);
    if (!key) return false;
    for (const brand of brands) {
      if (!brand) continue;
      if (key === brand) return true;
      if (brand.startsWith(key) && key.length >= 4) return true;   // "STONE" for stonescape
      if (key.startsWith(brand)) return true;                      // "StoneScape.~" for stonescape
    }
    return false;
  }

  /**
   * A bot wall is not content. "Just a moment...", "Performing security verification" and friends
   * load on the same URL as the series or chapter, so a panel drawn there records and displays a
   * series that does not exist.
   */
  const CHALLENGE_RE = /\b(just a moment|checking your browser|please wait|attention required|verify you are human|performing security verification|are you a robot|access denied|ddos-guard|enable javascript and cookies)\b/i;
  function isInterstitial() {
    if (CHALLENGE_RE.test((document.title || '').trim())) return true;
    if (document.querySelector('#challenge-form, #challenge-running, #cf-challenge-running, .cf-browser-verification, [id^="cf-"], script[src*="challenges.cloudflare.com"]')) return true;
    const text = (document.body?.innerText || '').trim();
    return text.length < 400 && CHALLENGE_RE.test(text);
  }

  window.__kura = {
    sites,
    site(def) {
      sites.push(def);
      for (const h of def.hosts || []) {
        const clean = h.replace(/^www\./, '');
        byHost.set(clean, def);
        brands.add(brandOf(clean));
      }
      return def;
    },
    /** the definition for this page's host, or the generic one */
    forHost(host) {
      const h = String(host || '').replace(/^www\./, '');
      return byHost.get(h) || sites.find((s) => s.id === 'generic') || {};
    },
    isBrand,
    isInterstitial,
    brandOf,
  };
})();
