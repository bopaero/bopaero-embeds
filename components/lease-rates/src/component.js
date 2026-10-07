/* Leasing Program rates (bopaero.com/sr22t-leasing-program).
 *
 * The rates are the bridge aircraft's lease terms in the SR22T costing — the one
 * place they are edited (private costing editor, /sr22t). Raymond 2026-10-07:
 * the page's typed rates and the costing must not drift apart.
 *
 * The data file's `lease` figures render first (no blank or jump while loading)
 * and stay if the costing can't be reached; tools/sync_costing.py keeps them
 * equal to the costing daily.
 */
function initLeaseRates(root, spec) {
  var WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
               'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen',
               'nineteen', 'twenty', 'twenty-one', 'twenty-two', 'twenty-three', 'twenty-four', 'twenty-five',
               'twenty-six', 'twenty-seven', 'twenty-eight', 'twenty-nine', 'thirty'];
  function money(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
  function words(n) { return WORDS[n] ? WORDS[n] + ' (' + n + ')' : String(n); }
  function set(field, text) {
    Array.prototype.forEach.call(root.querySelectorAll('[data-f="' + field + '"]'), function (el) { el.textContent = text; });
  }
  var FIELDS = ['leaseMonthly', 'leaseIncludedHours', 'leaseExtraHourRate', 'leaseHourlyRate'];
  function usable(l) {
    return l && FIELDS.every(function (f) { return typeof l[f] === 'number' && isFinite(l[f]) && l[f] >= 0; }) &&
           Math.floor(l.leaseIncludedHours) === l.leaseIncludedHours;
  }
  function render(l) {
    set('heading', spec.heading + '');
    set('monthly', money(l.leaseMonthly));
    set('hours', String(l.leaseIncludedHours));
    set('hoursWords', words(l.leaseIncludedHours));
    set('extra', money(l.leaseExtraHourRate));
    set('hourly', money(l.leaseHourlyRate));
  }

  /* The page keeps its two original blocks: rates beside the photo, footnotes
     full-width below. Each block holds a stub naming its part. */
  var host = root.closest ? root.closest('[data-embed]') : null;
  var part = (host && host.getAttribute('data-part')) || '';
  if (part === 'rates') root.querySelector('.bop-lease-notes').hidden = true;
  if (part === 'notes') root.querySelector('.bop-lease-rates').hidden = true;

  if (usable(spec.lease)) render(spec.lease);
  else console.warn('[bopaero:lease-rates] ' + spec.id + ' built-in lease figures are incomplete');

  if (spec.costing && spec.costing.url) {
    /* Minute key: GitHub Pages caches each URL for 10 minutes, so a publish in the
       costing editor shows here within about a minute (same as the calculator). */
    var url = spec.costing.url + (spec.costing.url.indexOf('?') < 0 ? '?' : '&') + 'm=' + Math.floor(Date.now() / 60000);
    fetch(url, { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error('costing HTTP ' + r.status); return r.json(); })
      .then(function (c) {
        if (!usable(c && c.bridge)) throw new Error('costing has no complete bridge lease terms');
        render(c.bridge);
      })
      .catch(function (e) {
        console.warn('[bopaero:lease-rates] ' + spec.id + ' live costing unavailable, showing built-in rates:', e.message);
      });
  }
}
