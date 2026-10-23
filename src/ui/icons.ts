// Original inline SVG icons and art for the menus (no image files, no fonts): small line icons on a 24x24 grid, the
// foil pack art per pack tier, and the gem clusters of the shop. Everything draws in `currentColor` or in its own
// gradients, so CSS colours it per screen.

export type IconName =
  | 'back' | 'gear' | 'career' | 'glove' | 'fighters' | 'packs' | 'season' | 'shop' | 'boards' | 'lock' | 'check'
  | 'crown' | 'bolt' | 'clock' | 'info' | 'star' | 'gift' | 'ban' | 'restore' | 'bracket' | 'target' | 'medal'
  | 'list';

const P: Record<IconName, string> = {
  back: '<path d="M15 5l-7 7 7 7"/>',
  gear: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.6M12 18.6v2.6M21.2 12h-2.6M5.4 12H2.8M18.5 5.5l-1.8 1.8M7.3 16.7l-1.8 1.8M18.5 18.5l-1.8-1.8M7.3 7.3L5.5 5.5"/><circle cx="12" cy="12" r="6.6"/>',
  // a belt: plate with a crown notch and two straps
  career: '<path d="M2 9.5h4.5M17.5 9.5H22M2 14.5h4.5M17.5 14.5H22"/><path d="M6.5 7.5L12 5l5.5 2.5v9L12 19l-5.5-2.5z"/><path d="M9.5 13.2l1-3 1.5 1.6 1.5-1.6 1 3z"/>',
  glove: '<path d="M7 20v-3.2C5.2 15.6 4.5 13.8 4.5 11.5V8a3.5 3.5 0 0 1 3.5-3.5h5.5A4.5 4.5 0 0 1 18 9v1.5h.5a1.5 1.5 0 0 1 1.5 1.5v1c0 2.4-1.4 4.2-3.5 5V20z"/><path d="M8.5 9.5h6.5M14 12.5c1.6 0 3-.6 4-1.6M7 20h9.5"/>',
  fighters: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c.5-3.8 2.9-6 6-6s5.5 2.2 6 6"/><circle cx="16.5" cy="7" r="2.6"/><path d="M15.5 12.4c3.1-.5 5 1.6 5.5 5.6"/>',
  packs: '<rect x="3" y="6" width="11" height="15" rx="1.5" transform="rotate(-10 8.5 13.5)"/><rect x="9.5" y="3.5" width="11" height="15" rx="1.5"/><path d="M13 9.5l2-2 2 2-2 2z"/>',
  season: '<path d="M7 3.5h10v5a5 5 0 0 1-10 0z"/><path d="M7 5.5H4v1.5a3 3 0 0 0 3 3M17 5.5h3v1.5a3 3 0 0 1-3 3M12 13.5V17M8.5 20.5h7l-.8-3.5H9.3z"/>',
  shop: '<path d="M5 8h14l-1.1 12.5H6.1z"/><path d="M8.8 10.5V6.5a3.2 3.2 0 0 1 6.4 0v4"/>',
  boards: '<path d="M3 20.5h18M5 20.5v-6h4.3v6M9.8 20.5V9.5h4.4v11M14.7 20.5v-8.5H19v8.5"/><path d="M12 3.2l.9 1.8 2 .3-1.4 1.4.3 2-1.8-.9-1.8.9.3-2-1.4-1.4 2-.3z"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5M12 14.5v2.5"/>',
  check: '<path d="M4.5 12.5l5 5 10-11"/>',
  crown: '<path d="M3.5 18.5L2.5 7.5l5.5 4 4-6.5 4 6.5 5.5-4-1 11z"/><path d="M4 21h16"/>',
  bolt: '<path d="M13.5 2.5L5 13.5h6l-1 8 8.5-11h-6z"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.3v.2"/>',
  star: '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z"/>',
  gift: '<rect x="3.5" y="8.5" width="17" height="4" rx="1"/><path d="M5 12.5v8h14v-8M12 8.5v12M12 8.5C10.5 5 7 4.5 7 6.5s3 2 5 2c2 0 5 0 5-2s-3.5-1.5-5 2"/>',
  ban: '<circle cx="12" cy="12" r="8.5"/><path d="M6 6l12 12"/>',
  restore: '<path d="M4 12a8 8 0 1 0 2.4-5.7M4 4.5v4h4"/>',
  bracket: '<path d="M3 4.5h5v5H3M3 14.5h5v5H3M8 7h3.5v10H8M11.5 12H16"/><path d="M16 9h5v6h-5z"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.6"/><path d="M12 1.8v3M12 19.2v3M1.8 12h3M19.2 12h3"/>',
  medal: '<path d="M8 2.5l2.5 6M16 2.5l-2.5 6M6.5 2.5h3.5M14 2.5h3.5"/><circle cx="12" cy="15" r="6"/><path d="M12 11.6l1 2.1 2.3.3-1.7 1.6.4 2.3-2-1.1-2 1.1.4-2.3-1.7-1.6 2.3-.3z"/>',
  list: '<path d="M9.5 6.5H20M9.5 12H20M9.5 17.5H20"/><path d="M3.8 6.4l1.3 1.3 2.4-2.6M3.8 11.9l1.3 1.3 2.4-2.6"/><circle cx="5.3" cy="17.5" r="1.4"/>',
};

