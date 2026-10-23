// The three minigames decoded from the reference (docs/10 §3). Original implementations of the *behaviour*;
// `faithful: true` reproduces two quirks of the original (asymmetric perfect test, frame-dependent perfect size).

import { clamp, lerp, pingPong } from '../core/math.js';

const bitmask = (b) => (b[0] ? 1 : 0) | (b[1] ? 2 : 0) | (b[2] ? 4 : 0) | (b[3] ? 8 : 0);

// ------------------------------------------------------------------------------------------------------------
// SnakeMeter — two-sided needle/zone timing meter
// ------------------------------------------------------------------------------------------------------------
export class SnakeMeter {
  /**
   * @param {object} o duration (s), startDelay (s), numPasses, difficulty 0..1 (high = harder for Dom / easier for Sub),
   *   scoreSizeMin/Max (fraction of track), perfectZoneSize (fraction), random 0..1, domPlaying, subPlaying, faithful
   */
  constructor(o) {
    this.o = { startDelay: 0.4, duration: 1.6, numPasses: 2, difficulty: 0.5, scoreSizeMin: 0.12, scoreSizeMax: 0.35, perfectZoneSize: 0.06,
      random: 0.5, domPlaying: true, subPlaying: false, faithful: false, dt0: 1 / 60, ...o };
    this.running = false;
    this.finished = false;
    this.domWon = false;
  }

  start() {
    const o = this.o;
    this.delay = o.startDelay; this.timer = 0;
    this.finalDom = -1; this.finalSub = -1; this.liveDom = 0; this.liveSub = 0;
    this.zoneDom = o.scoreSizeMax + o.difficulty * (o.scoreSizeMin - o.scoreSizeMax);
    this.zoneSub = o.scoreSizeMax + (1 - o.difficulty) * (o.scoreSizeMin - o.scoreSizeMax);
    const widest = Math.max(this.zoneDom, this.zoneSub);
    this.centre = 0.5 + o.random * 0.5 * (1 - widest);
    this.perfect = o.faithful ? ((widest + 1) / o.duration) * o.dt0 : o.perfectZoneSize;
    this.posDom = -this.zoneDom / 2; this.posSub = -this.zoneSub / 2;
    this.running = true; this.finished = false; this.domWon = false;
    return this;
  }

  #score(dist, zone, pos) {
    const perfectOk = this.o.faithful ? pos <= this.centre && dist <= this.perfect : dist <= this.perfect;
    if (perfectOk) return 1.0;
    if (dist >= zone) return 0;
    return 0.99 * (1 - dist / zone);
  }

  /** advance by dt seconds; inputs {domEnd, subEnd} are "lock now" presses */
  tick(dt, { domEnd = false, subEnd = false } = {}) {
    if (!this.running) return this.outputs();
    const o = this.o;
    if (this.delay > 0) { this.delay -= dt; return this.outputs(); }
    this.timer = clamp(this.timer + dt, 0, o.duration);
    const t = pingPong(this.timer / (o.duration / o.numPasses));
    const both = o.domPlaying && o.subPlaying;
    const widest = Math.max(this.zoneDom, this.zoneSub);
    const sizeD = both ? widest : this.zoneDom, sizeS = both ? widest : this.zoneSub;
    if (o.domPlaying && this.finalDom < 0) {
      this.posDom = (sizeD + 1) * t - sizeD / 2;
      this.liveDom = this.#score(Math.abs(this.posDom - this.centre), this.zoneDom, this.posDom);
      if (domEnd) this.finalDom = this.liveDom;
    }
    if (o.subPlaying && this.finalSub < 0) {
      this.posSub = (sizeS + 1) * t - sizeS / 2;
      this.liveSub = this.#score(Math.abs(this.posSub - this.centre), this.zoneSub, this.posSub);
      if (subEnd) this.finalSub = this.liveSub;
    }
    const anyUnlocked = (o.domPlaying && this.finalDom < 0) || (o.subPlaying && this.finalSub < 0);
    const domZeroed = o.domPlaying && this.finalDom === 0;
    if (!anyUnlocked || this.timer >= o.duration || domZeroed) this.#finish();
    return this.outputs();
  }

  #finish() {
    const o = this.o;
    this.running = false; this.finished = true;
    if (o.domPlaying && o.subPlaying) this.domWon = this.finalDom > 0 && this.finalDom > this.finalSub;
    else if (o.domPlaying) this.domWon = this.finalDom > 0;
    else this.domWon = this.finalSub <= 0;
  }

  outputs() {
    return {
      needlePosDom: this.posDom, needleSizeDom: this.zoneDom, scoreZonePosDom: this.centre, scoreZoneSizeDom: this.zoneDom,
      perfectZonePosDom: this.centre, perfectZoneSizeDom: this.perfect,
      needlePosSub: this.posSub, needleSizeSub: this.zoneSub, scoreZonePosSub: this.centre, scoreZoneSizeSub: this.zoneSub,
      perfectZonePosSub: this.centre, perfectZoneSizeSub: this.perfect,
      domScore: this.liveDom, subScore: this.liveSub, domFinalScore: this.finalDom, subFinalScore: this.finalSub,
      finished: this.finished, domWon: this.domWon, isRunning: this.running,
    };
  }
}

// ------------------------------------------------------------------------------------------------------------
// ButtonSnipe — reaction minigame
// ------------------------------------------------------------------------------------------------------------
export class ButtonSnipe {
  constructor() { this.running = false; this.timer = 0; this.mask = 0; }

  start(snipeButton) { this.running = true; this.timer = 0; this.mask = 1 << snipeButton; return this; }

