/* bopaero-leads — the calculator lead gate's back end.
 *
 * The aircraft calculators (bopaero.com) and TripCalc (tripcalc.bopaero.com) show
 * results only after a visitor fills in a short form. The form posts here; this
 * Worker files the visitor in LeadConnector as a contact and an open opportunity.
 *
 * WHY A WORKER: the LeadConnector token can create and edit every contact in the
 * account. bopaero-embeds is a PUBLIC repo and the embeds run in visitors'
 * browsers, so the token lives here as a secret and nowhere else.
 *
 * API shapes checked against the official docs on 2026-10-16 (see README.md):
 * every call sends `Version: v3` (the docs' only allowed value; overridable with
 * the LC_API_VERSION var in case LeadConnector moves it again).
 */

const API = 'https://services.leadconnectorhq.com';
const SOURCE = 'bop Aero website calculator';

/* Exact origins only. `null` (sandboxed iframes, file://) is never allowed: it
   would let any page anywhere post leads through us. */
const ALLOWED_ORIGINS = new Set([
  'https://bopaero.com',
  'https://www.bopaero.com',
  'https://tripcalc.bopaero.com',
]);
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

export function originAllowed(origin) {
  if (!origin || origin === 'null') return false;
  return ALLOWED_ORIGINS.has(origin) || LOCAL_ORIGIN.test(origin);
}

/* The program list the forms offer. Anything else is dropped, not stored: the
   value becomes a CRM tag and an opportunity name, so free text is not welcome. */
export const PROGRAMS = {
  'sf50-g3':        'SF50 G3 (new)',
  'sf50-preowned':  'SF50 pre-owned (G1 / G2 / G2+)',
  'sr22t':          'SR22T ownership',
  'sr22t-leasing':  'SR22T leasing',
  'founders':       "Founder's Circle",
  'not-sure':       'Not sure yet',
};
export const TOOLS = { 'aircraft-calc': 'calculator', 'tripcalc': 'tripcalc' };

const MAX = { name: 100, email: 254, phone: 32, company: 120, page: 200 };
const EMAIL = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]{2,}$/;

function clean(v, max) {
  if (typeof v !== 'string') return '';
  // Control characters out, whitespace collapsed, then capped.
  return v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/* Returns { lead } or { error } — the error text is shown to the visitor. */
export function validate(body) {
  if (!body || typeof body !== 'object') return { error: 'Please fill in the form.' };
  const lead = {
    name: clean(body.name, MAX.name),
    email: clean(body.email, MAX.email).toLowerCase(),
    phone: clean(body.phone, MAX.phone),
    company: clean(body.company, MAX.company),
    program: PROGRAMS[body.program] ? body.program : '',
    tool: TOOLS[body.tool] ? body.tool : '',
    page: clean(body.page, MAX.page),
  };
  if (!lead.name) return { error: 'Please enter your name.' };
  if (!EMAIL.test(lead.email)) return { error: 'Please enter a valid email address.' };
  if (lead.phone && !/^[0-9+().\-\s x]{7,}$/i.test(lead.phone)) return { error: 'Please check the phone number.' };
  if (!lead.tool) return { error: 'Unknown tool.' };
  return { lead };
}

/* A visitor who already sent the form on another device (cookies are per device)
   gives just their email (Raymond 2026-10-16). Returns { lead } or { error }. */
export function validateReturning(body) {
  if (!body || typeof body !== 'object') return { error: 'Please enter your email.' };
  const lead = {
    email: clean(body.email, MAX.email).toLowerCase(),
    tool: TOOLS[body.tool] ? body.tool : '',
    page: clean(body.page, MAX.page),
  };
  if (!EMAIL.test(lead.email)) return { error: 'Please enter a valid email address.' };
  if (!lead.tool) return { error: 'Unknown tool.' };
  return { lead };
}

export function splitName(full) {
  const parts = full.split(' ');
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] };
}

/* Best-effort burst limit, per isolate. It stops a script hammering one edge
   location; it is not a quota. The honeypot and the origin check do the rest. */
const RATE = { windowMs: 10 * 60 * 1000, max: 8 };
const hits = new Map();
export function rateLimited(ip, now = Date.now()) {
  if (!ip) return false;
  const recent = (hits.get(ip) || []).filter((t) => now - t < RATE.windowMs);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();   // never let the map grow without bound
  return recent.length > RATE.max;
}
export function _resetRate() { hits.clear(); }