/** A line icon as an inline SVG string. */
export function icon(name: IconName, cls = ''): string {
  return `<svg class="ic${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name]}</svg>`;
}

/** The two currencies (filled, coloured). */
export const CASH_ICON =
  '<svg class="cur cash" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#2f9a3a"/><circle cx="12" cy="12" r="10" fill="none" stroke="#a6f58f" stroke-width="1.5" opacity=".7"/><circle cx="12" cy="12" r="6.6" fill="none" stroke="#c9ffb6" stroke-width="1.2" opacity=".55"/><path d="M14.4 9.2c-.5-.8-1.4-1.2-2.4-1.2-1.4 0-2.4.8-2.4 1.9 0 2.5 5 1.4 5 4 0 1.1-1.1 2-2.6 2-1.1 0-2-.5-2.5-1.3M12 6.6v1.4M12 16v1.4" fill="none" stroke="#eaffdf" stroke-width="1.5" stroke-linecap="round"/></svg>';
export const GEM_ICON =
  '<svg class="cur gem" viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 3.5h11l4 5.5L12 21 2.5 9z" fill="#8a45d6"/><path d="M2.5 9h19L12 21z" fill="#6a2fb4"/><path d="M6.5 3.5L9 9l3-5.5L15 9l2.5-5.5" fill="none" stroke="#e8d0ff" stroke-width="1" opacity=".8"/><path d="M9 9l3 12 3-12" fill="none" stroke="#c9a2ff" stroke-width="1" opacity=".7"/><path d="M7.2 4.5L5 8.3" stroke="#fff" stroke-width="1.3" stroke-linecap="round" opacity=".8"/></svg>';

let uid = 0;

/** Foil pack colours per tier: base, light, dark, ink, accent. */
const FOIL: Record<string, [string, string, string, string, string]> = {
  free: ['#1f8f6b', '#7cf2c4', '#0b3a2c', '#eafff6', '#b8ffe4'],
  standard: ['#56657c', '#d6e2f2', '#1b222e', '#ffffff', '#9fc3ff'],
  premium: ['#6b2fc0', '#d9b6ff', '#22103f', '#fbf3ff', '#c48bff'],
  elite: ['#b8862a', '#ffe7a3', '#3d2a08', '#fff8e2', '#ffd56a'],
};

/**
 * Foil pack art: a crimped foil wrapper in the tier's colours with an embossed crown crest, the pack name printed
 * on it and the card count as a small fan of cards. The shine sweep is a clipped band that CSS moves (`.sheen`).
 */
