// Drives a fighter's skeleton from a Pose: hips and spine as rotations, hands and feet as IK targets, the head as a
// rotation plus look-at, fists as a finger curl. Works on the MPFB "game_engine" rig (bone names below) at any body
// size: targets are authored for the 1.747 m base male and scaled by the model's own height.
//
// Character space: the glTF scene root. x = the fighter's LEFT, y = up, z = FORWARD (toward the opponent). Forward
// kinematics is done here by hand (no three.js matrix updates per bone) and the result written to bone.quaternion /
// bone.position, so posing two fighters costs a fraction of a millisecond.

import * as THREE from 'three';

export const AUTHOR_HEIGHT = 1.747;

export type V3 = readonly [number, number, number];

/** Degrees: rx = pitch (+ bends forward), ry = yaw (+ turns to the fighter's left), rz = roll (+ leans to the fighter's left). */
export type Rot = readonly [number, number, number];

export interface LimbTarget {
  /** Wrist / ankle position in character space (m, authored for the base male). */
  p: V3;
  /** Direction the elbow / knee should point. */
  pole: V3;
}

export interface Pose {
  /** Pelvis offset from its rest position (m) and rotation. */
  hip: V3;
  hipRot: Rot;
  /** Spine bend, spread over the three spine bones (on top of the hips). */
  chest: Rot;
  /** Head on top of the neck (on top of the chest). */
  head: Rot;
  handL: LimbTarget;
  handR: LimbTarget;
  /** Hand roll around the forearm (deg): 0 = knuckles up (horizontal fist), 90 = vertical fist. */
  wristL: number;
  wristR: number;
  footL: LimbTarget;
  footR: LimbTarget;
  /** Foot pitch (deg, + = toes down / on the ball) and yaw (+ = toes turned to the fighter's left). */
  toeL: readonly [number, number];
  toeR: readonly [number, number];
  /** 0 open hand .. 1 tight fist. */
  fist: number;
  shrugL: number;
  shrugR: number;
}

const BODY = ['Root', 'pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'head'] as const;
const SIDE_BONES = ['clavicle', 'upperarm', 'lowerarm', 'hand', 'thigh', 'calf', 'foot', 'ball'] as const;
const FINGERS = ['index', 'middle', 'ring', 'pinky'] as const;

interface BoneInfo {
  bone: THREE.Bone;
  parent: BoneInfo | null;
  restQ: THREE.Quaternion;
  restP: THREE.Vector3;
  /** Character-space rest orientation and position. */
  restWQ: THREE.Quaternion;
  restWP: THREE.Vector3;
  /** Working character-space orientation / position (this frame). */
  wq: THREE.Quaternion;
  wp: THREE.Vector3;
  /** Unit vector along the bone in its local space (toward its main child). */
  axis: THREE.Vector3;
  length: number;
}

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _qs = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _w = new THREE.Vector3();
const _u = new THREE.Vector3();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const DEG = Math.PI / 180;

/** Quaternion from a Rot (degrees) in character space. */
export function rotQ(r: Rot, out: THREE.Quaternion): THREE.Quaternion {
  // pitch around x (the left axis): + bends forward, i.e. the head goes toward +z -> rotation about +x by +angle
  _e.set(r[0] * DEG, r[1] * DEG, -r[2] * DEG, 'YXZ');
  return out.setFromEuler(_e);
}

/** rotQ from three angles (degrees), without building a Rot. */
export function rotQ3(x: number, y: number, z: number, out: THREE.Quaternion): THREE.Quaternion {
  _e.set(x * DEG, y * DEG, -z * DEG, 'YXZ');
  return out.setFromEuler(_e);
}

const IDQ = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);
/** Pelvis height of the base male at rest (m): low hips are authored from the mat with it. */
const PELVIS_Y = 0.945;

export class FighterRig {
  private bones = new Map<string, BoneInfo>();
  private order: BoneInfo[] = [];
  /** Character space <- skeleton parent (the armature node). */
  private baseQ = new THREE.Quaternion();
  private baseP = new THREE.Vector3();
  /** Model height / authored height: scales every positional target. */
  readonly k: number;
  private fingerAxis = new Map<THREE.Bone, THREE.Vector3>();

