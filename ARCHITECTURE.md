# Kura — architecture

Kura keeps one local manga library and mirrors progress to MyAnimeList, AniList and MangaBaka.
The guiding rule is that **identity comes from facts, not from guesses**: a tracker id is either
declared by the page being read or resolved through a chain of declared ids, and when neither is
possible Kura records nothing rather than risk writing progress into a stranger's list.

## Layers

| Layer | File(s) | Responsibility |
|---|---|---|
| Site definitions | `src/sites/*.js` | One file per reader site: URL patterns, title/chapter extractors, panel placement. No file outside this directory names a host. |
| Site registry | `src/sites/registry.js` | Resolves a host to its definition; owns the rules that are cross-site (brand text, bot walls). |
| Reader detection | `src/content/overlay.js` | Which series/chapter is open, when the chapter is finished, the pill UI. |
| Series-page panel | `src/content/status-card.js` | Progress/status panel under the synopsis, themed from the page. |
| Routing & policy | `src/background.js` | Message handlers, identity resolution, completion policy, activity log. |
| Sync | `src/sync.js`, `src/mapping.js` | Local state is canonical; pull the highest chapter, push to every linked tracker. |
| Trackers | `src/trackers/*.js` | One module per service: auth, read, write, search. |
| Storage | `src/db.js` | IndexedDB `kura` v1: `series`, `state`, `queue`, `kv`. |
| Matching | `src/match.js` | Pure title normalisation, similarity, candidate selection. |
| Diagnostics | `src/diag.js` | Ring buffer of what happened, stamped with the running version. |

## Data model

`series` — `{ id, title, normTitle, cover, total, links, linkSource, EOF }`.
`links` holds numeric tracker ids; `linkSource[id]` records `'page'` or `'title'`, so a correction
can tell a fact from a guess.

`state` — `{ seriesId, chapter, volume, status, rating, trackers: { [id]: { state, error, at } } }`
plus `lastSeenChapter` for a chapter that was opened but not finished.

`queue` — failed pushes with attempts and backoff, drained by a 1-minute alarm.

## Identity resolution (the part that used to be wrong)

Order of authority, highest first:

1. **Page-declared ids.** Reader series pages publish links to the trackers; the content script
   reads the series page (same-origin, cached per page) and sends `ids` with the reading event.
   These overwrite existing links, and any link derived from the old chain is dropped and re-resolved.
2. **The MangaBaka bridge.** `/v1/source/{anilist|my-anime-list}/{id}` → `{ data: { series: [ … ] } }`.
   Note the shape: the series is an element of `series[]`, not `data` itself.
3. **Title matching.** Last resort. Every hit is scored against every title the tracker knows
   (synonyms, alternative titles, all languages). A near-tie is refused: two series can share one
   English title, and writing to the wrong one is worse than not linking.

Title matching must never be trusted when a page declares an id. It exists for sites that publish
no links at all.

## Progress semantics

Opening a chapter does **not** advance anything; it records `lastSeenChapter` locally. A chapter
counts when finished:

- scrolled to the bottom (≥95%), or
- the bottom edge of the last page is on screen (readers with a footer below the pages), or
- an explicit "end of chapter" marker is visible, or
- a paged reader reports the last page (`Page 3 of 3`, `3 / 3 · 100 %`).

Signals are read on scroll, on DOM mutation (timers are throttled in background tabs) and on a
slow interval. The pill's ✓ button is the manual escape hatch and marks the chapter on screen.

The pill only claims a chapter is read once the worker confirms it was recorded. The completion is
sent through `post()`, which cannot throw: a message to a worker that no longer exists (the extension
was reloaded, so every open tab holds an orphaned content script) comes back as a reason. While the
write is in flight the pill says `saving…`; if it fails it says `not saved` with the reason, clears the
tracker dots, and retries on the next tick at least 8s later, because a chapter that was finished must
not depend on the user noticing.

## Site rules

Every reader site is its own file in `src/sites/`, the way MAL-Sync gives each site its own folder
with its URL match and its own extractors. Content scripts cannot import, so the manifest loads the
registry, then the site files, then the two content scripts, and each site file registers itself:

```js
// src/sites/mangadot.js
window.__kura.site({
  id: 'mangadot',
  hosts: ['mangadot.net'],
  seriesPage: [/^\/manga\/[^/]+\/?$/i],
  chapterPage: /^\/chapter\//i,
  title:   () => …,            // series name from the page
  chapter: () => …,            // chapter number from the page
  seriesUrl: () => …,          // where the tracker links live
  placement: () => ({ before, geom }),  // where the panel goes on a series page
});
```

Nothing in `src/content/` branches on a hostname. A definition only overrides what its site does
differently; anything it leaves out comes from `src/sites/generic.js` (series pages at
`/manga|series|comic/<id>`, chapter pages at `/chapter|chapters|ch|read`, panel anchored above the
chapter list). Adding a reader is one new file plus a harness scenario, and it cannot affect another
site because no shared file was edited.

