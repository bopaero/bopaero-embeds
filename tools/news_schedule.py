#!/usr/bin/env python3
"""Publish a news post at a set time.

A post held in data/news/_pending/ carries a `publishAt` timestamp and is invisible
to the build (the collection loader only reads *.json directly in data/news/). When
the time arrives this moves it up a directory, drops the `publishAt` key and rebuilds.

Timing, stated plainly: GitHub's scheduled runs are not punctual - a cron can fire
several minutes late under load - and news.js is cached for 10 minutes at the CDN on
top of that. So a 1:00 PM post is seen by visitors somewhere in the 1:00-1:15 window.
Nothing about how this is built changes that; only pre-shipping the text inside the
bundle would, and that would put the release on a public URL before its time.

Every pending post is validated on EVERY run, not just at publication. A malformed
post fails the job days early, when there is time to fix it, rather than silently at
the moment it was supposed to go out.

Usage: news_schedule.py [--force <slug>]   (--force publishes now, ignoring the time)
"""
import json, os, sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build as build_mod

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NEWS = os.path.join(ROOT, 'data', 'news')
PENDING = os.path.join(NEWS, '_pending')


def load_pending():
    out = {}
    if not os.path.isdir(PENDING):
        return out
    for f in sorted(os.listdir(PENDING)):
        if f.endswith('.json'):
            with open(os.path.join(PENDING, f)) as fh:
                out[f[:-5]] = json.load(fh)
    return out


def check(slug, post):
    """Refuse anything that would fail at publication time."""
    when = post.get('publishAt')
    if not when:
        sys.exit('%s: no publishAt. A pending post without a time will never publish.' % slug)
    try:
        dt = datetime.fromisoformat(when)
    except ValueError:
        sys.exit('%s: publishAt %r is not ISO 8601 (want 2026-09-19T13:00:00-04:00).'
                 % (slug, when))
    if dt.tzinfo is None:
        sys.exit('%s: publishAt %r has no timezone offset. "1 PM" in whose zone? '
                 'Write it as 2026-09-19T13:00:00-04:00.' % (slug, when))
    body = {k: v for k, v in post.items() if k != 'publishAt'}
    try:
        build_mod.lint_news({slug: body})
    except SystemExit as e:
        sys.exit('%s would be rejected by the build:\n%s' % (slug, e))
    return dt


def main():
    force = sys.argv[sys.argv.index('--force') + 1] if '--force' in sys.argv else None
    now = datetime.now(timezone.utc)
    pending = load_pending()

    if not pending:
        print('nothing pending')
        return

    moved = []
    for slug, post in pending.items():
        due = check(slug, post)
        if force and slug != force:
            print('%s: holding (forcing %s)' % (slug, force))
            continue
        if not force and due > now:
            print('%s: holds until %s (%s from now)'
                  % (slug, due.isoformat(), str(due - now).split('.')[0]))
            continue
        post.pop('publishAt', None)
        with open(os.path.join(NEWS, slug + '.json'), 'w') as f:
            json.dump(post, f, indent=2)
            f.write('\n')
        os.remove(os.path.join(PENDING, slug + '.json'))
        moved.append(slug)
        print('%s: PUBLISHING (due %s)' % (slug, due.isoformat()))

    if moved:
        build_mod.build('news')
        with open(os.environ.get('GITHUB_OUTPUT', os.devnull), 'a') as f:
            f.write('published=%s\n' % ' '.join(moved))


if __name__ == '__main__':
    main()
