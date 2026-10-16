/* ============================================================================
   bop Aero lead gate — shared by every calculator embed (prepended by
   tools/build.py for components that list "lead-gate" in component.json
   "shared"). TripCalc carries an equivalent inline copy in its own index.html;
   keep the two in step (endpoint, cookie, program list).

   Raymond 2026-10-16: calculator results are shown after a short form (name and
   email required; phone, company, desired program optional). The form posts to
   the bopaero-leads Worker, which files the visitor in LeadConnector as a contact
   and an opportunity. On success a cookie remembers it, so the form never shows
   again - on bopaero.com OR tripcalc.bopaero.com (Domain=bopaero.com).

   The cookie holds no personal data: just bopaero_lead=1. The privacy policy
   already covers cookies "for analytics and functionality".

   No silent unlock: if the Worker cannot be reached the visitor sees an error and
   can retry. Raymond wants the lead; a gate that opens on failure collects none.
   ========================================================================== */
(function () {
  if (window.__bopLeadGate) return;

  /* Where the form posts. Set to the deployed bopaero-leads Worker + '/lead'. */
  var LEAD_ENDPOINT = 'https://bopaero-leads.compilotrc.workers.dev/lead';
  /* Local testing only (tools/testbed): a page on localhost may point the form at
     a mock. Ignored on every real host, so a page script cannot redirect leads. */
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) && window.__bopLeadEndpoint) {
    LEAD_ENDPOINT = window.__bopLeadEndpoint;
  }
  var COOKIE = 'bopaero_lead';
  var MAX_AGE = 365 * 24 * 60 * 60;

  /* Same keys the Worker accepts - anything else is dropped there. */
  var PROGRAMS = [
    ['sf50-g3', 'SF50 G3 (new)'],
    ['sf50-preowned', 'SF50 pre-owned (G1 / G2 / G2+)'],
    ['sr22t', 'SR22T ownership'],
    ['sr22t-leasing', 'SR22T leasing'],
    ['founders', 'Founder’s Circle'],
    ['not-sure', 'Not sure yet']
  ];

  function hasLead() {
    try { return document.cookie.split(/;\s*/).indexOf(COOKIE + '=1') !== -1; }
    catch (e) { return false; }
  }

  function rememberLead() {
    var host = location.hostname;
    var domain = (host === 'bopaero.com' || /\.bopaero\.com$/.test(host)) ? '; Domain=bopaero.com' : '';
    var secure = location.protocol === 'https:' ? '; Secure' : '';
    try {
      document.cookie = COOKIE + '=1; Path=/; Max-Age=' + MAX_AGE + domain + '; SameSite=Lax' + secure;
    } catch (e) { /* cookies blocked: they will simply see the form next time */ }
  }

  var uid = 0;
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }

  /* Builds the form into `host`. opts: { tool, program (preselect key), title,
     intro, onUnlock }. Returns the form element. */
  function renderForm(host, opts) {
    var n = ++uid, id = function (f) { return 'bop-lead-' + f + '-' + n; };
    var options = '<option value="">Select a program (optional)</option>' + PROGRAMS.map(function (p) {
      return '<option value="' + p[0] + '"' + (p[0] === opts.program ? ' selected' : '') + '>' + esc(p[1]) + '</option>';
    }).join('');
    host.innerHTML =
      '<form class="bop-lead" novalidate>' +
        '<h3 class="bop-lead-title">' + esc(opts.title || 'See your results') + '</h3>' +
        '<p class="bop-lead-intro">' + esc(opts.intro || 'Tell us where to reach you and your results appear right here.') + '</p>' +
        '<label for="' + id('name') + '"><span>Name <span class="bop-lead-req">(required)</span></span>' +
          '<input id="' + id('name') + '" name="name" type="text" autocomplete="name" maxlength="100" required></label>' +
        '<label for="' + id('email') + '"><span>Email <span class="bop-lead-req">(required)</span></span>' +
          '<input id="' + id('email') + '" name="email" type="email" autocomplete="email" inputmode="email" maxlength="254" required></label>' +
        '<label for="' + id('phone') + '">Phone' +
          '<input id="' + id('phone') + '" name="phone" type="tel" autocomplete="tel" inputmode="tel" maxlength="32"></label>' +
        '<label for="' + id('company') + '">Company' +
          '<input id="' + id('company') + '" name="company" type="text" autocomplete="organization" maxlength="120"></label>' +
        '<label for="' + id('program') + '">Desired program' +
          '<select id="' + id('program') + '" name="program">' + options + '</select></label>' +
        /* Honeypot: hidden from people and from screen readers; bots fill it in. */
        '<div class="bop-lead-hp" aria-hidden="true"><label>Website<input name="website" type="text" tabindex="-1" autocomplete="off"></label></div>' +
        '<p class="bop-lead-error" role="alert" hidden></p>' +
        '<button type="submit" class="bop-lead-submit">Show my results</button>' +
        '<p class="bop-lead-fine">We’ll only use this to follow up about bop Aero programs. ' +
          '<a href="https://bopaero.com/privacy-policy" target="_blank" rel="noopener">Privacy policy</a></p>' +
      '</form>';

    var form = host.querySelector('form');
    var err = form.querySelector('.bop-lead-error');
    var btn = form.querySelector('.bop-lead-submit');
    function fail(msg, field) {
      err.textContent = msg; err.hidden = false;
      if (field) { field.setAttribute('aria-invalid', 'true'); field.focus(); }
    }
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      err.hidden = true;
      form.querySelectorAll('[aria-invalid]').forEach(function (f) { f.removeAttribute('aria-invalid'); });
      var f = form.elements;
      var name = f.name.value.trim(), email = f.email.value.trim();
      if (!name) return fail('Please enter your name.', f.name);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return fail('Please enter a valid email address.', f.email);
      var body = {
        name: name, email: email,
        phone: f.phone.value.trim(), company: f.company.value.trim(), program: f.program.value,
        website: f.website.value,
        tool: opts.tool, page: location.pathname
      };
      btn.disabled = true; btn.textContent = 'Sending…';
      fetch(LEAD_ENDPOINT, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, status: r.status, j: j }; });
      }).then(function (res) {
        if (res.ok && res.j.ok) {
          rememberLead();
          if (opts.onUnlock) opts.onUnlock({ program: body.program });
          return;
        }
        /* 400/429 carry a message meant for the visitor; anything else is ours */
        var msg = (res.status === 400 || res.status === 429) && res.j.error ? res.j.error
          : 'Sorry, we couldn’t send that just now. Please try again in a moment, or call (513) 450-2FLY.';
        fail(msg);
      }).catch(function () {
        fail('Sorry, we couldn’t reach our server. Please check your connection and try again.');
      }).then(function () {
        btn.disabled = false; btn.textContent = 'Show my results';
      });
    });
    return form;
  }

  window.__bopLeadGate = { hasLead: hasLead, renderForm: renderForm, programs: PROGRAMS, endpoint: LEAD_ENDPOINT };
})();
