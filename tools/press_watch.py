#!/usr/bin/env python3
"""Watch for press that mentions bop Aero, and raise each hit for Raymond to review.

The company has no press coverage indexed today (checked 2026-09-18: the exact
phrase returns nothing, while control phrases return 100 items each). So this
watcher will be silent nearly all the time, and silence is exactly what a broken
watcher looks like. Two things keep the silence honest:

  * a control query every run - a phrase that is guaranteed to have coverage. If
    it comes back empty the feed, the network or the query syntax has changed, and
    the run FAILS loudly instead of reporting "no news".
  * a weekly heartbeat comment on one long-lived status issue, so a run that stops
    happening altogether is visible without an issue per day.

Nothing here publishes. A hit becomes a GitHub issue; adding the `publish` label
is what turns it into a post (see press_publish.py).
"""
import html as htmllib
import json, os, re, subprocess, sys, urllib.parse, urllib.request
from datetime import datetime, timezone, timedelta
from xml.etree import ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SEEN_PATH = os.path.join(ROOT, 'data', 'press-seen.json')
STATUS_ISSUE_TITLE = 'Press watch — status log'

# Quoted so "bop" alone cannot match. The wire-scoped queries are redundant with the
# bare phrase (Google indexes the wires) and exist only so a change in Google's
# general ranking cannot quietly drop an official release.
QUERIES = [
    '"bop Aero"',
    '"BOP AERO SERVICES"',
    '"bop Aero" (site:prnewswire.com OR site:businesswire.com OR site:globenewswire.com OR site:accesswire.com)',
    # Partner coverage, but only where we are actually named - both phrases are
    # required, so Elite's own news does not arrive here unless it concerns us.
    '"Elite Aircraft Services" "bop Aero"',
]
# Must return results. If it does not, the pipeline is broken, not the news quiet.
CONTROL_QUERY = '"Cirrus Aircraft"'
RETENTION_DAYS = 365


def clean(text):
    return re.sub(r'\s+', ' ', htmllib.unescape(text or '')).strip()


def fetch(query):
    url = ('https://news.google.com/rss/search?q=' + urllib.parse.quote(query) +
           '&hl=en-US&gl=US&ceid=US:en')
    req = urllib.request.Request(url, headers={'User-Agent': 'bopaero-press-watch/1.0'})
    with urllib.request.urlopen(req, timeout=30) as r:
        raw = r.read()
    root = ET.fromstring(raw)
    out = []
    for it in root.findall('.//item'):
        src = it.find('source')
        out.append({
            'title': clean(it.findtext('title')),
            'link': (it.findtext('link') or '').strip(),
            'pub': (it.findtext('pubDate') or '').strip(),
            'desc': clean(re.sub(r'<[^>]+>', ' ', it.findtext('description') or '')),
            'source': (src.text or '').strip() if src is not None else '',
        })
    return out


def mentions_us(item):
    """Google's quoted search is not always strict, so confirm the phrase ourselves.
    An item that fails this does NOT open an issue: on 2026-09-18 the partner query
    returned a sports-car story that names none of our terms, and an issue per day
    of that teaches Raymond to ignore the label. Unconfirmed items are listed in the
    run summary and counted in the weekly heartbeat instead, so they are visible
    without being a notification."""
    hay = re.sub(r'[^a-z ]+', ' ', (item['title'] + ' ' + item['desc']).lower())
    hay = re.sub(r'\s+', ' ', hay)
    return 'bop aero' in hay


def load_seen():
    try:
        with open(SEEN_PATH) as f:
            return json.load(f)
    except (FileNotFoundError, ValueError):
        return {}


def save_seen(seen):
    cutoff = (datetime.now(timezone.utc) - timedelta(days=RETENTION_DAYS)).strftime('%Y-%m-%d')
    seen = {k: v for k, v in seen.items() if v >= cutoff}
    os.makedirs(os.path.dirname(SEEN_PATH), exist_ok=True)
    with open(SEEN_PATH, 'w') as f:
        json.dump(seen, f, indent=1, sort_keys=True)
        f.write('\n')
    return seen


def key_for(item):
    """Key on the headline, not the URL: the same release syndicates under many
    links and Google's redirect URLs are not stable."""
    return re.sub(r'[^a-z0-9]+', '-', item['title'].lower()).strip('-')[:120]


def gh(*args, check=True):
    p = subprocess.run(['gh'] + list(args), capture_output=True, text=True)
    if check and p.returncode:
        sys.exit('gh ' + ' '.join(args) + ' failed:\n' + p.stderr)
    return p.stdout.strip()


def iso_date(pub):
    for fmt in ('%a, %d %b %Y %H:%M:%S %Z', '%a, %d %b %Y %H:%M:%S %z'):
        try:
            return datetime.strptime(pub, fmt).strftime('%Y-%m-%d')
        except ValueError:
            pass
    return datetime.now(timezone.utc).strftime('%Y-%m-%d')


