# bopaero-embeds — revision history & rollback guide

Single source of truth for the code embedded in bopaero.com Squarespace pages.
Edit a data file or component, run `python3 tools/build.py`, `git push` — every page
carrying the stub updates within ~10 minutes. No pasting.

---

## v2026-09-15.2 — design system, share selector, in-page CTA

### Design
Audited bopaero.com computed styles and rebuilt the embeds on a shared token layer
(`components/_shared/tokens.css`, prepended to every component by build.py, scoped to
`.bop-embed`). **Edit brand values there, never in a component.**

| | Before | After |
|---|---|---|
| Buttons | Bootstrap `#dc3545` / `#28a745` | orange pill + outlined pill |
| Body type | Arial | proxima-nova |
| Corners | 6px | full pill (300px), matching the site |
| Focus ring | Bootstrap blue | navy |
| Usage note | inherited full-size orange | 13px grey italic |
| Footnotes | inherited orange | `#333` |

Measured tokens: Archivo Black headings (tracking −0.02em), proxima-nova body weight
300, orange `#FF6700`, navy `#003767`, ink `#282D30`.

**Container queries replace media queries.** These are embeds: the block can sit in a
narrow column on a wide screen, where `max-width:900px` never fires. Verified — at a
1384px window, narrowing the block to 420px collapses the grid.

### Calculator
- **Ships open.** Collapsed, most visitors never reached the numbers.
- **Share selector** (1..N, capped at what is for sale — 8 SF50 / 14 SR22T) drives every
  share-dependent figure from one function: program cost, annual fee, entitlement,
  scheduling limit, heading, footnote phrase, per-hour cost.
- Confirmed by Raymond: multi-share pricing is **strictly linear**; a reservation block
  is **per share** so the scheduling limit scales.
- SR22T hours placeholder was hard-coded at 175 against a 96-hour cap — now data-driven.
- **In-page jump CTA**, delivered from the bundle with no Squarespace work. Verified on
  a real phone by Raymond.

### Traps worth remembering
- The accordion shipping open moved the image-wake fix out from under the `toggle`
  event, which no longer fires on load — it runs at init too, or the photos silently
  never load.
- Never re-inject `addendumHtml` to update the footnote: `fuelNoteEl` is captured from
  inside it, and re-injecting orphans it so the live fuel price vanishes.
- IntersectionObserver and scroll events are throttled in background tabs and some
  webviews, and never deliver even the first IO callback — the CTA carries a geometry
  fallback for that.

---

## v2026-09-15.1 — first full release: all 8 embeds on the loader

The site went from eight hand-pasted copies of two components to eight six-line
stubs served from one build.

### Live-site corrections shipped

| What | Before | After |
|---|---|---|
| SF50 annual program fee | $131,291 | **$136,178** |
| SR22T program cost | $95,677 | **$100,956** |
| SR22T annual program fee | $30,522 | **$33,976** |
| SR22T share footnote | "16 available" | "16 total, 15 available for purchase, 14 currently remaining" |
| SF50 share footnote | "one of eight available" | "9 total, 8 available for purchase" |
| Shares row | not shown | "8 of 9" / "14 of 16" |
| Per-hour cost above the usage cap | understated ($361/hr at 150 hrs) | hidden; warning only |
| Calculator photos | intermittently never loaded | load on accordion open |
| Usage note | inherited full-size orange body copy | 13px grey italic |
| Footnotes | inherited orange | #333 |

The pricing errors understated a 5-year SR22T by roughly $22.5k.

### Structural
- Public repo + GitHub Pages (`main` `/docs`) on `embeds.bopaero.com`, Let's Encrypt
  cert, HTTPS enforced.
- `sr22t-pilots-v` / `-v-1` unpublished (they advertised a DIFFERENT product: unit-based
  1/8th share) with 301s to `/sr22t-fractional-ownership-program-pilots`.
- `/travel-model-test` unpublished — it was serving a Google Maps API key.
- Registry now watches the stubs themselves, so a stray Squarespace edit shows as drift.

### Known-good state
Verified live on every page: values, a real calculation, both photos, mobile at 390px,
maps (SF50 no circles + dashed 100°W divider; SR22T 207mi circle on hover).

