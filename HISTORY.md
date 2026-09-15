# bopaero-embeds — revision history & rollback guide

Single source of truth for the code embedded in bopaero.com Squarespace pages.
Edit a data file or component, run `python3 tools/build.py`, `git push` — every page
carrying the stub updates within ~10 minutes. No pasting.

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

## Conventions
- **Tags are incremental.** Raymond promotes a release to `stable-*` manually.
- **No `?v=` cache buster in stubs** — the stub text must never change, or every page
  needs re-pasting. Freshness comes from `max-age=600` + ETag.
- Verify in `tools/testbed/` with a real browser AND a screenshot; `tools/testbed/mobile.html`
  for phone width (window resizing does NOT work — innerWidth stays desktop).