def issue_body(item, confirmed=True):
    date = iso_date(item['pub'])
    title = re.sub(r'\s+-\s+[^-]+$', '', item['title']).strip()   # drop " - Publisher"

    # Google's <description> is usually just the headline again. Repeating the title
    # as a summary reads like a bug on the live page, so only use it when it says
    # something the title does not.
    excerpt = item['desc'][:280]
    norm = lambda t: re.sub(r'[^a-z0-9]+', '', t.lower())
    if not excerpt or norm(excerpt).startswith(norm(title)[:40]):
        excerpt = ''

    warn = ('' if confirmed else
            '\n> [!WARNING]\n> The phrase "bop Aero" was not found in the headline or '
            'summary. Google matched it some other way - check the article before publishing.\n')

    return f"""**{item['source'] or 'Unknown source'}** · {date}

Read it here: {item['link']}
{warn}
---

### To add this to bopaero.com/news

Edit the block below, then add the **`publish`** label. What is in the block is what
gets published, verbatim. To skip it, just close this issue.

**You must replace `link:`** with the publisher's own URL - the link above is a Google
News redirect that only resolves in a browser, so it is not fit to sit on the live
site. Publishing is refused until it is changed.

Only a summary and a link are published, never the release text, which is not ours to
reproduce. Write `body:` in your own words.

```post
date: {date}
tag: Press
title: {title}
link: PASTE THE PUBLISHER URL HERE
linkText: Read the release
body: {excerpt or 'Write a one- or two-sentence summary here.'}
```
"""


def ensure_status_issue():
    num = gh('issue', 'list', '--label', 'press-watch', '--state', 'open',
             '--search', STATUS_ISSUE_TITLE, '--json', 'number,title', '--limit', '20')
    for row in json.loads(num or '[]'):
        if row['title'] == STATUS_ISSUE_TITLE:
            return str(row['number'])
    url = gh('issue', 'create', '--title', STATUS_ISSUE_TITLE, '--label', 'press-watch',
             '--body', 'Weekly proof that the press watcher is still running. '
                       'A gap in this log means the workflow stopped, which is the '
                       'failure mode a quiet watcher hides. Leave this issue open.')
    return url.rstrip('/').rsplit('/', 1)[-1]


def main():
    dry = '--dry-run' in sys.argv

    control = fetch(CONTROL_QUERY)
    if not control:
        sys.exit('SELF-TEST FAILED: control query %s returned no items. The feed or query '
                 'syntax has changed - treat today\'s "no news" as unknown, not as quiet.'
                 % CONTROL_QUERY)

    items, seen_now = [], set()
    for q in QUERIES:
        for it in fetch(q):
            k = key_for(it)
            if k and k not in seen_now:
                seen_now.add(k)
                items.append((k, it))

    seen = load_seen()
    fresh = [(k, it) for k, it in items if k not in seen]
    today = datetime.now(timezone.utc).strftime('%Y-%m-%d')

    opened, unconfirmed = [], []
    print('control: %d items | matches: %d | new: %d' % (len(control), len(items), len(fresh)))
    for k, it in fresh:
        if not mentions_us(it):
            # Not recorded as seen: if the same story later turns up with our name in
            # the summary, it should still be able to become an issue.
            unconfirmed.append(it)
            print('  skip (name not present) %s' % it['title'][:85])
            continue
        opened.append(it)
        print('  NEW %s' % it['title'][:90])
        if not dry:
            gh('issue', 'create',
               '--title', 'Press mention: ' + it['title'][:200],
               '--label', 'press-watch',
               '--body', issue_body(it, True))
        seen[k] = today

    if not dry:
        save_seen(seen)
        # Monday heartbeat, on one long-lived issue rather than an issue per run.
        if datetime.now(timezone.utc).weekday() == 0:
            n = ensure_status_issue()
            gh('issue', 'comment', n, '--body',
               'Ran %s. Control query returned %d items, so the feed is healthy. '
               'Matches for bop Aero: %d, of which %d opened an issue. '
               'Skipped as loose matches (our name nowhere in the headline or '
               'summary): %d.'
               % (today, len(control), len(items), len(opened), len(unconfirmed)))

    summary = os.environ.get('GITHUB_STEP_SUMMARY')
    if summary:
        with open(summary, 'a') as f:
            f.write('### Press watch %s\n\n- control: %d items (healthy)\n- matches: %d\n'
                    '- issues opened: %d\n' % (today, len(control), len(items), len(opened)))
            if unconfirmed:
                f.write('\nSkipped as loose matches - our name appears nowhere in the '
                        'headline or summary:\n\n')
                for it in unconfirmed:
                    f.write('- %s (%s)\n' % (it['title'], it['source'] or '?'))


if __name__ == '__main__':
    main()