---

## Open to-dos

### Closed: section reorder — DONE on all six pages (2026-09-16)
PRICING moved above SAFETY everywhere. Final order on all six:
Hero / HOW IT WORKS / **PRICING** / SAFETY / AIRCRAFT FEATURES / NEXT STEPS.

Measured after, calculator position:

| page | mobile (390x844) | desktop (1280x900) |
|---|---|---|
| sf50-pilots | 4.9 | 2.8 |
| sf50-nonpilots | 4.5 | 2.9 |
| sf50-nonpilots-business | 5.1 | 2.8 |
| sr22t-pilots | 5.2 | 3.1 |
| sr22t-nonpilots-personal | 4.3 | 3.0 |
| sr22t-nonpilots-business | 5.3 | 3.5 |

Was 8.3 screens on mobile. Form position and page length unchanged — only the order.
Calculators verified working after the move on every page, both widths.

### Closed: mobile image trimming — NOT worth doing, do not revisit
Raymond, 2026-09-16: Squarespace image and section settings are global, so shrinking an
image for mobile also shrinks it on desktop. Doing it mobile-only from CSS is worse:
the three stacked images in section 4 are placed by Squarespace's fluid engine through
per-block rules keyed to GENERATED ids (`.fe-block-ea4e8f1eaf20cf105620 { grid-area:
19/2/30/10 }`) which change whenever the section is edited — the override would break
silently on exactly the edit that caused it.

Measured, for the record: image heights above the calculator total 2,778px (40% of the
7,029px). Section heights come from per-section inline padding and background-image
sections, NOT from anything blanket CSS can reach — three separate attempts to trim
from the bundle each made the page LONGER. Line-height from the bundle saves only
253px and was judged not worth styling the host page for.

---

## Rollback

### 1. Bad build, stubs still in place (the usual case)
The stub is permanent and points at a fixed URL, so rolling back is a repo operation —
Raymond does not touch Squarespace.

    git revert <bad-commit>        # or: git checkout v2026-09-15.1 -- components/ data/
    python3 tools/build.py
    git push

Live within ~10 minutes. **Hard-reload** to see it: an already-open page keeps the
cached bundle for up to 10 minutes (`cache-control: max-age=600`).

### 2. Loader itself is broken or unreachable — restore a page to standalone code
Every pre-migration block is preserved. Paste the file's contents back into that page's
code block and the page is self-contained again, no dependency on `embeds.bopaero.com`.

| Page(s) | Baseline file |
|---|---|
| the 3 `sf50-fractional-ownership-program-*` pages | `audit/live/block_a74472485b.html` |
| the 3 `sr22t-fractional-ownership-program-*` pages | `audit/live/block_3340ed05e7.html` |
| `/sf50-locations-with-interest` | `audit/live/block_ebb97c5628.html` |
| `/sr22t-locations-with-interest` | `audit/live/block_cdac4416d4.html` |

**These baselines carry the CORRECTED prices** (captured after the 2026-09-14 hotfix),
so restoring one does not reintroduce the understated figures. It does lose everything
after the hotfix: the share counts, the cap fix, the image fix and the styling.

### 3. Verify whatever you did
    python3 tools/audit_site.py          # drift vs baseline; --refresh to re-baseline

---

## Pending

**Promote `v2026-09-16.1` to stable on or after 2026-09-17** (Raymond, 2026-09-16 — he
asked for it to sit a day first, because that release contains a regression of mine that
was live for a while before it was caught).

Gate it, do not promote blind:

    python3 tools/health_check.py            # must pass, 46/46
    git tag -a stable-v2026-09-16.1 v2026-09-16.1 -m "Promoted after 24h clean"
    git push origin stable-v2026-09-16.1

If the health check fails, do NOT tag — report what failed instead.

---

## Conventions
- **Tags are incremental.** Raymond promotes a release to `stable-*` manually.
- **No `?v=` cache buster in stubs** — the stub text must never change, or every page
  needs re-pasting. Freshness comes from `max-age=600` + ETag.
- Verify in `tools/testbed/` with a real browser AND a screenshot; `tools/testbed/mobile.html`
  for phone width (window resizing does NOT work — innerWidth stays desktop).
