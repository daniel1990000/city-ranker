// Original fighter names, generated from common first and last names from many backgrounds. Combinations are
// checked against a deny-list of famous fighters (tests/content-names.test.ts) so nobody looks like a real person.

const FIRST_M = [
  'Marcus', 'Dante', 'Tomas', 'Kofi', 'Ivan', 'Rafael', 'Mateo', 'Kenji', 'Darius', 'Owen', 'Emeka', 'Luka', 'Sergio',
  'Tariq', 'Bruno', 'Niko', 'Andre', 'Felix', 'Hamza', 'Joaquin', 'Ruben', 'Kai', 'Viktor', 'Malik', 'Cian', 'Tobias',
  'Elias', 'Diego', 'Yusuf', 'Rory', 'Anton', 'Silas', 'Thabo', 'Jonah', 'Arash', 'Leon', 'Reza', 'Callum', 'Ezra',
  'Marek', 'Dmitri', 'Kwame', 'Haruto', 'Santiago', 'Isaac', 'Ronan', 'Nasir', 'Vito', 'Bilal', 'Gideon',
];
const FIRST_F = [
  'Maya', 'Lena', 'Ines', 'Amara', 'Sofia', 'Yuki', 'Talia', 'Nadia', 'Freya', 'Zara', 'Camila', 'Keira', 'Ayla',
  'Rosa', 'Imani', 'Hana', 'Elena', 'Leila', 'Mira', 'Jade', 'Noor', 'Thandi', 'Greta', 'Paloma', 'Sasha', 'Aoife',
  'Valentina', 'Dara', 'Nia', 'Selin',
];
const LAST = [
  'Okafor', 'Reyes', 'Varga', 'Mensah', 'Kovac', 'Duarte', 'Nakamura', 'Brennan', 'Haddad', 'Lindqvist', 'Mbeki',
  'Castillo', 'Petrov', 'Adeyemi', 'Moreau', 'Sato', 'Novak', 'Quinn', 'Ferreira', 'Halloran', 'Osei', 'Marin',
  'Kowalski', 'Tanaka', 'Rossi', 'Abara', 'Vance', 'Delgado', 'Karim', 'Sorensen', 'Achebe', 'Lozano', 'Ivanov',
  'Mwangi', 'Barros', 'Keane', 'Takeda', 'Volkov', 'Nwosu', 'Arroyo', 'Fitzgerald', 'Bakr', 'Holm', 'Oduya', 'Serrano',
  'Kaplan', 'Ruiz', 'Dragan', 'Asante', 'Mercer', 'Calloway', 'Sandoval', 'Orlov', 'Ikeda', 'Byrne', 'Tavares',
];
const NICKS = [
  'The Hammer', 'Iron', 'Lights Out', 'The Viper', 'Stone', 'The Surgeon', 'Wildfire', 'The Anchor', 'Ghost', 'Steamroller',
  'The Tide', 'Razor', 'Bulldozer', 'The Professor', 'Thunder', 'The Shadow', 'Grizzly', 'Silk', 'The Wall', 'Cyclone',
  'Mad Dog', 'The Chemist', 'Atlas', 'The Butcher', 'Smoke', 'The Python', 'Rhino', 'Quicksilver', 'The Mountain', 'Rook',
];

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A deterministic original name and nickname. */
export function generateName(seed: number, sex: 'm' | 'f'): { name: string; nickname: string } {
  const r = rng(seed * 7919 + 17);
  const first = (sex === 'm' ? FIRST_M : FIRST_F)[Math.floor(r() * (sex === 'm' ? FIRST_M.length : FIRST_F.length))];
  const last = LAST[Math.floor(r() * LAST.length)];
  return { name: `${first} ${last}`, nickname: r() < 0.7 ? NICKS[Math.floor(r() * NICKS.length)] : '' };
}

export const NAME_POOLS = { FIRST_M, FIRST_F, LAST, NICKS };