The rules that are true of every site live in `src/sites/registry.js`: what counts as the site's own
name (a brand is a fragment of its own hostname, so "STONE" from stonescape's split logo is
rejected), and what counts as a bot wall. Cross-site lists are kept there rather than in either
content script, so the panel and the pill cannot disagree.

A site may also answer two questions about placement, both optional:

- `synopsis()` — the block holding the series description, used as the anchor. It must return a
  *rendered* element: at narrow widths atsu keeps a hidden copy of the description in the DOM, and
  anchoring to it dropped the panel into a `display:none` subtree.
- `chapterList()` — the container holding the chapter rows. The panel uses it to place itself above
  the chapters when no description can be found, and to notice that a mounted card has sunk to the
  end of the page. atsu's own answer wins over the shared "Chapters" heading match, which that site
  does not always render.
- `placement()` — the anchor itself, when the site knows a better one than the shared finder. It
  returns `{ before, geom }` and may carry a `label`, which the activity log prints instead of the
  generic spot name. atsu uses it to put the panel *before* its description, between the metadata
  table and the blurb.

The panel's spot list is ordered: the site's anchor, then after the description, then above the
chapter list, then the end of the content column. Every spot is checked for a real visible box before
it is accepted. Mounting is settle-then-render-once: mutations, DOMContentLoaded and load feed one
600ms debounce, and only a quiet page whose title resolves renders — page activity never re-renders a
mounted card. 800ms after the card lands it is verified once (visible, above the chapter list, and
beside the description where the site declares `expect: 'beforeSynopsis'`), and may be corrected once.
After that a 3s watchdog re-renders only on real loss — the card no longer connected to the document,
moved by the site, or the document title/pathname changing (an SPA route) — bounded at three
consecutive repairs, with a note carrying the removal count when the budget runs out. A new pathname
resets the state, clears the card and settles again.

## Non-content guards

Bot walls must never become library entries, and must never be drawn on either. The shared
`isInterstitial()` in the registry refuses pages whose title, markup (`#challenge-form`, `[id^="cf-"]`,
turnstile scripts) or short body text identifies a Cloudflare/DDoS-Guard interstitial, and both the
pill and the series-page panel ask it before rendering anything; the background worker refuses the
same titles independently.

## Failure surfacing

`diag` keeps the last 60 events: reader detections, match decisions with reasons, per-tracker push
results, and the build they came from. It is the only supported way to answer "why didn't it sync".
The Setup tab shows it as the Activity panel, with the running version in the header.

## Testing

The harnesses under `tools/` are deliberately **not** committed — they are local verification for
whoever is working on the extension, not part of the shipped product.

- `tools/test-overlay.mjs` — drives the real content script against fake reader pages served on the
  real hostnames (`--host-resolver-rules`), covering: tall chapter, embedded site name, paged
  reader, "Episode N", unrecognised layout, Cloudflare wall, and page-declared ids.
- `tools/test-status-card.mjs` — the series-page panel: placement per site, page typography, a site
  that removes or hides the panel, a mutation flood (exactly one card), a shell page and a challenge
  page (no card at all).
- `tools/test-match.mjs` — title normalisation, similarity, ambiguity refusal, using real API data.
- `tools/test-bridge.mjs` — the MangaBaka `/source/` response shape.
- `tools/site-audit.mjs` — the per-site entry point, one site at a time: drives that site's real
  series and chapter pages with the real content scripts and reports pass/fail per behaviour. See
  `docs/SITES.md` for the workflow, the status table, and what each site does differently. Exit 3
  means the site served no series content today, which is not a code failure.
- Both browser harnesses load their scripts through `contentSource()` in `tools/_browser.mjs`, which
  reads the list out of `manifest.json`, so a test can never run a different file set than the build.
- Browser harnesses are opt-in (`KURA_BROWSER_TESTS=1`) because each headless run can leave a stale
  Alt+Tab entry with no process behind it, and the entries accumulate one per run. Every run must end
  with `cleanup verified: no msedge.exe processes remain`; if the switcher still shows a ghost tile,
  restart the shell (`Stop-Process -Name explorer`, it relaunches itself). For real pages, drive the
  anti-detect browser instead: it leaves nothing in Alt+Tab.

## Known gaps

- stonescape.xyz currently serves no series content: `/series/` answers "The page you are looking
  for does not exist" and slug pages render only the site chrome, so its placement is verified
  against a fixture rather than the live site.
- weebcentral sits behind Cloudflare, so it can only be exercised in a real browser.
- MangaBaka's OAuth refresh rotates tokens; a replayed refresh token revokes the session, so the
  refresh is single-flight.
- Multi-tracker writing is being built on the MAL-Sync fork; this extension writes to every linked
  tracker sequentially, which is fine for three services but not a design to extend.
