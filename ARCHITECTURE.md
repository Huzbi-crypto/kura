# Kura — architecture

Kura keeps one local manga library and mirrors progress to MyAnimeList, AniList and MangaBaka.
The guiding rule is that **identity comes from facts, not from guesses**: a tracker id is either
declared by the page being read or resolved through a chain of declared ids, and when neither is
possible Kura records nothing rather than risk writing progress into a stranger's list.

## Layers

| Layer | File(s) | Responsibility |
|---|---|---|
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

## Site rules

All per-site knowledge lives in one table, `SITE_RULES` in `src/content/overlay.js`:

```js
'weebcentral.com': {
  title:   () => …,           // series name from the page
  chapter: () => …,           // chapter number from the page
  seriesUrl: () => …,         // where the tracker links live
}
```

Adding a reader is an entry in that table plus a harness scenario — not a new branch in the
detection code. Sites with no entry fall back to generic detection (h1, series links, `data-title`,
URL slug) and are never recorded unless the page actually contains manga-sized images.

## Non-content guards

Bot walls must never become library entries. The content script refuses pages whose title,
markup (`#challenge-form`, `[id^="cf-"]`, turnstile scripts) or short body text identifies a
Cloudflare/DDoS-Guard interstitial; the background worker refuses the same titles independently.

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
- `tools/test-match.mjs` — title normalisation, similarity, ambiguity refusal, using real API data.
- `tools/test-bridge.mjs` — the MangaBaka `/source/` response shape.
- Every test run must end with `cleanup verified: no msedge.exe processes remain`; a leaked headless
  browser leaves a stale Alt+Tab entry until the shell restarts.

## Known gaps

- `atsu.moe` and `stonescape.xyz` have no site rule; they rely on generic detection.
- weebcentral sits behind Cloudflare, so it can only be exercised in a real browser.
- MangaBaka's OAuth refresh rotates tokens; a replayed refresh token revokes the session, so the
  refresh is single-flight.
- Multi-tracker writing is being built on the MAL-Sync fork; this extension writes to every linked
  tracker sequentially, which is fine for three services but not a design to extend.
