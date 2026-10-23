// Eight ORIGINAL fictional fighters, one per archetype family, for tests/demos/calibration. No real people.

import { RATINGS } from '../core/taxonomy.js';

function fighter(id, name, meta, base, over) {
  const ratings = {};
  for (const r of RATINGS) ratings[r] = base;
  Object.assign(ratings, over);
  return { id, name, ...meta, ratings };
}

export const DEFAULT_FIGHTERS = [
  fighter('f_striker', 'Striker Prime', { stance: 'orthodox', style: 'kickboxer', tendency: 'striking_purist', difficulty: 'pro',
    physique: { heightCm: 182, reachCm: 188, weightKg: 77 }, skills: ['vicious_kicks', 'marathoner'] }, 60,
    { punchspeed: 78, kickspeed: 76, movement: 76, lefthandpower: 66, righthandpower: 70, leftlegpower: 70, rightlegpower: 76, blocking: 64, stamina: 70, takedown: 40, takedowndefense: 62, clinchcontrol: 50, groundcontrol: 45, groundpassing: 42, chokesubmission: 38, jointsubmission: 38, chokedefense: 52, jointdefense: 52 }),
  fighter('f_brawler', 'Brawler Prime', { stance: 'southpaw', style: 'boxer', tendency: 'brawler', difficulty: 'pro', handsDown: true,
    physique: { heightCm: 185, reachCm: 185, weightKg: 84 }, skills: ['heavy_handed', 'crushing_blows'] }, 58,
    { lefthandpower: 90, righthandpower: 86, punchspeed: 66, kickspeed: 48, leftlegpower: 52, rightlegpower: 52, chinhealth: 82, toughness: 80, blocking: 48, movement: 52, stamina: 60, takedown: 40, takedowndefense: 50, clinchcontrol: 56, groundcontrol: 46, groundpassing: 40, chokesubmission: 36, jointsubmission: 36 }),
  fighter('f_grappler', 'Grappler Prime', { stance: 'orthodox', style: 'jiu_jutsu', tendency: 'bjj_fighter', difficulty: 'pro',
    physique: { heightCm: 178, reachCm: 180, weightKg: 77 }, skills: ['scrambler', 'iron_clinch'] }, 56,
    { takedown: 82, clinchcontrol: 76, groundcontrol: 88, groundpassing: 86, chokesubmission: 90, jointsubmission: 86, chokedefense: 80, jointdefense: 80, takedowndefense: 70, stamina: 72, lefthandpower: 46, righthandpower: 46, punchspeed: 50, kickspeed: 44, blocking: 52, movement: 54 }),
  fighter('f_counter', 'Counter Prime', { stance: 'orthodox', style: 'karate', tendency: 'chess_master', difficulty: 'pro',
    physique: { heightCm: 183, reachCm: 186, weightKg: 77 }, skills: ['weathering_storms'] }, 58,
    { movement: 88, blocking: 80, punchspeed: 74, kickspeed: 72, lefthandpower: 56, righthandpower: 58, leftlegpower: 60, rightlegpower: 64, stamina: 74, takedowndefense: 74, chinhealth: 66, toughness: 66 }),
  fighter('f_wrestler', 'Wrestler Prime', { stance: 'orthodox', style: 'freestyle_wrestler', tendency: 'rounded_clincher', difficulty: 'pro',
    physique: { heightCm: 177, reachCm: 178, weightKg: 77 }, skills: ['attacking_the_base', 'iron_clinch'] }, 56,
    { takedown: 90, takedowndefense: 84, clinchcontrol: 86, clinchthrows: 80, groundcontrol: 82, groundpassing: 76, stamina: 82, lefthandpower: 60, righthandpower: 62, punchspeed: 52, kickspeed: 40, chokesubmission: 52, jointsubmission: 52, chinhealth: 70, toughness: 74 }),
  fighter('f_thai', 'Thai Prime', { stance: 'southpaw', style: 'muay_thai', tendency: 'thai_clincher', difficulty: 'pro',
    physique: { heightCm: 179, reachCm: 182, weightKg: 77 }, skills: ['vicious_kicks', 'weathering_storms'] }, 57,
    { clinchcontrol: 84, clinchpassing: 72, leftlegpower: 82, rightlegpower: 84, kickspeed: 70, punchspeed: 62, blocking: 72, toughness: 78, bodyhealth: 76, leghealth: 74, stamina: 72, takedown: 44, takedowndefense: 66, groundcontrol: 50, chokesubmission: 40, jointsubmission: 40 }),
  fighter('f_judoka', 'Judoka Prime', { stance: 'orthodox', style: 'judo', tendency: 'dominance_specialist', difficulty: 'pro',
    physique: { heightCm: 180, reachCm: 181, weightKg: 77 }, skills: ['scrambler'] }, 56,
    { clinchcontrol: 80, clinchthrows: 90, takedown: 80, groundcontrol: 84, groundpassing: 78, chokesubmission: 74, jointsubmission: 70, stamina: 70, lefthandpower: 50, righthandpower: 52, punchspeed: 52, blocking: 58 }),
  fighter('f_dirty', 'Dirty Prime', { stance: 'orthodox', style: 'boxer', tendency: 'dirty_boxer', difficulty: 'pro',
    physique: { heightCm: 181, reachCm: 183, weightKg: 77 }, skills: ['heavy_handed', 'survivalist'] }, 58,
    { punchspeed: 72, lefthandpower: 76, righthandpower: 74, clinchcontrol: 70, blocking: 66, toughness: 72, chinhealth: 70, stamina: 66, takedown: 52, takedowndefense: 60, kickspeed: 50, leftlegpower: 52, rightlegpower: 52 }),
];
