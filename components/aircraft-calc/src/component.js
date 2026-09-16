/* Shared cost-calculator engine.
 *
 * One engine, one template, one stylesheet — every aircraft program is a JSON
 * file in data/. A UX or logic change here updates every calculator on the site.
 * The ONLY per-aircraft variation lives in data/<id>.json.
 *
 * Adding an aircraft: drop in data/<id>.json, rebuild, and embed a stub with
 * data-aircraft="<id>". No code changes.
 */
function initCalculator(root, spec) {
  if (!root || !spec) return;

  var HR = ' /hr';
  var FUEL_PRICES_URL =
    'https://raw.githubusercontent.com/bopaero/bopaeroFlightCalc/main/data/fuel_prices.json';

  var money0 = function (n) {
    return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  };
  var q = function (sel) { return root.querySelector(sel); };

  function fuelCostPerHour(pricePerGal) {
    return Math.round(pricePerGal * spec.fuel.gph + spec.fuel.oilPerHour);
  }

  /* ── static content from the data file ─────────────────────────────── */
  var titleEl = q('.summary-title'); if (titleEl) titleEl.innerText = spec.summaryTitle;
  var headEl  = q('h2');             if (headEl)  headEl.innerText  = spec.heading;

  (spec.images || []).forEach(function (img, i) {
    root.querySelectorAll('[data-img="' + i + '"]').forEach(function (el) {
      el.src = img.src; el.alt = img.alt || '';
    });
  });

  /* Footnotes are per-aircraft: they state share counts, usage terms and fuel
     specifics. They MUST come from the data file — the shared template was built
     from the SF50 component, so a hard-coded block would put SF50 footnotes
     ("one of eight positions", "unlimited usage") on every other aircraft.
     Injected before #fuel-note is queried, because it lives inside this block. */
  /* Footnote prose repeats numbers that also live in structured fields, so it
     drifts: the SR22T footnote still claimed "16 available" after the program
     moved to 15 of 16. Tokens keep one source of truth — edit the data, the
     prose follows. Unknown tokens are left visible rather than blanked, so a
     typo shows up instead of silently deleting a number. */
  /* Three distinct counts: totalShares (fleet positions), availableShares
     (offered for sale) and sharesRemaining (still unsold). Older data files
     predate the third, so it falls back to "none sold yet". */
  function remaining() {
    return typeof spec.sharesRemaining === 'number'
      ? spec.sharesRemaining : spec.availableShares;
  }

  function fill(text) {
    if (!text) return text;
    var map = {
      totalShares: spec.totalShares,
      availableShares: spec.availableShares,
      sharesRemaining: remaining(),
      /* Reads redundant while nothing has sold ("8 available for purchase, 8
         currently remaining"), so the clause disappears until it carries news.
         Computed, never prose, so it cannot drift from the numbers above. */
      remainingClause: (remaining() === spec.availableShares
        ? '' : ', ' + remaining() + ' currently remaining'),
      maxHours: spec.usage && spec.usage.maxHours,
      schedulingHours: spec.usage && spec.usage.schedulingHours,
      schedulingDays: spec.usage && spec.usage.schedulingDays,
      fuelLabel: spec.fuel && spec.fuel.label,
      gph: spec.fuel && spec.fuel.gph
    };
    return text.replace(/\{\{(\w+)\}\}/g, function (whole, key) {
      var v = map[key];
      if (v === undefined || v === null) {
        console.warn('[bopaero:aircraft-calc] ' + spec.id + ' unknown token ' + whole);
        return whole;
      }
      return v;
    });
  }

  /* Hours placeholder comes from the data file. It used to be hard-coded at
     "e.g., 175 hrs." on BOTH aircraft - on the SR22T that suggested a figure
     nearly double the 96-hour per-share limit, reading as an invitation to
     exceed the entitlement the calculator then warns about. */
  var hoursInput = q('#hours-per-year');
  if (hoursInput && spec.hoursPlaceholder) hoursInput.placeholder = spec.hoursPlaceholder;

  /* Share selector. Capped at what is actually for sale - offering 16 when 14
     remain would quote a position that cannot be bought. */
  var sharesEl = q('#share-count');
  var maxSelectable = (typeof spec.sharesRemaining === 'number' ? spec.sharesRemaining
                      : (typeof spec.availableShares === 'number' ? spec.availableShares : 1));
  if (sharesEl) {
    for (var si = 1; si <= maxSelectable; si++) {
      var op = document.createElement('option');
      op.value = si;
      op.textContent = si === 1 ? '1 share' : si + ' shares';
      sharesEl.appendChild(op);
    }
    sharesEl.value = '1';
  }
  function shareCount() {
    var n = sharesEl ? parseInt(sharesEl.value, 10) : 1;
    return (!n || n < 1) ? 1 : n;
  }

  var noteEl = q('#input-note');
  if (noteEl && spec.inputNote) { noteEl.innerText = fill(spec.inputNote); noteEl.hidden = false; }

  var addendumEl = root.querySelector('.addendum');
  if (addendumEl && spec.addendumHtml) addendumEl.innerHTML = fill(spec.addendumHtml);

  /* Every share-dependent figure is rendered here, from one place. Leaving the
     static rows at one share while the per-hour figure reflected several would
     put two different quantities of aircraft on screen at once - the same class
     of inconsistency as the capped per-hour cost. */
  function renderShareFigures() {
    var n = shareCount();
    q('#share-position').innerText =
      n === 1 ? spec.sharePositionLabel
              : spec.sharePositionLabel.replace(/\(per share\)/i, '(' + n + ' shares)');
    q('#program-cost').innerText       = '$' + money0(spec.programCost * n);
    q('#annual-program-fee').innerText = '$' + money0(spec.annualProgramFee * n);
    var hoursRow = q('#share-hours');
    if (hoursRow && spec.usage && spec.usage.model === 'capped') {
      hoursRow.innerText = 'Up to ' + (spec.usage.maxHours * n) + ' hours';
    }
    /* Raymond 2026-09-15: a reservation block is per share, so two shares carry
       two of them. */
    var schedRow = q('#scheduling-limit');
    if (schedRow && spec.usage && spec.usage.model === 'unlimited') {
      schedRow.innerText = (spec.usage.schedulingHours * n) + ' flight hours or ' +
                           (spec.usage.schedulingDays * n) + ' days at one time';
    }
    /* Only this phrase is rewritten, never the whole footnote: fuelNoteEl is captured
       once from inside .addendum, and re-injecting the HTML would orphan it so the
       live fuel price would write to a detached node and vanish from the page. */
    var posEl = root.querySelector('[data-positions]');
    if (posEl) {
      posEl.textContent = n === 1 ? 'purchases one position'
                                  : 'shown is for ' + n + ' positions';
    }
  }
  renderShareFigures();

  var fuelCostEl = q('#fuel-cost');
  var fuelNoteEl = q('#fuel-note');
  fuelCostEl.innerText = '$' + money0(spec.fuel.fallbackCostPerHour) + HR;

  /* ── share availability (only if this program publishes it) ────────── */
  var sharesRow = q('[data-shares]');
  if (sharesRow && typeof spec.availableShares === 'number' && typeof spec.totalShares === 'number') {
    q('#shares-available').innerText = remaining() + ' of ' + spec.totalShares;
    sharesRow.hidden = false;
  }

  /* ── usage model: show only the rows this program uses ─────────────── */
  var model = (spec.usage && spec.usage.model) || 'unlimited';
  root.querySelectorAll('[data-usage]').forEach(function (el) {
    el.hidden = el.getAttribute('data-usage') !== model;
  });
  if (model === 'unlimited') {
    q('#share-usage').innerText = 'Unlimited';
    renderShareFigures();   /* scheduling limit scales with the selection */
  } else if (model === 'capped') {
    renderShareFigures();   /* scales the entitlement row with the selection */
  } else {
    console.warn('[bopaero:aircraft-calc] unknown usage model:', model);
  }

  /* ── live fuel price ───────────────────────────────────────────────── */
  function applyFuelPrice(pricePerGal, updated) {
    fuelCostEl.innerText = '$' + money0(fuelCostPerHour(pricePerGal)) + HR;
    if (fuelNoteEl) {
      fuelNoteEl.innerText =
        '***' + spec.fuel.label + ' $' + pricePerGal.toFixed(2) + '/gal (national avg, AirNav.com' +
        (updated ? ', updated ' + updated : '') + ') × ' + spec.fuel.gph + ' gph + oil.';
    }
  }
  fetch(FUEL_PRICES_URL + '?v=' + new Date().toISOString().slice(0, 10))
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      var p = d && d[spec.fuel.priceKey];
      if (typeof p === 'number') applyFuelPrice(p, d.updated);
    })
    .catch(function (e) {
      console.warn('[bopaero:aircraft-calc] ' + spec.id + ' fuel price fetch failed:', e.message);
    });

  /* ── interaction ───────────────────────────────────────────────────── */
  var yearsEl = q('#ownership-years');
  var hoursEl = q('#hours-per-year');
  var blendedEl = q('#blended-cost-per-hour');
  var blendedRow = q('#blended-row');
  var warnEl = q('#usage-warning');

  /* A capped program cannot deliver more than maxHours per share per year.
     Without this, entering 175 hrs/yr against a 96-hour SR22T share returns a
     confident cost per hour for a usage level the program does not permit —
     and because the figure falls as hours rise, the error flatters the wrong
     way. Warn rather than block: needing a second share is a conversation,
     not an input error. */
  /* Entitlement scales with shares: N shares carry N x maxHours per year. This is
     the same arithmetic the warning already asserted ("2 shares would be required
     at this usage level"), now that the buyer can actually select those shares. */
  function entitlement() {
    var cap = spec.usage && spec.usage.model === 'capped' ? spec.usage.maxHours : null;
    return cap ? cap * shareCount() : null;
  }
  function overCap(hoursPerYear) {
    var allowed = entitlement();
    return allowed && hoursPerYear > allowed ? allowed : null;
  }

  function checkUsageCap(hoursPerYear) {
    if (!warnEl) return;
    var cap = spec.usage && spec.usage.model === 'capped' ? spec.usage.maxHours : null;
    var allowed = entitlement();
    if (allowed && hoursPerYear > allowed) {
      var have = shareCount();
      var need = Math.ceil(hoursPerYear / cap);
      warnEl.innerText =
        hoursPerYear + ' hours per year exceeds the ' + allowed + '-hour annual limit for ' +
        (have === 1 ? 'a single share' : have + ' shares') + '. ' + need +
        (need === 1 ? ' share' : ' shares') + ' would be required at this usage level — ' +
        'contact us to discuss.';
      warnEl.hidden = false;
    } else {
      warnEl.hidden = true;
    }
  }

  /* The photos are loading="lazy" with height:auto and no intrinsic size, so while
     they have zero area the browser may never schedule the load - and opening the
     accordion does not by itself break that deadlock. Switching to eager and
     re-triggering guarantees the fetch.
     MUST run at init as well as on toggle: the accordion now ships open, so the
     toggle event never fires on load and the images would never wake. */
  /* Milestones, not behaviour tracking: each is a yes/no about whether the
     pricing tool was used, which is the question the reorder was meant to move. */
  function track(name, data) {
    try { if (window.__bopTelemetry) window.__bopTelemetry.event(name, data); } catch (e) {}
  }
  track('calc_present', { aircraft: spec.id });

  function wakeImages(scope) {
    scope.querySelectorAll('img[loading="lazy"]').forEach(function (img) {
      img.loading = 'eager';
      if (!img.complete || !img.naturalWidth) { var u = img.src; img.src = ''; img.src = u; }
    });
  }
  if (root.open) wakeImages(root);

  root.addEventListener('toggle', function () {
    if (!this.open) return;
    wakeImages(this);
    /* Only pull the page to the calculator when the USER opened it. Doing this on
       an accordion that ships open would yank the page on load. */
    if (this.dataset.userToggled) {
      track('calc_opened', { aircraft: spec.id });
      this.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });

  function calculate() {
    var years = Number(yearsEl.value);
    var hoursPerYear = Number(hoursEl.value);
    if (!Number.isInteger(years) || years < 1 || years > 20) {
      alert('Please enter Years of Ownership as a whole number between 1 and 20.'); return;
    }
    if (!Number.isFinite(hoursPerYear) || hoursPerYear < 1) {
      alert('Please enter estimated annual flying hours greater than zero.'); return;
    }
    /* Above the cap the per-hour figure is not just unhelpful, it is wrong in the
       flattering direction: it divides ONE share's cost by hours that one share is
       not entitled to fly, so the rate falls as the overage grows. Raymond's call
       (2026-09-14): show the warning alone rather than a number a prospect could
       quote back. The static per-share rows stay - they remain true. */
    var cap = overCap(hoursPerYear);
    if (cap) {
      blendedEl.innerText = '-';
      if (blendedRow) blendedRow.hidden = true;
    } else {
      /* ASSUMPTION, flagged to Raymond 2026-09-15: buying N shares costs N x the
         program cost and N x the annual fee. Linear, and consistent with the cap
         warning that already told prospects they would need a second share. If the
         real pricing is not linear this is the one place to change it. */
      var total = (spec.programCost + spec.annualProgramFee * years) * shareCount();
      blendedEl.innerText = '$' + money0(total / (years * hoursPerYear)) + HR;
      if (blendedRow) blendedRow.hidden = false;
    }
    checkUsageCap(hoursPerYear);
    track('calc_run', { aircraft: spec.id, years: years, hours: hoursPerYear,
                        shares: shareCount(), overCap: !!cap });
  }

  function clearData() {
    yearsEl.value = ''; hoursEl.value = '';
    blendedEl.innerText = '-';
    if (blendedRow) blendedRow.hidden = false;
    if (warnEl) warnEl.hidden = true;
    yearsEl.focus();
  }

  /* ── in-page jump CTA ──────────────────────────────────────────────────
     Delivered by the bundle rather than a Squarespace edit: the loader is already
     on every one of these pages, so this ships to all six with one push and
     reverts with one revert. Measured on a phone, the calculator sits ~7 screens
     down behind 6.3 screens of copy; a visitor who has decided had no way to
     reach it except scrolling.

     Defensive by design - it touches host-page DOM, so every step is guarded and
     any failure leaves the page exactly as it was. */
  function mountJumpCta() {
    try {
      if (!('IntersectionObserver' in window)) return;   // no observer, no CTA
      if (document.querySelector('.bop-jump')) return;    // one per page
      if (!document.body) return;

      root.id = root.id || 'bop-calculator';

      var cta = document.createElement('button');
      cta.type = 'button';
      cta.className = 'bop-embed bop-jump';
      cta.setAttribute('data-show', '0');
      cta.textContent = (spec.jumpLabel || 'See your cost') + ' \u2193';
      document.body.appendChild(cta);

      cta.addEventListener('click', function () {
        var reduce = window.matchMedia &&
                     window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        track('jump_cta', { aircraft: spec.id });
        root.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
        /* Land the caret in the first field: tapping the CTA is intent to use the
           calculator, not just to look at it. Deferred so focus does not fight the
           smooth scroll. */
        setTimeout(function () { try { yearsEl.focus({ preventScroll: true }); } catch (e) {} }, 700);
      });

      /* Show only once the calculator is off screen AND the visitor has actually
         started reading - otherwise it covers the hero the moment the page loads.

         Both conditions are observed, not listened for. The first version keyed
         "has scrolled" off a window scroll event and never appeared: in some
         embedded contexts that event simply does not fire, so the CTA silently
         never showed. A sentinel parked below the fold answers the same question
         from layout rather than from an event, and costs no scroll handler. */
      var calcVisible = false, scrolledEnough = false;
      function sync() {
        cta.setAttribute('data-show', (!calcVisible && scrolledEnough) ? '1' : '0');
      }

      var sentinel = document.createElement('div');
      sentinel.setAttribute('aria-hidden', 'true');
      sentinel.style.cssText =
        'position:absolute;top:75vh;left:0;width:1px;height:1px;opacity:0;pointer-events:none';
      document.body.appendChild(sentinel);

      new IntersectionObserver(function (entries) {
        calcVisible = entries[0].isIntersecting;
        sync();
      }, { threshold: 0 }).observe(root);

      var ioReported = false;
      new IntersectionObserver(function (entries) {
        ioReported = true;
        scrolledEnough = !entries[0].isIntersecting;   /* scrolled past the fold */
        sync();
      }, { threshold: 0 }).observe(sentinel);

      /* Fallback. IntersectionObserver is throttled or suspended in some contexts
         (a background tab, some embedded webviews) and then never delivers even its
         guaranteed first callback - the CTA would simply never appear. If nothing has
         been reported shortly after mount, drive the same two flags from geometry on
         scroll instead. Only one path is ever active, and both write through sync(),
         so they cannot disagree. */
      setTimeout(function () {
        if (ioReported) return;
        var tick = function () {
          var r = root.getBoundingClientRect();
          calcVisible = r.bottom > 0 && r.top < window.innerHeight;
          scrolledEnough = (window.scrollY || document.documentElement.scrollTop || 0)
                           > window.innerHeight * 0.75;
          sync();
        };
        window.addEventListener('scroll', tick, { passive: true });
        window.addEventListener('resize', tick);
        tick();
      }, 1500);
    } catch (e) {
      console.warn('[bopaero:aircraft-calc] jump CTA skipped:', e.message);
    }
  }
  mountJumpCta();

  var summaryEl = root.querySelector('summary');
  if (summaryEl) summaryEl.addEventListener('click', function () { root.dataset.userToggled = '1'; });

  if (sharesEl) sharesEl.addEventListener('change', function () {
    track('shares_changed', { aircraft: spec.id, shares: shareCount() });
    renderShareFigures();
    /* Only recompute if the visitor has already produced a result; otherwise a
       stale per-hour figure would appear from an empty form. */
    if (yearsEl.value && hoursEl.value) calculate();
  });

  q('#calculate-cost').addEventListener('click', calculate);
  q('#clear-calculator').addEventListener('click', clearData);

  [yearsEl, hoursEl].forEach(function (el) {
    el.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); calculate(); el.blur(); }
    });
    el.addEventListener('blur', function () {
      if (yearsEl.value && hoursEl.value) calculate();
    });
  });
}
