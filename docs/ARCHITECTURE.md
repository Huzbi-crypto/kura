# Architecture

## The one-line model

Local library is canonical, trackers are mirrors, and every write records its own outcome.

## Pieces

```
popup/               library grid · add (MangaBaka search) · setup
src/background.js    service worker: message router, 1-minute retry alarm
src/sync.js          pull → reconcile → push fan-out, retry queue
src/mapping.js       cross-tracker id resolution (MangaBaka as the bridge)
src/trackers/*.js    one adapter per service: pull / push / search
src/db.js            IndexedDB: series, state, queue
src/content/overlay.js  reader pill (shadow DOM, SPA-aware)
worker/mal-token.js  Cloudflare Worker for the MAL token exchange
```

## Why the sync rule is "highest chapter wins"

Three services cannot agree on their own. Each has its own clock, its own idea of "chapter 41.5",
and its own outages. Picking a winner by rule — the furthest progress — means the outcome is
deterministic, explainable in one sentence, and safe to run in either direction: whatever you did
most recently on any tracker becomes the truth everywhere, because reading is monotonic.

Status and rating are reconciled separately: local status is only invented when empty (planning →
reading on first progress, completed when the last chapter is reached), and a rating is only taken
from a tracker when the library has none.

## Why MangaBaka is the bridge

The same series has three unrelated ids. Building a mapping table means maintaining it against
three catalogs forever. MangaBaka already publishes the mapping in both directions —
`/v1/series/{id}` returns `source.anilist.id` and `source.my_anime_list.id`, and
`/v1/source/{provider}/{id}` goes the other way — so one link fills in the others.

## Failure handling

A push that fails does not block the others: each tracker is marked `error` with its message and
the write goes into the queue (exponential backoff, five attempts, one-minute alarm). The library
row keeps showing the truth locally, so the UI never claims a sync that did not happen.

## Extension surface

- MV3 service worker, ES modules, no build step.
- Content script in a closed shadow root, so site CSS cannot reach the pill and the pill cannot
  break the site. SPA chapter changes are picked up by a `MutationObserver` on `location.href`.
- Permissions: `storage`, `alarms`, `identity`; host access only to the three tracker APIs and the
  four reader sites.
