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

  /* ── programs ──────────────────────────────────────────────────────────
     An aircraft can offer several ownership programs (SF50: new G3 plus
     pre-owned G2+, G2, G1 - Raymond 2026-10-02). Each entry in spec.programs
     carries that program's figures, heading and footnote; useProgram() copies
     the chosen one onto spec, so everything below reads one current program.
     A costing-driven aircraft with no `programs` is treated as one program;
     an aircraft with neither (SR22T) skips all of this. */
  var PROGRAM_FIELDS = ['heading', 'programCost', 'annualProgramFee', 'totalShares',
                        'availableShares', 'sharesRemaining', 'approx', 'programNote', 'features'];
  var programs = Array.isArray(spec.programs) && spec.programs.length ? spec.programs : null;
  if (!programs && spec.costing) {
    var only = { key: spec.costing.program };
    PROGRAM_FIELDS.forEach(function (f) { only[f] = spec[f]; });
    programs = [only];
  }
  var currentKey = programs ? (spec.defaultProgram || programs[0].key) : null;
  function programByKey(key) {
    for (var i = 0; i < programs.length; i++) if (programs[i].key === key) return programs[i];
    return programs[0];
  }
  function useProgram(key) {
    var pr = programByKey(key);
    currentKey = pr.key;
    PROGRAM_FIELDS.forEach(function (f) { if (pr[f] !== undefined) spec[f] = pr[f]; else if (f === 'programNote' || f === 'approx' || f === 'features') spec[f] = undefined; });
    if (spec.addenda && pr.addendum) spec.addendumHtml = spec.addenda[pr.addendum];
    /* Scheduling scales with the number of owners: the aircraft's yearly hours
       and days divided by the shares offered (Raymond 2026-10-02, proportional). */
    if (spec.usage && spec.usage.aircraftHours && spec.availableShares) {
      spec.usage.schedulingHours = Math.round(spec.usage.aircraftHours / spec.availableShares);
      spec.usage.schedulingDays = Math.round(spec.usage.aircraftDays / spec.availableShares);
    }
  }
  if (programs) useProgram(currentKey);

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
      gph: spec.fuel && spec.fuel.gph,
      taxRate: typeof spec.taxRate === 'number' ? String(+(spec.taxRate * 100).toFixed(2)) + '%' : undefined,
      programNote: spec.programNote
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
  if (hoursInput && spec.hoursPlaceholder) hoursInput.placeholder = fill(spec.hoursPlaceholder);

  /* Share selector. Capped at what is actually for sale - offering 16 when 14
     remain would quote a position that cannot be bought. */
  var sharesEl = q('#share-count');
  function buildShareOptions() {
    if (!sharesEl) return;
    var maxSelectable = (typeof spec.sharesRemaining === 'number' ? spec.sharesRemaining
                        : (typeof spec.availableShares === 'number' ? spec.availableShares : 1));
    var keep = parseInt(sharesEl.value, 10) || 1;
    sharesEl.innerHTML = '';
    for (var si = 1; si <= maxSelectable; si++) {
      var op = document.createElement('option');
      op.value = si;
      op.textContent = si === 1 ? '1 share' : si + ' shares';
      sharesEl.appendChild(op);
    }
    sharesEl.value = String(keep <= maxSelectable ? keep : 1);
  }
  buildShareOptions();
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
    /* Pre-owned figures are planning values - "~" on the capital side only, as in
       the program document (the Annual Program Fee is not approximate). */
    q('#program-cost').innerText       = (spec.approx ? '~' : '') + '$' + money0(spec.programCost * n);
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

  /* Features (SF50: connectivity, Garmin Safe Return), edited with the costing in
     the costing editor and shown for the selected program. The wording (`text`) is
     produced by the costing's own costing.js from the status plus an optional
     detail, so it always agrees with the mark. `note` is the pre-2026-10-02.3 shape. */
  var featuresEl = q('#program-features');
  var FEATURE_MARK = { included: '\u2713', depends: '~', excluded: '\u2715' };
  function renderFeatures() {
    if (!featuresEl) return;
    var labels = spec.featureLabels || {}, f = spec.features || {};
    var keys = Object.keys(labels).filter(function (k) { return f[k]; });
    featuresEl.innerHTML = '';
    keys.forEach(function (k) {
      var row = document.createElement('div');
      row.className = 'output-item feature feature-' + f[k].status;
      var name = document.createElement('span');
      var mark = document.createElement('b'); mark.className = 'feature-mark'; mark.textContent = FEATURE_MARK[f[k].status] || '';
      name.appendChild(mark); name.appendChild(document.createTextNode(' ' + labels[k] + ':'));
      var val = document.createElement('span'); val.textContent = f[k].text || f[k].note;
      row.appendChild(name); row.appendChild(val);
      featuresEl.appendChild(row);
    });
    featuresEl.hidden = !keys.length;
  }
  renderFeatures();

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
  var lastFuelNote = null;   /* kept so a re-rendered footnote can get it back */
  function applyFuelPrice(pricePerGal, updated) {
    fuelCostEl.innerText = '$' + money0(fuelCostPerHour(pricePerGal)) + HR;
    lastFuelNote =
      '***' + spec.fuel.label + ' $' + pricePerGal.toFixed(2) + '/gal (national avg, AirNav.com' +
      (updated ? ', updated ' + updated : '') + ') × ' + spec.fuel.gph + ' gph + oil.';
    if (fuelNoteEl) fuelNoteEl.innerText = lastFuelNote;
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

  /* ── live costing ──────────────────────────────────────────────────────
     A program with a `costing` block takes its figures from the costing
     published in the private SF50 costing editor - the same costing.json the
     SF50 Ownership Program Options document reads, calculated by the same
     costing.js. One source of truth: a publish there updates the document and
     every calculator page, with no rebuild here (Raymond, 2026-10-02).

     The figures in the data file are a FALLBACK: shown immediately, so nothing
     jumps or blanks while loading, and kept current daily by the costing-sync
     workflow. If the costing cannot load, visitors still see sound figures. */
  function applyCosting(costing) {
    var problems = window.SF50Costing.validate(costing);
    if (problems.length) throw new Error('costing invalid: ' + problems.join('; '));
    var d = window.SF50Costing.derive(costing);
    var changed = false;
    programs.forEach(function (pr) {
      var c = d.byKey[pr.key];
      if (!c) { console.warn('[bopaero:aircraft-calc] ' + spec.id + ' program ' + pr.key + ' is not in the costing'); return; }
      var next = { programCost: c.capPerShare, annualProgramFee: c.annualFee,
                   totalShares: c.interests, availableShares: c.shares, approx: c.approx, features: c.features };
      Object.keys(next).forEach(function (k) {
        var differs = typeof next[k] === 'number' ? Math.abs((pr[k] || 0) - next[k]) > 0.005
                    : JSON.stringify(pr[k]) !== JSON.stringify(next[k]);
        if (differs) { pr[k] = next[k]; changed = true; }
      });
      /* Never offer more shares than the program now has for sale */
      if (typeof pr.sharesRemaining === 'number' && pr.sharesRemaining > pr.availableShares) { pr.sharesRemaining = pr.availableShares; changed = true; }
    });
    if (Math.abs((spec.taxRate || 0) - d.common.taxRate) > 1e-9) { spec.taxRate = d.common.taxRate; changed = true; }
    if (JSON.stringify(spec.featureLabels) !== JSON.stringify(d.featureLabels)) { spec.featureLabels = d.featureLabels; changed = true; }
    if (changed) refreshProgram();
  }

  function loadCostingLib(url) {
    if (window.SF50Costing) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var s = document.querySelector('script[data-sf50-costing]');
      var fresh = !s;
      if (fresh) { s = document.createElement('script'); s.src = url; s.async = true; s.setAttribute('data-sf50-costing', ''); }
      s.addEventListener('load', function () { window.SF50Costing ? resolve() : reject(new Error('costing.js loaded without SF50Costing')); });
      s.addEventListener('error', function () { reject(new Error('costing.js did not load')); });
      if (fresh) document.head.appendChild(s);
    });
  }

  /* A publish in the costing editor must reach the calculator promptly (Raymond,
     2026-10-02). GitHub Pages' CDN caches files for 10 minutes, so ask for a copy
     keyed to the current minute: at most a minute stale, and still cacheable. */
  function fresh(url) { return url + (url.indexOf('?') < 0 ? '?' : '&') + 'm=' + Math.floor(Date.now() / 60000); }
  if (spec.costing) {
    loadCostingLib(fresh(spec.costing.lib))
      .then(function () { return fetch(fresh(spec.costing.url), { cache: 'no-cache' }); })
      .then(function (r) { if (!r.ok) throw new Error('costing HTTP ' + r.status); return r.json(); })
      .then(applyCosting)
      .catch(function (e) {
        console.warn('[bopaero:aircraft-calc] ' + spec.id + ' live costing unavailable, showing built-in figures:', e.message);
      });
  }

  /* Re-render everything that depends on the current program. Footnotes quote
     its numbers, and re-injecting the footnote block replaces #fuel-note, so
     re-find it and put the live fuel price back. */
  function refreshProgram() {
    if (programs) useProgram(currentKey);
    if (headEl) headEl.innerText = spec.heading;
    if (hoursInput && spec.hoursPlaceholder) hoursInput.placeholder = fill(spec.hoursPlaceholder);
    buildShareOptions();
    if (addendumEl && spec.addendumHtml) {
      addendumEl.innerHTML = fill(spec.addendumHtml);
      fuelNoteEl = q('#fuel-note');
      if (fuelNoteEl && lastFuelNote) fuelNoteEl.innerText = lastFuelNote;
    }
    if (noteEl && spec.inputNote) noteEl.innerText = fill(spec.inputNote);
    renderShareFigures();
    renderFeatures();
    if (sharesRow && !sharesRow.hidden) q('#shares-available').innerText = remaining() + ' of ' + spec.totalShares;
    renderPicker();
    if (yearsEl && hoursEl && yearsEl.value && hoursEl.value) calculate();
  }

  var pickerEl = q('#program-picker');
  function renderPicker() {
    if (!pickerEl || !programs || programs.length < 2) return;
    pickerEl.innerHTML = '';
    programs.forEach(function (pr) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'program-option';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', pr.key === currentKey ? 'true' : 'false');
      var k = document.createElement('span'); k.className = 'program-key'; k.textContent = pr.label || pr.key;
      var sub = document.createElement('span'); sub.className = 'program-sub'; sub.textContent = pr.sublabel || '';
      b.appendChild(k); b.appendChild(sub);
      b.addEventListener('click', function () {
        if (pr.key === currentKey) return;
        currentKey = pr.key;
        track('program_changed', { aircraft: spec.id, program: pr.key });
        refreshProgram();
      });
      pickerEl.appendChild(b);
    });
    pickerEl.hidden = false;
  }

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

  /* Results update as the visitor types (Raymond 2026-10-02: the Calculate button
     was removed - leaving a field, Enter, the share count and the program already
     recalculated, so the button only mattered if nothing else was touched). An
     incomplete entry shows "-"; an out-of-range one gets a quiet inline line in
     place of the old alert() pop-ups, which fired on every blur mid-typing. */
  var errorEl = q('#input-error');
  function showInputError(msg) {
    if (!errorEl) return;
    errorEl.textContent = msg || '';
    errorEl.hidden = !msg;
  }
  function noResult(msg) {
    blendedEl.innerText = '-';
    if (blendedRow) blendedRow.hidden = false;
    if (warnEl) warnEl.hidden = true;
    showInputError(msg);
  }
  var trackTimer = null, lastTracked = null;
  function calculate() {
    if (!yearsEl.value || !hoursEl.value) return noResult('');
    var years = Number(yearsEl.value);
    var hoursPerYear = Number(hoursEl.value);
    if (!Number.isInteger(years) || years < 1 || years > 20) {
      return noResult('Enter Years of Ownership as a whole number from 1 to 20.');
    }
    if (!Number.isFinite(hoursPerYear) || hoursPerYear < 1) {
      return noResult('Enter estimated flying hours per year greater than zero.');
    }
    showInputError('');
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
      blendedEl.innerText = (spec.approx ? '~' : '') + '$' + money0(total / (years * hoursPerYear)) + HR;
      if (blendedRow) blendedRow.hidden = false;
    }
    checkUsageCap(hoursPerYear);
    /* One calc_run per settled entry, not one per keystroke now that results are live */
    var run = { aircraft: spec.id, years: years, hours: hoursPerYear, shares: shareCount(), overCap: !!cap };
    if (currentKey) run.program = currentKey;
    var runKey = JSON.stringify(run);
    clearTimeout(trackTimer);
    trackTimer = setTimeout(function () {
      if (runKey !== lastTracked) { lastTracked = runKey; track('calc_run', run); }
    }, 1500);
  }

  function clearData() {
    yearsEl.value = ''; hoursEl.value = '';
    noResult('');
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

  renderPicker();
  q('#clear-calculator').addEventListener('click', clearData);

  var calcTimer = null;
  function scheduleCalculate() { clearTimeout(calcTimer); calcTimer = setTimeout(calculate, 200); }

  [yearsEl, hoursEl].forEach(function (el) {
    el.addEventListener('input', scheduleCalculate);
    el.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); calculate(); el.blur(); }
    });
    el.addEventListener('blur', function () {
      if (yearsEl.value && hoursEl.value) calculate();
    });
  });
}
