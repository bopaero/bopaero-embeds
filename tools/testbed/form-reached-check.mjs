/* form_reached in real headless Chrome: bash tools/testbed/form-reached-check.sh

   Asserts: nothing on load; the footer signup alone never counts; scrolling the
   enquiry form into view counts exactly once, however often it is passed. */
import { launch } from './cdp.mjs';

const BASE = process.env.BASE || 'http://127.0.0.1:8766';
let pass = 0, fail = 0;
const is = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? '  ok   ' : '  FAIL ') + label + (ok ? '' : `\n         got ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`));
};
const count = `window.__bopTelemetry.dump().events.filter(e => e.t === 'form_reached').length`;
const scrollTo = (sel, block) => `document.getElementById('${sel}').scrollIntoView({block:'${block}'})`;

for (const view of [{ name: 'desktop', width: 1280, height: 900 }, { name: 'phone', width: 390, height: 844, mobile: true }]) {
  console.log(`\n${view.name}`);
  const b = await launch(view);
  await b.goto(BASE + '/tools/testbed/form-reached.html', 1500);
  is('nothing counted on load', await b.eval(count), 0);

  await b.eval(scrollTo('signup', 'center')); await b.sleep(1300);
  // jumped straight past the enquiry form to the footer: only the signup is on screen
  is('footer signup does not count', await b.eval(count), 0);

  await b.eval(scrollTo('enquiry', 'start')); await b.sleep(1300);
  is('enquiry form counts', await b.eval(count), 1);

  await b.eval('scrollTo(0,0)'); await b.sleep(1100);
  await b.eval(scrollTo('enquiry', 'center')); await b.sleep(1300);
  is('counted once per visit', await b.eval(count), 1);
  is('no console errors', b.consoleErrors, []);
  await b.close();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
