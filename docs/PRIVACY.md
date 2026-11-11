# Privacy policy — Kura

Last updated: 2026-11-11

Kura is a browser extension that keeps your manga reading progress in step across
MyAnimeList, AniList and MangaBaka. This page describes exactly what leaves your browser.

## What Kura stores on your device

- **Tracker credentials** (AniList access token, MyAnimeList access/refresh token, MangaBaka
  personal access token) in `chrome.storage.local`, in the extension's own storage area.
- **Your library**: series titles, the ids they carry on each tracker, reading progress,
  status and the last known state per tracker, in the extension's IndexedDB.
- **A retry queue** of writes that have not reached a tracker yet.

Nothing is stored anywhere else. There is no Kura account, no analytics, and no telemetry.

## What leaves your browser, and when

Only requests you cause, to the services you connected:

| Destination | What is sent | Why |
|---|---|---|
| `api.myanimelist.net` | your MyAnimeList token, the manga id, chapter/volume/status/score | read and write your MAL list |
| `graphql.anilist.co` | your AniList token, the media id, progress/status/score | read and write your AniList list |
| `api.mangabaka.org` | your MangaBaka token (for `/my/*`), series ids and titles | read and write your MangaBaka list, and look up series metadata |
| your Kura Worker (if self-hosted) | the OAuth code or refresh token | exchange it for a MyAnimeList token, because MAL requires the client secret |

Kura never contacts the reader sites' servers: the content script only reads the page you have
open, in your browser, and reports the series and chapter to the extension.

## What Kura does not do

- No analytics, crash reporting, advertising or fingerprinting.
- No remote code: every script is inside the packaged extension.
- No selling or sharing of your data with anyone. Your tokens never reach a server we control
  unless you deploy your own Worker for MyAnimeList.

## Removing your data

Remove the extension, or clear its storage from `chrome://extensions` → Kura → *Site data* /
*Remove*. That deletes tokens, library and queue. Your tracker accounts are untouched; delete
entries there through each service.

## Contact

Open an issue at github.com/Huzbi-crypto/kura.
