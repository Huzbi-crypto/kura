# Changelog

All notable changes to Kura. Format: [Keep a Changelog](https://keepachangelog.com/), versioning
follows [SemVer](https://semver.org/).

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
