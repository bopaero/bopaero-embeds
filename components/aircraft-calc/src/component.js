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

  q('#share-position').innerText     = spec.sharePositionLabel;
  q('#program-cost').innerText       = '$' + money0(spec.programCost);
  q('#annual-program-fee').innerText = '$' + money0(spec.annualProgramFee);

  var fuelCostEl = q('#fuel-cost');
  var fuelNoteEl = q('#fuel-note');
  fuelCostEl.innerText = '$' + money0(spec.fuel.fallbackCostPerHour) + HR;

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
  }

  function clearData() {
    yearsEl.value = ''; hoursEl.value = '';
    blendedEl.innerText = '-'; yearsEl.focus();
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
