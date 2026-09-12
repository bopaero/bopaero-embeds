# bopaero-embeds

Single source of truth for the code embedded in bopaero.com Squarespace pages.

Baseline captured from the live site 2026-09-12. **The live site was the only
authoritative source at that point** — two local copies had already diverged
(`~/sf50-calc` 0.675 similarity, `~/sr22t-calc` 0.818). Do not trust those.

## The idea

A component appearing on several pages must be editable in ONE place. Two modes:

| Mode | When | Deploy |
|---|---|---|
| `loader` | component is on 2+ pages | `git push` — every page updates |
| `paste`  | single-page component | build, paste into that one block |
| `vendor` | third-party embed | **not managed here** — edit in the vendor UI |
| `review` | not yet classified | needs a decision |

`registry.json` records which component is on which pages, and its mode.

## Loader mode

The Squarespace block holds only a stub (`snippets/<name>.html`):

```html
<div id="sf50-calc-mount"></div>
<script src="https://embeds.bopaero.com/sf50-calc.js?v=..." defer></script>
```

After that one-time paste, the block is never touched again. `docs/<name>.js`
injects the CSS once, renders the HTML into the mount, then runs the component JS.
It refuses to mount twice and falls back to its own parent node if the mount div
is missing, so a mangled block degrades rather than breaks.

## Workflow

```bash
python3 tools/extract.py <name>     # live block -> components/<name>/src/{html,css,js}
# edit components/<name>/src/
python3 tools/build.py              # src -> docs/<name>.js + snippets/<name>.html
node --check docs/<name>.js         # always
python3 tools/audit_site.py         # drift check against the live site
git add -A && git commit && git push
```

### Testbed

`tools/testbed/index.html` mounts every built component with a console capture.

```bash
python3 -m http.server 8791
open http://127.0.0.1:8791/tools/testbed/index.html
```

Verify the component RENDERS AND COMPUTES, not just that it parses — and check
**computed visibility, not the `hidden` attribute**. A DOM check on `el.hidden`
passed while a row was plainly visible on screen, because
`.calculator .output-item { display: flex }` outranks the browser's
`[hidden] { display: none }`. Filter on
`getComputedStyle(el).display !== 'none'`, and take a screenshot. `sf50-calc`
was verified this way: 5 yrs / 175 hrs -> $1,372/hr, Clear resets, fuel price
fetched live from the TripCalc repo.

## Drift

`tools/audit_site.py` re-scans all pages and reports:
1. loader components whose stub is not yet live (`PENDING`)
2. captured blocks that no longer match the live site (someone edited Squarespace directly)
3. new blocks the registry doesn't know about

Run it before and after any change. It is the only thing preventing the drift
this repo exists to fix.

## Do not manage here

Three `link.killerspots.com` iframes (LeadConnector) on 12, 6 and 3 pages. The
form content lives in the vendor UI; only the wrapper is in the page. Versioning
the wrapper would imply control we do not have.
