#!/bin/bash
# Lead gate end-to-end check: bash tools/testbed/lead-gate-check.sh
# Rebuild first (python3 tools/build.py aircraft-calc) - it tests docs/aircraft-calc.js.
set -e
cd "$(dirname "$0")/../.."
OUT=${OUT:-$(mktemp -d)}
python3 tools/testbed/lead_mock.py 8765 . & MOCK=$!
trap 'kill $MOCK 2>/dev/null' EXIT
sleep 1
OUT=$OUT node tools/testbed/lead-gate-check.mjs
