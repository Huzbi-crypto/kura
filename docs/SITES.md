# Sites

One site at a time. Pick a site, audit it against its real pages, fix only that site, re-audit, move on.

## The rule

- Everything a site does differently lives in `src/sites/<site>.js`: URL patterns, title and chapter
  extractors, where the panel goes, and what the audit should verify (`expect`).
- Shared code (`src/content/*`, `src/sites/registry.js`) carries only rules that are true of every
  site: brand text, bot walls, the mount/retry loop, the 95% completion threshold. **A change to a
  shared file must be justifiable as universal, and must come with a harness case**, because it lands
  on every site at once.
- A fix for one site never edits another site's file. If it has to, the shape is wrong: move the
  difference into the site file.

## Auditing one site

```
cd ~/camofox-browser && node server.js      # the anti-detect browser, off the desktop
cd <repo> && node tools/site-audit.mjs atsu
```

Exit codes: `0` all checks passed, `1` something failed (listed at the end), `3` skipped because the
site serves no series content today.

It drives the real pages with the real content scripts, so a pass means the series-page panel and the
reader pill both work on that site right now. It checks:

**Series page** — the panel asks for the real series title (not the site's name), exactly one card
exists, the card is below the synopsis, and it sits where that site's definition says it should
(`expect: 'afterSynopsis'` for atsu, `'aboveChapterList'` for the rest), with no horizontal overflow.

**Chapter page** — the chapter link stays on the same host, the pill names the series and chapter
without a site label, opening the chapter completes nothing, mid-chapter shows a percentage and
completes nothing, 96% completes exactly once, and scrolling back up completes nothing further.

## Status

| Site | Audit | What is specific to it |
|---|---|---|
| atsu.moe | 20/20 | Panel goes *between the metadata table and the description* (`placement()` returns the description as a `before` anchor), because the chapter list is thousands of pixels lower. The description finder allows inline children, needs prose (15+ words, a period and a comma, so tag chips and row headers are out), prefers a `<p>`, and only looks above the chapter list. `chapterList()` returns the container with the most chapter rows (`Chapter`, `Ch.`, `Episode` prefixes) — the first match is the sidebar's open-chapter button. Reader has no `h1` and its back-link glues a "Manhwa Info" label to the title, so both title and chapter come from `<title>` (`<h1>` titles here can also carry a hyphenated name: "Mikoto-chan" must survive the chapter suffix being cut off it). |
| mangadot.net | 19/19 | Panel goes above the chapter tabs, taking the width of the panel they open. Chapter number only exists in `<title>`, spelled `Ch. N` for regular chapters and `Chapter 0` for a one-shot; the reader URL's number is an opaque id (`/chapter/3070825`) and must never be read as a chapter. Paged reader, so it can finish on a pager rather than a scroll. |
| weebcentral.com | 19/19 | Chapter URLs are opaque ids, so series name and number come from `<title>`. "Episode N" counts as a chapter. Series page links out to publishers, so links must be same-origin. |
| stonescape.xyz | 19/19 | Title comes from `<title>` (`Series - Ch. N - StoneScape`), chapter from the path (`/series/<slug>/ch-<n>`), so a sidebar link to another series can never rename the chapter. The site is a Vue SPA: `<title>` is `StoneScape` until hydration, `og:title` is the site name, and the series page publishes no tracker links (`/api/series/by-slug/<slug>` has no ids), so identity is resolved by title. `collectIds` finds nothing there by design, because the chapter page's series link resolves to the SPA shell. |

`tools/site-audit.mjs` is local verification scaffolding and is not committed, like the other
harnesses under `tools/`.
