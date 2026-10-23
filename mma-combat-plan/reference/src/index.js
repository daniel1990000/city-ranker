// Public surface of the reference implementation. Import from here, or from the individual modules.

export * from './core/taxonomy.js';
export { DEFAULT_TUNABLES, mergeTunables, deepMerge } from './core/tunables.js';
export { Rng, RngStreams, healthEventDice, hashString } from './core/rng.js';
export * as math from './core/math.js';
export { Statechart } from './core/statechart.js';
export { buildSituation } from './core/situation.js';

export { Fighter, defaultSpec, placeFighters } from './combat/fighter.js';
export { MoveBook, validateMove } from './combat/moves.js';
export { healthEventProbability, switchHealthEvent, evaluateLadder } from './combat/health-events.js';
export { SnakeMeter, ButtonSnipe, SnipeChain } from './combat/minigames.js';
export { ClinchBout, attemptClinch, getAvailableTakedowns } from './combat/clinch.js';
export { TakedownBout, startShot, takedownProbability } from './combat/takedown.js';
export { GroundBout, GROUND_GRAPH } from './combat/ground.js';
export { SubmissionBout, beginSubmission, availableSubmissions } from './combat/submission.js';
export { Referee } from './combat/referee.js';
export { scoreRound, scoreFight, classifyDecision, makeJudges } from './combat/scoring.js';
export { AbilityBar, ABILITIES } from './combat/abilities.js';

export { Brain, ScriptedBrain } from './ai/brain.js';
export { aggressionLevel } from './ai/aggression.js';
export { TENDENCY_PROFILES } from './ai/tendencies.js';
export { checkIntent } from './ai/legality.js';

export { emptyIntent, compactIntent, expandIntent } from './input/intent.js';
export { InputBuffer } from './input/buffer.js';
export { TouchRecognizer, gestureToIntent } from './input/recognizer.js';
export { GamepadMapper } from './input/mapping.js';

export { World } from './sim/world.js';
export { EventBus, EventType } from './sim/events.js';
export { StatsTracker } from './sim/stats.js';
export { Octagon } from './sim/cage.js';
export { Match } from './sim/match.js';
export { FightSim } from './sim/fight-sim.js';
export { ReplayRecorder } from './sim/replay.js';
export { playReplay } from './sim/replayer.js';
export { StoryEngine } from './sim/story.js';
export { runBatch, runOne, summarize, TARGETS } from './sim/batch.js';

export { DEFAULT_FIGHTERS } from './data/default-fighters.js';
export { buildDefaultMoves } from './data/default-moves.js';