  constructor(scene: THREE.Object3D, modelHeight: number) {
    this.k = modelHeight / AUTHOR_HEIGHT;
    const byName = new Map<string, THREE.Bone>();
    scene.traverse(o => {
      if ((o as THREE.Bone).isBone) byName.set(o.name, o as THREE.Bone);
    });
    const root = byName.get('Root');
    if (!root) throw new Error('fighter rig: no Root bone');
    // the armature node's transform relative to the scene root
    scene.updateMatrixWorld(true);
    const parent = root.parent as THREE.Object3D;
    const inv = new THREE.Matrix4().copy(scene.matrixWorld).invert();
    const m = new THREE.Matrix4().multiplyMatrices(inv, parent.matrixWorld);
    m.decompose(this.baseP, this.baseQ, _v);

    const names: string[] = [...BODY];
    for (const s of ['l', 'r']) {
      for (const b of SIDE_BONES) names.push(`${b}_${s}`);
      for (const f of FINGERS) for (const i of [1, 2, 3]) names.push(`${f}_0${i}_${s}`);
      for (const i of [1, 2, 3]) names.push(`thumb_0${i}_${s}`);
    }
    for (const n of names) {
      const bone = byName.get(n);
      if (!bone) continue;
      const pInfo = bone.parent && this.bones.get(bone.parent.name) ? (this.bones.get(bone.parent.name) as BoneInfo) : null;
      const info: BoneInfo = {
        bone,
        parent: pInfo,
        restQ: bone.quaternion.clone(),
        restP: bone.position.clone(),
        restWQ: new THREE.Quaternion(),
        restWP: new THREE.Vector3(),
        wq: new THREE.Quaternion(),
        wp: new THREE.Vector3(),
        axis: new THREE.Vector3(0, 1, 0),
        length: 0.1,
      };
      this.bones.set(n, info);
      this.order.push(info);
    }
    // rest FK in character space
    for (const b of this.order) this.fk(b, b.restQ);
    for (const b of this.order) {
      b.restWQ.copy(b.wq);
      b.restWP.copy(b.wp);
    }
    // bone axes from the main child
    const child: Record<string, string> = {
      pelvis: 'spine_01', spine_01: 'spine_02', spine_02: 'spine_03', spine_03: 'neck_01', neck_01: 'head',
      clavicle_l: 'upperarm_l', upperarm_l: 'lowerarm_l', lowerarm_l: 'hand_l', hand_l: 'middle_01_l',
      clavicle_r: 'upperarm_r', upperarm_r: 'lowerarm_r', lowerarm_r: 'hand_r', hand_r: 'middle_01_r',
      thigh_l: 'calf_l', calf_l: 'foot_l', foot_l: 'ball_l', thigh_r: 'calf_r', calf_r: 'foot_r', foot_r: 'ball_r',
    };
    for (const [p, c] of Object.entries(child)) {
      const pi = this.bones.get(p);
      const ci = this.bones.get(c);
      if (!pi || !ci) continue;
      pi.length = ci.restP.length();
      pi.axis.copy(ci.restP).normalize();
    }
    // finger curl axes: perpendicular to the finger and the palm normal, in each finger bone's local space
    for (const s of ['l', 'r'] as const) {
      const hand = this.bones.get(`hand_${s}`);
      const idx = this.bones.get(`index_01_${s}`);
      const pinky = this.bones.get(`pinky_01_${s}`);
      if (!hand || !idx || !pinky) continue;
      const across = _v.copy(idx.restWP).sub(pinky.restWP).normalize();
      for (const f of FINGERS) {
        for (const i of [1, 2, 3]) {
          const fb = this.bones.get(`${f}_0${i}_${s}`);
          if (!fb) continue;
          // world curl axis = across (index -> pinky line); fingers curl toward the palm around it
          const local = across.clone().applyQuaternion(_q.copy(fb.restWQ).invert());
          this.fingerAxis.set(fb.bone, s === 'l' ? local.negate() : local);
        }
      }
    }
  }

  get(name: string): BoneInfo | undefined {
    return this.bones.get(name);
  }

  /** Rest position of a bone in character space (m). */
  restPos(name: string): THREE.Vector3 {
    return (this.bones.get(name) as BoneInfo).restWP;
  }

