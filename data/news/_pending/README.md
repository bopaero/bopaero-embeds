# Scheduled posts

A post in this folder is invisible to the site. It carries one extra field:

    "publishAt": "2026-09-19T13:00:00-04:00"

The offset is required — `-04:00` is EDT, `-05:00` is EST after 2 November. The
`news schedule` workflow checks every five minutes through the day, and when the
time passes it moves the file up into `data/news/`, drops `publishAt`, rebuilds
and pushes.

Every pending post is validated on every run, so a bad field fails days early
rather than at the moment it was meant to go out.

**To publish early:** Actions → *news schedule* → Run workflow → enter the slug
in `force`. **To cancel:** delete the file.

**Timing is approximate.** GitHub's scheduled runs can be several minutes late,
and news.js is cached at the CDN for 10 minutes. A 1:00 PM post reaches visitors
somewhere in the 1:00–1:15 window. Publishing early and hiding it client-side
would be exact, but it would put the release text on a public URL ahead of time.
