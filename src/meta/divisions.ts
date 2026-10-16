// The six weight classes. Fights only happen inside a division.
import type { DivisionId } from '../game/fight/types';

export interface Division {
  id: DivisionId;
  name: string;
  short: string;
  sex: 'm' | 'f';
  /** Weight limit (kg / lb). */
  kg: number;
  lb: number;
}

export const DIVISIONS: readonly Division[] = [
  { id: 'mLight', name: 'Lightweight', short: 'LW', sex: 'm', kg: 70, lb: 155 },
  { id: 'mWelter', name: 'Welterweight', short: 'WW', sex: 'm', kg: 77, lb: 170 },
  { id: 'mMiddle', name: 'Middleweight', short: 'MW', sex: 'm', kg: 84, lb: 185 },
  { id: 'mHeavy', name: 'Heavyweight', short: 'HW', sex: 'm', kg: 120, lb: 265 },
  { id: 'wStraw', name: "Women's Strawweight", short: 'SW', sex: 'f', kg: 52, lb: 115 },
  { id: 'wBantam', name: "Women's Bantamweight", short: 'BW', sex: 'f', kg: 61, lb: 135 },
];

export const DIVISION_IDS: readonly DivisionId[] = DIVISIONS.map(d => d.id);

export function division(id: DivisionId): Division {
  return DIVISIONS.find(d => d.id === id) ?? DIVISIONS[0];
}

export function isDivision(v: unknown): v is DivisionId {
  return typeof v === 'string' && (DIVISION_IDS as readonly string[]).includes(v);
}
