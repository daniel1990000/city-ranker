// Builds the full sound bank (sfx.ts, crowd.ts, music.ts: plain TypeScript synthesis, several seconds of work on a
// phone) off the main thread, most-needed first, and posts each sound as soon as it is ready. Until a sound arrives,
// the game plays the small start-up bank in sound.ts.

import { sfxSound, type SfxId } from './sfx';
import { crowdSound, type CrowdId } from './crowd';
import { menuMusic } from './music';
import type { Pcm } from './dsp';

export interface BankMessage {
  name: string;
  variant: number;
  sr: number;
  ch: Float32Array[];
}

type Job = { name: string; variants: number; make: (v: number) => Pcm };
const sfx = (id: SfxId, variants = 1): Job => ({ name: id, variants, make: v => sfxSound(id, v) });
const crowd = (id: CrowdId, variants = 1): Job => ({ name: id, variants, make: v => crowdSound(id, v) });

/** In the order a fight needs them, then the menus, then the music. */
const JOBS: Job[] = [
  sfx('jab', 3), sfx('power', 3), sfx('body', 2), sfx('blocked', 3), sfx('whoosh', 3), sfx('bodyKick', 2), sfx('legKick', 2),
  sfx('headKick', 2), sfx('thud'), sfx('knockdown'), sfx('pound', 2), sfx('slam'), sfx('parried'), sfx('checked'),
  sfx('whooshHeavy'), sfx('tap'), sfx('cage'), sfx('heartbeat'), sfx('bell'), sfx('bellFinal'), sfx('fightCue'), sfx('clapper'),
  crowd('ooh', 2), crowd('roar', 2), crowd('bedCalm'), crowd('bedHot'), crowd('applause'), crowd('cheer'), crowd('boo'),
  sfx('specialReady'), sfx('click'), sfx('back'), sfx('cardFlip'), sfx('reveal0'), sfx('reveal1'), sfx('reveal2'), sfx('reveal3'),
  sfx('packBuild'), sfx('buy'), sfx('claim'), sfx('deny'), sfx('levelUp'), sfx('starUp'), sfx('achievement'), sfx('mission'),
  sfx('trophy'), sfx('win'), sfx('lose'),
  { name: 'music', variants: 1, make: () => menuMusic() },
];

const post = (m: BankMessage) => (self as unknown as Worker).postMessage(m, m.ch.map(c => c.buffer));

for (const j of JOBS) {
  for (let v = 0; v < j.variants; v++) {
    try {
      const p = j.make(v);
      post({ name: j.name, variant: v, sr: p.sr, ch: p.ch });
    } catch {
      // one broken sound must not stop the rest (the start-up bank covers it)
    }
  }
}
