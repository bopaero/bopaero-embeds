/* End-to-end check of the calculator lead gate in real headless Chrome.

     bash tools/testbed/lead-gate-check.sh        (starts the mock, runs this)

   Asserts: results hidden before the form; required fields enforced; a failed
   send keeps the gate shut and says so; a good send unlocks, shows the result
   and sets the cookie (no personal data in it); a reload skips the form.
   Screenshots land in $OUT (default: a temp dir) - LOOK at them. */
import { launch } from './cdp.mjs';

const BASE = process.env.BASE || 'http://127.0.0.1:8765';
const OUT = process.env.OUT || '/tmp';
let pass = 0, fail = 0;
const is = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? '  ok   ' : '  FAIL ') + label + (ok ? '' : `\n         got ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`));
};

for (const view of [{ name: 'desktop', width: 1280, height: 900 }, { name: 'phone', width: 390, height: 844, mobile: true }]) {
  console.log(`\n${view.name}`);
  const b = await launch(view);
  await b.goto(BASE + '/tools/testbed/lead-gate.html');
  const R = '[data-embed="aircraft-calc"]';
  is('gate shown', await b.eval(`!!document.querySelector('${R} .bop-lead')`), true);
  is('results hidden', await b.eval(`getComputedStyle(document.querySelector('${R} .output-section')).display`), 'none');
  is('program preselected from the page (SF50 G3)', await b.eval(`document.querySelector('${R} .bop-lead select').value`), 'sf50-g3');

  // inputs still usable while locked
  await b.type('#ownership-years', '5');
  await b.type('#hours-per-year', '150');
  await b.sleep(400);
  await b.screenshot(`${OUT}/lead-gate-${view.name}-1-locked.png`, `${R} .calculator`);

  // required fields
  await b.click(`${R} .bop-lead-submit`);
  await b.sleep(200);
  is('name required', await b.eval(`document.querySelector('${R} .bop-lead-error').textContent`), 'Please enter your name.');
  await b.type(`${R} .bop-lead input[name=name]`, 'Jane Pilot');
  await b.type(`${R} .bop-lead input[name=email]`, 'not-an-email');
  await b.click(`${R} .bop-lead-submit`);
  await b.sleep(200);
  is('email checked', await b.eval(`document.querySelector('${R} .bop-lead-error').textContent`), 'Please enter a valid email address.');

  // server failure keeps it locked
  await b.type(`${R} .bop-lead input[name=name]`, 'fail');
  await b.type(`${R} .bop-lead input[name=email]`, 'jane@example.com');
  await b.click(`${R} .bop-lead-submit`);
  await b.sleep(800);
  is('failure: still locked', await b.eval(`document.querySelector('${R} details').classList.contains('lead-locked')`), true);
  is('failure: message shown', await b.eval(`/couldn.t send/.test(document.querySelector('${R} .bop-lead-error').textContent)`), true);
  is('failure: no cookie', await b.eval(`document.cookie.includes('bopaero_lead')`), false);
  await b.screenshot(`${OUT}/lead-gate-${view.name}-2-error.png`, `${R} .bop-lead-panel`);

  // good send
  await b.type(`${R} .bop-lead input[name=name]`, 'Jane Pilot');
  await b.type(`${R} .bop-lead input[name=phone]`, '513-450-2359');
  await b.type(`${R} .bop-lead input[name=company]`, 'Acme Air');
  await b.click(`${R} .bop-lead-submit`);
  await b.sleep(1200);
  is('unlocked', await b.eval(`document.querySelector('${R} details').classList.contains('lead-locked')`), false);
  is('form removed', await b.eval(`!!document.querySelector('${R} .bop-lead')`), false);
  is('result computed', await b.eval(`/\\$[\\d,]+ \\/hr/.test(document.querySelector('#blended-cost-per-hour').innerText)`), true);
  const sent = await (await fetch(BASE + '/mock/leads')).json();
  is('payload sent', (({ name, email, phone, company, program, tool, website }) => ({ name, email, phone, company, program, tool, website }))(sent[sent.length - 1]),
     { name: 'Jane Pilot', email: 'jane@example.com', phone: '513-450-2359', company: 'Acme Air', program: 'sf50-g3', tool: 'aircraft-calc', website: '' });
  const ck = (await b.cookies()).find((c) => c.name === 'bopaero_lead');
  is('cookie set, value 1, 1 year, Lax', ck && [ck.value, ck.sameSite, Math.round((ck.expires * 1000 - Date.now()) / 864e5)], ['1', 'Lax', 365]);
  await b.screenshot(`${OUT}/lead-gate-${view.name}-3-unlocked.png`, `${R} .calculator`);

  // reload: no form
  await b.reload();
  is('reload: no gate', await b.eval(`!!document.querySelector('${R} .bop-lead')`), false);
  is('reload: results visible', await b.eval(`getComputedStyle(document.querySelector('${R} .output-section')).display`) !== 'none', true);
  is('no console errors', b.consoleErrors, []);
  await b.close();
}
console.log(`\n${pass} passed, ${fail} failed   screenshots: ${OUT}/lead-gate-*.png`);
process.exit(fail ? 1 : 0);
