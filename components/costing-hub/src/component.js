/* Private costing dashboard (Raymond 2026-10-07).
 *
 * One card per aircraft: the PUBLISHED costing read live (same costing.json and
 * costing.js the documents and calculators use), the latest market check, links
 * to the document and PDF, and an Open editor button. Nothing is editable here:
 * the editors run behind Cloudflare Access and refuse to be framed, and a
 * Squarespace page password is not a substitute for that login.
 */
var HUB_AIRCRAFT = [
  { name: 'SF50 Vision Jet', sub: 'G3 new · G2+ / G2 / G1 pre-owned',
    site: 'https://sf50program.bopaero.com', pdf: 'bop-Aero-SF50-Ownership-Program-Options.pdf',
    global: 'SF50Costing', repo: 'bopaero/sf50Program', editor: 'https://sf50-costing.compilotrc.workers.dev/' },
  { name: 'SR22T G7+', sub: 'New G7+ GTS · bridge aircraft 2022 G6 GTS',
    site: 'https://sr22tprogram.bopaero.com', pdf: 'bop-Aero-SR22T-Ownership-Program.pdf',
    global: 'SR22TCosting', repo: 'bopaero/sr22tProgram', editor: 'https://sf50-costing.compilotrc.workers.dev/sr22t/' }
];

function initCostingHub(root) {
  var cards = root.querySelector('.hub-cards');
  var minute = Math.floor(Date.now() / 60000);
  function fresh(url) { return url + (url.indexOf('?') < 0 ? '?' : '&') + 'm=' + minute; }
  function money(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function when(iso) {
    var d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
  function loadLib(a) {
    if (window[a.global]) return Promise.resolve(window[a.global]);
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = fresh(a.site + '/assets/costing.js'); s.async = true; s.setAttribute('data-costing-lib', a.global);
      s.onload = function () { window[a.global] ? resolve(window[a.global]) : reject(new Error('costing.js loaded without ' + a.global)); };
      s.onerror = function () { reject(new Error('costing.js did not load')); };
      document.head.appendChild(s);
    });
  }
  function getJson(url) { return fetch(url, { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }); }

  // Market check status line: proposals waiting (SF50), or the information-only value (SR22T bridge)
  function marketLine(m, costing) {
    if (!m) return { cls: '', text: 'Market check: no result yet.' };
    var at = 'checked ' + when(m.checkedAt) + ' (saved when results change)';
    if (m.bridge) {
      var b = m.bridge, paid = costing.bridge && costing.bridge.purchasePrice;
      return { cls: '', text: 'Bridge aircraft market value ≈ ' + (b.marketValue ? money(b.marketValue) : '—') +
        (paid ? ' vs. ' + money(paid) + ' paid' : '') + ' (' + b.count + ' listings). Information only; ' + at + '.' };
    }
    var n = (m.proposals || []).length;
    if (!n) return { cls: '', text: 'Market check: prices match the market; ' + at + '.' };
    return { cls: m.declined ? '' : 'attn', text: n + ' market price proposal' + (n === 1 ? '' : 's') +
      (m.declined ? ' (declined)' : ' waiting for review in the editor') + '; ' + at + '.' };
  }

  HUB_AIRCRAFT.forEach(function (a) {
    var card = document.createElement('section');
    card.className = 'hub-card';
    card.innerHTML = '<h3>' + esc(a.name) + '</h3><p class="hub-sub">' + esc(a.sub) + '</p><div class="hub-body">Loading the published costing…</div>' +
      '<div class="hub-actions"><a class="hub-btn" target="_blank" rel="noopener" href="' + a.editor + '">Open editor</a>' +
      '<a class="hub-link" target="_blank" rel="noopener" href="' + a.site + '/">Document</a>' +
      '<a class="hub-link" target="_blank" rel="noopener" href="' + a.site + '/' + a.pdf + '">PDF</a></div>';
    cards.appendChild(card);
    var body = card.querySelector('.hub-body');

    Promise.all([loadLib(a), getJson(fresh(a.site + '/data/costing.json'))])
      .then(function (r) {
        var lib = r[0], costing = r[1];
        var problems = lib.validate(costing);
        if (problems.length) throw new Error('published costing is invalid: ' + problems.join('; '));
        var d = lib.derive(costing);
        var rows = d.programs.map(function (p) {
          var remaining = typeof p.sharesRemaining === 'number' ? p.sharesRemaining : p.shares;
          return '<tr><td>' + esc(p.key) + '</td><td>' + (p.approx ? '~' : '') + money(p.capPerShare) + '</td><td>' +
            money(p.annualFee) + '</td><td>' + remaining + ' of ' + p.shares + '</td></tr>';
        }).join('');
        body.innerHTML =
          '<p class="hub-ver">Published <b>' + esc(d.version) + '</b> · ' + esc(when(d.publishedAt)) + '</p>' +
          '<p class="hub-note">' + esc(costing.note || '') + '</p>' +
          '<div class="hub-tw"><table><thead><tr><th>Program</th><th>Program Cost</th><th>Annual Fee</th><th>Remaining</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
          '<p class="hub-market">Market check: loading…</p>';
        var mk = body.querySelector('.hub-market');
        // Raw GitHub: the market check saves without republishing the site
        getJson('https://raw.githubusercontent.com/' + a.repo + '/main/data/market.json?m=' + minute)
          .then(function (m) { var l = marketLine(m, costing); mk.textContent = l.text; if (l.cls) mk.classList.add(l.cls); })
          .catch(function (e) { mk.textContent = 'Market check unavailable (' + e.message + ').'; });
      })
      .catch(function (e) {
        body.innerHTML = '<p class="hub-err">Could not read the published costing: ' + esc(e.message) + '</p>';
      });
  });
}

/* Plain (non-data) components run this file inside component(root): start here. */
initCostingHub(root);
