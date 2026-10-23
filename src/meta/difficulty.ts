// The player's difficulty choice (Settings): it shifts how good the computer opponent is in career and quick fights,
// and what a win pays. Pure functions, so the rules are testable and a server could apply them.
//
//   Easy   AI -250, wins pay -20% (cash and xp; gems stay flat), leaderboard: the win's score is halved and it does not count on the wins and
//          knockouts boards (an easier opponent must not climb the rankings)
//   Normal AI +0,   wins pay as before
//   Hard   AI +150, wins pay +15%
//   Pro    AI +300, wins pay +30%
// The AI difficulty is always clamped to 0..1000 (the range AIController takes).

export type DifficultyLevel = 'easy' | 'normal' | 'hard' | 'pro';

export const DIFFICULTY_LEVELS: readonly DifficultyLevel[] = ['easy', 'normal', 'hard', 'pro'];

export const DIFFICULTY_LABEL: Record<DifficultyLevel, string> = { easy: 'Easy', normal: 'Normal', hard: 'Hard', pro: 'Pro' };

/** Added to the AI difficulty of every career and quick fight. */
export const DIFFICULTY_OFFSET: Record<DifficultyLevel, number> = { easy: -250, normal: 0, hard: 150, pro: 300 };

/** Cash multiplier for a win, in percent. */
export const DIFFICULTY_CASH_PCT: Record<DifficultyLevel, number> = { easy: 80, normal: 100, hard: 115, pro: 130 };

/** Share of a win's leaderboard score that counts, in percent. */
export const DIFFICULTY_SCORE_PCT: Record<DifficultyLevel, number> = { easy: 50, normal: 100, hard: 100, pro: 100 };

/** The AI difficulty a fight uses: the career / quick-fight value shifted by the setting, clamped to 0..1000. */
export function effectiveDifficulty(base: number, level: DifficultyLevel): number {
  const b = Number.isFinite(base) ? Math.round(base) : 0;
  return Math.max(0, Math.min(1000, b + DIFFICULTY_OFFSET[level]));
}

/** A win's cash after the setting (whole tens, like every other reward). */
export function winCash(cash: number, level: DifficultyLevel): number {
  if (!(cash > 0)) return 0;
  return Math.round((cash * DIFFICULTY_CASH_PCT[level]) / 1000) * 10;
}

/** A win's xp after the setting (same multiplier as cash). */
export function winXp(xp: number, level: DifficultyLevel): number {
  if (!(xp > 0)) return 0;
  return Math.round((xp * DIFFICULTY_CASH_PCT[level]) / 100);
}

/** Does a win at this setting count on the wins / knockouts leaderboards? */
export function countsForBoards(level: DifficultyLevel): boolean {
  return level !== 'easy';
}

/** One line for the settings screen. */
export function difficultyNote(level: DifficultyLevel): string {
  const pct = DIFFICULTY_CASH_PCT[level] - 100;
  if (level === 'easy') return 'Easier opponents · wins pay 20% less · no leaderboard wins';
  if (pct === 0) return 'The standard challenge';
  return `Tougher opponents · wins pay ${pct}% more`;
}
