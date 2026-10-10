#!/usr/bin/env python3
"""Throwaway diagnostic: what does Google News hold for wider queries? Opens no issues."""
import json, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import press_watch as p

QUERIES = p.QUERIES + [
    'bop Aero',
    '"bopaero"',
    '"Bop Aero Services"',
    'intitle:"bop Aero"',
    '"bop Aero" Cirrus',
    '"Elite Aircraft Services"',
    '"Elite Aircraft Services" SF50',
    '"Elite Aircraft Services" "Vision Jet"',
    '"Elite Aircraft Services" "type rating"',
    'Elite "Vision Jet" "preferred" training provider',
    '"Vision Jet" "shared ownership" training Elite',
    '"SF50" "type rating" Elite',
    '"Raymond Chase" Cirrus',
    '"Raymond Chase" "Vision Jet"',
    '"bop Aero" when:1y',
]
out = {}
for q in QUERIES:
    try:
        items = p.fetch(q)
    except SystemExit as e:
        out[q] = {'error': str(e.code)}
        continue
    out[q] = {'count': len(items), 'items': [
        {'pub': it['pub'], 'source': it['source'], 'title': it['title'],
         'desc': it['desc'][:300], 'named': p.mentions_us(it), 'link': it['link']}
        for it in items[:40]]}
    print(q, len(items))
with open(os.path.join(p.ROOT, 'press-diag-report.json'), 'w') as f:
    json.dump(out, f, indent=1)
