/* ============================================================================
   bop Aero embed telemetry — aggregate only, prepended to every component.

   WHAT IT COLLECTS: how far down a page a visit scrolls, where clicks land as a
   coarse grid position, which named control was clicked, and a handful of
   calculator milestones. Plus page path and whether the viewport is phone-sized.

   WHAT IT DOES NOT COLLECT, BY DESIGN: no cookies, no visitor or session id, no
   fingerprint, no form values, no keystrokes, no session replay. Two visits are
   indistinguishable in the data. That is deliberate - it keeps this inside the
   "usage data / network activity" the existing privacy notice already describes,
   so no new processor and no policy redraft. The tracker this replaces (an
   inherited Hotjar) recorded full session replays into an account Raymond did
   not control; the whole point of building our own is not to repeat that.

   Runs ONCE per page even when several embeds are present. Sends nothing until
   ENDPOINT is set, so the data shape can be proven locally first.
   ========================================================================== */
(function () {
  if (window.__bopTelemetry) return;          // one collector per page

  var ENDPOINT = 'https://bopaero-telemetry.compilotrc.workers.dev/collect';
  var DEBUG = /[?&]bopdebug=1/.test(location.search);
  var GRID_X = 20, GRID_Y = 40;               // click bins: coarse on purpose
  var MILESTONES = [25, 50, 75, 100];

  var events = [];
  var seenScroll = {};
  var sent = false;

  function ctx() {
    return {
      path: location.pathname,
      view: window.innerWidth <= 900 ? 'phone' : 'desktop'
    };
  }
  function push(type, data) {
    if (events.length >= 200) return;         // bound the payload, always
    events.push({ t: type, d: data || {} });
    if (DEBUG) console.log('[bop:telemetry]', type, data || {});
  }

  /* ── scroll depth ──────────────────────────────────────────────────────
     Milestones rather than a continuous position: it answers "how far do
     visitors get" without describing any individual's path down the page. */
  function scrollDepth() {
    var doc = document.documentElement;
    var max = Math.max(1, doc.scrollHeight - window.innerHeight);
    var pct = Math.min(100, Math.round(((window.scrollY || doc.scrollTop || 0) / max) * 100));
    for (var i = 0; i < MILESTONES.length; i++) {
      var m = MILESTONES[i];
      if (pct >= m && !seenScroll[m]) { seenScroll[m] = 1; push('scroll', { pct: m }); }
    }
  }

  /* ── clicks ────────────────────────────────────────────────────────────
     Position is binned to a 20x40 grid of the DOCUMENT, not exact pixels, so
     the report can draw density without the data describing a precise pointer
     trace. `el` names the control when it is one we care about. */
  function describe(node) {
    var el = node;
    for (var i = 0; i < 6 && el && el.nodeType === 1; i++) {
      if (el.id) return '#' + el.id;
      if (el.getAttribute && el.getAttribute('data-embed')) return '[' + el.getAttribute('data-embed') + ']';
      if (el.tagName === 'A' || el.tagName === 'BUTTON' || el.tagName === 'SELECT') {
        var txt = (el.innerText || el.value || '').trim().replace(/\s+/g, ' ').slice(0, 28);
        return el.tagName.toLowerCase() + (txt ? ':' + txt : '');
      }
      el = el.parentElement;
    }
    return 'other';
  }
  function onClick(e) {
    var doc = document.documentElement;
    var w = Math.max(1, doc.scrollWidth), h = Math.max(1, doc.scrollHeight);
    push('click', {
      x: Math.min(GRID_X - 1, Math.floor((e.pageX / w) * GRID_X)),
      y: Math.min(GRID_Y - 1, Math.floor((e.pageY / h) * GRID_Y)),
      el: describe(e.target)
    });
  }

  /* ── delivery ──────────────────────────────────────────────────────────
     sendBeacon on the way out: it survives navigation, where fetch does not.
     visibilitychange fires on mobile where unload often does not. */
  function flush() {
    if (sent || !events.length) return;
    sent = true;
    scrollDepth();          /* final depth before we stop measuring */
    var payload = { v: 1, ctx: ctx(), events: events };
    if (DEBUG) console.log('[bop:telemetry] FLUSH', JSON.stringify(payload));
    if (!ENDPOINT) return;                    // nothing configured: collect, never send
    try {
      /* text/plain, NOT application/json. A non-safelisted content type forces a
         CORS preflight, and sendBeacon cannot perform one - the browser drops the
         request with no error anywhere. It reported "sent" client-side and nothing
         ever arrived. The body is still JSON; the Worker parses it regardless. */
      var blob = new Blob([JSON.stringify(payload)], { type: 'text/plain;charset=UTF-8' });
      if (!navigator.sendBeacon || !navigator.sendBeacon(ENDPOINT, blob)) {
        fetch(ENDPOINT, { method: 'POST', body: blob, keepalive: true, mode: 'no-cors' });
      }
    } catch (e) { /* telemetry must never break the page */ }
  }

  try {
    window.addEventListener('scroll', scrollDepth, { passive: true });
    /* A low-frequency sampler as well as the scroll listener. Scroll events are
       throttled or suppressed entirely in some contexts - background tabs, some
       webviews, and any automated driver - and depth would then silently never
       record. Sampling is cheap, catches programmatic scrolling too, and stops
       as soon as every milestone is seen or the page is on its way out. */
    var sampler = setInterval(function () {
      scrollDepth();
      if (seenScroll[100]) clearInterval(sampler);
    }, 1000);
    document.addEventListener('click', onClick, true);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') flush();
    });
    window.addEventListener('pagehide', flush);
    scrollDepth();

    window.__bopTelemetry = {
      event: function (name, data) { push(name, data); },
      dump: function () { return { ctx: ctx(), events: events }; }
    };
  } catch (e) {
    window.__bopTelemetry = { event: function () {}, dump: function () { return null; } };
    if (DEBUG) console.warn('[bop:telemetry] disabled:', e.message);
  }
})();
