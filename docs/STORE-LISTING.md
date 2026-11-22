# Chrome Web Store submission copy

Everything the submission form asks for, in one place. Keep in sync with `manifest.json`.

## Basics

- **Name**: Kura — manga tracker
- **Short description** (≤132 chars): `Track manga in one place and keep MyAnimeList, AniList and MangaBaka in sync — highest chapter wins.`
- **Category**: Productivity
- **Language**: English

## Detailed description

```
Kura is a manga-first reading tracker that treats trackers as mirrors, not as the place you work.

Most trackers ask you to pick one service. Kura connects all of yours at once: MyAnimeList,
AniList and MangaBaka. Read a chapter anywhere, mark it, and every connected tracker is updated —
each with its own status, so you can see which one is behind.

WHAT IT DOES
• One library, three trackers. Progress, status and rating fan out in parallel.
• Highest chapter wins. Anything you read elsewhere — on a tracker's own site, on another device —
  is pulled in and pushed to the rest, so the furthest progress always becomes the truth.
• Per-tracker state, not one vague "connected" light: synced, pending, or failed with the reason.
  Failures retry in the background with backoff.
• A reading pill on the pages you already use (atsu.moe, stonescape.xyz, weebcentral.com,
  mangadot.net) with one-tap "+1 chapter". If a site can't be parsed, it asks for the chapter
  number instead of silently doing nothing.
• Manga-first UI: cover grid, chapters read against total, progress bar, one tap to advance.

PRIVACY
No account, no analytics, no telemetry, no remote code. Your tracker tokens stay in your browser's
extension storage. Kura talks only to the trackers you connect. Full policy:
github.com/Huzbi-crypto/kura/blob/main/docs/PRIVACY.md

OPEN SOURCE
MIT licensed. github.com/Huzbi-crypto/kura
```

## Permission justifications

| Permission | Why |
|---|---|
| `storage` | Tokens, library and the retry queue live in extension storage — the extension has no server account. |
| `alarms` | Retry a tracker write that failed (offline, rate limit) without keeping the service worker alive. |
| `identity` | OAuth for MyAnimeList and AniList, via `launchWebAuthFlow`. |
| `https://api.myanimelist.net/*` | Read and update the user's MAL manga list. |
| `https://graphql.anilist.co/*` | Read and update the user's AniList manga list. |
| `https://api.mangabaka.org/*` | Read and update the user's MangaBaka list; look up metadata and cross-tracker ids. |
| `myanimelist.net` | The MAL OAuth authorize page. |
| `atsu.moe`, `stonescape.xyz`, `weebcentral.com`, `mangadot.net` | Content script: read the series and chapter of the page the user has open, to record progress. |

## Single purpose statement

`Kura tracks manga reading progress and keeps it in sync across the tracker services the user connects.`

## Assets to supply

- Icon 128×128 (in `icons/icon128.png`), 48 and 16 included.
- At least one screenshot 1280×800 (or 640×400) of the popup library.
- Optional 440×280 small promo tile.

## Review notes

- The extension works without any tracker connected (library + manual progress), so reviewers do
  not need credentials.
- MyAnimeList token exchange happens in a Cloudflare Worker; no secret ships in the package.
  The Worker source is in `worker/mal-token.js`.
- No `<all_urls>`; host permissions are the four reader sites and the three tracker APIs.
