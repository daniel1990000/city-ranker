// Original starter move book (stand-up, clinch, ground). Frame numbers are 60 Hz ticks. All values are ours ([REC]).
// Compact builder → full schema objects (docs/18).

const into = {
  jab:      ['cross', 'hook', 'uppercut', 'legkick', 'bodykick', 'overhand', 'jab'],
  cross:    ['hook', 'uppercut', 'legkick', 'headkick', 'bodykick', 'jab'],
  hook:     ['cross', 'hook', 'uppercut', 'legkick', 'headkick', 'bodykick', 'jab'],
  uppercut: ['cross', 'hook', 'legkick', 'jab'],
  overhand: ['jab', 'legkick'],
  legkick:  ['cross', 'jab', 'hook', 'headkick'],
  bodykick: ['cross', 'hook', 'jab'],
  headkick: ['cross', 'hook'],
  teep:     ['cross', 'jab', 'legkick'],
  knee:     ['hook', 'cross'],
  elbow:    ['hook', 'cross', 'knee'],
};

function mv(o) {
  const total = o.f[0] + o.f[1] + o.f[2];
  const tag = o.tags[0];
  return {
    id: o.id, label: o.label, mode: o.mode ?? 'standup', limb: o.limb, side: o.side, slot: o.slot ?? 'basic', target: o.target,
    type: o.type, kind: o.kind ?? o.limb, contact: o.contact ?? (o.limb === 'punch' ? 'fist' : 'foot_shin'), power: o.power,
    frames: { startup: o.f[0], active: o.f[1], recovery: o.f[2] },
    reach: o.reach, ...(o.minReach ? { minReach: o.minReach } : {}), wedgeDeg: o.wedge ?? 24, advance: o.adv ?? 0,
    damage: { base: o.dmg[0], range: o.dmg[1] }, stamina: o.st, eventMult: o.ev ?? 1, critChance: o.crit ?? 0.03,
    blockHeight: o.target === 'leg' ? 'low' : 'high', tags: o.tags,
    // a move may be cancelled into the next one only once it has had its active frames (so it can still land), early in recovery
    cancel: { out: o.cancel ?? [[o.f[0] + o.f[1], Math.min(total, o.f[0] + o.f[1] + Math.floor(o.f[2] * 0.55))]], into: into[tag] ?? [] },
  };
}

