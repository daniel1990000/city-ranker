// Intent legality (docs/13 acceptance #4): the AI must never emit something the sim would have to reject.
// `checkIntent` returns a list of violations (empty = legal). The FightSim can run it in debug mode; tests run it on every tick.

import { Mode } from '../core/taxonomy.js';
import { actionStaminaCost } from '../combat/stamina.js';
import { canStartShot } from '../combat/takedown.js';
import { canAttemptClinch } from '../combat/clinch.js';

export function resolveStrikeMove(world, intent) {
  const s = intent.strike;
  if (!s) return null;
  return s.moveId ? world.moveBook.get(s.moveId) : world.moveBook.select({ mode: 'standup', limb: s.limb, side: s.side, slot: s.slot ?? 'basic', target: s.target, power: s.power });
}

export function checkIntent(world, f, intent) {
  const bad = [];
  const o = world.opp(f);
  const helpless = f.isHelpless();
  if (intent.strike) {
    const move = resolveStrikeMove(world, intent);
    if (f.mode !== Mode.STANDUP) bad.push(`strike in mode ${f.mode}`);
    else if (helpless) bad.push('strike while helpless');
    else if (!move) bad.push('unknown strike');
    else {
      if (f.stamina < actionStaminaCost(f, move.stamina)) bad.push(`strike ${move.id} without stamina`);
      const d = Math.hypot(o.pos.x - f.pos.x, o.pos.y - f.pos.y) - (move.advance ?? 0);
      if (!f.busy() && intent.strike.moveId && d > move.reach * f.reachFactor * 1.05) bad.push(`strike ${move.id} out of range (${d.toFixed(2)})`);
    }
  }
  if (intent.clinch) {
    const c = canAttemptClinch(world, f, o);
    if (!c.ok) bad.push(`clinch not allowed: ${c.reason}`);
    else if (world.gap(f, o) > world.tun.clinch.range) bad.push('clinch out of range');
  }
  if (intent.takedown) {
    const c = canStartShot(world, f, o);
    if (!c.ok) bad.push(`takedown not allowed: ${c.reason}`);
  }
  if (intent.grapple?.kind === 'followUp') {          // the one grapple intent that starts a bout from stand-up: pounce on a downed opponent
    if (f.mode !== Mode.STANDUP || o.mode !== Mode.DOWN || helpless || f.bout) bad.push('follow-up: wrong state');
    else if (world.tick - o.downTick > world.tun.ground.downedFollowUpTicks) bad.push('follow-up: too late');
    else if (world.gap(f, o) > 1.0) bad.push('follow-up: out of range');
  } else if (intent.grapple) {
    const bout = f.bout;
    const kind = intent.grapple.kind;
    if (!bout) bad.push(`grapple ${kind} without a bout`);
    else {
      const legal = bout.legalActions ? bout.legalActions(f) : [];
      const ok = legal.some((a) => a.kind === kind && (intent.grapple.to === undefined || a.to === intent.grapple.to) && (intent.grapple.move === undefined || a.move === intent.grapple.move) && (intent.grapple.name === undefined || a.name === intent.grapple.name));
      if (!ok) bad.push(`illegal grapple ${JSON.stringify(intent.grapple)}`);
    }
  }
  if (helpless && (intent.guard !== 'none' || intent.parry || intent.slip)) { /* the sim ignores these; not a violation */ }
  return bad;
}
