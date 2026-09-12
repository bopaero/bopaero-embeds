#!/usr/bin/env python3
"""Re-scan bopaero.com and report DRIFT between the live site and this repo.

    python3 tools/audit_site.py            # scan and report
    python3 tools/audit_site.py --refresh  # also re-capture audit/live baseline

This is what keeps 'single source of truth' honest. It answers three questions:
  1. Has a live block changed since we captured it? (someone edited Squarespace directly)
  2. Are loader components still stubbed, or did a raw copy get pasted back in?
  3. Have new code blocks appeared that the registry doesn't know about?
"""
import hashlib, json, os, re, sys, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'}
DIV = re.compile(r'<(/?)div\b', re.I)

def fetch(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=45).read().decode('utf-8','replace')

def extract(h):
    out = []
    for m in re.finditer(r'<div\s+class="sqs-code-container"', h):
        gt = h.index('>', m.start()); depth = 1
        for d in DIV.finditer(h, gt+1):
            depth += -1 if d.group(1) else 1
            if depth == 0:
                out.append(h[gt+1:d.start()]); break
    return out

def main():
    refresh = '--refresh' in sys.argv
    reg = json.load(open(os.path.join(ROOT, 'registry.json')))
    urls = [u for u in open(os.path.join(ROOT,'audit','urls.txt')).read().split() if u.strip()]
    known = {c['block_hash']: n for n, c in reg['components'].items()}

    live = {}   # hash -> [pages]
    stubbed = {}
    for u in urls:
        page = u.rsplit('/', 1)[-1] or 'root'
        try: h = fetch(u)
        except Exception as e:
            print(f"  ! fetch failed {page}: {e}"); continue
        for c in extract(h):
            hsh = hashlib.sha256(c.strip().encode()).hexdigest()[:10]
            live.setdefault(hsh, []).append(page)
            m = re.search(r'embeds\.bopaero\.com/([a-z0-9\-]+)\.js', c)
            if m: stubbed.setdefault(m.group(1), []).append(page)

    print("=== loader components: is the stub actually in place? ===")
    any_loader = False
    for n, c in reg['components'].items():
        if c['mode'] != 'loader': continue
        any_loader = True
        have, want = sorted(stubbed.get(n, [])), sorted(c['pages'])
        if have == want: print(f"  OK       {n}: stub live on all {len(want)} page(s)")
        else:
            print(f"  PENDING  {n}: stub on {len(have)}/{len(want)} page(s)")
            missing = [p for p in want if p not in have]
            if missing: print(f"           still raw: {', '.join(missing)}")
    if not any_loader: print("  (none configured)")

    print("\n=== drift: captured blocks that changed on the live site ===")
    drift = 0
    for hsh, name in known.items():
        if reg['components'][name]['mode'] == 'vendor': continue
        if hsh not in live and name not in stubbed:
            print(f"  CHANGED  {name} ({hsh}) no longer matches anything live"); drift += 1
    if not drift: print("  none")

    print("\n=== new/unknown blocks on the live site ===")
    new = [h for h in live if h not in known]
    if not new: print("  none")
    for h in new:
        print(f"  NEW      {h} on {', '.join(live[h])}")
        if refresh:
            # capture it so the next run has a baseline
            for u in urls:
                if u.rsplit('/',1)[-1] in live[h]:
                    for c in extract(fetch(u)):
                        if hashlib.sha256(c.strip().encode()).hexdigest()[:10] == h:
                            open(os.path.join(ROOT,'audit','live',f'block_{h}.html'),'w').write(c)
                            print(f"           captured -> audit/live/block_{h}.html")
                    break

if __name__ == '__main__':
    main()
