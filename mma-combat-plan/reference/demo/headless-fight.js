// Run one bot-vs-bot fight with play-by-play, round scores, stats and stories.
//   node demo/headless-fight.js [--seed 7] [--a f_striker] [--b f_grappler] [--rounds 3] [--quiet] [--replay out.json]
// Fighters: any id from src/data/default-fighters.js. Uses only the public API (src/index.js).

import { writeFileSync } from 'node:fs';
import { FightSim, DEFAULT_FIGHTERS, StoryEngine, playReplay } from '../src/index.js';

function parse(argv) {
  const o = { seed: 7, a: 'f_striker', b: 'f_grappler', rounds: 3, quiet: false, replay: null };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--quiet') o.quiet = true;
    else if (k === '--replay') o.replay = argv[++i];
    else if (k.startsWith('--')) o[k.slice(2)] = Number.isNaN(+argv[i + 1]) ? argv[++i] : +argv[++i];
  }
  return o;
}

const roundStart = new Map();                         // tick at which each round began (the official clock also pauses for knockdowns; this one does not)
const clock = (e) => {
  if (e.type === 'round_start') roundStart.set(e.round, e.tick);
  const s = Math.floor((e.tick - (roundStart.get(e.round) ?? 0)) / 60);
  return `R${e.round} ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function describe(e, name) {
  const n = (id) => name(id);
  switch (e.type) {
    case 'round_start': return `— Round ${e.round} —`;
    case 'round_end': return `— end of round ${e.round} —`;
    case 'strike': {
      if (e.outcome === 'hit' && (e.tier === 'heavy' || e.crit)) return `${n(e.attacker)} lands a ${e.crit ? 'CLEAN ' : ''}${e.kind} to the ${e.target} (${e.mode})`;
      if (e.outcome === 'parried') return `${n(e.defender)} parries ${n(e.attacker)}`;
      if (e.outcome === 'caught') return `${n(e.defender)} catches the kick`;
      return null;
    }
    case 'health_event': return ['wobbled_shot', 'limping'].includes(e.event) && !process.env.ALL ? null : `${n(e.fighter)}: ${e.event.replace('_', ' ')}${e.region ? ` (${e.region})` : ''}`;
    case 'knockdown': return `KNOCKDOWN — ${n(e.fighter)} is down!`;
    case 'injury': return e.stage === 'cut' || e.stage === 'worse' || e.stage === 'critical' ? `${n(e.fighter)} is cut (${e.region})` : null;
    case 'clinch_start': return `${n(e.dom)} takes the ${e.position.replace('_', '-')} clinch`;
    case 'takedown': return e.phase === 'result' ? (e.result === 'success' ? `${n(e.attacker)} lands a takedown (${e.move}) → ${e.position}` : `${n(e.defender)} defends the takedown (${e.denial})`) : null;
    case 'ground_position': return e.reason === 'pass' || e.reason === 'sweep' || e.reason === 'reverse' ? `${n(e.top)} ${e.reason === 'pass' ? 'improves to' : 'sweeps into'} ${e.to}` : null;
    case 'submission': return ['stage', 'escape', 'tap', 'ko', 'injury'].includes(e.result) && (e.result !== 'stage' || e.stage >= 3 || e.stage === 2) ? `${n(e.attacker)} ${e.name.replace(/_/g, ' ')} — ${e.result}${e.result === 'stage' ? ` ${e.stage}/5` : ''}` : null;
    case 'referee': return e.kind === 'break' || e.kind === 'stand_up' ? `Referee: ${e.kind.replace('_', ' ')} (${e.mode})` : null;
    case 'stoppage': return `STOPPAGE — ${e.kind.toUpperCase()}${e.winner ? `: ${n(e.winner)} wins by ${e.how.replace(/_/g, ' ')}` : ' (no contest)'}`;
    case 'decision': return `Decision: ${e.result.replace(/_/g, ' ')}${e.winner ? ` — ${n(e.winner)}` : ''}`;
    default: return null;
  }
}

function main() {
  const o = parse(process.argv.slice(2));
  const fa = DEFAULT_FIGHTERS.find((f) => f.id === o.a), fb = DEFAULT_FIGHTERS.find((f) => f.id === o.b);
  if (!fa || !fb) { console.error(`unknown fighter; choose from ${DEFAULT_FIGHTERS.map((f) => f.id).join(', ')}`); process.exit(1); }
  const sim = new FightSim({ seed: o.seed, rounds: o.rounds, fighters: [fa, fb], record: true, replay: !!o.replay, debug: true });
  const t0 = performance.now();
  const result = sim.run();
  const ms = performance.now() - t0;
  const w = sim.world, name = (id) => w.byId(id)?.name ?? id;
  console.log(`\n${fa.name} (${fa.style}/${fa.tendency})  vs  ${fb.name} (${fb.style}/${fb.tendency})   seed ${o.seed}\n`);
  if (!o.quiet) for (const e of w.bus.log) { const line = describe(e, name); if (line) console.log(`  ${clock(e).padEnd(8)} ${line}`); }

  const st = w.stats, [A, B] = w.fighters;
  console.log(`\nResult: ${result.result.toUpperCase().replace(/_/g, ' ')}${result.winner ? ` — ${name(result.winner)}` : ''} (${result.method}) in round ${result.round}, ${Math.floor(result.clock / 3600)}:${String(Math.floor((result.clock % 3600) / 60)).padStart(2, '0')}`);
  if (result.cards) for (const c of result.cards) console.log(`  judge ${c.judge} (${c.bias}): ${c.rounds.map((r) => `${r.a}-${r.b}`).join(' ')}  = ${c.a}-${c.b}`);
  const row = (label, k) => console.log(`  ${label.padEnd(22)} ${String(st.get(A.id, k)).padStart(8)} ${String(st.get(B.id, k)).padStart(8)}`);
  console.log(`\n  ${''.padEnd(22)} ${A.name.split(' ')[0].padStart(8)} ${B.name.split(' ')[0].padStart(8)}`);
  for (const [l, k] of [['strikes thrown', 'strikes.thrown'], ['strikes landed', 'strikes.landed'], ['significant landed', 'strikes.sig.landed'], ['knockdowns', 'knockdowns.landed'], ['takedowns', 'takedowns.landed'], ['submission attempts', 'subs.attempted']]) row(l, k);
  console.log(`  ${'head health left'.padEnd(22)} ${`${Math.round(A.poolFraction('head') * 100)}%`.padStart(8)} ${`${Math.round(B.poolFraction('head') * 100)}%`.padStart(8)}`);

  const story = new StoryEngine(w);
  console.log('\nStories:');
  for (let r = 1; r <= result.round; r++) for (const s of story.roundStories(r)) console.log(`  R${r}: ${s.text}  [${s.id}]`);
  console.log(`  Post-fight: ${story.postFight(result).text}`);
  if (sim.violations.length) console.log(`\n!! ${sim.violations.length} illegal AI intents`, sim.violations.slice(0, 3));
  console.log(`\n${w.tick} ticks (${(w.tick / 60).toFixed(0)} s of fighting) simulated in ${ms.toFixed(0)} ms = ${(ms * 1000 / w.tick).toFixed(1)} µs/tick`);

  if (o.replay) {
    const data = sim.recorder.export();
    writeFileSync(o.replay, JSON.stringify(data));
    const check = playReplay(JSON.parse(JSON.stringify(data)));
    console.log(`replay written to ${o.replay} (${data.log.length} intent changes, ${data.checkpoints.length} checkpoints); re-simulation ${check.ok ? 'matches' : 'DIVERGES'}`);
  }
}

main();
