/* bop Aero embed telemetry Worker.
 *
 * Accepts beacons from the embed collector and folds each one into aggregate
 * counters. The payload is never stored: there is no row anywhere that
 * represents a single visit, which is what keeps this inside the "usage data"
 * the existing privacy notice covers. See workers/schema.sql.
 *
 *   POST /collect   beacon from bopaero.com
 *   GET  /report    aggregate JSON for the weekly report (token-gated)
 */

const ALLOWED_ORIGINS = ['https://bopaero.com', 'https://www.bopaero.com'];
const GRID_X = 20, GRID_Y = 40;
const MAX_BODY = 8 * 1024;          // a real beacon is ~500 bytes
const MAX_EVENTS = 200;
const RETAIN_DAYS = 90;

const SCALARS = new Set([
  'visits', 'scroll_25', 'scroll_50', 'scroll_75', 'scroll_100',
  'calc_present', 'calc_opened', 'calc_run', 'calc_run_overcap',
  'shares_changed', 'jump_cta', 'form_reached'
]);

function cors(origin) {
  const ok = ALLOWED_ORIGINS.includes(origin);
  return {
    'Access-Control-Allow-Origin': ok ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400'
  };
}

/* Bound what can ever reach the database. The collector is ours, but the
   endpoint is public, so treat every field as hostile: unknown metric names are
   dropped rather than inserted, paths and control names are length-capped, and
   grid positions must be integers inside the grid. */
function clean(payload) {
  const ctx = payload && payload.ctx || {};
  const path = String(ctx.path || '/').slice(0, 120);
  const view = ctx.view === 'phone' ? 'phone' : 'desktop';
  const events = Array.isArray(payload.events) ? payload.events.slice(0, MAX_EVENTS) : [];

  const metrics = new Map([['visits', 1]]);
  const bins = new Map();
  const controls = new Map();
  const bump = (m, k, by = 1) => m.set(k, (m.get(k) || 0) + by);

  for (const e of events) {
    const t = typeof e?.t === 'string' ? e.t : '';
    const d = e && e.d || {};
    if (t === 'scroll') {
      const pct = Number(d.pct);
      if ([25, 50, 75, 100].includes(pct)) bump(metrics, 'scroll_' + pct);
    } else if (t === 'click') {
      const x = Number(d.x), y = Number(d.y);
      if (Number.isInteger(x) && Number.isInteger(y) &&
          x >= 0 && x < GRID_X && y >= 0 && y < GRID_Y) bump(bins, x + ',' + y);
      const el = typeof d.el === 'string' ? d.el.slice(0, 48) : '';
      if (el) bump(controls, el);
    } else if (SCALARS.has(t)) {
      bump(metrics, t);
      if (t === 'calc_run' && d.overCap) bump(metrics, 'calc_run_overcap');
    }
  }
  return { path, view, metrics, bins, controls };
}

async function store(db, day, c) {
  const stmts = [];
  const up = (sql) => db.prepare(sql);

  for (const [name, n] of c.metrics) {
    stmts.push(up(`INSERT INTO metrics (day,path,view,name,n) VALUES (?,?,?,?,?)
                   ON CONFLICT(day,path,view,name) DO UPDATE SET n = n + excluded.n`)
               .bind(day, c.path, c.view, name, n));
  }
  for (const [key, n] of c.bins) {
    const [x, y] = key.split(',').map(Number);
    stmts.push(up(`INSERT INTO bins (day,path,view,x,y,n) VALUES (?,?,?,?,?,?)
                   ON CONFLICT(day,path,view,x,y) DO UPDATE SET n = n + excluded.n`)
               .bind(day, c.path, c.view, x, y, n));
  }
  for (const [el, n] of c.controls) {
    stmts.push(up(`INSERT INTO controls (day,path,view,el,n) VALUES (?,?,?,?,?)
                   ON CONFLICT(day,path,view,el) DO UPDATE SET n = n + excluded.n`)
               .bind(day, c.path, c.view, el, n));
  }
  if (stmts.length) await db.batch(stmts);
  return stmts.length;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const headers = cors(origin);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });

    if (url.pathname === '/collect' && request.method === 'POST') {
      if (origin && !ALLOWED_ORIGINS.includes(origin)) {
        return new Response('forbidden', { status: 403, headers });
      }
      const body = await request.text();
      if (body.length > MAX_BODY) return new Response('too large', { status: 413, headers });
      let payload;
      try { payload = JSON.parse(body); }
      catch { return new Response('bad json', { status: 400, headers }); }

      const day = new Date().toISOString().slice(0, 10);
      try {
        await store(env.DB, day, clean(payload));
      } catch (e) {
        /* Never fail loudly at the visitor: a telemetry outage must not surface
           on the page. It is logged for the Worker tail instead. */
        console.error('store failed', e.message);
      }
      return new Response(null, { status: 204, headers });
    }

    if (url.pathname === '/report' && request.method === 'GET') {
      if (!env.REPORT_TOKEN || url.searchParams.get('token') !== env.REPORT_TOKEN) {
        return new Response('unauthorized', { status: 401 });
      }
      const days = Math.min(90, Math.max(1, Number(url.searchParams.get('days') || 7)));
      const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
      const [metrics, bins, controls] = await Promise.all([
        env.DB.prepare(`SELECT path,view,name,SUM(n) n FROM metrics WHERE day >= ?
                        GROUP BY path,view,name`).bind(since).all(),
        env.DB.prepare(`SELECT path,view,x,y,SUM(n) n FROM bins WHERE day >= ?
                        GROUP BY path,view,x,y`).bind(since).all(),
        env.DB.prepare(`SELECT path,view,el,SUM(n) n FROM controls WHERE day >= ?
                        GROUP BY path,view,el ORDER BY n DESC`).bind(since).all()
      ]);
      return new Response(JSON.stringify({
        since, days,
        metrics: metrics.results, bins: bins.results, controls: controls.results
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    return new Response('not found', { status: 404, headers });
  },

  /* Retention. Counters are already aggregate, but they should not accumulate
     for ever either - 90 days is enough to compare month over month. */
  async scheduled(event, env) {
    const cutoff = new Date(Date.now() - RETAIN_DAYS * 864e5).toISOString().slice(0, 10);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM metrics  WHERE day < ?').bind(cutoff),
      env.DB.prepare('DELETE FROM bins     WHERE day < ?').bind(cutoff),
      env.DB.prepare('DELETE FROM controls WHERE day < ?').bind(cutoff)
    ]);
  }
};

export { clean };   /* exported for tests */
