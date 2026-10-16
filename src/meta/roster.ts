// The Cage Kings roster: 48 original fighters, 8 per division (3 common, 3 rare, 1 epic, 1 legend). Every name is
// invented and checked against a deny-list of famous fighters (tests/content-roster.test.ts). Stats come from the
// archetype, the rarity and the division, plus a small seeded variation, so the data stays readable here.

import type { Archetype, DivisionId, FighterSpec, FighterStats, LookHints, Rarity } from '../game/fight/types';

type Skin = NonNullable<LookHints['skin']>;
type Build = NonNullable<LookHints['build']>;

interface Entry {
  first: string;
  last: string;
  nick: string;
  from: string;
  bio: string;
  arch: Archetype;
  rarity: Rarity;
  skin: Skin;
  build: Build;
  beard?: boolean;
  ink?: boolean;
  hair?: string;
}

export interface RosterFighter extends FighterSpec {
  hometown: string;
  bio: string;
}

const E = (first: string, last: string, nick: string, from: string, arch: Archetype, rarity: Rarity, skin: Skin, build: Build, bio: string, extra: Partial<Entry> = {}): Entry => ({
  first, last, nick, from, arch, rarity, skin, build, bio, ...extra,
});

const DATA: Record<DivisionId, Entry[]> = {
  mLight: [
    E('Dante', 'Okafor', 'Wildfire', 'London, England', 'brawler', 'legend', 'dark', 'athletic', 'Never takes a step back. Fourteen of his wins came inside the first round.', { beard: true, ink: true }),
    E('Mateo', 'Lozano', 'Quicksilver', 'Monterrey, Mexico', 'boxer', 'epic', 'tan', 'lean', 'Hands so fast the judges count them twice.'),
    E('Kenji', 'Takeda', 'Silk', 'Osaka, Japan', 'kicker', 'rare', 'light', 'lean', 'Karate black belt at twelve. Kicks from angles nobody sees coming.'),
    E('Luka', 'Dragan', 'Razor', 'Split, Croatia', 'kicker', 'rare', 'light', 'athletic', 'Former kickboxing champion with a left high kick that ends nights.', { ink: true }),
    E('Tariq', 'Haddad', 'The Anchor', 'Amman, Jordan', 'wrestler', 'rare', 'tan', 'athletic', 'Once he has your legs, the fight goes where he wants.', { beard: true }),
    E('Owen', 'Brennan', 'Rook', 'Cork, Ireland', 'boxer', 'common', 'light', 'athletic', 'Amateur boxing stalwart learning the rest of the game fast.'),
    E('Kofi', 'Asante', '', 'Accra, Ghana', 'grappler', 'common', 'dark', 'lean', 'Patient on the mat, dangerous off his back.'),
    E('Rafael', 'Duarte', 'Smoke', 'Porto Alegre, Brazil', 'grappler', 'common', 'tan', 'athletic', 'Grew up on the jiu-jitsu mats of southern Brazil.', { hair: 'short03' }),
  ],
  mWelter: [
    E('Marcus', 'Calloway', 'The Hammer', 'Detroit, USA', 'brawler', 'legend', 'dark', 'muscular', 'Heavy hands, heavier reputation. Undefeated in three years.', { ink: true }),
    E('Viktor', 'Orlov', 'Stone', 'Yekaterinburg, Russia', 'wrestler', 'epic', 'light', 'muscular', 'Sambo and freestyle wrestling. Grinds opponents into the fence.', { beard: true }),
    E('Santiago', 'Serrano', 'Cyclone', 'Bogotá, Colombia', 'kicker', 'rare', 'tan', 'athletic', 'Spinning, switching, never still for a second.'),
    E('Emeka', 'Nwosu', 'Atlas', 'Enugu, Nigeria', 'wrestler', 'rare', 'dark', 'muscular', 'College wrestling standout with a takedown for every occasion.'),
    E('Haruto', 'Ikeda', 'The Chemist', 'Sapporo, Japan', 'grappler', 'rare', 'light', 'lean', 'Calm, precise, and always three moves ahead on the ground.'),
    E('Callum', 'Byrne', '', 'Glasgow, Scotland', 'boxer', 'common', 'light', 'athletic', 'Southpaw boxer who loves a scrap.', { ink: true }),
    E('Bilal', 'Karim', '', 'Marseille, France', 'boxer', 'common', 'tan', 'athletic', 'Sharp jab, sharper counters.', { beard: true }),
    E('Joaquin', 'Barros', '', 'Lisbon, Portugal', 'kicker', 'common', 'tan', 'lean', 'Muay thai fighter with a punishing leg kick.'),
  ],
  mMiddle: [
    E('Isaac', 'Mensah', 'The Tide', 'Kumasi, Ghana', 'kicker', 'legend', 'dark', 'athletic', 'Long, loose and lethal. His head kick has its own highlight reel.'),
    E('Anton', 'Kowalski', 'Grizzly', 'Kraków, Poland', 'wrestler', 'epic', 'light', 'muscular', 'A bear of a man with a gas tank that never empties.', { beard: true }),
    E('Diego', 'Castillo', 'The Viper', 'Tijuana, Mexico', 'boxer', 'rare', 'tan', 'athletic', 'Body-shot specialist. Ask anyone who has felt his left hook.', { ink: true }),
    E('Nasir', 'Bakr', 'The Professor', 'Tehran, Iran', 'grappler', 'rare', 'tan', 'athletic', 'Teaches jiu-jitsu by day, submits contenders by night.', { beard: true }),
    E('Ronan', 'Halloran', 'Rhino', 'Limerick, Ireland', 'brawler', 'rare', 'light', 'muscular', 'Walks through shots to land his own.', { ink: true }),
    E('Thabo', 'Mwangi', '', 'Durban, South Africa', 'kicker', 'common', 'dark', 'athletic', 'Taekwondo roots, MMA ambitions.'),
    E('Felix', 'Lindqvist', '', 'Malmö, Sweden', 'grappler', 'common', 'light', 'lean', 'Wrestler-turned-grappler with a slick back take.'),
    E('Sergio', 'Marin', '', 'Valencia, Spain', 'brawler', 'common', 'tan', 'athletic', 'Bar-room toughness, gym-built technique.'),
  ],
  mHeavy: [
    E('Gideon', 'Achebe', 'The Wall', 'Abuja, Nigeria', 'brawler', 'legend', 'dark', 'heavy', 'Nobody has knocked him down. Most of his opponents cannot say the same.'),
    E('Dmitri', 'Petrov', 'Steamroller', 'Vladivostok, Russia', 'wrestler', 'epic', 'light', 'heavy', 'Takes you down and keeps you there for fifteen minutes.', { beard: true }),
    E('Bruno', 'Tavares', 'The Butcher', 'Recife, Brazil', 'grappler', 'rare', 'tan', 'heavy', 'A heavyweight who moves on the mat like a lightweight.', { ink: true }),
    E('Malik', 'Fitzgerald', 'Thunder', 'Atlanta, USA', 'boxer', 'rare', 'dark', 'muscular', 'Golden-gloves boxer with one-punch power in both hands.'),
    E('Marek', 'Novak', 'Bulldozer', 'Brno, Czechia', 'wrestler', 'rare', 'light', 'heavy', 'Pressure, pressure, pressure.'),
    E('Kwame', 'Oduya', '', 'Nairobi, Kenya', 'kicker', 'common', 'dark', 'muscular', 'Rare heavyweight kicker with surprising speed.'),
    E('Vito', 'Rossi', '', 'Naples, Italy', 'brawler', 'common', 'light', 'heavy', 'Old-school slugger with a granite chin.', { beard: true }),
    E('Ezra', 'Mercer', '', 'Auckland, New Zealand', 'grappler', 'common', 'tan', 'heavy', 'Rugby forward turned submission hunter.', { ink: true }),
  ],
  wStraw: [
    E('Yuki', 'Nakamura', 'Ice', 'Tokyo, Japan', 'kicker', 'legend', 'light', 'lean', 'Never rattled, never hurried. Picks you apart from range.'),
    E('Ines', 'Ferreira', 'The Scalpel', 'Porto, Portugal', 'grappler', 'epic', 'tan', 'lean', 'Black belt with eleven submission wins.'),
    E('Amara', 'Osei', 'Lioness', 'Accra, Ghana', 'brawler', 'rare', 'dark', 'athletic', 'All forward pressure and heavy hands.'),
    E('Mira', 'Kaplan', 'Bullet', 'Izmir, Turkey', 'boxer', 'rare', 'light', 'lean', 'National boxing champion with lightning combinations.'),
    E('Paloma', 'Delgado', 'Hurricane', 'Guadalajara, Mexico', 'wrestler', 'rare', 'tan', 'athletic', 'Relentless wrestler who never stops moving forward.'),
    E('Freya', 'Sorensen', '', 'Aarhus, Denmark', 'kicker', 'common', 'light', 'lean', 'Muay thai specialist with a sharp teep.'),
    E('Hana', 'Moreau', '', 'Montréal, Canada', 'grappler', 'common', 'light', 'lean', 'Judoka with slick trips and throws.'),
    E('Thandi', 'Abara', '', 'Johannesburg, South Africa', 'boxer', 'common', 'dark', 'athletic', 'Tough, busy, and impossible to discourage.'),
  ],
  wBantam: [
    E('Camila', 'Reyes', 'Venom', 'San Juan, Puerto Rico', 'boxer', 'legend', 'tan', 'athletic', 'Two-time world boxing champion who moved to the cage and kept winning.', { ink: true }),
    E('Nadia', 'Kovac', 'Steel', 'Zagreb, Croatia', 'wrestler', 'epic', 'light', 'muscular', 'Olympic-level wrestler with brutal ground-and-pound.'),
    E('Imani', 'Adeyemi', 'Firestorm', 'Ibadan, Nigeria', 'kicker', 'rare', 'dark', 'athletic', 'Explosive kicker with a knockout spinning back kick.'),
    E('Aoife', 'Quinn', 'The Banshee', 'Galway, Ireland', 'brawler', 'rare', 'light', 'athletic', 'Loud walkouts, louder punches.', { ink: true }),
    E('Leila', 'Arroyo', 'Kismet', 'Seville, Spain', 'grappler', 'rare', 'tan', 'lean', 'Finds the armbar from anywhere.'),
    E('Keira', 'Vance', '', 'Manchester, England', 'boxer', 'common', 'light', 'athletic', 'Crisp jab and a big heart.'),
    E('Noor', 'Hassan', '', 'Cairo, Egypt', 'wrestler', 'common', 'tan', 'athletic', 'Strong in the clinch and tireless on top.'),
    E('Sasha', 'Volna', '', 'Kyiv, Ukraine', 'grappler', 'common', 'light', 'lean', 'Sambo grappler with dangerous leg locks.'),
  ],
};

