// Story selection (docs/16 §3): narrative generated from statistics. After every round each story generator scores a candidate;
// score = significance × freshness, the top 1–2 are told, and a story id cannot repeat inside its cooldown. The ids are ours
// (the reference has 244 `story_type_*` variants); text is a debug rendering — real games map `id + params` to VO/captions.

const rate = (n, d) => (d > 0 ? n / d : 0);

/** Round-story catalogue. test(c) returns a significance ≥ 1 when the story applies (0 otherwise) and its params. */
export const ROUND_STORIES = [
  { id: 'round_high_accuracy', weight: 1.0, test: (c) => (c.thrown >= 10 && c.accuracy >= 0.55 ? { sig: c.accuracy / 0.55, params: { accuracy: +c.accuracy.toFixed(2), thrown: c.thrown } } : null), text: (n, p) => `${n} connected on ${Math.round(p.accuracy * 100)}% of ${p.thrown} strikes` },
  { id: 'round_kicks_landed', weight: 1.0, test: (c) => (c.kicks >= 5 ? { sig: c.kicks / 5, params: { kicks: c.kicks } } : null), text: (n, p) => `${n} landed ${p.kicks} kicks` },
  { id: 'round_leg_kicks', weight: 1.1, test: (c) => (c.legStrikes >= 4 ? { sig: c.legStrikes / 4, params: { count: c.legStrikes } } : null), text: (n, p) => `${n} chopped at the legs ${p.count} times` },
  { id: 'round_clinch_strikes', weight: 0.9, test: (c) => (c.clinchStrikes >= 6 ? { sig: c.clinchStrikes / 6, params: { count: c.clinchStrikes } } : null), text: (n, p) => `${n} did damage in the clinch (${p.count} strikes)` },
  { id: 'round_counters', weight: 1.1, test: (c) => (c.counters >= 3 ? { sig: c.counters / 3, params: { count: c.counters } } : null), text: (n, p) => `${n} countered ${p.count} times` },
  { id: 'round_defence_good', weight: 1.0, test: (c) => (c.faced >= 10 && c.defence >= 0.7 ? { sig: c.defence / 0.7, params: { rate: +c.defence.toFixed(2) } } : null), text: (n, p) => `${n} defended ${Math.round(p.rate * 100)}% of what came` },
  { id: 'round_defence_bad', weight: 0.8, test: (c) => (c.faced >= 10 && c.defence <= 0.3 ? { sig: 0.3 / Math.max(c.defence, 0.1), params: { rate: +c.defence.toFixed(2) } } : null), text: (n, p) => `${n} defended only ${Math.round(p.rate * 100)}% of what came` },
  { id: 'round_takedowns', weight: 1.2, test: (c) => (c.tdLanded >= 2 ? { sig: c.tdLanded / 2, params: { landed: c.tdLanded, attempted: c.tdAttempted } } : null), text: (n, p) => `${n} landed ${p.landed} of ${p.attempted} takedowns` },
  { id: 'round_takedown_defence', weight: 1.0, test: (c) => (c.tdDenied >= 3 ? { sig: c.tdDenied / 3, params: { denied: c.tdDenied } } : null), text: (n, p) => `${n} stuffed ${p.denied} takedowns` },
  { id: 'round_kept_on_ground', weight: 1.1, test: (c) => (c.groundShare >= 0.5 ? { sig: c.groundShare / 0.5, params: { share: +c.groundShare.toFixed(2) } } : null), text: (n, p) => `${n} kept it on the mat for ${Math.round(p.share * 100)}% of the round` },
  { id: 'round_clinch_control', weight: 0.9, test: (c) => (c.clinchDomSeconds >= 45 ? { sig: c.clinchDomSeconds / 45, params: { seconds: Math.round(c.clinchDomSeconds) } } : null), text: (n, p) => `${n} controlled the clinch for ${p.seconds} seconds` },
  { id: 'round_ground_and_pound', weight: 1.2, test: (c) => (c.gnp >= 8 ? { sig: c.gnp / 8, params: { count: c.gnp } } : null), text: (n, p) => `${n} landed ${p.count} ground strikes` },
  { id: 'round_cut', weight: 1.5, test: (c) => (c.cutStage >= 2 ? { sig: c.cutStage, params: { stage: c.cutStage } } : null), text: (n, p) => `${n}'s opponent is cut (stage ${p.stage})` },
  { id: 'round_swelling', weight: 1.1, test: (c) => (c.swellStage >= 1 && c.cutStage < 2 ? { sig: 1 + c.swellStage * 0.2, params: { stage: c.swellStage } } : null), text: (n) => `swelling is building on ${n}'s opponent` },
  { id: 'round_wobbled', weight: 1.2, test: (c) => (c.eventsInflicted.wobbled_shot + c.eventsInflicted.stun >= 2 ? { sig: (c.eventsInflicted.wobbled_shot + c.eventsInflicted.stun) / 2, params: { count: c.eventsInflicted.wobbled_shot + c.eventsInflicted.stun } } : null), text: (n, p) => `${n} hurt their opponent ${p.count} times` },
  { id: 'round_knockdown', weight: 2.5, test: (c) => (c.knockdownsLanded >= 1 ? { sig: 1 + 0.5 * c.knockdownsLanded, params: { count: c.knockdownsLanded } } : null), text: (n, p) => `${n} scored ${p.count === 1 ? 'a knockdown' : `${p.count} knockdowns`}` },
  { id: 'round_submission_attempts', weight: 1.2, test: (c) => (c.subAttempts >= 2 ? { sig: c.subAttempts / 2, params: { attempts: c.subAttempts } } : null), text: (n, p) => `${n} hunted submissions (${p.attempts} attempts)` },
  { id: 'round_submission_close', weight: 2.0, test: (c) => (c.subDeep >= 1 ? { sig: 1 + c.subDeep / 2, params: { deep: c.subDeep } } : null), text: (n) => `${n} almost finished the submission` },
  { id: 'round_saved_by_bell', weight: 2.2, test: (c) => (c.savedByBell > 0 ? { sig: 2, params: {} } : null), text: (n) => `${n}'s opponent was saved by the bell` },
  { id: 'round_low_action', weight: 0.7, test: (c) => (c.thrown + c.opponentThrown < 14 ? { sig: 1, params: { thrown: c.thrown + c.opponentThrown } } : null), text: () => 'a quiet round', both: true },
];

