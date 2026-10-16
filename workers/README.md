# telemetry worker

Folds embed beacons into aggregate counters. **No row anywhere represents a single
visit** — payloads are counted and discarded on arrival. That is the distinction from
the inherited Hotjar this replaces, and it is what keeps the data inside the "usage
data / network activity" the existing privacy notice already covers.

## Deploy (needs Raymond's Cloudflare auth)

    cd workers
    npx wrangler d1 create bopaero-telemetry          # paste database_id into wrangler.toml
    npx wrangler d1 execute bopaero-telemetry --remote --file=./schema.sql
    pbpaste | npx wrangler secret put REPORT_TOKEN    # pipe it; empty values "succeed"
    npx wrangler deploy

Then set `ENDPOINT` in `components/_shared/telemetry.js` to the deployed
`/collect` URL, rebuild, and push. Until that constant is set the collector
gathers but sends nothing.

## The report token

**Never commit it — this repo is public.** It lives in the macOS Keychain on Raymond's
machine and in Cloudflare as a Worker secret (write-only there; it cannot be read back).

    security find-generic-password -a bopaero -s bopaero-telemetry-report-token -w

To rotate:

    NEW=$(python3 -c "import secrets;print(secrets.token_urlsafe(32))")
    printf '%s' "$NEW" | npx wrangler secret put REPORT_TOKEN
    security add-generic-password -a bopaero -s bopaero-telemetry-report-token -w "$NEW" -U
    npx wrangler secret list        # confirm - `secret put` reports success on an EMPTY value

## Check it

    node telemetry.test.mjs                            # sanitiser, incl. hostile input
    curl "https://<worker>/report?token=<token>&days=7" # aggregate JSON

## Shape

| table | grain |
|---|---|
| `metrics`  | day × path × view × metric name |
| `bins`     | day × path × view × 20×40 click grid cell |
| `controls` | day × path × view × control name |

Retention: 90 days, swept nightly by the `scheduled` handler.

---

# leads worker (`bopaero-leads`)

The back end of the calculator lead gate. The aircraft calculators (bopaero.com)
and TripCalc (tripcalc.bopaero.com) show results only after a short form: name and
email required, phone / company / desired program optional. The form posts to
`POST /lead`; this Worker files the visitor in **LeadConnector** as a contact plus an
open opportunity, and the page then sets the `bopaero_lead=1` cookie (no personal
data in it, Domain=bopaero.com so one form covers both sites, 1 year) so the form
never shows again.

**The token never leaves this Worker** — the embeds are public code in a public repo.

## What it sends (checked against the official docs, 2026-10-16)

| step | call | doc |
|---|---|---|
| 1 | `POST /contacts/upsert` — name, email, phone, companyName, source "bop Aero website calculator" | https://marketplace.gohighlevel.com/docs/ghl/contacts/upsert-contact.md |
| 2 | `POST /contacts/{id}/tags` — `calculator-lead`, `tool-calculator` or `tool-tripcalc`, `interest-<program>` | https://marketplace.gohighlevel.com/docs/ghl/contacts/add-tags.md |
| 3 | `GET /opportunities/search?locationId&pipelineId&contactId&status=open` | https://marketplace.gohighlevel.com/docs/ghl/opportunities/search-opportunity.md |
| 4 | `POST /opportunities/` — "<Program> — <Name>" (or "Calculator lead — <Name>"), status open, in the configured pipeline/stage; **skipped if step 3 found an open one** | https://marketplace.gohighlevel.com/docs/ghl/opportunities/create-opportunity.md |

- All calls send `Version: v3` — the only value the current docs allow (older
  examples online show `2021-07-28`). Overridable with the `LC_API_VERSION` var.
- Tags go through step 2, not the upsert: on upsert, tags **replace** the contact's
  existing tags, which would wipe whatever Raymond has tagged them with.
- The program is a tag (`interest-sf50-g3`, `interest-sf50-preowned`, `interest-sr22t`,
  `interest-sr22t-leasing`, `interest-founders`, `interest-not-sure`) and is in the
  opportunity name. A tag needs no custom-field setup and works in LC workflows/filters.
- Upsert matches on the location's "Allow Duplicate Contact" rule, so a returning
  visitor updates their contact instead of creating a second one.

Guards: exact-origin allowlist (bopaero.com, www, tripcalc, localhost — never `null`),
validation + length caps, a hidden honeypot field, a best-effort per-IP burst limit
(8 per 10 min per isolate), 4 KB body cap. Logs carry status codes and the tool /
program only — never the visitor's details.

## Go live (needs Raymond)

1. In LeadConnector, create a **Private Integration** token for the sub-account with
   scopes `contacts.write`, `opportunities.readonly`, `opportunities.write`
   (`contacts.readonly` too is harmless). Copy it to the clipboard.
2. Find the IDs with the token (pipelines list includes each stage's id):

       curl -s -H "Authorization: Bearer $(pbpaste)" -H "Version: v3" \
         "https://services.leadconnectorhq.com/opportunities/pipelines?locationId=<LOCATION_ID>"

   The location (sub-account) ID is in the LC URL: `/v2/location/<LOCATION_ID>/...`.
3. Fill `LC_LOCATION_ID`, `LC_PIPELINE_ID`, `LC_STAGE_ID` in `wrangler-leads.toml`, then

       pbpaste | npx wrangler secret put LC_TOKEN -c wrangler-leads.toml
       npx wrangler secret list -c wrangler-leads.toml      # confirm it is there
       npx wrangler deploy -c wrangler-leads.toml

4. Put the deployed URL + `/lead` into `LEAD_ENDPOINT` in
   `components/_shared/lead-gate.js` and in TripCalc's `index.html`, rebuild, merge.

## Check it

    bash workers/test.sh        # telemetry + leads; LeadConnector is mocked
