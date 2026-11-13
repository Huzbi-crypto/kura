# Changelog

All notable changes to Kura. Format: [Keep a Changelog](https://keepachangelog.com/), versioning
follows [SemVer](https://semver.org/).

## [0.9.4] — unreleased

Why the panel was missing on stonescape and mangadot, with the cause found on the live pages.

- **stonescape puts its own name in an `h1` above the series.** `seriesTitle()` took the first `h1`
  and got `STONESCAPE`, so Kura searched the trackers for "STONESCAPE" and found nothing. Titles now
  come from the first non-brand heading in the content column.
- **The panel is placed above the chapter list**, a landmark every reader site has, instead of
  "after the synopsis" (which landed 2800px down where the synopsis block was not recognised) or
  inside the hero (which put it over the title). Width comes from that section, so it lines up with
  the chapter column on both sites.
- **Contrast is enforced, not sampled.** stonescape is a light theme: lifting the surface while
  keeping the page's ink produced near-invisible text. Ink, muted text and hairlines are now derived
  from a contrast check against the panel surface.
- **The panel no longer fails silently.** Every outcome is logged to Activity: `not in the
  library: "<title>"`, `no series title on this page`, `no place to insert the panel`, or `panel
  shown for "<title>"` — so a missing panel says why it is missing.
- Verified live: stonescape (`Webtoon Character Na Kang Lim`) and mangadot (`The Glutton`), both
  reaching Cloudflare with camofox and measured in the page, not on a copy.

## [0.9.3] — unreleased

- **The popup shows its build** (`manga tracker · v0.9.3`), and the series-page panel marks the
  document with `data-kura-status`. Two rounds of "the panel is missing" were an older build still
  loaded; that should never need guessing again.
- **Browser tests are opt-in** (`KURA_BROWSER_TESTS=1`). They were the source of the stale Alt+Tab
  entries Windows kept showing: each headless Edge run registers hidden windows, and they linger
  until the shell restarts. Visual verification now goes through camofox, which does not.

## [0.9.2] — unreleased

The series-page panel, verified on the live sites instead of guessed at.

- **mangadot.net placement was wrong.** The panel took the width of the page container, so it ran
  across the sidebar gutter with dead space on the right. It now sits above the chapter tabs and
  takes the *chapter column's* box (verified on the live page: 988px at x=427, exactly the tabpanel
  below it), so it reads as part of the page grid.
- **The panel matches the prose it belongs to** where the layout gives no section landmark: width
  and left edge come from the text column, not the page wrapper.
- Verified on the real mangadot.net page through a browser that passes Cloudflare, and locked into
  the harness as a mangadot-shaped layout (width, left edge and "above the tabs" are asserted).

## [0.9.1] — unreleased

- **A synopsis page is no longer recorded as progress.** The pill ran on any matched URL, so sitting
  on a series page could create an entry — complete with a chapter number harvested from something
  on the page ("ch 73815"). Recording now requires a chapter URL (`/chapter-…`, `/chapters/…`,
  `/series/<slug>/ch-…`, `/read/…`); series pages belong to the status panel instead.
- **Implausible chapter numbers are refused** in the worker as well (negative, or above 5000), so a
  mis-parse cannot reach the library or a tracker.
- **stonescape.xyz has a real site rule**: series from the page title, chapter from
  `/series/<slug>/ch-<n>/`, series URL derived from the path. A sidebar link to another series can
  no longer become the title (it was recording "Things I Want to Do as a 6th Grader · ch 1001").
- **The status panel always lands somewhere.** If the synopsis block cannot be identified, it is
  placed at the end of the content column instead of silently not rendering.

## [0.9.0] — unreleased

**Progress on the site's own series page.**

- A Kura panel appears under the synopsis on a series page for anything already in the library:
  status (Reading / Completed / Paused / Dropped / Plan to read), chapter and volume position with
  a progress bar, and one row per linked tracker with its own chapter when it disagrees, plus its
  sync state (synced / pending / error, with the error on hover).
- It is themed from the page rather than from Kura: font family, size, line height, ink colour,
  the nearest painted surface (lifted slightly) and that panel's corner radius are all read at
  runtime. Verified against atsu.moe's actual values — Geist, 14px, surface `#1d1e20` — so the
  panel inherits 14px and a `#242528` surface rather than a fixed look.
- It only renders when the series is in the library, and never on chapter pages.
- New background message `status` resolves the page title to a local series and returns the merged
  state for the panel.

## [0.8.1] — unreleased

A chapter was written into the wrong AniList series. Two independent holes, both closed.

- **A chapter page links other series.** weebcentral's chapter page carries anchors to related and
  promoted series; taking the first `/series/` anchor fetched an unrelated manga, and its AniList id
  was then used for the chapter being read ("Mazumeshi Elf to Yuubokugurashi" for "Surviving the
  Apocalypse"). Candidate series pages are now fetched and kept only if their own title matches the
  series in the tab.
- **Page-declared ids are now verified, and verification fails closed.** Before an id is trusted,
  the tracker is asked what that id actually is (`titleFor` on AniList, MAL, MangaBaka) and the
  titles must match. An id for a tracker that is not connected is dropped rather than accepted
  unchecked, and a failed verification drops the id instead of proceeding — an unverified id is
  exactly how progress lands in a stranger's list.

Both are covered by tests built from the real case: the recommendation link is skipped
(`181296`, not `110654`), and the guard scores 0.04 for the wrong series against 1.00 for the right
one.

## [0.8.0] — unreleased

Links come from the page, not from guessing.

- **Tracker ids are read from the site's own links.** Reader series pages publish them — weebcentral
  links `anilist.co/manga/212724`, mangadot links AniList/MangaBaka/MangaDex — and the extension reads
  the series page (same-origin, cached) and sends those ids with the reading event. Page-declared ids
  are authoritative: they replace a guessed id, and ids derived from the old chain are discarded and
  re-resolved.
- **Ambiguous title matches are refused.** "Surviving the Apocalypse" is the English title of two
  AniList series (181296 and 193312); the old code took the first search hit and linked the wrong one.
  Candidates are now all scored, and a near-tie is logged as `ambiguous — not linked` instead of
  guessing.
- **weebcentral "Episode N"** pages count as chapters (they were parsed as having no chapter, which
  is why reading there never synced).
- **Site rules are data, not branches.** All per-site knowledge — title, chapter, series URL — lives
  in one `SITE_RULES` table; adding a reader is an entry, not another `if`.
- **Provenance**: each link records whether it came from the page or from a title guess.

## [0.7.5] — unreleased

- **Bot walls are never content.** Cloudflare's "Just a moment…" interstitial on mangadot was
  recorded as a series called "Just a Moment", with a chapter and cover, and would have synced to
  every tracker. Detected now by title, challenge selectors (`#challenge-form`,
  `[id^="cf-"]`, turnstile scripts) and short body text — on every site, including ones Kura has a
  rule for. The background worker rejects such titles too, so a stale content script cannot
  reintroduce it.
- **A reader page with no pages is not a chapter.** On a site without a rule, Kura only records a
  page that actually contains manga images; otherwise the pill says "page not recognised" and
  creates nothing.

## [0.7.4] — unreleased

- **mangadot is `mangadot.net`, not `.com`.** The manifest pointed at `mangadot.com`, which is a
  parked domain ("may be for sale", article farm). The content script never injected on the site
  being read. Verified in a real browser: `mangadot.net/manga/<id>` and `/chapter/<id>`.
- **mangadot parsing**: series and chapter come from the tab title
  (`The Glutton: Devourer of Kings — Ch. 0: 0 | MangaDot`); the chapter URL is an opaque id.
- **Paged readers finish properly.** mangadot pages one image at a time (`Page 1 of 5, 1 / 5 · 20 %`),
  so a scroll-percentage rule never completes. Completion now also fires on an explicit
  "End of chapter" marker in view, or when the paged indicator says you are on the last page.
- **DOM changes are observed, not just timers**, because timers are throttled in background tabs —
  the previous poll missed the page change entirely.
- **Chapter 0 works.** `!chapter` treated prologue chapter 0 as "no chapter", so it was never
  recorded on any site.

## [0.7.3] — unreleased

Reader coverage, and a pill that admits when it cannot read a page.

- **weebcentral.com**: chapter pages carry everything in the tab title
  (`Chapter 20 | World Wide Web MIKO! | Weeb Central`) and their URLs are opaque ids
  (`/chapters/01M7…`), so the number can only come from the title. Parsed properly now —
  verified: `World Wide Web MIKO! · ch 20`, with no site name left in the label.
- **Generic title sources**: single-chapter views often have no `og:title`; the reader now also
  reads `h1`, a link back to the series page, `[data-title]` attributes, and finally the URL slug.
- **The pill no longer disappears on unknown layouts.** It used to hide when it could not parse a
  page, which is indistinguishable from a broken extension. It now stays visible with what it does
  know and offers manual chapter entry.
- The overlay test harness serves pages on the real hostnames (`--host-resolver-rules`), so per-site
  rules are actually exercised instead of silently skipped.

## [0.7.2] — unreleased

- **The activity log now stamps the build it came from** (header shows `v0.7.2`, and any event from a
  different version is marked inline). Two rounds of debugging went into working out which build was
  actually running from the shape of the log.
- **The id bridge always runs when linking.** It only ran when *title* matching had added something,
  so a series with AniList already linked but MangaBaka missing never got the MAL → MangaBaka lookup —
  and MangaBaka's title search cannot find alternate titles like "I Only Want to Beat You".

## [0.7.1] — unreleased

Two bugs that between them meant MangaBaka and AniList could never be linked.

- **MangaBaka lookups always returned null.** `/v1/source/{provider}/{id}` answers
  `{ data: { source_response, series: [ ... ] } }`, and the code read `data.id`. Every bridge from a
  MAL or AniList id to a MangaBaka series silently failed, for every series, since the first build.
  Verified against the live API: AniList 135561 now resolves to MangaBaka **1471**, "I Only Want to
  Beat You".
- **Title matching ignored synonyms.** AniList's search index knows "I Only Want to Beat You", but
  its main title is the romaji "Oroji Neoreul Igigo Sipeo", so scoring against `title` alone gave
  0.00 and the link was rejected as "too different". Search results now carry `alt` (english, romaji,
  native, synonyms for AniList; alternative titles for MAL; every title for MangaBaka) and the match
  takes the best of them — 1.00 for this series.
- `bestTitleScore` and `pickSourceSeries` are pure functions with tests built from the real captured
  responses (`tools/test-match.mjs`, `tools/test-bridge.mjs`), so this class of bug fails a test
  instead of shipping.

## [0.7.0] — unreleased

**Opening a chapter no longer counts as reading it.**

- Progress only advances when a chapter is *finished*: you reach the bottom, or the end of the last
  page is on screen (which catches readers with a "next chapter" footer, and paged or lazy pages
  where the scroll percentage never reaches 95). Opening chapter 67 and closing the tab now leaves
  the trackers at 66.
- The pill's button marks the chapter you are on, instead of silently jumping to chapter+1.
- **Every tracker now appears in the activity log.** Linked ids are logged per chapter
  (`linked: mal=…, anilist=…`), and a connected-but-unlinked tracker is named with the reason its
  title search failed — that gap is why AniList and MangaBaka were absent from the log.
- Opening a chapter records `lastSeenChapter` locally only, so the library can still show what you
  are reading without claiming you finished it.

## [0.6.1] — unreleased

- **The reader's brand name is no longer mistaken for the series.** stonescape.xyz puts "StoneScape"
  in `<title>` and `og:title`, so pages became a series called "StoneScape". The title now comes from
  the page heading first, then og:title, then the title tag, then the URL slug — and known reader
  brands are rejected outright. Verified: h1 beats the site name, and with no heading the slug
  (`/manga/hells-paradise/...`) is used.
- **No more 100% on open.** A page whose images have not laid out is not a finished chapter. The
  percentage reads "—" until the page is actually scrollable, and a chapter is only marked finished
  after real scroll evidence, so opening a chapter no longer claims you read it.
- **Activity rows stop overlapping**: the log was a `<pre>` with an unstyled header; it is now real
  rows (time / message / place) with the card header laid out as flex. Verified by geometry, not by
  eye: four rows, zero overlapping pairs.
- **Remove entries from the library**: an × on each card drops a series from Kura only — useful for
  the duplicates created by the old title matching. Trackers are untouched.

## [0.6.0] — unreleased

The reading loop, made observable and made to actually reach the trackers.

- **In-chapter progress**: the pill shows a percentage and a thin bar for how far through the
  chapter you are, following whichever element actually scrolls (readers often nest the pages).
- **Chapter finished**: reaching the end (~95%) sends a completion event, turns the indicator green
  with a ✓, and saves progress — the missing "you read this chapter" signal.
- **Activity log in Setup**: every reader event, match decision and per-tracker result is recorded
  locally (last 60). A silent 401 or an unmatched title is now a readable line instead of a mystery.
- **Title matching**: reader pages decorate titles (`(Official)`, `- Vol. 2`, `[Latest]`). Matching
  is tolerant now, so a page maps onto the series you already track instead of creating a duplicate
  entry with no tracker links — which is why MAL/AniList stayed put while MangaBaka moved.
- **Auto-linking**: a series first seen on a reader page has its AniList/MAL/MangaBaka ids resolved
  by title, then via the MangaBaka bridge, so it can sync at all.
- **Fixed**: the manual chapter input stayed visible because `all: unset` overrode `[hidden]`.

## [0.5.3] — unreleased

- **Advanced shows overrides, not Kura's own ids.** Older builds copied the built-in AniList/MAL
  client id into storage, so the fields looked like personal settings. They are placeholders now
  (`Kura's default — 56681`), stale copies are cleared, and empty always means "use Kura's app".
  Nothing in that panel is per-user or secret: the ids ship inside the extension, the MAL secret
  stays in the Worker, and an OAuth session never touches them.

## [0.5.2] — unreleased

- **MangaBaka import reported nothing, including its own errors.** The import result was written to
  `#mangabaka-state`, but the element is `#mb-state`, so the lookup returned null and every outcome
  was discarded. Tracker → element ids are now mapped explicitly.
- **Per-series MangaBaka calls were 404ing**: reads and writes went to `/v2/my/library/{id}`, which
  does not exist. Only `/v1/my/library/{series_id}` carries get/patch.
- **Failures now say what happened**: HTTP status and message inline in the Setup row, plus a toast,
  and an explicit "nothing in your MangaBaka library to import" instead of a silent "0 series".

## [0.5.1] — unreleased

- Signing in to MangaBaka clears any stored personal access token, so an old token cannot linger
  next to the OAuth session.

## [0.5.0] — unreleased

- **MangaBaka one-click sign-in**: Kura's own public OAuth client is now the default, so Connect on
  MangaBaka is the same single click as AniList and MAL. Personal access tokens still work under
  Advanced. Verified against MangaBaka's authorize endpoint: an unknown client returns
  `invalid_client` and a mismatched redirect returns `invalid_redirect`, while Kura's client id +
  redirect pass both checks.

## [0.4.0] — unreleased

Sign in, don't configure. And the library actually renders.

- **Setup rebuilt**: three rows — AniList, MyAnimeList, MangaBaka — each with Connect and Import
  list. No client ids, worker URLs or tokens on screen. All of it moved under *Advanced — run your
  own apps*, for people who would rather use their own registrations.
- **Library rendering fixed**: grid rows were being squeezed to the popup height, so every card was
  ~95px tall and clipped a ~290px cover (the wall of thin strips). Rows are now content-sized
  (`grid-auto-rows: max-content`) and the cover is a ratio box the grid can measure.
- **MangaBaka personal tokens fixed**: they go in `x-api-key`. We were sending
  `Authorization: Bearer`, which MangaBaka treats as an OAuth token and rejects with
  `Invalid access token`. This is why every token pasted so far failed.
- **MangaBaka OAuth**: public client + PKCE (no secret), `openid` + `library.read/write` +
  `offline_access`, tokens refreshed single-flight because MangaBaka retires the old refresh token
  on every rotation. Connect shows a clear message until a client id is configured.
- **MangaBaka library calls** moved to `/v2`, where items are `{ entry, series }`.

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