export function buildDefaultMoves() {
  const M = [];
  const P = (o) => M.push(mv({ limb: 'punch', ...o }));
  const K = (o) => M.push(mv({ limb: 'kick', ...o }));

  // ---- punches ----
  P({ id: 'lead_jab_head', label: 'Jab', side: 'lead', target: 'head', type: 'straight', power: 'light', f: [5, 2, 9], reach: 1.05, wedge: 22, dmg: [3.4, 1.2], st: 1.6, ev: 0.7, crit: 0.02, tags: ['jab', 'punch'] });
  P({ id: 'lead_jab_body', label: 'Body jab', side: 'lead', target: 'body', type: 'straight', power: 'light', f: [6, 2, 10], reach: 1.0, wedge: 22, dmg: [3.0, 1.0], st: 1.7, ev: 0.7, crit: 0, tags: ['jab', 'punch', 'body'] });
  P({ id: 'back_cross_head', label: 'Cross', side: 'back', target: 'head', type: 'straight', power: 'medium', f: [8, 3, 14], reach: 1.1, wedge: 22, dmg: [6.8, 2.2], st: 3.0, ev: 1.0, crit: 0.04, tags: ['cross', 'punch'] });
  P({ id: 'back_cross_body', label: 'Body cross', side: 'back', target: 'body', type: 'straight', power: 'medium', f: [9, 3, 15], reach: 1.05, wedge: 22, dmg: [6.0, 2.0], st: 3.0, ev: 1.0, crit: 0, tags: ['cross', 'punch', 'body'] });
  P({ id: 'lead_hook_head', label: 'Lead hook', side: 'lead', slot: 'tech', target: 'head', type: 'hook', power: 'medium', f: [10, 3, 18], reach: 0.95, wedge: 30, dmg: [7.4, 2.4], st: 3.4, ev: 1.1, crit: 0.05, tags: ['hook', 'punch'] });
  P({ id: 'lead_hook_body', label: 'Lead body hook', side: 'lead', slot: 'tech', target: 'body', type: 'hook', power: 'medium', f: [11, 3, 19], reach: 0.95, wedge: 30, dmg: [7.0, 2.2], st: 3.4, ev: 1.2, crit: 0, tags: ['hook', 'punch', 'body'] });
  P({ id: 'back_overhand_head', label: 'Overhand', side: 'back', slot: 'tech', target: 'head', type: 'overhand', power: 'heavy', f: [13, 3, 24], reach: 1.05, wedge: 28, dmg: [10.5, 3.0], st: 4.8, ev: 1.3, crit: 0.07, tags: ['overhand', 'punch'] });
  P({ id: 'back_hook_body', label: 'Rear body hook', side: 'back', slot: 'tech', target: 'body', type: 'hook', power: 'heavy', f: [12, 3, 22], reach: 0.95, wedge: 30, dmg: [9.2, 2.6], st: 4.4, ev: 1.3, crit: 0, tags: ['hook', 'punch', 'body'] });
  P({ id: 'lead_uppercut_head', label: 'Uppercut', side: 'lead', slot: 'sig', target: 'head', type: 'uppercut', power: 'medium', f: [9, 3, 17], reach: 0.8, wedge: 26, dmg: [7.6, 2.4], st: 3.4, ev: 1.15, crit: 0.05, tags: ['uppercut', 'punch'] });
  P({ id: 'back_uppercut_body', label: 'Rear uppercut', side: 'back', slot: 'sig', target: 'body', type: 'uppercut', power: 'medium', f: [10, 3, 18], reach: 0.8, wedge: 26, dmg: [7.0, 2.2], st: 3.6, ev: 1.2, crit: 0, tags: ['uppercut', 'punch', 'body'] });
  P({ id: 'back_superman_head', label: 'Superman punch', side: 'back', slot: 'sig', target: 'head', type: 'superman', power: 'heavy', f: [15, 3, 26], reach: 1.55, wedge: 20, adv: 0.5, dmg: [10.8, 3.0], st: 5.6, ev: 1.3, crit: 0.08, tags: ['cross', 'punch', 'flashy'] });
  P({ id: 'lead_jab_lunge', label: 'Lunging jab', side: 'lead', slot: 'fwd', target: 'head', type: 'straight', power: 'light', f: [7, 2, 12], reach: 1.4, wedge: 20, adv: 0.35, dmg: [3.8, 1.2], st: 2.2, ev: 0.8, crit: 0.02, tags: ['jab', 'punch'] });
  P({ id: 'back_cross_lunge', label: 'Lunging cross', side: 'back', slot: 'fwd', target: 'head', type: 'straight', power: 'medium', f: [10, 3, 17], reach: 1.5, wedge: 20, adv: 0.45, dmg: [7.0, 2.2], st: 3.4, ev: 1.0, crit: 0.04, tags: ['cross', 'punch'] });
  P({ id: 'back_elbow_head', label: 'Elbow', side: 'back', slot: 'tech', target: 'head', type: 'elbow', kind: 'elbow', contact: 'elbow', power: 'medium', f: [9, 3, 17], reach: 0.72, wedge: 30, dmg: [7.8, 2.4], st: 3.2, ev: 1.2, crit: 0.07, tags: ['elbow', 'punch'] });

  // ---- kicks & knees ----
  K({ id: 'lead_legkick_leg', label: 'Lead leg kick', side: 'lead', target: 'leg', type: 'leg_kick', power: 'medium', f: [11, 4, 22], reach: 1.35, wedge: 24, dmg: [7.0, 2.0], st: 3.8, ev: 1.0, crit: 0, tags: ['legkick', 'kick'] });
  K({ id: 'back_legkick_leg', label: 'Rear leg kick', side: 'back', target: 'leg', type: 'leg_kick', power: 'heavy', f: [13, 4, 26], reach: 1.4, wedge: 24, dmg: [9.8, 2.8], st: 4.8, ev: 1.2, crit: 0, tags: ['legkick', 'kick'] });
  K({ id: 'back_kick_body', label: 'Body kick', side: 'back', target: 'body', type: 'roundhouse', power: 'heavy', f: [14, 4, 28], reach: 1.4, wedge: 26, dmg: [9.8, 2.8], st: 5.0, ev: 1.3, crit: 0, tags: ['bodykick', 'kick'] });
  K({ id: 'back_kick_head', label: 'Head kick', side: 'back', target: 'head', type: 'roundhouse', power: 'heavy', f: [17, 4, 34], reach: 1.5, wedge: 24, dmg: [12.5, 3.4], st: 5.8, ev: 1.6, crit: 0.09, tags: ['headkick', 'kick'] });
  K({ id: 'lead_teep_body', label: 'Teep', side: 'lead', target: 'body', type: 'teep', power: 'light', f: [10, 3, 20], reach: 1.4, wedge: 20, dmg: [3.8, 1.2], st: 2.6, ev: 0.8, crit: 0, tags: ['teep', 'kick', 'bodykick'] });
  K({ id: 'lead_front_head', label: 'Front kick', side: 'lead', target: 'head', type: 'front_kick', power: 'medium', f: [12, 3, 24], reach: 1.5, wedge: 18, dmg: [6.8, 2.0], st: 3.8, ev: 1.1, crit: 0.05, tags: ['headkick', 'kick'] });
  K({ id: 'lead_side_body', label: 'Side kick', side: 'lead', slot: 'tech', target: 'body', type: 'side_kick', power: 'medium', f: [12, 3, 22], reach: 1.45, wedge: 18, dmg: [6.4, 2.0], st: 3.8, ev: 1.0, crit: 0, tags: ['bodykick', 'kick'] });
  K({ id: 'back_spinheel_head', label: 'Spinning heel kick', side: 'back', slot: 'sig', target: 'head', type: 'spinning_heel_kick', power: 'heavy', f: [20, 4, 40], reach: 1.55, wedge: 22, dmg: [13.5, 3.6], st: 7.0, ev: 1.8, crit: 0.12, tags: ['headkick', 'kick', 'flashy'] });
  K({ id: 'back_knee_body', label: 'Lunging knee', side: 'back', slot: 'fwd', target: 'body', type: 'knee', kind: 'knee', contact: 'knee', power: 'medium', f: [11, 3, 20], reach: 1.0, adv: 0.4, wedge: 24, dmg: [7.4, 2.2], st: 4.0, ev: 1.1, crit: 0.03, tags: ['knee', 'kick'] });
  K({ id: 'back_knee_head', label: 'Flying knee', side: 'back', slot: 'sig', target: 'head', type: 'flying_knee', kind: 'knee', contact: 'knee', power: 'heavy', f: [16, 3, 32], reach: 1.5, adv: 0.7, wedge: 20, dmg: [12.0, 3.2], st: 6.4, ev: 1.6, crit: 0.1, tags: ['knee', 'kick', 'flashy'] });

  // ---- clinch strikes ----
  const C = (o) => M.push(mv({ mode: 'clinch', slot: 'basic', side: 'back', reach: 0.9, wedge: 60, ...o }));
  C({ id: 'clinch_knee_body', label: 'Clinch knee (body)', limb: 'kick', target: 'body', type: 'knee', kind: 'knee', contact: 'knee', power: 'medium', f: [8, 3, 14], dmg: [6.0, 2.0], st: 2.8, ev: 1.0, tags: ['knee'] });
  C({ id: 'clinch_knee_head', label: 'Clinch knee (head)', limb: 'kick', target: 'head', type: 'knee', kind: 'knee', contact: 'knee', power: 'heavy', f: [10, 3, 18], dmg: [9.0, 2.6], st: 3.6, ev: 1.4, crit: 0.06, tags: ['knee'] });
  C({ id: 'clinch_elbow_head', label: 'Clinch elbow', limb: 'punch', target: 'head', type: 'elbow', kind: 'elbow', contact: 'elbow', power: 'medium', f: [7, 3, 14], dmg: [7.2, 2.2], st: 2.8, ev: 1.2, crit: 0.08, tags: ['elbow'] });
  C({ id: 'clinch_uppercut_head', label: 'Clinch uppercut', limb: 'punch', target: 'head', type: 'uppercut', power: 'medium', f: [8, 3, 14], dmg: [6.8, 2.0], st: 2.8, ev: 1.1, crit: 0.05, tags: ['uppercut'] });
  C({ id: 'clinch_hook_head', label: 'Clinch hook', limb: 'punch', target: 'head', type: 'hook', power: 'medium', f: [8, 3, 14], dmg: [6.4, 2.0], st: 2.6, ev: 1.0, crit: 0.04, tags: ['hook'] });
  C({ id: 'clinch_shoulder_body', label: 'Shoulder strike', limb: 'punch', target: 'body', type: 'shoulder', kind: 'shoulder', contact: 'shoulder', power: 'light', f: [6, 2, 12], dmg: [3.6, 1.2], st: 1.8, ev: 0.7, tags: ['shoulder'] });
  C({ id: 'clinch_stomp_leg', label: 'Foot stomp', limb: 'kick', target: 'leg', type: 'stomp', kind: 'stomp', contact: 'foot_shin', power: 'light', f: [6, 2, 12], dmg: [3.2, 1.0], st: 1.8, ev: 0.6, tags: ['stomp'] });

  // ---- ground strikes (GnP) ----
  const G = (o) => M.push(mv({ mode: 'ground', slot: 'basic', side: 'back', reach: 0.9, wedge: 180, ...o }));
  G({ id: 'ground_hammer_head', label: 'Hammerfist', limb: 'punch', target: 'head', type: 'hammer', kind: 'hammer', power: 'medium', f: [7, 3, 12], dmg: [6.4, 2.0], st: 2.5, ev: 1.0, crit: 0.05, tags: ['hammer'] });
  G({ id: 'ground_straight_head', label: 'Ground straight', limb: 'punch', target: 'head', type: 'straight', kind: 'straight', power: 'medium', f: [7, 3, 12], dmg: [6.0, 2.0], st: 2.5, ev: 1.0, crit: 0.04, tags: ['straight'] });
  G({ id: 'ground_hook_head', label: 'Ground hook', limb: 'punch', target: 'head', type: 'hook', kind: 'hook', power: 'medium', f: [8, 3, 13], dmg: [6.6, 2.0], st: 2.6, ev: 1.05, crit: 0.05, tags: ['hook'] });
  G({ id: 'ground_elbow_head', label: 'Ground elbow', limb: 'punch', target: 'head', type: 'elbow', kind: 'elbow', contact: 'elbow', power: 'heavy', f: [8, 3, 14], dmg: [8.4, 2.4], st: 3.0, ev: 1.3, crit: 0.1, tags: ['elbow'] });
  G({ id: 'ground_knee_body', label: 'Ground knee', limb: 'kick', target: 'body', type: 'knee', kind: 'knee', contact: 'knee', power: 'medium', f: [9, 3, 15], dmg: [6.4, 2.0], st: 3.0, ev: 1.1, tags: ['knee'] });
  G({ id: 'ground_body_punch', label: 'Body punch', limb: 'punch', target: 'body', type: 'straight', kind: 'straight', power: 'light', f: [7, 3, 12], dmg: [4.4, 1.4], st: 2.2, ev: 0.9, tags: ['straight'] });
  return M;
}