  private fk(b: BoneInfo, localQ: THREE.Quaternion): void {
    if (b.parent) {
      b.wq.copy(b.parent.wq).multiply(localQ);
      b.wp.copy(b.restP).applyQuaternion(b.parent.wq).add(b.parent.wp);
    } else {
      // Root: under the armature node
      b.wq.copy(this.baseQ).multiply(localQ);
      b.wp.copy(b.bone.position).applyQuaternion(this.baseQ).add(this.baseP);
    }
  }

  /** Give bone `b` the character-space orientation `wq` (its parent's working pose is already set). */
  private setWorld(b: BoneInfo, wq: THREE.Quaternion): void {
    const pq = b.parent ? b.parent.wq : this.baseQ;
    b.wq.copy(wq);
    _qs.copy(pq).invert().multiply(b.wq);
    b.bone.quaternion.copy(_qs);
    b.wp.copy(b.restP).applyQuaternion(b.parent ? b.parent.wq : this.baseQ).add(b.parent ? b.parent.wp : this.baseP);
  }

  /** Rotate the bone's rest orientation (relative to its current parent) so its axis points along `dir`. */
  private aim(b: BoneInfo, dir: THREE.Vector3, roll = 0): void {
    const pq = b.parent ? b.parent.wq : this.baseQ;
    // where the bone would point if it kept its rest local rotation under the current parent
    const w0 = _q.copy(pq).multiply(b.restQ);
    const cur = _v3.copy(b.axis).applyQuaternion(w0);
    const r = _q2.setFromUnitVectors(cur, _v2.copy(dir).normalize());
    const w = r.multiply(w0);
    if (roll !== 0) w.premultiply(this.sRoll.setFromAxisAngle(_v2, roll * DEG));
    this.setWorld(b, w);
  }

  private rest(b: BoneInfo): void {
    b.bone.quaternion.copy(b.restQ);
    this.fk(b, b.restQ);
  }

  // bone references resolved once (posing runs for two fighters every frame: no lookups, no allocations)
  private refs: {
    root: BoneInfo;
    pelvis: BoneInfo;
    spine: BoneInfo[];
    neck: BoneInfo;
    head: BoneInfo;
    cl: BoneInfo[];
    ua: BoneInfo[];
    la: BoneInfo[];
    hand: BoneInfo[];
    thigh: BoneInfo[];
    calf: BoneInfo[];
    foot: BoneInfo[];
    ball: BoneInfo[];
    fingers: { b: BoneInfo; axis: THREE.Vector3; deg: number }[][];
    thumbs: BoneInfo[][];
  } | null = null;
  /** Base-male pelvis height minus this body's (authored units): low hips are placed from the mat, not the rest pose. */
  private pelvisFix = 0;
  private lastFist = [-1, -1];
  private readonly sHq = new THREE.Quaternion();
  private readonly sAcc = new THREE.Quaternion();
  private readonly sChest = new THREE.Quaternion();
  private readonly sStep = new THREE.Quaternion();
  private readonly sQ = new THREE.Quaternion();
  private readonly sTurn = new THREE.Quaternion();
  private readonly sRoll = new THREE.Quaternion();
  private readonly sOff = new THREE.Vector3();
  private readonly sV = new THREE.Vector3();
  private readonly sFace = new THREE.Vector3();
  private readonly sDir = new THREE.Vector3();
  private readonly sT = new THREE.Vector3();
  private readonly sD0 = new THREE.Vector3();
  private readonly sU = new THREE.Vector3();
  private readonly sPole = new THREE.Vector3();
  private readonly sE = new THREE.Vector3();
  private readonly sAim = new THREE.Vector3();