  /**
   * @param {object} i {snipeTime, domPlaying, domButtons[4], subPlaying, subButtons[4], dt}
   * @returns {{snipeTime:number, snipeButton:number, finished:boolean, domWon:boolean, isRunning:boolean}}
   */
  tick({ snipeTime, domPlaying, domButtons = [0, 0, 0, 0], subPlaying, subButtons = [0, 0, 0, 0], dt }) {
    const out = { snipeTime: -1, snipeButton: this.mask, finished: false, domWon: false, isRunning: false };
    if (!this.running) return out;
    this.timer += dt;
    out.snipeTime = snipeTime - this.timer;
    const dom = bitmask(domButtons), sub = bitmask(subButtons);
    if (this.timer > snipeTime) { out.finished = true; out.domWon = !domPlaying; }
    else if (subPlaying && sub === this.mask) { out.finished = true; out.domWon = false; }   // Sub is checked first → ties go to Sub
    else if (domPlaying && dom === this.mask) { out.finished = true; out.domWon = true; }
    else if (domPlaying && dom > 0) { out.finished = true; out.domWon = false; }              // wrong button
    else if (subPlaying && sub > 0) { out.finished = true; out.domWon = true; }               // wrong button
    this.running = !out.finished;
    out.isRunning = this.running;
    return out;
  }
}

// ------------------------------------------------------------------------------------------------------------
// SnipeChain — "UTSubmissionMinigame": count-up then countdown of button snipes
// ------------------------------------------------------------------------------------------------------------
export class SnipeChain {
  constructor() { this.running = false; this.#clear(); }
  #clear() {
    this.snipeTimer = -1; this.delayTimer = 0; this.mask = 0; this.snipeCount = 0; this.totalCD = 0; this.countUpTries = 0;
  }

  /**
   * @param {object} i  resetTrigger, countUpTrigger, countUpSnipeTime, isCountingDown, countDownSnipeTime, countDownTimerDelay,
   *   countDownTimerDelaySpeedIncrease, countDownTimerDelayMinTicks, snipeButton, domPlaying, domButtons[4], subPlaying, subButtons[4],
   *   dt, domInitiates, stopTrigger
   * @returns {{snipeTime, snipeButton, snipeResult, domWon, snipeCount, isRunning}}  (`domWon` ≡ "the initiator succeeded")
   */
  tick(i) {
    const out = { snipeTime: -1, snipeButton: -1, snipeResult: false, domWon: false, snipeCount: this.snipeCount, isRunning: this.running };
    if (i.resetTrigger && !this.running) {
      this.running = true; this.#clear(); this.delayTimer = i.countDownTimerDelay;
    }
    const countingDown = !!i.isCountingDown;
    if (!countingDown && i.countUpTrigger && this.running) {
      this.snipeTimer = i.countUpSnipeTime; this.mask = 1 << i.snipeButton; this.countUpTries += 1;
    }
    if (this.running && countingDown && this.snipeTimer <= 0 && this.delayTimer > 0) {
      this.delayTimer -= i.dt;
      if (this.delayTimer <= 0) {
        this.snipeTimer = i.countDownSnipeTime;
        this.delayTimer = Math.max(i.countDownTimerDelay - i.countDownTimerDelaySpeedIncrease * this.totalCD, i.countDownTimerDelayMinTicks);
        this.mask = 1 << i.snipeButton;
      }
    }
    if (i.stopTrigger && this.running) { this.running = false; out.isRunning = false; return out; }
    if (!this.running || this.snipeTimer <= 0) { out.isRunning = this.running; out.snipeCount = this.snipeCount; return out; }

    out.snipeButton = this.mask;
    const dom = bitmask(i.domButtons ?? [0, 0, 0, 0]), sub = bitmask(i.subButtons ?? [0, 0, 0, 0]);
    this.snipeTimer -= Math.max(i.dt, 0);
    out.snipeTime = this.snipeTimer;
    let result = false, success = false; // `success` is what the original calls OutDomWon: "the snipe initiator succeeded"
    const D = { playing: i.domPlaying, mask: dom }, S = { playing: i.subPlaying, mask: sub };
    if (this.snipeTimer <= 0) { result = true; success = i.domInitiates ? !D.playing : !S.playing; } // timeout: a human initiator who didn't react fails
    else if (i.domInitiates) {
      if (S.playing && S.mask === this.mask) { result = true; success = false; }          // Sub-exact is evaluated first → ties go to Sub
      else if (D.playing && D.mask === this.mask) { result = true; success = true; }
      else if (D.playing && D.mask > 0) { result = true; success = false; }               // wrong button
      else if (S.playing && S.mask > 0) { result = true; success = true; }
    } else {
      if (S.playing && S.mask === this.mask) { result = true; success = true; }
      else if (D.playing && D.mask === this.mask) { result = true; success = false; }
      else if (D.playing && D.mask > 0) { result = true; success = true; }
      else if (S.playing && S.mask > 0) { result = true; success = false; }
    }

    if (result) {
      out.snipeResult = true; out.domWon = success; out.initiatorWon = success;
      if (countingDown) { if (!success) this.snipeCount -= 1; } else if (success) this.snipeCount += 1;
      this.totalCD += countingDown ? 1 : 0;
      this.snipeTimer = 0;
      if (this.countUpTries === 3 && this.snipeCount === 0) this.running = false;
      if (countingDown && this.snipeCount === 0) this.running = false;
    }
    out.snipeCount = this.snipeCount;
    out.isRunning = this.running;
    return out;
  }
}
