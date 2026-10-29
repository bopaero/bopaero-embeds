/* Employee resources page (Raymond 2026-10-29).
 *
 * Replaces the two hand-made Squarespace buttons and the pasted UTM code block on
 * bopaero.com/internal-login. The page is behind a Squarespace password; nothing
 * here is secret (the program sites are unlisted, not private), and the editors
 * stay behind Cloudflare Access.
 */
var HUB_GROUPS = [
  { title: 'Program Sites', links: [
    { name: 'Program Documents', url: 'https://programs.bopaero.com/',
      desc: 'Cross-program hub: SF50 and SR22T documents, the 6-Seat Comparison, Founder’s Circle and planning.' },
    { name: 'SF50 Vision Jet Program', url: 'https://sf50program.bopaero.com/',
      desc: 'SF50 ownership program options, current costing and the printable PDF.' },
    { name: 'SR22T Program', url: 'https://sr22tprogram.bopaero.com/',
      desc: 'SR22T G7+ ownership program, current costing and the printable PDF.' }
  ] },
  { title: 'Tools', links: [
    { name: 'TripCalc®', url: 'https://tripcalc.bopaero.com/',
      desc: 'Flight planning: compare a trip by Cirrus against driving and the airlines.' },
    { name: 'Site Calculators', url: 'https://bopaero.com/site-calculators',
      desc: 'The cost calculators embedded on bopaero.com, all on one page.' }
  ] }
];

function initInternalHub(root) {
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  root.querySelector('.ih-groups').innerHTML = HUB_GROUPS.map(function (g) {
    return '<section class="ih-group"><h3>' + esc(g.title) + '</h3><div class="ih-cards">' +
      g.links.map(function (l) {
        return '<a class="ih-card" target="_blank" rel="noopener" href="' + esc(l.url) + '">' +
          '<span class="ih-name">' + esc(l.name) + '</span>' +
          '<span class="ih-desc">' + esc(l.desc) + '</span>' +
          '<span class="ih-host">' + esc(l.url.replace(/^https:\/\//, '').replace(/\/$/, '')) + '</span></a>';
      }).join('') + '</div></section>';
  }).join('');

  /* ── UTM generator ───────────────────────────────────────────────────── */
  var KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
  var REQUIRED = ['utm_source', 'utm_medium', 'utm_campaign'];
  var form = root.querySelector('.ih-form');
  var urlIn = form.querySelector('[name=url]');
  var out = root.querySelector('.ih-url');
  var copyBtn = root.querySelector('.ih-copy');
  var built = '';

  function field(k) { return form.querySelector('[name="' + k + '"]'); }
  function hint(msg) { built = ''; out.textContent = msg; out.classList.add('ih-hint'); copyBtn.disabled = true; }

  function update() {
    var raw = urlIn.value.trim();
    urlIn.classList.remove('ih-bad');
    if (!raw) return hint('Enter a base URL to start.');
    // People paste "bopaero.com/page" without the scheme; accept it.
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = 'https://' + raw;
    var u;
    try { u = new URL(raw); } catch (e) { urlIn.classList.add('ih-bad'); return hint('That base URL doesn’t look valid.'); }
    KEYS.forEach(function (k) {
      // Analytics treats "Facebook" and "facebook" as two sources; lower-case
      // and hyphenate so the reports don't split.
      var v = field(k).value.trim().toLowerCase().replace(/\s+/g, '-');
      if (v) u.searchParams.set(k, v); else u.searchParams.delete(k);
    });
    var missing = REQUIRED.filter(function (k) { return !u.searchParams.get(k); });
    if (missing.length) return hint('Still needed: ' + missing.join(', ') + '.');
    built = u.toString();
    out.textContent = built;
    out.classList.remove('ih-hint');
    copyBtn.disabled = false;
    copyBtn.textContent = 'Copy link';
  }

  form.addEventListener('input', update);
  copyBtn.addEventListener('click', function () {
    if (!built) return;
    function done() { copyBtn.textContent = 'Copied ✓'; setTimeout(function () { copyBtn.textContent = 'Copy link'; }, 1800); }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(built).then(done, fallback);
    } else fallback();
    function fallback() {
      var r = document.createRange(); r.selectNodeContents(out);
      var s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
      try { document.execCommand('copy'); done(); } catch (e) { copyBtn.textContent = 'Press ⌘C'; }
    }
  });
  root.querySelector('.ih-clear').addEventListener('click', function () {
    [urlIn].concat(KEYS.map(field)).forEach(function (i) { i.value = ''; });
    update(); urlIn.focus();
  });
  update();
}

/* Plain (non-data) components run this file inside component(root): start here. */
initInternalHub(root);
