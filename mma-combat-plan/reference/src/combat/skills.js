// Skills (perks) as data: {id, label, mods:[{stat, op, value, when?}]} (docs/03 §5).
// Stats queried by the sim: eventProb (attacker), eventResist (defender), damage, staminaCost, clinch, takedown, ground, speed.

const lowHead = (frac) => (ctx) => ctx.self && ctx.self.poolFraction('head') < frac;

export const SKILLS = Object.freeze({
  heavy_handed:   { label: 'Heavy handed',   mods: [{ stat: 'damage', op: 'mul', value: 1.08, when: (c) => c.move?.limb === 'punch' }] },
  vicious_kicks:  { label: 'Vicious kicks',  mods: [{ stat: 'damage', op: 'mul', value: 1.08, when: (c) => c.move?.limb === 'kick' }] },
  crushing_blows: { label: 'Crushing blows', mods: [{ stat: 'eventProb', op: 'mul', value: 1.15 }] },
  marathoner:     { label: 'Marathoner',     mods: [{ stat: 'staminaCost', op: 'mul', value: 0.85 }] },
  iron_clinch:    { label: 'Iron clinch',    mods: [{ stat: 'clinch', op: 'add', value: 8 }] },
  last_stand:     { label: 'Last stand',     mods: [{ stat: 'damage', op: 'mul', value: 1.15, when: lowHead(0.25) }, { stat: 'eventProb', op: 'mul', value: 1.10, when: lowHead(0.25) }] },
  survivalist:    { label: 'Survivalist',    mods: [{ stat: 'eventResist', op: 'mul', value: 0.80, when: lowHead(0.35) }] },
  scrambler:      { label: 'Scrambler',      mods: [{ stat: 'ground', op: 'add', value: 0.06 }] },
  attacking_the_base: { label: 'Attacking the base', mods: [{ stat: 'takedown', op: 'add', value: 6 }] },
  weathering_storms:  { label: 'Weathering storms',  mods: [{ stat: 'eventResist', op: 'mul', value: 0.90 }] },
});

/** Combine all modifiers of `stat` for a fighter. ctx = {self, other, move, ...}. Multiplicative stats start at 1, additive at 0. */
export function skillValue(fighter, stat, ctx = {}) {
  let mul = 1, add = 0;
  const c = { self: fighter, ...ctx };
  for (const id of fighter.skills) {
    const sk = SKILLS[id];
    if (!sk) continue;
    for (const m of sk.mods) {
      if (m.stat !== stat) continue;
      if (m.when && !m.when(c)) continue;
      if (m.op === 'mul') mul *= m.value; else add += m.value;
    }
  }
  return { mul, add };
}

export const skillMul = (fighter, stat, ctx) => skillValue(fighter, stat, ctx).mul;
export const skillAdd = (fighter, stat, ctx) => skillValue(fighter, stat, ctx).add;