async function lc(env, method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: {
      Authorization: 'Bearer ' + env.LC_TOKEN,
      Version: env.LC_API_VERSION || 'v3',
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (e) { /* non-JSON error page */ }
  if (!res.ok) {
    // Status and path only: the response can echo the contact's details back.
    const err = new Error(`LeadConnector ${method} ${path.split('?')[0]} -> ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return json || {};
}

export async function fileLead(env, lead) {
  const { firstName, lastName } = splitName(lead.name);
  // 1. Contact. Upsert matches on the location's duplicate rule (email/phone), so a
  //    returning visitor updates their contact instead of creating a second one.
  //    Tags are NOT sent here: on upsert they REPLACE the contact's existing tags.
  const contactBody = {
    locationId: env.LC_LOCATION_ID,
    firstName, lastName, name: lead.name,
    email: lead.email,
    source: SOURCE,
  };
  if (lead.phone) contactBody.phone = lead.phone;
  if (lead.company) contactBody.companyName = lead.company;
  const up = await lc(env, 'POST', '/contacts/upsert', contactBody);
  const contactId = up.contact && up.contact.id;
  if (!contactId) throw new Error('LeadConnector upsert returned no contact id');

  // 2. Tags, added (merged) rather than set. The program travels as a tag so it can
  //    drive LeadConnector workflows and filters without a custom field to set up.
  const tags = ['calculator-lead', 'tool-' + TOOLS[lead.tool]];
  if (lead.program) tags.push('interest-' + lead.program);
  await lc(env, 'POST', `/contacts/${encodeURIComponent(contactId)}/tags`, { tags });

  // 3. Opportunity, unless this contact already has an open one in the pipeline -
  //    a visitor who clears cookies and fills the form again is one lead, not two.
  const q = new URLSearchParams({
    locationId: env.LC_LOCATION_ID, pipelineId: env.LC_PIPELINE_ID,
    contactId, status: 'open', limit: '1',
  });
  const found = await lc(env, 'GET', '/opportunities/search?' + q);
  if (found.opportunities && found.opportunities.length) {
    return { contactId, newContact: !!up.new, opportunityId: found.opportunities[0].id, newOpportunity: false };
  }
  const opp = {
    pipelineId: env.LC_PIPELINE_ID,
    locationId: env.LC_LOCATION_ID,
    name: (lead.program ? PROGRAMS[lead.program] : 'Calculator lead') + ' — ' + lead.name,
    status: 'open',
    contactId,
  };
  if (env.LC_STAGE_ID) opp.pipelineStageId = env.LC_STAGE_ID;
  const made = await lc(env, 'POST', '/opportunities/', opp);
  return { contactId, newContact: !!up.new, opportunityId: made.opportunity && made.opportunity.id, newOpportunity: true };
}

/* Returning visitor: unlock only if LeadConnector already has a contact with this
   email. Nothing is created, so a mistyped or unknown email adds no empty contact;
   the visitor is sent to the full form instead. Needs the token's contacts.readonly
   scope (GET /contacts/search/duplicate, checked against the docs 2026-10-16).
   Returns { found: false } or { found: true, contactId }. */
export async function findReturning(env, lead) {
  const q = new URLSearchParams({ locationId: env.LC_LOCATION_ID, email: lead.email });
  const r = await lc(env, 'GET', '/contacts/search/duplicate?' + q);
  const c = r && r.contact;
  // Only an exact email match counts: the duplicate rule may also match on phone
  if (!c || !c.id || String(c.email || '').toLowerCase() !== lead.email) {
    // Shape only, never values: shows whether LeadConnector answered with no match or another format
    console.log('returning no match: reply keys=' + Object.keys(r || {}).join(',') + ' contactKeys=' + (c ? Object.keys(c).join(',') : '-'));
    return { found: false };
  }
  // Mark the extra tool on the contact (merged, never replacing its tags)
  await lc(env, 'POST', `/contacts/${encodeURIComponent(c.id)}/tags`, { tags: ['calculator-lead', 'tool-' + TOOLS[lead.tool]] });
  return { found: true, contactId: c.id };
}

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}
function json(status, obj, origin) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(origin ? cors(origin) : {}) },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    if (url.pathname !== '/lead') return json(404, { error: 'not found' });
    if (!originAllowed(origin)) return json(403, { error: 'forbidden origin' });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
    if (request.method !== 'POST') return json(405, { error: 'method not allowed' }, origin);

    if (rateLimited(request.headers.get('CF-Connecting-IP'))) {
      return json(429, { error: 'Too many tries. Please wait a few minutes and try again.' }, origin);
    }
    let body;
    try {
      const raw = await request.text();
      if (raw.length > 4096) return json(413, { error: 'Too large.' }, origin);
      body = JSON.parse(raw);
    } catch (e) {
      return json(400, { error: 'Please fill in the form.' }, origin);
    }
    // Honeypot: a field people never see. Bots fill it; pretend it worked.
    if (body && typeof body.website === 'string' && body.website.trim()) return json(200, { ok: true }, origin);

    const returning = !!(body && body.returning === true);
    const { lead, error } = returning ? validateReturning(body) : validate(body);
    if (error) return json(400, { error }, origin);
    if (!env.LC_TOKEN || !env.LC_LOCATION_ID || !env.LC_PIPELINE_ID) {
      console.error('bopaero-leads: LeadConnector is not configured');
      return json(503, { error: 'unavailable' }, origin);
    }
    if (returning) {
      try {
        const r = await findReturning(env, lead);
        console.log(`returning tool=${lead.tool} found=${r.found}`);
        if (!r.found) return json(404, { found: false, error: 'We don’t have that email yet. Please fill in the form.' }, origin);
        return json(200, { ok: true }, origin);
      } catch (e) {
        // e.g. 401/403 until the token has contacts.readonly: the visitor uses the full form
        console.error('bopaero-leads: returning lookup ' + e.message);
        return json(502, { error: 'unavailable' }, origin);
      }
    }
    try {
      const r = await fileLead(env, lead);
      console.log(`lead filed tool=${lead.tool} program=${lead.program || '-'} newContact=${r.newContact} newOpportunity=${r.newOpportunity}`);
      return json(200, { ok: true }, origin);
    } catch (e) {
      console.error('bopaero-leads: ' + e.message);
      return json(502, { error: 'unavailable' }, origin);
    }
  },
};