  private resolve(): NonNullable<FighterRig['refs']> {
    const B = (n: string) => this.bones.get(n) as BoneInfo;
    const LR = (n: string) => [B(`${n}_l`), B(`${n}_r`)];
    const fingers = (['l', 'r'] as const).map(s => {
      const out: { b: BoneInfo; axis: THREE.Vector3; deg: number }[] = [];
      for (const f of FINGERS) {
        for (const i of [1, 2, 3]) {
          const b = this.bones.get(`${f}_0${i}_${s}`);
          const axis = b && this.fingerAxis.get(b.bone);
          if (b && axis) out.push({ b, axis, deg: i === 1 ? 80 : i === 2 ? 95 : 70 });
        }
      }
      return out;
    });
    const thumbs = (['l', 'r'] as const).map(s => [1, 2, 3].map(i => this.bones.get(`thumb_0${i}_${s}`)).filter((b): b is BoneInfo => !!b));
    const refs = {
      root: B('Root'),
      pelvis: B('pelvis'),
      spine: [B('spine_01'), B('spine_02'), B('spine_03')],
      neck: B('neck_01'),
      head: B('head'),
      cl: LR('clavicle'),
      ua: LR('upperarm'),
      la: LR('lowerarm'),
      hand: LR('hand'),
      thigh: LR('thigh'),
      calf: LR('calf'),
      foot: LR('foot'),
      ball: LR('ball'),
      fingers,
      thumbs,
    };
    this.pelvisFix = PELVIS_Y - refs.pelvis.restWP.y / this.k;
    this.refs = refs;
    return refs;
  }

  /** Pose the skeleton. `look` (optional) is a character-space point the head turns toward (weight 0..1). */
  apply(p: Pose, look?: THREE.Vector3, lookWeight = 0): void {
    const R = this.refs ?? this.resolve();
    const k = this.k;
    const root = R.root;
    this.rest(root);
    // hips
    const pelvis = R.pelvis;
    const hq = rotQ(p.hipRot, this.sHq);
    this.setWorld(pelvis, this.sQ.copy(hq).multiply(pelvis.restWQ));
    // move the pelvis (its local position is in Root space). Standing, the offset is from this body's own rest
    // height (legs of any length keep the same bend); low (kneeling, sitting, lying) it is measured from the mat,
    // so a smaller or differently built body neither floats above nor sinks into the canvas.
    const low = Math.min(1, Math.max(0, (-p.hip[1] - 0.12) / 0.25));
    const dy = p.hip[1] + low * low * (3 - 2 * low) * this.pelvisFix;
    const off = this.sOff.set(p.hip[0] * k, dy * k, p.hip[2] * k);
    pelvis.wp.copy(pelvis.restWP).add(off);
    off.applyQuaternion(this.sQ.copy(root.wq).invert());
    pelvis.bone.position.copy(pelvis.restP).add(off);
    // spine: the chest rotation spread over three bones, then neck + head
    const step = rotQ3(p.chest[0] / 3, p.chest[1] / 3, p.chest[2] / 3, this.sStep);
    const acc = this.sAcc.copy(hq);
    for (const b of R.spine) {
      acc.multiply(step);
      this.setWorld(b, this.sQ.copy(acc).multiply(b.restWQ));
    }
    const chestQ = this.sChest.copy(acc);
    const neck = R.neck;
    const hstep = rotQ3(p.head[0] / 2, p.head[1] / 2, p.head[2] / 2, this.sStep);
    acc.multiply(hstep);
    this.setWorld(neck, this.sQ.copy(acc).multiply(neck.restWQ));
    acc.multiply(hstep);
    const head = R.head;
    const headQ = this.sQ.copy(acc).multiply(head.restWQ);
    if (look && lookWeight > 0) {
      // turn the face (+z of the rest head) toward the point
      const face = this.sFace.set(0, 0, 1).applyQuaternion(acc);
      const want = this.sV.copy(head.restP).applyQuaternion(neck.wq).add(neck.wp).multiplyScalar(-1).add(look).normalize();
      const turn = this.sTurn.setFromUnitVectors(face, want);
      turn.slerp(IDQ, 1 - Math.min(1, lookWeight));
      headQ.premultiply(turn);
    }
    this.setWorld(head, headQ);
    // the capsule from the neck to the middle of the head that gloves must stay out of
    this.neckA.copy(neck.wp);
    this.headB.copy(head.wp).add(this.sV.set(0, 0.09 * k, 0.02 * k));

    // arms
    for (let i = 0; i < 2; i++) {
      const left = i === 0;
      const cl = R.cl[i];
      const shrugQ = rotQ3(0, 0, left ? p.shrugL : -p.shrugR, this.sStep);
      this.setWorld(cl, this.sQ.copy(chestQ).multiply(shrugQ).multiply(cl.restWQ));
      this.ik(R.ua[i], R.la[i], left ? p.handL : p.handR, true);
      const fore = R.la[i];
      // the hand continues the forearm; roll sets the fist (horizontal / vertical)
      const dir = this.sDir.copy(fore.axis).applyQuaternion(fore.wq);
      this.aim(R.hand[i], dir, left ? p.wristL : -p.wristR);
      this.curl(i, p.fist);
    }
    // legs
    for (let i = 0; i < 2; i++) {
      const left = i === 0;
      this.ik(R.thigh[i], R.calf[i], left ? p.footL : p.footR);
      const toe = left ? p.toeL : p.toeR;
      // foot points forward along z, pitched and yawed; flat on the floor at pitch 0, toes straight up at -115
      const pitch = Math.max(-115, toe[0] + 25) * DEG;
      const fwd = this.sDir.set(0, -Math.sin(pitch), Math.cos(pitch)).applyAxisAngle(UP, toe[1] * DEG);
      this.aim(R.foot[i], fwd);
      this.rest(R.ball[i]);
    }
  }

