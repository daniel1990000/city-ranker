// The broadcast camera: side-on, framing both fighters, closer when they close the distance, lower on the ground,
// with shake on big hits, punch-ins and a slow orbit for knockout replays. Pure maths + one PerspectiveCamera.

import * as THREE from 'three';

export type CamMode = 'fight' | 'ground' | 'intro' | 'replay' | 'result';

export class CameraDirector {
  private pos = new THREE.Vector3(0, 1.6, 6.5);
  private look = new THREE.Vector3(0, 1.1, 0);
  private shakeAmp = 0;
  private shakeT = 0;
  private punch = 0;
  private orbit = 0;
  mode: CamMode = 'intro';
  /** Which side the camera sits on (+1 = +z). */
  side = 1;

  constructor(readonly camera: THREE.PerspectiveCamera) {}

  /** Settings > Reduced motion: no shake, no punch-ins, no replay orbit. */
  reduced = false;
  /** Replay mode: the fighters are on the ground (the cinematic camera drops to the mat). */
  replayGround = false;
  private _mid = new THREE.Vector3();
  private _target = new THREE.Vector3();
  private _lk = new THREE.Vector3();

  /**
   * Start a finish replay: a cut to a low, close camera that slowly orbits from one side of the fighters to the
   * other (a fixed low angle with reduced motion). Call snap() after the first frame's positions are known.
   */
  startReplay(): void {
    this.mode = 'replay';
    this.orbit = this.reduced ? -0.35 : -0.55;
    this.shakeAmp = 0;
    this.punch = 0;
  }

  /** A hit: strength 0..1. */
  shake(strength: number): void {
    if (this.reduced) return;
    this.shakeAmp = Math.max(this.shakeAmp, 0.02 + strength * 0.07);
  }

  /** Briefly zoom in on the action (big shots, knockdowns). */
  punchIn(amount = 1): void {
    if (this.reduced) return;
    this.punch = Math.max(this.punch, amount);
  }

  /**
   * Follow two points (the fighters' chests, world space). `dt` real seconds. `aspect` lets narrow phones pull back.
   */
  update(a: THREE.Vector3, b: THREE.Vector3, dt: number): void {
    const cam = this.camera;
    const mid = this._mid.addVectors(a, b).multiplyScalar(0.5);
    const sep = Math.max(1, a.distanceTo(b));
    const aspect = cam.aspect;
    const fit = aspect < 1.6 ? 1.2 : aspect < 1.9 ? 1.06 : 1;
    let dist: number;
    let height: number;
    let lookY: number;
    switch (this.mode) {
      case 'ground':
        dist = 3.6 + sep * 0.4;
        height = 2.1;
        lookY = 0.3;
        break;
      case 'intro':
        dist = 5.6 + sep * 0.5;
        height = 2.2;
        lookY = 1.1;
        this.orbit += dt * 0.12;
        break;
      case 'replay':
        // low and close, looking slightly up at the fighters (on the ground: down at mat level), a slow orbit
        if (this.replayGround) {
          dist = 2.5 + sep * 0.3;
          height = 0.8;
          lookY = 0.35;
        } else {
          dist = 2.4 + sep * 0.45;
          height = 1.0;
          lookY = 1.3;
        }
        if (!this.reduced) this.orbit = Math.min(0.6, this.orbit + dt * 0.12);
        break;
      case 'result':
        dist = 4.4;
        height = 1.6;
        lookY = 1.25;
        this.orbit += dt * 0.08;
        break;
      default:
        // just above the top rail, looking down into the cage like a broadcast camera
        dist = 3.3 + sep * 0.62;
        height = 2.15;
        lookY = 1.02;
        this.orbit *= Math.pow(0.2, dt);
    }
    dist *= fit;
    dist *= 1 - this.punch * 0.18;
    const ang = this.orbit;
    const target = this._target.set(mid.x + Math.sin(ang) * dist, height, mid.z + Math.cos(ang) * dist * this.side);
    const lk = this._lk.set(mid.x, lookY, mid.z);
    const k = 1 - Math.pow(this.mode === 'replay' ? 0.02 : 0.004, dt);
    this.pos.lerp(target, k);
    this.look.lerp(lk, Math.min(1, k * 1.6));
    cam.position.copy(this.pos);
    // shake: decaying noise
    if (this.shakeAmp > 0.0005) {
      this.shakeT += dt * 60;
      const s = this.shakeAmp;
      cam.position.x += Math.sin(this.shakeT * 1.7) * s;
      cam.position.y += Math.cos(this.shakeT * 2.3) * s * 0.7;
      this.shakeAmp *= Math.pow(0.0008, dt);
    }
    this.punch *= Math.pow(0.05, dt);
    cam.lookAt(this.look);
  }

  /** Jump straight to the framing (new fight, after a replay). */
  snap(a: THREE.Vector3, b: THREE.Vector3): void {
    // settle the smoothing without letting the slow orbits run on
    const orbit = this.orbit;
    for (let i = 0; i < 60; i++) {
      this.orbit = orbit;
      this.update(a, b, 0.5);
    }
    this.orbit = orbit;
  }
}
