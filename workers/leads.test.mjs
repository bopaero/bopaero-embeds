/* Runs with: node workers/leads.test.mjs   (or: bash workers/test.sh)
   LeadConnector is mocked: fetch is replaced, every call is recorded, and the
   assertions check exactly what would have been sent. Nothing leaves the machine. */
import worker, { validate, originAllowed, splitName, rateLimited, _resetRate } from './leads.js';

let pass = 0, fail = 0;
const is = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? '  ok   ' : '  FAIL ') + label + (ok ? '' : `\n         got ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`));
};

const ENV = { LC_TOKEN: 'tok', LC_LOCATION_ID: 'loc1', LC_PIPELINE_ID: 'pipe1', LC_STAGE_ID: 'stage1' };
let calls = [];
function mockLC({ existingOpp = false, upsertStatus = 200, isNew = true } = {}) {
  calls = [];
  globalThis.fetch = async (url, init) => {
    const u = new URL(url);
    calls.push({ method: init.method, path: u.pathname, query: Object.fromEntries(u.searchParams),
                 headers: init.headers, body: init.body ? JSON.parse(init.body) : null });
    const reply = (status, obj) => new Response(JSON.stringify(obj), { status });
    if (u.pathname === '/contacts/upsert') return upsertStatus === 200
      ? reply(200, { new: isNew, contact: { id: 'c123', email: 'echo@example.com' } })
      : reply(upsertStatus, { message: 'nope', email: 'echo@example.com' });
    if (u.pathname === '/contacts/c123/tags') return reply(201, { tags: [] });
    if (u.pathname === '/opportunities/search') return reply(200, { opportunities: existingOpp ? [{ id: 'o-old' }] : [] });
    if (u.pathname === '/opportunities/') return reply(201, { opportunity: { id: 'o-new' } });
    return reply(404, {});
  };
}
const post = (body, origin = 'https://bopaero.com', ip = '1.2.3.4') =>
  new Request('https://leads.example/lead', {
    method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { Origin: origin, 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
  });
const good = { name: 'Jane Q Pilot', email: ' Jane@Example.com ', phone: '(513) 450-2359',
               company: 'Acme Air', program: 'sf50-g3', tool: 'aircraft-calc', page: '/sf50-fractional-ownership-program-pilots' };

// origins
is('bopaero.com allowed', originAllowed('https://bopaero.com'), true);
is('tripcalc allowed', originAllowed('https://tripcalc.bopaero.com'), true);
is('localhost any port allowed', originAllowed('http://localhost:8123'), true);
is('null origin refused', originAllowed('null'), false);
is('lookalike refused', originAllowed('https://bopaero.com.evil.example'), false);
is('http bopaero refused', originAllowed('http://bopaero.com'), false);

// validation
is('name required', validate({ ...good, name: '  ' }).error, 'Please enter your name.');
is('email required', validate({ ...good, email: 'nope' }).error, 'Please enter a valid email address.');
is('email normalised', validate(good).lead.email, 'jane@example.com');
is('unknown program dropped, not stored', validate({ ...good, program: '<b>free text</b>' }).lead.program, '');
is('unknown tool refused', validate({ ...good, tool: 'x' }).error, 'Unknown tool.');
is('name capped at 100', validate({ ...good, name: 'a'.repeat(500) }).lead.name.length, 100);
is('control chars stripped', validate({ ...good, company: 'Ac\u0000me\nAir' }).lead.company, 'Ac me Air');
is('bad phone refused', validate({ ...good, phone: 'call me' }).error, 'Please check the phone number.');
is('optional fields may be empty', validate({ name: 'Al', email: 'al@b.co', tool: 'tripcalc' }).lead.phone, '');
is('split name', splitName('Jane Q Pilot'), { firstName: 'Jane Q', lastName: 'Pilot' });
is('single name', splitName('Cher'), { firstName: 'Cher', lastName: '' });

// happy path
_resetRate(); mockLC();
let res = await worker.fetch(post(good), ENV);
is('200 ok', [res.status, await res.json()], [200, { ok: true }]);
is('CORS echoes the origin', res.headers.get('Access-Control-Allow-Origin'), 'https://bopaero.com');
is('call order', calls.map((c) => c.method + ' ' + c.path),
   ['POST /contacts/upsert', 'POST /contacts/c123/tags', 'GET /opportunities/search', 'POST /opportunities/']);
is('Version header v3 + bearer', [calls[0].headers.Version, calls[0].headers.Authorization], ['v3', 'Bearer tok']);
is('upsert body', calls[0].body, { locationId: 'loc1', firstName: 'Jane Q', lastName: 'Pilot', name: 'Jane Q Pilot',
   email: 'jane@example.com', source: 'bop Aero website calculator', phone: '(513) 450-2359', companyName: 'Acme Air' });
is('upsert never sends tags (they would replace existing ones)', 'tags' in calls[0].body, false);
is('tags added', calls[1].body, { tags: ['calculator-lead', 'tool-calculator', 'interest-sf50-g3'] });
is('search scoped to contact + pipeline + open', calls[2].query,
   { locationId: 'loc1', pipelineId: 'pipe1', contactId: 'c123', status: 'open', limit: '1' });
is('opportunity body', calls[3].body, { pipelineId: 'pipe1', locationId: 'loc1', name: 'SF50 G3 (new) — Jane Q Pilot',
   status: 'open', contactId: 'c123', pipelineStageId: 'stage1' });

// no program → generic opportunity name; no stage → field omitted
_resetRate(); mockLC();
await worker.fetch(post({ name: 'Al Bee', email: 'al@b.co', tool: 'tripcalc' }), { ...ENV, LC_STAGE_ID: '' });
is('tripcalc tag, no interest tag', calls[1].body.tags, ['calculator-lead', 'tool-tripcalc']);
is('generic opportunity name', calls[3].body.name, 'Calculator lead — Al Bee');
is('stage omitted when unset', 'pipelineStageId' in calls[3].body, false);

// returning contact with an open opportunity → no duplicate
_resetRate(); mockLC({ existingOpp: true, isNew: false });
res = await worker.fetch(post(good), ENV);
is('existing open opportunity: still ok', res.status, 200);
is('no second opportunity created', calls.some((c) => c.path === '/opportunities/'), false);

// failures
_resetRate(); mockLC({ upsertStatus: 422 });
const errors = []; const origErr = console.error; console.error = (m) => errors.push(String(m));
res = await worker.fetch(post(good), ENV);
console.error = origErr;
is('LC failure → 502 for the visitor', [res.status, (await res.json()).error], [502, 'unavailable']);
is('error log carries no PII', errors.some((m) => /example\.com|Jane|513/.test(m)), false);

_resetRate(); mockLC();
res = await worker.fetch(post(good), { LC_TOKEN: '' });
is('unconfigured → 503', res.status, 503);
is('unconfigured: nothing sent', calls.length, 0);

_resetRate(); mockLC();
res = await worker.fetch(post({ ...good, website: 'http://spam' }), ENV);
is('honeypot: pretend success', res.status, 200);
is('honeypot: nothing sent', calls.length, 0);

res = await worker.fetch(post(good, 'https://evil.example'), ENV);
is('foreign origin 403', res.status, 403);
res = await worker.fetch(post(good, 'null'), ENV);
is('null origin 403', res.status, 403);
res = await worker.fetch(post('{not json'), ENV);
is('bad JSON 400', res.status, 400);
res = await worker.fetch(post('x'.repeat(5000)), ENV);
is('oversized 413', res.status, 413);
res = await worker.fetch(new Request('https://leads.example/lead', { method: 'OPTIONS', headers: { Origin: 'https://tripcalc.bopaero.com' } }), ENV);
is('preflight 204', [res.status, res.headers.get('Access-Control-Allow-Methods')], [204, 'POST, OPTIONS']);
res = await worker.fetch(new Request('https://leads.example/other', { headers: { Origin: 'https://bopaero.com' } }), ENV);
is('other paths 404', res.status, 404);

// rate limit
_resetRate();
let limited = false;
for (let i = 0; i < 9; i++) limited = rateLimited('9.9.9.9', 1000 + i);
is('9th try in 10 min is limited', limited, true);
is('other IPs unaffected', rateLimited('8.8.8.8', 1000), false);
is('window expires', rateLimited('9.9.9.9', 1000 + 11 * 60 * 1000), false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
