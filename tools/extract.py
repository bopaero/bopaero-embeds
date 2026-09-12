#!/usr/bin/env python3
"""Split a captured live Squarespace block into editable source parts.

    python3 tools/extract.py <component-name>

Reads the block named in registry.json, writes components/<name>/src/ as three
files — component.html, component.css, component.js — so each part can be edited
and diffed on its own instead of as one 30 KB blob.
"""
import json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def main(name):
    reg = json.load(open(os.path.join(ROOT, 'registry.json')))
    comp = reg['components'].get(name)
    if not comp:
        sys.exit(f"unknown component: {name}")
    src_block = os.path.join(ROOT, 'audit', 'live', f"block_{comp['block_hash']}.html")
    raw = open(src_block, encoding='utf-8').read()

    css = '\n\n'.join(m.group(1) for m in re.finditer(r'<style[^>]*>(.*?)</style>', raw, re.S))
    js  = '\n\n'.join(m.group(1) for m in re.finditer(r'<script(?![^>]*\ssrc=)[^>]*>(.*?)</script>', raw, re.S))
    html = re.sub(r'<style[^>]*>.*?</style>', '', raw, flags=re.S)
    html = re.sub(r'<script(?![^>]*\ssrc=)[^>]*>.*?</script>', '', html, flags=re.S)
    # external <script src=...> must survive — record them for the build
    ext = re.findall(r'<script[^>]*\ssrc="([^"]+)"[^>]*>', raw)
    html = re.sub(r'<script[^>]*\ssrc="[^"]+"[^>]*>\s*</script>', '', html, flags=re.S)
    html = re.sub(r'\n\s*\n\s*\n+', '\n\n', html).strip()

    d = os.path.join(ROOT, 'components', name, 'src')
    os.makedirs(d, exist_ok=True)
    open(os.path.join(d, 'component.html'), 'w').write(html + '\n')
    open(os.path.join(d, 'component.css'), 'w').write(css.strip() + '\n')
    open(os.path.join(d, 'component.js'), 'w').write(js.strip() + '\n')
    meta = {'name': name, 'mount_id': f'{name}-mount', 'external_scripts': ext,
            'pages': comp['pages'], 'mode': comp['mode']}
    json.dump(meta, open(os.path.join(ROOT, 'components', name, 'component.json'), 'w'), indent=2)

    print(f"  {name}: html {len(html):,}  css {len(css):,}  js {len(js):,}"
          + (f"  external scripts: {ext}" if ext else ""))

if __name__ == '__main__':
    if len(sys.argv) < 2: sys.exit(__doc__)
    for n in sys.argv[1:]: main(n)
