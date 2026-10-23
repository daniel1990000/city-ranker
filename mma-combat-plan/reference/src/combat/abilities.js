// Ability cards (docs/15 §3): cooldown state machine, minigame-result scaling, per-phase counters and the AI's "force goal" hook.
// Names and numbers are ours; the structure (phases, cooldowns, fail/success/perfect, ForceCardGoal) is what the reference exposes.

export const AbilityPhase = Object.freeze({ STANDUP: 'standup', TAKEDOWN: 'takedown', SUBMISSION: 'submission' });
export const MinigameResult = Object.freeze({ NONE: 'none', FAIL: 'fail', SUCCESS: 'success', PERFECT: 'perfect' });
export const RESULT_SCALE = Object.freeze({ fail: 0, success: 1, perfect: 1.5 });

export const ABILITIES = Object.freeze({
  iron_fist: { phase: 'standup', cooldownSecs: 18, minigame: 'golf', effect: { damageScale: 1.5, critBonus: 0.10 }, aiGoal: 'strike', classTags: ['striker'] },
  flurry: { phase: 'standup', cooldownSecs: 22, minigame: 'mash', effect: { damageScale: 1.25, stunBonus: 0.08 }, aiGoal: 'strike', classTags: ['striker'] },
  second_wind: { phase: 'standup', cooldownSecs: 40, minigame: 'none', effect: { staminaRestore: 25 }, aiGoal: null, classTags: ['any'] },
  level_change: { phase: 'takedown', cooldownSecs: 25, minigame: 'snake', effect: { takedownBonus: 0.20 }, aiGoal: 'takedown', classTags: ['wrestler'] },
  iron_grip: { phase: 'submission', cooldownSecs: 30, minigame: 'snipe', effect: { submissionBonus: 0.20 }, aiGoal: 'submission', classTags: ['grappler'] },
});

/** Scale an effect by a minigame result: damageScale scales around 1, everything else linearly. */
export function scaleEffect(effect, scale) {
  const out = {};
  for (const [k, v] of Object.entries(effect)) out[k] = k === 'damageScale' ? 1 + (v - 1) * scale : v * scale;
  return out;
}

/** `ForceCardGoal` equivalent: after an ability is consumed, force the AI toward its goal with probability `procChance`. */
export const forceGoal = ({ consumed, procChance, random }) => !!consumed && random < procChance;

export class AbilityBar {
  /** @param ids ability ids (≤ 4 slots in the reference HUD) @param tickHz sim rate */
  constructor(ids, { tickHz = 60 } = {}) {
    this.tickHz = tickHz;
    this.slots = ids.map((id) => {
      if (!ABILITIES[id]) throw new Error(`unknown ability ${id}`);
      return { id, def: ABILITIES[id], cooldown: 0 };
    });
    this.disabledPhases = new Set();
    this.counters = {};
    for (const p of Object.values(AbilityPhase)) this.counters[p] = { played: 0, landed: 0, damage: 0 };
  }

  tick() { for (const s of this.slots) if (s.cooldown > 0) s.cooldown -= 1; }
  ready(i) { const s = this.slots[i]; return !!s && s.cooldown === 0 && !this.disabledPhases.has(s.def.phase); }
  cooldownFraction(i) { const s = this.slots[i]; return s ? s.cooldown / (s.def.cooldownSecs * this.tickHz) : 0; }

  /** Use slot `i` with the minigame result (`none` for abilities without a minigame counts as success). */
  use(i, result = MinigameResult.SUCCESS) {
    if (!this.ready(i)) return { ok: false, reason: this.slots[i] ? (this.disabledPhases.has(this.slots[i].def.phase) ? 'disabled' : 'cooldown') : 'empty' };
    const s = this.slots[i];
    const r = result === MinigameResult.NONE ? MinigameResult.SUCCESS : result;
    s.cooldown = Math.round(s.def.cooldownSecs * this.tickHz);
    this.counters[s.def.phase].played += 1;
    const scale = RESULT_SCALE[r];
    return { ok: true, id: s.id, phase: s.def.phase, result: r, scale, effect: scaleEffect(s.def.effect, scale), aiGoal: s.def.aiGoal };
  }

  /** Book the outcome of a used ability for the per-phase stats (`Fighter_Card_<Phase>_Actions_{Played,Landed,Damage}`). */
  record(phase, { landed = false, damage = 0 } = {}) {
    const c = this.counters[phase];
    if (landed) c.landed += 1;
    c.damage += damage;
  }
}