export function packArt(tier: 'free' | 'standard' | 'premium' | 'elite', title: string, cards: number): string {
  const [base, light, dark, ink, accent] = FOIL[tier];
  const id = `pk${++uid}`;
  // crimped top and bottom edges
  let top = 'M6 14';
  for (let x = 6; x < 114; x += 6) top += ` L${x + 3} 8 L${x + 6} 14`;
  let bot = '';
  for (let x = 114; x > 6; x -= 6) bot += ` L${x - 3} 172 L${x - 6} 166`;
  const shape = `${top} L114 166${bot} Z`;
  const fan = Array.from({ length: cards }, (_, i) => {
    const a = (i - (cards - 1) / 2) * 13;
    return `<rect x="51" y="128" width="18" height="25" rx="2.5" transform="rotate(${a} 60 160)" fill="${dark}" stroke="${accent}" stroke-width="1.4"/>`;
  }).join('');
  const words = title.toUpperCase().split(' ');
  return `<svg class="foil-svg" viewBox="0 0 120 180" aria-hidden="true" preserveAspectRatio="xMidYMid meet">
  <defs>
    <linearGradient id="${id}b" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${light}"/><stop offset=".28" stop-color="${base}"/><stop offset=".55" stop-color="${dark}"/><stop offset=".78" stop-color="${base}"/><stop offset="1" stop-color="${light}" stop-opacity=".85"/></linearGradient>
    <radialGradient id="${id}g" cx=".5" cy=".38" r=".5"><stop offset="0" stop-color="${accent}" stop-opacity=".55"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></radialGradient>
    <linearGradient id="${id}e" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${ink}"/><stop offset="1" stop-color="${accent}"/></linearGradient>
    <linearGradient id="${id}s" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <clipPath id="${id}c"><path d="${shape}"/></clipPath>
  </defs>
  <path d="${shape}" fill="url(#${id}b)"/>
  <path d="${shape}" fill="url(#${id}g)"/>
  <path d="M6 22h108M6 158h108" stroke="${ink}" stroke-opacity=".35" stroke-width="1" stroke-dasharray="2 3"/>
  <path d="M0 120 L120 40 L120 64 L0 144z" fill="#fff" opacity=".07"/>
  <g transform="translate(60 62)">
    <path d="M0 -30 L26 -17 L26 9 C26 22 13 30 0 35 C-13 30 -26 22 -26 9 L-26 -17Z" fill="${dark}" fill-opacity=".55" stroke="url(#${id}e)" stroke-width="2"/>
    <path d="M-14 8 L-16 -8 L-7 -1 L0 -13 L7 -1 L16 -8 L14 8Z" fill="url(#${id}e)"/>
    <rect x="-14" y="11" width="28" height="3.5" rx="1" fill="url(#${id}e)"/>
  </g>
  <text x="60" y="${words.length > 1 ? 112 : 117}" text-anchor="middle" font-family="Oswald, 'Arial Narrow', sans-serif" font-weight="700" font-size="15" letter-spacing="1.2" fill="${ink}">${words[0]}</text>
  ${words.length > 1 ? `<text x="60" y="124" text-anchor="middle" font-family="Oswald, 'Arial Narrow', sans-serif" font-weight="500" font-size="8.5" letter-spacing="3" fill="${accent}">${words.slice(1).join(' ')}</text>` : ''}
  ${fan}
  <g clip-path="url(#${id}c)"><rect class="sheen" x="-70" y="-10" width="34" height="200" fill="url(#${id}s)"/></g>
  </svg>`;
}

/** A gem cluster for the shop: 1..5 sets the size of the pile. */
export function gemArt(size: number): string {
  const spots: [number, number, number][] = [
    [50, 46, 1], [32, 56, 0.8], [68, 56, 0.8], [41, 64, 0.7], [59, 64, 0.7],
    [22, 66, 0.6], [78, 66, 0.6], [50, 66, 0.75], [14, 72, 0.5], [86, 72, 0.5],
  ];
  const n = [1, 3, 5, 8, 10][Math.max(0, Math.min(4, size - 1))];
  const g = spots.slice(0, n).sort((a, b) => a[1] - b[1]);
  const gem = ([x, y, s]: [number, number, number]) =>
    `<g transform="translate(${x} ${y}) scale(${s})"><path d="M-12 -14h24l8 10-20 22-20-22z" fill="#8a45d6"/><path d="M-20 -4h40l-20 22z" fill="#5f27a8"/><path d="M-12 -14l4 10 8-10 8 10 4-10" fill="none" stroke="#efdcff" stroke-width="1.2" opacity=".8"/><path d="M-8 -4l8 22 8-22" fill="none" stroke="#c9a2ff" stroke-width="1"/><path d="M-9 -12l-6 7" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity=".85"/></g>`;
  return `<svg class="gem-art" viewBox="0 0 100 90" aria-hidden="true"><ellipse cx="50" cy="82" rx="${18 + n * 3.4}" ry="5" fill="#000" opacity=".35"/>${g.map(gem).join('')}</svg>`;
}
