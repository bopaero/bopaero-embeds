#!/usr/bin/env python3
"""Refresh the built-in (fallback) figures of costing-driven calculators.

    python3 tools/sync_costing.py           # update data/aircraft/*.json if the costing moved
    python3 tools/sync_costing.py --check   # report only; exit 1 if any fallback is stale

A data file with a `costing` block takes its live figures from that costing at
page load (see components/aircraft-calc). The figures stored in the file are the
fallback shown first and used if the costing can't be reached. This keeps them
equal to the live costing, using the costing's OWN costing.js through Node, so
there is still exactly one implementation of the program math.

sharesRemaining is sales status, not costing: it is never written here, but if
the costing now offers fewer shares than sharesRemaining says remain, this
fails so a person decides.
"""
import glob
import json
import os
import subprocess
import sys
import tempfile
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIELDS = ('programCost', 'annualProgramFee', 'totalShares', 'availableShares', 'taxRate')

NODE = r"""
const [lib, data, program] = process.argv.slice(1);
const C = require(lib), costing = require(data);
const problems = C.validate(costing);
if (problems.length) { console.error('costing invalid: ' + problems.join('; ')); process.exit(2); }
const d = C.derive(costing), p = d.byKey[program];
if (!p) { console.error('program ' + program + ' not in costing'); process.exit(2); }
console.log(JSON.stringify({ version: d.version, programCost: p.capPerShare, annualProgramFee: p.annualFee,
                             totalShares: p.interests, availableShares: p.shares, taxRate: d.common.taxRate }));
"""


def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'bopaero-embeds costing-sync', 'Cache-Control': 'no-cache'})
    with urllib.request.urlopen(req, timeout=45) as r:
        return r.read()


def live_figures(cfg, tmp):
    lib, data = os.path.join(tmp, 'costing.js'), os.path.join(tmp, 'costing.json')
    open(lib, 'wb').write(get(cfg['lib']))
    open(data, 'wb').write(get(cfg['url']))
    out = subprocess.run(['node', '-e', NODE, lib, data, cfg['program']], capture_output=True, text=True)
    if out.returncode:
        sys.exit('costing-sync FAILED: ' + out.stderr.strip())
    return json.loads(out.stdout)


def main():
    check_only = '--check' in sys.argv
    stale = 0
    with tempfile.TemporaryDirectory() as tmp:
        for path in sorted(glob.glob(os.path.join(ROOT, 'data', 'aircraft', '*.json'))):
            spec = json.load(open(path))
            cfg = spec.get('costing')
            if not cfg:
                continue
            live = live_figures(cfg, tmp)
            diffs = [(f, spec.get(f), live[f]) for f in FIELDS if spec.get(f) != live[f]]
            name = os.path.basename(path)
            if isinstance(spec.get('sharesRemaining'), int) and spec['sharesRemaining'] > live['availableShares']:
                sys.exit('costing-sync FAILED: %s says %d shares remain but costing %s offers %d — update sharesRemaining by hand'
                         % (name, spec['sharesRemaining'], live['version'], live['availableShares']))
            if not diffs:
                print('%s: fallback matches costing %s' % (name, live['version']))
                continue
            stale += 1
            for f, a, b in diffs:
                print('%s: %s %s -> %s (costing %s)' % (name, f, a, b, live['version']))
            if not check_only:
                raw = open(path).read()
                for f, a, b in diffs:
                    spec[f] = b
                with open(path, 'w') as fh:
                    json.dump(spec, fh, indent=2, ensure_ascii=False)
                    fh.write('\n')
    if check_only and stale:
        sys.exit(1)


if __name__ == '__main__':
    main()
