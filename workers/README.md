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