function context(stats, f, o, round) {
  const g = (x, key) => stats.get(x.id, key, round);
  const thrown = g(f, 'strikes.thrown'), landed = g(f, 'strikes.landed');
  const defended = ['blocked', 'parried', 'slipped', 'caught', 'evaded'].reduce((s, k) => s + g(f, `defense.${k}`), 0);
  const time = ['time.standup', 'time.clinch.dom', 'time.clinch.sub', 'time.ground.top', 'time.ground.bottom', 'time.takedown', 'time.submission.attacker', 'time.submission.defender', 'time.down'].reduce((s, k) => s + g(f, k), 0) || 1;
  const cutStage = Math.max(0, ...['brow', 'cheek', 'eye', 'nose', 'lip', 'jaw'].flatMap((r) => [['swollen', 1], ['cut', 2], ['worse', 3], ['critical', 4]].map(([s, n]) => (g(o, `injury.${r}.${s}`) > 0 && n >= 2 ? n : 0))));
  const swellStage = Math.max(0, ...['brow', 'cheek', 'eye', 'nose', 'lip', 'jaw'].map((r) => (g(o, `injury.${r}.swollen`) > 0 ? 1 : 0)));
  return {
    f, o, thrown, landed, accuracy: rate(landed, thrown), opponentThrown: g(o, 'strikes.thrown'),
    kicks: g(f, 'strikes.landed.kick'), legStrikes: g(f, 'strikes.landed.leg'), clinchStrikes: g(f, 'strikes.landed.clinch'), counters: g(f, 'counters.landed'),
    faced: g(o, 'strikes.thrown'), defence: rate(defended, g(o, 'strikes.thrown')),
    tdLanded: g(f, 'takedowns.landed'), tdAttempted: g(f, 'takedowns.attempted'), tdDenied: g(f, 'takedowns.denied'),
    groundShare: g(f, 'time.ground.top') / time,                 // share of the round spent on top
    clinchDomSeconds: g(f, 'time.clinch.dom') / 60, gnp: g(f, 'strikes.landed.ground'),
    cutStage, swellStage,
    eventsInflicted: { wobbled_shot: g(f, 'events.inflicted.wobbled_shot'), stun: g(f, 'events.inflicted.stun') + g(f, 'events.inflicted.critical_stun') },
    knockdownsLanded: g(f, 'knockdowns.landed'), subAttempts: g(f, 'subs.attempted'), subDeep: g(f, 'subs.deep'), savedByBell: g(o, 'subs.saved_by_bell'),
  };
}

