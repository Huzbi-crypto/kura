# Changelog

All notable changes to Kura. Format: [Keep a Changelog](https://keepachangelog.com/), versioning
follows [SemVer](https://semver.org/).

## [0.9.17] — unreleased

The panel now checks where it actually is, and moves back when it is at the page end.

- **A mounted card is re-checked against the chapter list.** `ensure()` used to accept any visible card
  showing the right title as done. A card that ends up below the end of the chapter list is now treated
  as misplaced and re-rendered, at most three times in a row, with the budget resetting once the card
  has stayed put for ten seconds. Moving the card to `body`'s end on `/manga/O43t` puts it back under
  the description in about 600ms, at the cost of one extra status lookup.
- **`chapterList()` for atsu, corrected twice.** It returns the container holding the most chapter rows
  rather than the first "Chapter N" match, which was the sidebar's open-chapter button at the top of
  the page — that made the card look misplaced on arrival. It also knows the `Ch.` and `Episode` row
  prefixes, and caches its answer for 3s because `ensure()` asks every 1.2s.
- **atsu's description floor is 40 characters, not 80.** Series with a short synopsis were falling
  through to the chapter-list fallback.
- **The audit covers placement at two widths and self-correction.** The narrow pass reads the site's
  own `expect` (a gap under the description for `afterSynopsis`, above the chapter list otherwise) and
  fails if the placement fell through to the page end. A new pass moves the mounted card to the page
  end and requires it to come back above the chapter list with exactly one card left.
- Baseline: atsu 18/18, mangadot 18/18, weebcentral 18/18, stonescape skipped (serves no series
  content).

## [0.9.16] — unreleased

The panel no longer falls to the end of the page at all.

- **A chapter list is now tried before the page end.** When no description can be found, the panel is
  inserted above the chapters instead of after everything. Sites can also answer where their chapter
  rows are (`chapterList()`), which atsu now does.
- The first explanation given for the reported page (a logged-in Premium layout with no description
  where the anonymous one has it) was wrong: signed-in and signed-out atsu render the description in
  the same place and differ only in the buttons under the cover. The fallback ordering was the real
  weakness.
- Verified with the description hidden behind `display:none`: the card lands at 422, above the first
  chapter row at 503, at both 2048px and 820px. With the description present it is unchanged at 462,
  16px under it. atsu audit: 16/16 at the time.

## [0.9.15] — unreleased

The panel fell to the bottom of the page in a narrow window.

- **Cause: a hidden description.** At narrow widths atsu swaps in a compact layout and leaves the
  desktop description in the DOM, unrendered. atsu's `synopsis()` took the longest text block without
  checking whether it had a box, so it picked the hidden one; the card was inserted into a
  `display:none` subtree, failed the visibility test, and the last resort (end of the content column)
  put it below the entire chapter list. Measured at 760px on `/manga/O43t`: description at 456, card at
  2813, below the last chapter row at 2727. With the fix the card is at 518, 16px under the
  description. This is why every desktop-width check was green.
- The picker now requires a real visible box (`getClientRects()` non-empty and height above 8px).
- The per-site audit runs the series page twice, at desktop width and at 820px, and fails if the
  placement falls through to `end of the content column`. atsu: 16/16.

## [0.9.14] — unreleased

A site can say where its description is.

- **New per-site hook: `synopsis()`.** The shared finder climbs from the description paragraph to a
  container it believes is the series card, and on a site whose container also holds other blocks
  that climb is what decides the panel's position. A site definition can now answer the question
  itself; atsu returns the longest leaf block in the content column.
- Measured on ten real atsu series pages at 2048px: everywhere the panel sits 16px under the
  description. The change did not move the card on any of them; it removes the accident that it
  happened to be right, and gives atsu's layout an explicit answer.
- Note: if the panel is ever placed below the chapter list, the Activity line names the spot that was
  used, and `end of the content column` means the description was not found at all.

## [0.9.13] — unreleased

A chapter counted by mistake can be put back.

- **Progress only ever went up, so a wrong chapter was permanent.** Every path takes the highest value
  (`max(local, remote)`), which is what stops a stale pull from rolling your reading back. The cost is
  that a chapter pushed by mistake becomes the truth, every later sync keeps it, and it is fanned out
  to the other trackers: that is what makes an old false "76" still look like a live bug.
- **New: set the exact chapter.** The popup card now has a number field beside `+1`. Type a chapter,
  press Tab or Enter, and that value is written and pushed to every linked tracker, up or down. This is
  the only path that lowers, and the only way to correct chapters that were counted before 0.9.12.
- Verified in the extension harness: progress at 72, opening chapter 73 leaves it at 72 and reports
  `openedOnly`, finishing 73 moves it to 73, and setting 70 lowers it to 70. The popup card renders the
  field and shows the corrected number.

## [0.9.12] — unreleased

Opening a chapter no longer moves your progress.

- **The bug: a chapter that opens already scrolled counted as read.** The `userScrolled` flag was set
  from the page's scroll *position*, not from you moving it. Readers restore your place, so a chapter
  opened on the back of the previous one can appear at the bottom immediately, and the "you scrolled
  far" rule finished it: opening 73 after finishing 72 pushed 73 to every tracker. The opening
  position is now recorded and only a real move away from it (200px) counts as scrolling. Covered by
  `chapter opens at the bottom (restored position)`: open at 96%, nothing is sent, scrolling up sends
  nothing, scrolling back to 96% sends one completion.
- **The load-time false end is gone.** The old `chapterEndVisible()` treated the last *laid-out* image
  as the last page. On a reader that has not laid out its remaining images yet, that is the first
  page, so it could declare the chapter finished the moment it opened. Removed; completion comes from
  the end marker, the pager, or reaching the end of the scroll.
- **95% is back.** Removing it was wrong: you cannot know what sits below a chapter (a comments
  section can be longer than the chapter), and MAL-Sync finishes at the same threshold. Scrolling to
  96% with a footer still below finishes the chapter; 93% does not.

## [0.9.11] — unreleased

A chapter that was only started can no longer be marked read.

- **The percentage rule is gone.** `pct >= 95` finished a chapter, and 95% of a long chapter is still
  the middle of it. A chapter now finishes only on evidence that you reached the end: an explicit
  end-of-chapter marker, a pager sitting on its last page, or the reader scrolled to the bottom of
  what it holds after you actually scrolled. Seeing the last page is not enough on its own, because
  a site that has not laid out its remaining images looks exactly the same.
- **Completion survives a re-render.** It was remembered as a chapter number and cleared on every
  `report()`; a re-render makes detection briefly return a different title, so a chapter already
  completed could be completed again and the pill could drop back to a percentage. It is now a
  `title|chapter` key, and only a real path change clears the scroll evidence.
- Harness: `started is not finished` asserts no completion at 55%, 80% and 93% and exactly one at the
  real end; `footer below the pages` asserts that the last page on screen is not the end when content
  follows. Live on the atsu reader: no completion at 10/25/40/55/70/85/93/97%, one at the bottom, and
  nothing further on the way back up.

## [0.9.10] — unreleased

A chapter marked read before it was opened.

- **Achievement tiers read as a page counter.** The overlay decides "this is the last page" by looking
  for `N of M` text in pager-ish elements. atsu.moe renders achievement badges ("Genre Explorer, Jack
  of All Trades, tier 4 of 4"), and `4 of 4` satisfied it, so as soon as that widget was in the DOM the
  overlay concluded the chapter was finished: the pill jumped to `✓ read` and the completion went to
  every tracker. Scroll direction never mattered, which is why scrolling up showed it too, and why the
  percentage looked correct only while the badge widget had not rendered yet.
- A page counter now has to be one: the word `page` with `N of M`, or a bare `3 / 3` / `3 / 3 · 100 %`
  counter, in a short element. The aria-label and the text are matched separately, because a real
  pager reads `Page 3 of 3, open page selector` in the label and `3 / 3 · 100 %` on screen.
- Harness: an atsu reader fixture carrying those badges (it completed on load before, sends nothing
  now), while the mangadot paged reader still completes on its real last page.
- Live on the atsu reader with the real scripts: at the top `pct 0, paged false, nothing completed`;
  at 50% `pct 50`; at the bottom `pct 98` and one completion.

## [0.9.9] — unreleased

The pill named the series after a label.

- On atsu the reader page has no `h1`, and the link back to the series holds a label and the title in
  the same anchor: `<a href="/manga/jqb3X">Manhwa Info<span>The Boxer</span></a>`. Reading that
  anchor's text gave `Manhwa InfoThe Boxer`, which is what the pill showed and what would have been
  sent to the trackers.
- atsu now takes its series title and chapter number from `<title>` (`The Boxer - Episode 1`), which
  is clean on both page types. The case is in the overlay harness, which serves the fixture on the
  real hostname.
- Verified on the live reader page: the pill reads `The Boxer · ch 1` and the recorded title is
  `The Boxer`.

## [0.9.8] — unreleased

The panel that appeared on some reloads and not others.

- **Cause: three fixed timers, then silence.** The page was asked for a card at 0s, 1.2s and 3s, and
  the keep-alive that was supposed to catch everything else returned immediately while nothing was
  mounted. Reader sites mount their series heading whenever hydration, an auth check or an
  interstitial finishes, so a reload that hydrated after 3s never got a second look. Same page, same
  build: one card or none, depending on the race. Reproduced in the harness with a fixture whose
  heading arrives at 5s, which produced `card: false` while the heading was on the page.
- **One entry point instead of a schedule.** `ensure()` reads the page as it is right now and decides
  whether a card is needed; it runs on every DOM change (debounced 120ms), on a 1.2s tick, on `load`
  and on `popstate`. It compares the mounted card with the title the page currently has, so a late
  mount, a re-render, an SPA navigation and a site that deletes the card all converge on the same
  repair.
- **The retry budget is per page and self-refreshing.** 40 attempts on a page, reset when the path
  changes, and reset again once a mount has survived 10 seconds, so a long session is never rationed.
- Verified live by reloading each site three times with the real content scripts: atsu 3/3, mangadot
  3/3, weebcentral 3/3, no duplicates in any round. stonescape 0/3 with `no series title on this
  page`, which is correct: that site serves no series content.

## [0.9.7] — unreleased

One file per reader site, and the wall that a panel was being drawn on.

- **Per-site files, the way MAL-Sync does it.** Every site now has its own file in `src/sites/`
  carrying its URL patterns, title/chapter extractors and panel placement, registered into
  `src/sites/registry.js`, and loaded by the manifest before the two content scripts. Nothing in
  `src/content/` names a host any more, so adding a reader is one new file and cannot regress
  another site by editing a shared table.
- **Shared rules live in the registry, once.** What counts as a site's own name (a brand is a
  fragment of its own hostname) and what counts as a bot wall are used by the panel and the pill
  alike, so they cannot drift apart.
- **The panel refuses a challenge page.** mangadot served a Cloudflare wall on a series URL during
  verification and the panel drew a card titled "Performing security verification". The pill already
  refused interstitials; the panel now asks the same question and logs `challenge page, not content`.
- Verified live with the real content scripts at a 25s dwell: atsu (one card, `The Boxer`, after the
  series card), weebcentral (one card, `Hunter x Hunter`, above the chapter list), stonescape (no
  card, no series content), mangadot (no card, challenge page). Mangadot's placement is covered by
  the harness fixture only, because that site kept serving the wall to the verification browser.

## [0.9.6] — unreleased

Duplicate progress cards, and the version number that did not move.

- **One card, ever.** Re-inserting a node captured by an earlier render is what produced several
  identical panels stacked down the page: the closure held an old node while `mounted` had moved on,
  so the old card returned beside the new one. There is no "put it back" path any more; a fresh
  render is the only repair, every mount ends by removing every other card, and renders are single
  flight so two overlapping ones cannot both insert. Measured under a mutation flood: 12 cards
  before, 1 after.
- **Reading the version is how the version gets bumped.** 0.9.5 shipped two behaviour changes without
  a new number. Every behaviour change bumps `manifest.json`, which is the single source: the popup
  header, the Activity log stamp and the diagnostics all read it from there.

## [0.9.5] — unreleased

Two regressions from 0.9.4, both found by the Activity log it added.

- **mangadot asked for the wrong title.** Its `h1` nests the title and its alternate titles as
  sibling spans inside one wrapper, so the panel requested
  `"I Only Want to Beat YouOroji Neonreul Igigo Sipeo오로지 너를 이기고 싶어"` — a string that matches
  nothing. The heading text is now the first text-bearing leaf, giving `I Only Want to Beat You`.
- **atsu.moe's layout was squashed.** The chapter landmark matched a narrow sidebar link labelled
  "Chapters", so the panel was inserted into that rail. A landmark must now be a real column
  (≥45% of the viewport width and taller than 80px), and the panel refuses to insert into anything
  narrower than a column at all.
- **A site that re-renders no longer takes the panel with it.** The SPA drops any node it did not
  create, and it can also hide our node without removing it. Both count as a failure: a node that is
  still connected but zero-height is not placed. The panel is put back, re-rendered when reconnecting
  changes nothing, and the retry budget resets only after a visible mount.
- **Placement is measured, not assumed.** Every candidate position (above the chapter list, after the
  series card, end of the content column) has to produce a real, visible box, and a position that
  would put the panel above the series heading is rejected. The log names the spot it used.
- **atsu.moe gets its own rule.** Its chapter list sits thousands of pixels below the synopsis, so the
  panel anchors to the series card there instead of the chapter landmark.
- **A page with no series content gets no card.** stonescape's `/series/` route now 404s and its slug
  pages render only the site chrome and a cookie banner, and the logo is an `h1` whose text is split
  into spans, so the first text leaf named a series "STONE". Brand fragments are now rejected (a logo
  is a link home, and a brand fragment is a prefix of its own hostname), and the panel logs
  `no series title on this page` instead of drawing a card for a series that does not exist.
- Verified live on all three: atsu (`I Only Want to Beat You`, below the synopsis, above Chapters,
  layout intact), stonescape (`942px`, aligned with the chapter list), mangadot (`868px`, aligned
  with the chapter column, title clean).
- Re-verified live after the placement rewrite, through the anti-detect browser: atsu (`The Boxer`,
  618px card matching its 618px synopsis, no overflow), mangadot (`The Glutton: Devourer of Kings`,
  988px matching the 988px chapter column, above it), weebcentral (`Hunter x Hunter`, 800px matching
  the column it introduces, above the chapter list), stonescape (no card, `no series title on this
  page`, because the site serves no series content).
- The harness now asserts the mangadot case end to end: nested alt-title spans must still produce
  the series title alone. It also asserts that a hidden panel is re-rendered, that a shell page
  renders nothing, and that a stonescape-shaped page still names the series and sits above its
  chapter list.

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
