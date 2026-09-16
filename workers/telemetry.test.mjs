/* Runs with: node workers/telemetry.test.mjs
   The endpoint is public, so clean() is the security boundary: anything it lets
   through reaches the database. These cases are the hostile ones, not the happy
   path. */
import { clean } from './telemetry.js';

let pass = 0, fail = 0;
const is = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? '  ok   ' : '  FAIL ') + label + (ok ? '' : `\n         got ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`));
};

// a realistic beacon
const real = clean({ v:1, ctx:{ path:'/sf50-fractional-ownership-program-pilots', view:'phone' },
  events:[ {t:'scroll',d:{pct:25}}, {t:'scroll',d:{pct:50}},
           {t:'click',d:{x:10,y:15,el:'#calculate-cost'}},
           {t:'click',d:{x:10,y:15,el:'#calculate-cost'}},
           {t:'calc_run',d:{years:5,hours:175,shares:3,overCap:false}} ]});
is('counts a visit', real.metrics.get('visits'), 1);
is('scroll milestones', [real.metrics.get('scroll_25'), real.metrics.get('scroll_50')], [1,1]);
is('repeated clicks add up in one bin', real.bins.get('10,15'), 2);
is('control tallied', real.controls.get('#calculate-cost'), 2);
is('calc_run recorded', real.metrics.get('calc_run'), 1);
is('overCap not set when false', real.metrics.get('calc_run_overcap'), undefined);

// hostile / malformed
const bad = clean({ ctx:{ path:'/'.padEnd(500,'x'), view:'<script>' },
  events:[ {t:'scroll',d:{pct:37}},                       // not a milestone
           {t:'click',d:{x:99,y:-4,el:'ok'}},             // out of grid
           {t:'click',d:{x:1.5,y:2,el:'frac'}},           // non-integer
           {t:'DROP TABLE metrics',d:{}},                 // unknown metric
           {t:'click',d:{x:1,y:1,el:'z'.repeat(400)}},    // overlong control
           null, 'nope', {t:'calc_run',d:{overCap:true}} ]});
is('path length capped', bad.path.length, 120);
is('unknown view falls back to desktop', bad.view, 'desktop');
is('non-milestone scroll dropped', bad.metrics.get('scroll_37'), undefined);
is('out-of-grid click dropped', bad.bins.get('99,-4'), undefined);
is('non-integer click dropped', bad.bins.has('1.5,2'), false);
is('unknown event name not stored', [...bad.metrics.keys()].includes('DROP TABLE metrics'), false);
is('control name capped at 48', bad.controls.has('z'.repeat(48)), true);
is('overCap counted when true', bad.metrics.get('calc_run_overcap'), 1);

// bounds
const flood = clean({ ctx:{}, events: Array.from({length:5000}, () => ({t:'click',d:{x:1,y:1,el:'a'}})) });
is('event list bounded to 200', flood.bins.get('1,1'), 200);
is('empty payload still counts one visit', clean({}).metrics.get('visits'), 1);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