export class StoryEngine {
  constructor(world, { cooldownRounds = 2, perRound = 2 } = {}) {
    this.world = world; this.cooldown = cooldownRounds; this.perRound = perRound;
    this.lastUsed = new Map();            // story id → round
    this.told = [];
  }

  candidates(round) {
    const { world } = this, [a, b] = world.fighters, out = [];
    for (const [f, o] of [[a, b], [b, a]]) {
      const c = context(world.stats, f, o, round);
      for (const s of ROUND_STORIES) {
        const r = s.test(c);
        if (!r) continue;
        if (s.both && f !== a) continue;
        out.push({ id: s.id, fighter: s.both ? null : f.id, params: r.params, significance: r.sig * s.weight, text: s.text(f.name, r.params) });
      }
    }
    return out;
  }

  /** Pick the stories to tell after `round`, honouring cooldowns. Deterministic: ties break on id then fighter id. */
  roundStories(round) {
    const fresh = (id) => { const last = this.lastUsed.get(id); return last === undefined ? 1 : round - last >= this.cooldown ? 1 : 0; };
    const scored = this.candidates(round).map((c) => ({ ...c, score: c.significance * fresh(c.id) })).filter((c) => c.score > 0);
    scored.sort((x, y) => y.score - x.score || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0) || ((x.fighter ?? '') < (y.fighter ?? '') ? -1 : 1));
    const picked = [];
    for (const c of scored) {
      if (picked.length >= this.perRound) break;
      if (picked.some((p) => p.id === c.id)) continue;
      picked.push(c);
    }
    for (const p of picked) { this.lastUsed.set(p.id, round); this.told.push({ round, ...p }); }
    return picked;
  }

  /** Before the cards are read: "unanimous" or "close", with the stat that gave one fighter the edge. */
  preDecision(cards) {
    const { world } = this, [a, b] = world.fighters;
    const verdicts = cards.map((c) => c.verdict);
    const unanimous = verdicts.every((v) => v === verdicts[0]) && verdicts[0] !== 'draw';
    const total = (f, key) => world.stats.get(f.id, key);
    const edges = [
      ['strikes_landed', total(a, 'strikes.landed'), total(b, 'strikes.landed')], ['kicks_landed', total(a, 'strikes.landed.kick'), total(b, 'strikes.landed.kick')],
      ['knockdowns', total(a, 'knockdowns.landed'), total(b, 'knockdowns.landed')], ['takedowns', total(a, 'takedowns.landed'), total(b, 'takedowns.landed')],
      ['submission_attempts', total(a, 'subs.attempted'), total(b, 'subs.attempted')],
    ].map(([k, x, y]) => ({ key: k, leader: x === y ? null : x > y ? a.id : b.id, margin: Math.abs(x - y) / Math.max(5, x + y) }))   // small samples are damped: 1–0 in takedowns is not "the edge"
      .sort((p, q) => q.margin - p.margin);
    const edge = edges[0].leader ? edges[0] : null;
    return { id: unanimous ? 'pre_decision_unanimous' : 'pre_decision_close', edge: edge ? edge.key : null, leader: edge ? edge.leader : null, text: unanimous ? 'the judges saw it one way' : `a close one — the edge in ${edge ? edge.key.replace(/_/g, ' ') : 'nothing'}` };
  }

  /** Post-fight story from the result (docs/16 §3 post-fight family). */
  postFight(result) {
    const winner = result.winner ? this.world.byId(result.winner) : null;
    const name = winner?.name ?? 'nobody';
    const how = result.method ?? '';
    let id;
    if (result.stoppage === 'ko') id = /knee/.test(how) ? 'post_ko_knee' : /kick/.test(how) ? 'post_ko_kick' : /elbow/.test(how) ? 'post_ko_elbow' : 'post_ko_punch';
    else if (result.stoppage === 'submission') id = 'post_submission';
    else if (result.stoppage === 'doctor') id = 'post_doctor_stoppage';
    else if (result.stoppage === 'tko') id = how === 'ground_and_pound' ? 'post_tko_ground_and_pound' : how === 'leg_injury' ? 'post_tko_leg_kicks' : how === 'stunned_and_hurt' ? 'post_tko_after_stun' : 'post_tko_other';
    else id = result.winner ? `post_${result.result}` : 'post_draw';
    return { id, winner: result.winner, method: how, text: `${name}: ${id.replace(/^post_/, '').replace(/_/g, ' ')}` };
  }
}
