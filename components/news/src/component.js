/* News list.
 *
 * Receives every post, newest first (the build does the sorting, so a post cannot
 * be filed out of order by hand), plus the mount's filters. The same data therefore
 * serves /news in full and a short teaser anywhere else on the site.
 */
function initNews(root, items, opts) {
  var listEl = root.querySelector('.news-list');
  var emptyEl = root.querySelector('.news-empty');

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* Post bodies are authored HTML in the data file, so only a known-safe subset is
     allowed through. The files are ours, but a component that injects arbitrary
     HTML into a customer-facing page is a habit worth not forming, and this also
     means a stray unclosed tag damages one post instead of the whole page. */
  var ALLOWED = /^(p|br|strong|b|em|i|ul|ol|li|a|span)$/i;
  function richText(html) {
    var src = String(html == null ? '' : html);
    var doc = document.createElement('div');
    doc.innerHTML = src;
    (function walk(node) {
      var kids = Array.prototype.slice.call(node.childNodes);
      kids.forEach(function (child) {
        if (child.nodeType === 3) return;                 /* text is fine */
        if (child.nodeType !== 1) { child.remove(); return; }
        if (!ALLOWED.test(child.tagName)) {                /* unwrap, keep the words */
          while (child.firstChild) node.insertBefore(child.firstChild, child);
          child.remove();
          return;
        }
        Array.prototype.slice.call(child.attributes).forEach(function (a) {
          var n = a.name.toLowerCase();
          var bad = n.indexOf('on') === 0 ||
                    ((n === 'href' || n === 'src') && /^\s*javascript:/i.test(a.value));
          if (bad || (n !== 'href' && n !== 'title' && n !== 'target' && n !== 'rel')) {
            child.removeAttribute(a.name);
          }
        });
        walk(child);
      });
    })(doc);
    return doc.innerHTML;
  }

  /* A teaser is a pointer. Rendering a full press release on the home page - which
     is what happened the first time this was built - buries everything below it. */
  function excerpt(html, max) {
    var d = document.createElement('div');
    d.innerHTML = String(html == null ? '' : html);
    var first = d.querySelector('p') || d;
    var text = (first.textContent || '').replace(/\s+/g, ' ').trim();
    if (text.length <= max) return esc(text);
    var cut = text.slice(0, max);
    cut = cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 20));
    return esc(cut.replace(/[\s,;:.\u2014-]+$/, '') + '\u2026');
  }

  function fmtDate(iso) {
    /* Noon, so a timezone offset cannot roll the displayed day backwards. */
    var d = new Date(iso + 'T12:00:00');
    if (isNaN(d)) return iso;
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  }

  /* The page heading ships with the component so /news has no Squarespace title to
     keep in sync. data-heading="Latest news" retitles it; data-heading="" drops it,
     which is what a teaser mount under its own section header wants. */
  var more = root.getAttribute('data-more');
  var headingAttr = root.getAttribute('data-heading');
  var headingText = headingAttr === null ? 'News' : headingAttr;
  if (headingText) {
    /* h1 by default: with the Squarespace page title removed, this IS the page's
       top-level heading, and /news would otherwise have none. A teaser mount sits
       inside a page that already has an h1, so it passes data-level="2". */
    var tag = root.getAttribute('data-level') === '2' ? 'h2' : 'h1';
    var h = document.createElement(tag);
    h.className = 'news-heading';
    h.textContent = headingText;
    listEl.parentNode.insertBefore(h, listEl);
  }

  /* Teaser mode: one-paragraph preview, title links through to the full post. */
  var isTeaser = root.getAttribute('data-excerpt') !== '0' && (opts.limit > 0 || !!more);

  var posts = items.filter(function (p) {
    return !opts.tag || String(p.tag || '').toLowerCase() === opts.tag.toLowerCase();
  });
  if (opts.limit > 0) posts = posts.slice(0, opts.limit);

  if (!posts.length) { emptyEl.hidden = false; return; }

  posts.forEach(function (p) {
    var art = document.createElement('article');
    art.className = 'news-item' + (p.image ? ' has-image' : '');
    /* A stable id per post, so one announcement can be linked to directly -
       bopaero.com/news#2026-09-18-slug - which is what gets pasted into an email. */
    art.id = p.slug;

    var html = '';
    if (p.image) {
      html += '<img src="' + esc(p.image) + '" alt="' + esc(p.imageAlt || p.title) +
              '" loading="lazy">';
    }
    html += '<div class="news-text">' +
              '<div class="news-meta"><time datetime="' + esc(p.date) + '">' +
                esc(fmtDate(p.date)) + '</time>' +
                (p.tag ? '<span class="news-tag">' + esc(p.tag) + '</span>' : '') +
              '</div>' +
              '<h3 class="news-title">' +
                (isTeaser && more
                  ? '<a href="' + esc(more) + '#' + esc(p.slug) + '">' + esc(p.title) + '</a>'
                  : esc(p.title)) +
              '</h3>' +
              (isTeaser
                ? '<p class="news-body">' + excerpt(p.body, 190) + '</p>'
                : '<div class="news-body">' + richText(p.body) + '</div>') +
              (!isTeaser && p.link
                ? '<a class="news-more" href="' + esc(p.link) + '">' +
                  esc(p.linkText || 'Read more') + ' →</a>' : '') +
            '</div>';
    art.innerHTML = html;
    listEl.appendChild(art);
  });

  /* A teaser mount is a pointer, not the archive: data-more="/news" closes it with
     a link to the full page. The full page itself passes no data-more. */
  if (more) {
    var a = document.createElement('a');
    a.className = 'news-more-all';
    a.href = more;
    a.textContent = 'See all news \u2192';
    listEl.parentNode.appendChild(a);
  }

  /* Deep link: if the page was opened at #slug, bring that post into view. */
  if (location.hash && window.CSS && CSS.escape) {
    var target = root.querySelector('#' + CSS.escape(location.hash.slice(1)));
    if (target) setTimeout(function () { target.scrollIntoView({ block: 'center' }); }, 120);
  }
}
