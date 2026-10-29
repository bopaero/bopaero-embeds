#!/bin/bash
# form_reached check: bash tools/testbed/form-reached-check.sh
# Tests components/_shared/telemetry.js directly - no build needed.
set -e
cd "$(dirname "$0")/../.."
python3 -m http.server 8766 --bind 127.0.0.1 >/dev/null 2>&1 & SRV=$!
trap 'kill $SRV 2>/dev/null' EXIT
sleep 1
node tools/testbed/form-reached-check.mjs
