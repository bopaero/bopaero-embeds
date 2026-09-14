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

  var noteEl = q('#input-note');
  if (noteEl && spec.inputNote) { noteEl.innerText = fill(spec.inputNote); noteEl.hidden = false; }

  var addendumEl = root.querySelector('.addendum');
  if (addendumEl && spec.addendumHtml) addendumEl.innerHTML = fill(spec.addendumHtml);

  q('#share-position').innerText     = spec.sharePositionLabel;
  q('#program-cost').innerText       = '$' + money0(spec.programCost);
  q('#annual-program-fee').innerText = '$' + money0(spec.annualProgramFee);

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
    q('#scheduling-limit').innerText =
      spec.usage.schedulingHours + ' flight hours or ' +
      spec.usage.schedulingDays + ' days at one time';
  } else if (model === 'capped') {
    q('#share-hours').innerText = 'Up to ' + spec.usage.maxHours + ' hours';
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
  var warnEl = q('#usage-warning');

  /* A capped program cannot deliver more than maxHours per share per year.
     Without this, entering 175 hrs/yr against a 96-hour SR22T share returns a
     confident cost per hour for a usage level the program does not permit —
     and because the figure falls as hours rise, the error flatters the wrong
     way. Warn rather than block: needing a second share is a conversation,
     not an input error. */
  function checkUsageCap(hoursPerYear) {
    if (!warnEl) return;
    var cap = spec.usage && spec.usage.model === 'capped' ? spec.usage.maxHours : null;
    if (cap && hoursPerYear > cap) {
      var shares = Math.ceil(hoursPerYear / cap);
      warnEl.innerText =
        hoursPerYear + ' hours per year exceeds the ' + cap +
        '-hour annual limit for a single share. ' + shares +
        ' shares would be required at this usage level — contact us to discuss.';
      warnEl.hidden = false;
    } else {
      warnEl.hidden = true;
    }
  }

  root.addEventListener('toggle', function () {
    if (this.open) this.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
    var total = spec.programCost + spec.annualProgramFee * years;
    blendedEl.innerText = '$' + money0(total / (years * hoursPerYear)) + HR;
    checkUsageCap(hoursPerYear);
  }

  function clearData() {
    yearsEl.value = ''; hoursEl.value = '';
    blendedEl.innerText = '-';
    if (warnEl) warnEl.hidden = true;
    yearsEl.focus();
  }

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