export const ARCHETYPE_STATS: Record<Archetype, FighterStats> = {
  brawler: { power: 72, speed: 52, chin: 66, cardio: 52, striking: 62, kicking: 40, wrestling: 42, grappling: 40, submissions: 34, defense: 45 },
  boxer: { power: 58, speed: 70, chin: 55, cardio: 60, striking: 74, kicking: 36, wrestling: 40, grappling: 38, submissions: 32, defense: 62 },
  kicker: { power: 58, speed: 64, chin: 52, cardio: 60, striking: 52, kicking: 76, wrestling: 40, grappling: 42, submissions: 38, defense: 56 },
  wrestler: { power: 56, speed: 56, chin: 60, cardio: 70, striking: 48, kicking: 38, wrestling: 78, grappling: 62, submissions: 46, defense: 52 },
  grappler: { power: 50, speed: 56, chin: 58, cardio: 66, striking: 46, kicking: 42, wrestling: 66, grappling: 76, submissions: 78, defense: 50 },
};

/** Stat bonus by rarity (every stat). */
export const RARITY_BONUS: Record<Rarity, number> = { common: -6, rare: 2, epic: 9, legend: 16 };

/** Division flavour: heavier men hit harder and tire sooner. */
const DIVISION_SHIFT: Partial<Record<DivisionId, Partial<FighterStats>>> = {
  mLight: { speed: 4, cardio: 4, power: -4 },
  mHeavy: { power: 8, chin: 4, speed: -6, cardio: -6 },
  wStraw: { speed: 4, cardio: 4, power: -4 },
};

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Base stats for an archetype / rarity / division with a stable per-fighter variation (integers 1..99). */
export function baseStats(arch: Archetype, rarity: Rarity, div: DivisionId, seed: number): FighterStats {
  const out = { ...ARCHETYPE_STATS[arch] };
  const shift = DIVISION_SHIFT[div] ?? {};
  let s = seed;
  for (const k of Object.keys(out) as (keyof FighterStats)[]) {
    s = Math.imul(s ^ (s >>> 13), 0x5bd1e995) >>> 0;
    const jitter = (s % 9) - 4;
    out[k] = Math.max(1, Math.min(99, out[k] + RARITY_BONUS[rarity] + (shift[k] ?? 0) + jitter));
  }
  return out;
}

