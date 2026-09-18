#!/usr/bin/env python3
"""Turn an approved press-watch issue into a news post.

Runs when Raymond adds the `publish` label. It reads the ```post block from the
issue body - which he may have edited, and whatever it says is what ships - writes
data/news/<date>-<slug>.json, and lets build.py + lint_news() have the final word.
A bad field fails the job and comments on the issue rather than pushing something
broken to the live site.

Usage: press_publish.py <issue-number>
"""
import json, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIELDS = ('date', 'tag', 'title', 'link', 'linkText', 'body')
PLACEHOLDER = re.compile(r'PASTE THE PUBLISHER URL|Write a one- or two-sentence', re.I)


def gh(*args, check=True):
    p = subprocess.run(['gh'] + list(args), capture_output=True, text=True)
    if check and p.returncode:
        sys.exit('gh ' + ' '.join(args) + ' failed:\n' + p.stderr)
    return p.stdout.strip()


def fail(issue, msg):
    gh('issue', 'comment', issue, '--body',
       'Not published.\n\n' + msg + '\n\nFix the `post` block above and add the '
       '`publish` label again.')
    gh('issue', 'edit', issue, '--remove-label', 'publish', check=False)
    sys.exit(msg)


def parse_block(body):
    m = re.search(r'```post\s*\n(.*?)```', body, re.S)
    if not m:
        return None
    out, key = {}, None
    for line in m.group(1).splitlines():
        hit = re.match(r'([A-Za-z]+):\s?(.*)$', line)
        if hit and hit.group(1) in FIELDS:
            key = hit.group(1)
            out[key] = hit.group(2).strip()
        elif key:                                   # a continued, multi-line value
            out[key] = (out[key] + '\n' + line).strip()
    return out


def to_html(text):
    esc = (text.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;'))
    paras = [p.strip() for p in re.split(r'\n\s*\n', esc) if p.strip()]
    return ''.join('<p>' + p.replace('\n', ' ') + '</p>' for p in paras)


def main():
    issue = sys.argv[1]
    meta = json.loads(gh('issue', 'view', issue, '--json', 'body,title'))
    post = parse_block(meta['body'])
    if not post:
        fail(issue, 'No ```post block found in the issue body.')

    for f in ('date', 'title', 'body'):
        if not post.get(f):
            fail(issue, 'Missing `%s`.' % f)
    for f, v in post.items():
        if PLACEHOLDER.search(v):
            fail(issue, '`%s` still holds the placeholder text.' % f)
    if not re.match(r'^\d{4}-\d{2}-\d{2}$', post['date']):
        fail(issue, '`date` must be YYYY-MM-DD, got `%s`.' % post['date'])
    if post.get('link') and 'news.google.com' in post['link']:
        fail(issue, '`link` is still a Google News redirect. It only resolves in a '
                    'browser, so it must not go on the live site - paste the '
                    "publisher's own URL.")

    slug = re.sub(r'[^a-z0-9]+', '-', post['title'].lower()).strip('-')[:60]
    name = '%s-%s' % (post['date'], slug)
    path = os.path.join(ROOT, 'data', 'news', name + '.json')
    if os.path.exists(path):
        fail(issue, 'A post already exists at `data/news/%s.json`.' % name)

    with open(path, 'w') as f:
        json.dump({
            'date': post['date'],
            'title': post['title'],
            'tag': post.get('tag') or 'Press',
            'body': to_html(post['body']),
            'image': '', 'imageAlt': '',
            'link': post.get('link', ''),
            'linkText': post.get('linkText', '') or ('Read the release' if post.get('link') else ''),
        }, f, indent=2)
        f.write('\n')

    build = subprocess.run([sys.executable, 'tools/build.py', 'news'],
                           cwd=ROOT, capture_output=True, text=True)
    if build.returncode:
        os.remove(path)
        fail(issue, 'The build rejected it:\n\n```\n%s\n```'
                    % (build.stdout + build.stderr).strip()[:1200])

    print(build.stdout)
    print('wrote data/news/%s.json' % name)
    with open(os.environ.get('GITHUB_OUTPUT', os.devnull), 'a') as f:
        f.write('slug=%s\ntitle=%s\n' % (name, post['title']))


if __name__ == '__main__':
    main()
