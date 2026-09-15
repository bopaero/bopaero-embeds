#!/usr/bin/env python3
"""Assert the live site is actually serving what this repo intends.

    python3 tools/health_check.py            # human-readable report
    python3 tools/health_check.py --quiet    # only failures

Exit code 0 = healthy, 1 = something is wrong. Designed to be run unattended by
.github/workflows/health.yml so a failure e-mails Raymond instead of sitting
unnoticed. This exists because the embeds are delivered by a script on pages we
do not own: if a stub gets deleted, a page re-pasted, or the bundle stops
serving, nothing else would tell us.
"""
import hashlib, json, os, re, sys, urllib.request, urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'}
CDN = 'https://embeds.bopaero.com/'
fails, warns, oks = [], [], []


def fetch(url, timeout=45):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout).read()


def check(cond, ok_msg, fail_msg):
    (oks if cond else fails).append(ok_msg if cond else fail_msg)
    return cond


def main():
    quiet = '--quiet' in sys.argv
    reg = json.load(open(os.path.join(ROOT, 'registry.json')))
    comps = reg['components']

    # 1. every loader bundle serves over HTTPS and matches this repo's build ------
    for name in [n for n, c in comps.items() if c['mode'] == 'loader']:
        local_path = os.path.join(ROOT, 'docs', name + '.js')
        if not os.path.exists(local_path):
            fails.append(f'{name}.js: no local build in docs/'); continue
        local = open(local_path, 'rb').read()
        try:
            served = fetch(CDN + name + '.js')
        except Exception as e:
            fails.append(f'{name}.js: NOT SERVING over HTTPS ({e})'); continue
        check(served == local,
              f'{name}.js: served bundle matches the repo build',
              f'{name}.js: SERVED BUNDLE DIFFERS from the repo build '
              f'(served {len(served)}B vs local {len(local)}B) - a push may have failed '
              f'or someone deployed out of band')

    # 2. every page still carries its stub, and only its stub -------------------
    for name, c in comps.items():
        if c['mode'] != 'loader':
            continue
        for page in c['pages']:
            url = f"{reg['site']}/{page}"
            try:
                html = fetch(url).decode('utf-8', 'replace')
            except Exception as e:
                fails.append(f'{page}: FETCH FAILED ({e})'); continue

            stub = re.search(r'data-embed="([a-z-]+)"\s+data-aircraft="([a-z0-9]+)"', html)
            if not check(bool(stub), f'{page}: stub present',
                         f'{page}: STUB MISSING - the code block was emptied or replaced'):
                continue
            check(f'{CDN}{name}.js' in html,
                  f'{page}: loader script tag present',
                  f'{page}: LOADER SCRIPT TAG MISSING - the component cannot mount')
            check('const PROGRAM_COST' not in html,
                  f'{page}: no raw calculator pasted back in',
                  f'{page}: RAW CALCULATOR CODE IS BACK - a stale copy was pasted over the stub')

            # a stray line above the stub renders as body copy - this happened once
            i = html.find('<!-- bop Aero embed')
            if i > 0:
                j = html.rfind('sqs-code-container', 0, i)
                seg = re.sub(r'<[^>]*>', '', html[j:i]).replace('&nbsp;', ' ').strip()
                seg = re.sub(r'^[^>]*>', '', seg).strip()
                check(len(seg) < 3,
                      f'{page}: nothing stray above the stub',
                      f'{page}: STRAY TEXT above the stub renders as body copy: {seg[:40]!r}')

            # 3. basic page sanity - the page still has real content around the embed
            check(html.count('<p') > 3,
                  f'{page}: page content present',
                  f'{page}: PAGE LOOKS EMPTY - fewer than 4 paragraphs, the page may be broken')

    # 4. the numbers in the shipped bundle match the data files -----------------
    try:
        bundle = fetch(CDN + 'aircraft-calc.js').decode('utf-8', 'replace')
        for aid in ('sf50', 'sr22t'):
            spec = json.load(open(os.path.join(ROOT, 'data', 'aircraft', f'{aid}.json')))
            for field in ('programCost', 'annualProgramFee'):
                check(str(spec[field]) in bundle,
                      f'{aid}.{field}: {spec[field]} present in the served bundle',
                      f'{aid}.{field}: {spec[field]} NOT in the served bundle - the live '
                      f'figures do not match this repo')
    except Exception as e:
        warns.append(f'could not cross-check figures: {e}')

    if not quiet:
        print(f'=== healthy ({len(oks)}) ===')
        for o in oks:
            print('  OK    ' + o)
    for w in warns:
        print('  WARN  ' + w)
    if fails:
        print(f'\n=== FAILURES ({len(fails)}) ===')
        for f in fails:
            print('  FAIL  ' + f)
        print('\nThe live site is not serving what this repo intends.')
        return 1
    print(f'\nAll {len(oks)} checks passed.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
