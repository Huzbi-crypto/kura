# Changelog

All notable changes to Kura. Format: [Keep a Changelog](https://keepachangelog.com/), versioning
follows [SemVer](https://semver.org/).

## [0.3.0] — unreleased

Import, real search results, and a pill that gets out of the way.

- **List import**: on Connect (and from Setup or the empty library) Kura pulls your whole manga list
  from each connected tracker and seeds the library, highest chapter winning.
- **Search fixed**: MangaBaka's v1 search is used, so results show titles and covers instead of
  blank rows. `/v2` puts the title in `titles[]` and the cover as a bare URL string — both misread.
- **Covers**: missing covers are backfilled from MangaBaka metadata on library load.
- **Reader pill**: fades out after ~6s and leaves a small corner dot; hover or a chapter change
  brings it back. No longer swallows page clicks, and the leftover chapter input is fixed.
- **Library payload fixed**: `library()` returned an array where the worker destructured
  `{ items, connected }`, which blanked the popup.

## [0.2.0] — unreleased

Zero-configuration connect.

- Ships the project's AniList client id and a deployed Cloudflare Worker for MyAnimeList, so
  Setup is three clicks instead of registering apps and deploying infrastructure.
- Setup fields are now optional overrides for self-hosters; clearing them restores the defaults.
- Worker verified live: `/health`, and `/exchange` returns MAL's own error for a bad code, proving
  the client secret is attached (an invalid secret would answer `invalid_client`).

## [0.1.0] — unreleased

First working build.

- Library-first popup: covers, progress, per-tracker status dots, filter, `+1`, sync.
- Three trackers at once: MyAnimeList, AniList, MangaBaka — each write is tracked separately
  (`synced` / `pending` / `error`) instead of one shared "connected" flag.
- Sync rule: pull from every linked tracker, highest chapter wins, push the winner to the rest.
- Retry queue on a one-minute alarm with exponential backoff, five attempts.
- MangaBaka doubles as the cross-tracker ID bridge (`source.anilist.id` / `source.my_anime_list.id`).
- Reader overlay on atsu.moe, stonescape.xyz, weebcentral.com, mangadot.com; shadow DOM, SPA-aware,
  falls back to asking for the chapter number when a page can't be parsed.
- MyAnimeList token exchange in a Cloudflare Worker, so no client secret ships in the bundle.
- `tools/verify-extension.mjs`: headless load, service-worker check, popup render, add + bump smoke test.