function build(): RosterFighter[] {
  const out: RosterFighter[] = [];
  for (const [div, list] of Object.entries(DATA) as [DivisionId, Entry[]][]) {
    const sex = div.startsWith('w') ? 'f' : 'm';
    for (const e of list) {
      const id = `${e.first}-${e.last}`.toLowerCase().replace(/[^a-z-]/g, '');
      const seed = hash(id);
      out.push({
        id,
        name: `${e.first} ${e.last}`,
        nickname: e.nick,
        division: div,
        archetype: e.arch,
        rarity: e.rarity,
        stats: baseStats(e.arch, e.rarity, div, seed),
        lookSeed: seed % 100000,
        lookHints: { sex, skin: e.skin, build: e.build, beard: e.beard ?? false, tattoos: e.ink ?? false, hair: e.hair },
        hometown: e.from,
        bio: e.bio,
      });
    }
  }
  return out;
}

export const ROSTER: readonly RosterFighter[] = build();

const BY_ID = new Map(ROSTER.map(f => [f.id, f]));

export function rosterFighter(id: string): RosterFighter | undefined {
  return BY_ID.get(id);
}

export function rosterOf(div: DivisionId): RosterFighter[] {
  return ROSTER.filter(f => f.division === div);
}

/** Overall rating 1..99 (the number on the card). */
export function overall(s: FighterStats): number {
  const v = s.power + s.speed + s.chin + s.cardio + s.striking + s.kicking + s.wrestling + s.grappling + s.submissions + s.defense;
  return Math.round(v / 10);
}
