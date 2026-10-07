#!/usr/bin/env python3
"""Refresh the built-in (fallback) figures of costing-driven calculators.

    python3 tools/sync_costing.py           # update data/aircraft/*.json if the costing moved
    python3 tools/sync_costing.py --check   # report only; exit 1 if any fallback is stale

A data file with a `costing` block takes its live figures from that costing at
page load (see components/aircraft-calc). The figures stored in the file are the
fallback shown first and used if the costing can't be reached. This keeps them
equal to the live costing, using the costing's OWN costing.js through Node, so
there is still exactly one implementation of the program math.

Shares remaining and scheduling (hours/days per share, from the aircraft's
yearly hours/days) are kept in the costing too, since costing v2026-10-04.1.

data/lease/<id>.json (the Leasing Program rates embed) is refreshed the same way
from the costing's bridge aircraft lease terms (since 2026-10-07).
"""
import glob
import json
import os
import subprocess
import sys
import tempfile
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LEASE_FIELDS = ('leaseMonthly', 'leaseIncludedHours', 'leaseExtraHourRate', 'leaseHourlyRate')
FIELDS = ('programCost', 'annualProgramFee', 'totalShares', 'availableShares', 'sharesRemaining',
          'schedulingHours', 'schedulingDays', 'maxHours', 'approx', 'features')

NODE = r"""
const [lib, data] = process.argv.slice(1);
const C = require(lib), costing = require(data);
const problems = C.validate(costing);
if (problems.length) { console.error('costing invalid: ' + problems.join('; ')); process.exit(2); }
const d = C.derive(costing);
const programs = {};
for (const p of d.programs) programs[p.key] = { programCost: p.capPerShare, annualProgramFee: p.annualFee,
                                                totalShares: p.interests, availableShares: p.shares, approx: p.approx,
                                                features: p.features || null, sharesRemaining: p.sharesRemaining,
                                                schedulingHours: p.schedulingHours, schedulingDays: p.schedulingDays,
                                                maxHours: p.maxHours };
console.log(JSON.stringify({ version: d.version, taxRate: d.common.taxRate, featureLabels: d.featureLabels || null,
                             aircraftHours: d.common.aircraftHours, aircraftDays: d.common.aircraftDays, programs }));
"""


def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'bopaero-embeds costing-sync', 'Cache-Control': 'no-cache'})
    with urllib.request.urlopen(req, timeout=45) as r:
        return r.read()


def live_figures(cfg, tmp):
    lib, data = os.path.join(tmp, 'costing.js'), os.path.join(tmp, 'costing.json')
    open(lib, 'wb').write(get(cfg['lib']))
    open(data, 'wb').write(get(cfg['url']))
    out = subprocess.run(['node', '-e', NODE, lib, data], capture_output=True, text=True)
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
            name = os.path.basename(path)
            # One entry per program; an aircraft without `programs` is its own single program
            entries = spec['programs'] if spec.get('programs') else [dict(spec, key=cfg['program'])]
            diffs = []
            for e in entries:
                lp = live['programs'].get(e['key'])
                if lp is None:
                    sys.exit('costing-sync FAILED: %s program %s is not in costing %s' % (name, e['key'], live['version']))
                for f in FIELDS:
                    if f in lp and e.get(f) != lp[f]:
                        diffs.append((e['key'], f, e.get(f), lp[f]))
            # Top level mirrors the default program (the health check and older readers use it)
            default = spec.get('defaultProgram') or cfg['program']
            top = dict(live['programs'][default], taxRate=live['taxRate'], featureLabels=live['featureLabels'])
            scheduling = {}
            if 'aircraftHours' in live and isinstance(spec.get('usage'), dict):
                d = live['programs'][default]
                scheduling = {'aircraftHours': live['aircraftHours'], 'aircraftDays': live['aircraftDays'],
                              'schedulingHours': d['schedulingHours'], 'schedulingDays': d['schedulingDays']}
            for f, v in top.items():
                if (f in spec or f == 'featureLabels') and spec.get(f) != v:
                    diffs.append(('(top level)', f, spec.get(f), v))
            # A single-program aircraft (SR22T) keeps its figures at the top level and
            # its yearly hours cap in usage.maxHours
            single = not spec.get('programs')
            if single:
                for f in FIELDS:
                    if f in top and f not in spec and top[f] is not None:
                        diffs.append(('(top level)', f, None, top[f]))
                if isinstance(top.get('maxHours'), int) and isinstance(spec.get('usage'), dict):
                    scheduling['maxHours'] = top['maxHours']
            for f, v in scheduling.items():
                if spec['usage'].get(f) != v:
                    diffs.append(('(usage)', f, spec['usage'].get(f), v))
            if not diffs:
                print('%s: fallback matches costing %s' % (name, live['version']))
                continue
            stale += 1
            for k, f, a_, b_ in diffs:
                print('%s %s: %s %s -> %s (costing %s)' % (name, k, f, a_, b_, live['version']))
            if not check_only:
                for e in spec.get('programs') or []:
                    e.update({f: live['programs'][e['key']][f] for f in FIELDS if f in live['programs'][e['key']]})
                spec.get('usage', {}).update(scheduling)
                for f, v in top.items():
                    if f in spec or f == 'featureLabels' or (single and f in FIELDS and v is not None):
                        spec[f] = v
                with open(path, 'w') as fh:
                    json.dump(spec, fh, indent=2, ensure_ascii=False)
                    fh.write('\n')
    # Leasing Program rates (data/lease/<id>.json): the bridge aircraft's lease terms
    for path in sorted(glob.glob(os.path.join(ROOT, 'data', 'lease', '*.json'))):
        spec = json.load(open(path))
        cfg = spec.get('costing')
        if not cfg:
            continue
        costing = json.loads(get(cfg['url']))
        bridge = costing.get('bridge') or {}
        name = os.path.basename(path)
        live = {f: bridge.get(f) for f in LEASE_FIELDS}
        if not all(isinstance(v, (int, float)) for v in live.values()):
            sys.exit('costing-sync FAILED: %s: costing %s has no complete bridge lease terms' % (name, costing.get('version')))
        diffs = [(f, (spec.get('lease') or {}).get(f), v) for f, v in live.items() if (spec.get('lease') or {}).get(f) != v]
        if not diffs:
            print('%s: lease rates match costing %s' % (name, costing.get('version')))
            continue
        stale += 1
        for f, a_, b_ in diffs:
            print('%s lease: %s %s -> %s (costing %s)' % (name, f, a_, b_, costing.get('version')))
        if not check_only:
            spec['lease'] = live
            with open(path, 'w') as fh:
                json.dump(spec, fh, indent=2, ensure_ascii=False)
                fh.write('\n')
    if check_only and stale:
        sys.exit(1)


if __name__ == '__main__':
    main()
