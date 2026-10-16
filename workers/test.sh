#!/bin/bash
# Every worker test in one go: bash workers/test.sh
set -e
cd "$(dirname "$0")"
node telemetry.test.mjs
node leads.test.mjs