  private neckA = new THREE.Vector3();
  private headB = new THREE.Vector3();

  /**
   * Keep a glove out of the neck and head: poses are authored for the base body, and with the chin tucked and the
   * body leaning, a guard target can land under the jaw (the arm then cuts through the chest). A target inside the
   * neck-to-head capsule is moved forward, out of it.
   */
  private clearHead(T: THREE.Vector3): void {
    const k = this.k;
    const ab = _w.copy(this.headB).sub(this.neckA);
    const t = Math.max(0, Math.min(1, _u.copy(T).sub(this.neckA).dot(ab) / Math.max(1e-6, ab.lengthSq())));
    const P = _u.copy(this.neckA).addScaledVector(ab, t);
    const r = (0.13 + 0.05 * t) * k;
    const dx = T.x - P.x;
    const dy = T.y - P.y;
    const dz = T.z - P.z;
    if (dx * dx + dy * dy + dz * dz >= r * r) return;
    // straight out in front, at the same height and side (a glove beside the chin, not under it)
    T.z = P.z + Math.sqrt(Math.max(0, r * r - dx * dx - dy * dy));
  }

  /** Two-bone IK: upper + lower reach the target, the middle joint bends toward the pole. */
  private ik(upper: BoneInfo, lower: BoneInfo, t: LimbTarget, arm = false): void {
    const k = this.k;
    const a = upper.length;
    const b = lower.length;
    // the start of the chain after the parents moved
    this.fk(upper, upper.restQ);
    const S = upper.wp;
    const T = this.sT.set(t.p[0] * k, t.p[1] * k, t.p[2] * k);
    if (arm) this.clearHead(T);
    const d0 = this.sD0.copy(T).sub(S);
    let d = d0.length();
    const max = (a + b) * 0.999;
    if (d > max) {
      d0.multiplyScalar(max / d);
      d = max;
    }
    d = Math.max(d, Math.abs(a - b) + 1e-3);
    const u = this.sU.copy(d0).normalize();
    const v = this.sPole.set(t.pole[0], t.pole[1], t.pole[2]);
    v.addScaledVector(u, -v.dot(u));
    if (v.lengthSq() < 1e-8) v.set(0, -1, 0);
    v.normalize();
    const cosA = Math.min(1, Math.max(-1, (a * a + d * d - b * b) / (2 * a * d)));
    const sinA = Math.sqrt(1 - cosA * cosA);
    const E = this.sE.copy(S).addScaledVector(u, a * cosA).addScaledVector(v, a * sinA);
    this.aim(upper, this.sAim.copy(E).sub(S));
    this.fk(lower, lower.restQ);
    this.aim(lower, this.sAim.copy(S).add(d0).sub(E));
  }

  private curl(i: number, amount: number): void {
    // the fingers only move when the fist changes
    if (!this.refs || Math.abs(amount - this.lastFist[i]) < 1e-3) return;
    this.lastFist[i] = amount;
    for (const f of this.refs.fingers[i]) {
      f.b.bone.quaternion.copy(f.b.restQ).multiply(this.sRoll.setFromAxisAngle(f.axis, amount * f.deg * DEG));
    }
    for (const b of this.refs.thumbs[i]) b.bone.quaternion.copy(b.restQ);
  }
}
