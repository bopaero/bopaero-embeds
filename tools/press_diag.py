#!/usr/bin/env python3
"""Throwaway diagnostic: do other indexes hold bop Aero stories Google News lacks?"""
import json, os, re, sys, urllib.parse, urllib.request
from xml.etree import ElementTree as ET
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
SOURCES = {
    'bing-news': 'https://www.bing.com/news/search?q={q}&format=rss',
    'bing-web': 'https://www.bing.com/search?q={q}&format=rss&count=50',
}
QUERIES = ['"bop Aero"', '"bop Aero" -site:bopaero.com', '"Bop Aero Services"',
           '"bop Aero" Elite "Vision Jet"', '"Elite Aircraft Services" "bop Aero"',
           '"Elite Aircraft Services" SF50 "type rating"']
out = {}
for name, tpl in SOURCES.items():
    for q in QUERIES:
        key = name + ' :: ' + q
        try:
            req = urllib.request.Request(tpl.format(q=urllib.parse.quote(q)), headers={'User-Agent': UA})
            with urllib.request.urlopen(req, timeout=30) as r:
                raw = r.read()
            root = ET.fromstring(raw)
            items = []
            for it in root.findall('.//item'):
                t = (it.findtext('title') or '').strip()
                d = re.sub(r'<[^>]+>', ' ', it.findtext('description') or '')
                hay = re.sub(r'\s+', ' ', re.sub(r'[^a-z ]+', ' ', (t + ' ' + d).lower()))
                items.append({'title': t, 'link': (it.findtext('link') or '').strip(),
                              'pub': (it.findtext('pubDate') or '').strip(), 'desc': d.strip()[:300],
                              'named': 'bop aero' in hay})
            out[key] = {'count': len(items), 'items': items[:50]}
        except Exception as e:
            out[key] = {'error': '%s: %s' % (type(e).__name__, e), 'head': (raw[:200].decode('utf8', 'replace') if 'raw' in dir() else '')}
        print(key, out[key].get('count', out[key].get('error')))
with open(os.path.join(ROOT, 'press-diag-report.json'), 'w') as f:
    json.dump(out, f, indent=1)
