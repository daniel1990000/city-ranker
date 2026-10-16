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
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const DEG = Math.PI / 180;

/** Quaternion from a Rot (degrees) in character space. */
export function rotQ(r: Rot, out: THREE.Quaternion): THREE.Quaternion {
  // pitch around x (the left axis): + bends forward, i.e. the head goes toward +z -> rotation about +x by +angle
  _e.set(r[0] * DEG, r[1] * DEG, -r[2] * DEG, 'YXZ');
  return out.setFromEuler(_e);
}

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
    if (roll !== 0) w.premultiply(new THREE.Quaternion().setFromAxisAngle(_v2, roll * DEG));
    this.setWorld(b, w);
  }

  private rest(b: BoneInfo): void {
    b.bone.quaternion.copy(b.restQ);
    this.fk(b, b.restQ);
  }

  /** Pose the skeleton. `look` (optional) is a character-space point the head turns toward (weight 0..1). */
  apply(p: Pose, look?: THREE.Vector3, lookWeight = 0): void {
    const k = this.k;
    const B = (n: string) => this.bones.get(n) as BoneInfo;
    const root = B('Root');
    this.rest(root);
    // hips
    const pelvis = B('pelvis');
    const hq = rotQ(p.hipRot, new THREE.Quaternion());
    this.setWorld(pelvis, _q.copy(hq).multiply(pelvis.restWQ));
    // move the pelvis: its local position is in Root space
    const off = new THREE.Vector3(p.hip[0] * k, p.hip[1] * k, p.hip[2] * k).applyQuaternion(_q.copy(root.wq).invert());
    pelvis.bone.position.copy(pelvis.restP).add(off);
    pelvis.wp.copy(pelvis.restWP).add(_v.set(p.hip[0] * k, p.hip[1] * k, p.hip[2] * k));
    // spine: the chest rotation spread over three bones, then neck + head
    const third: Rot = [p.chest[0] / 3, p.chest[1] / 3, p.chest[2] / 3];
    const step = rotQ(third, new THREE.Quaternion());
    const acc = hq.clone();
    for (const n of ['spine_01', 'spine_02', 'spine_03']) {
      acc.multiply(step);
      const b = B(n);
      this.setWorld(b, _q.copy(acc).multiply(b.restWQ));
    }
    const chestQ = acc.clone();
    const neck = B('neck_01');
    const half: Rot = [p.head[0] / 2, p.head[1] / 2, p.head[2] / 2];
    const hstep = rotQ(half, new THREE.Quaternion());
    acc.multiply(hstep);
    this.setWorld(neck, _q.copy(acc).multiply(neck.restWQ));
    acc.multiply(hstep);
    const head = B('head');
    let headQ = _q.copy(acc).multiply(head.restWQ).clone();
    if (look && lookWeight > 0) {
      // turn the face (+z of the rest head) toward the point
      const face = new THREE.Vector3(0, 0, 1).applyQuaternion(acc);
      const want = _v.copy(look).sub(head.wp).normalize();
      const turn = new THREE.Quaternion().setFromUnitVectors(face, want);
      turn.slerp(new THREE.Quaternion(), 1 - Math.min(1, lookWeight));
      headQ = turn.multiply(headQ);
    }
    this.setWorld(head, headQ);

    // arms
    for (const s of ['l', 'r'] as const) {
      const cl = B(`clavicle_${s}`);
      const shrug = (s === 'l' ? p.shrugL : p.shrugR) * (s === 'l' ? 1 : -1);
      const shrugQ = rotQ([0, 0, shrug], new THREE.Quaternion());
      this.setWorld(cl, chestQ.clone().multiply(shrugQ).multiply(cl.restWQ));
      const t = s === 'l' ? p.handL : p.handR;
      this.ik(B(`upperarm_${s}`), B(`lowerarm_${s}`), t);
      const hand = B(`hand_${s}`);
      const fore = B(`lowerarm_${s}`);
      // the hand continues the forearm; roll sets the fist (horizontal / vertical)
      const dir = new THREE.Vector3().copy(fore.axis).applyQuaternion(fore.wq);
      const roll = (s === 'l' ? p.wristL : -p.wristR);
      this.aim(hand, dir, roll);
      this.curl(s, p.fist);
    }
    // legs
    for (const s of ['l', 'r'] as const) {
      const t = s === 'l' ? p.footL : p.footR;
      this.ik(B(`thigh_${s}`), B(`calf_${s}`), t);
      const foot = B(`foot_${s}`);
      const toe = s === 'l' ? p.toeL : p.toeR;
      // foot points forward along z, pitched and yawed; flat on the floor at pitch 0
      const fwd = new THREE.Vector3(0, -Math.sin(Math.max(-30, toe[0] + 25) * DEG), Math.cos(Math.max(-30, toe[0] + 25) * DEG));
      fwd.applyAxisAngle(_v.set(0, 1, 0), toe[1] * DEG);
      this.aim(foot, fwd);
      this.rest(B(`ball_${s}`));
    }
  }

  /** Two-bone IK: upper + lower reach the target, the middle joint bends toward the pole. */
  private ik(upper: BoneInfo, lower: BoneInfo, t: LimbTarget): void {
    const k = this.k;
    const a = upper.length;
    const b = lower.length;
    // the start of the chain after the parents moved
    this.fk(upper, upper.restQ);
    const S = upper.wp;
    const T = _v.set(t.p[0] * k, t.p[1] * k, t.p[2] * k);
    const d0 = T.clone().sub(S);
    let d = d0.length();
    const max = (a + b) * 0.999;
    if (d > max) {
      d0.multiplyScalar(max / d);
      d = max;
    }
    d = Math.max(d, Math.abs(a - b) + 1e-3);
    const u = d0.clone().normalize();
    const pole = new THREE.Vector3(t.pole[0], t.pole[1], t.pole[2]);
    const v = pole.sub(u.clone().multiplyScalar(pole.dot(u)));
    if (v.lengthSq() < 1e-8) v.set(0, -1, 0);
    v.normalize();
    const cosA = Math.min(1, Math.max(-1, (a * a + d * d - b * b) / (2 * a * d)));
    const sinA = Math.sqrt(1 - cosA * cosA);
    const E = S.clone().add(u.clone().multiplyScalar(a * cosA)).add(v.multiplyScalar(a * sinA));
    this.aim(upper, E.clone().sub(S));
    this.fk(lower, lower.restQ);
    this.aim(lower, S.clone().add(d0).sub(E));
  }

  private curl(s: 'l' | 'r', amount: number): void {
    for (const f of FINGERS) {
      for (const i of [1, 2, 3]) {
        const b = this.bones.get(`${f}_0${i}_${s}`);
        if (!b) continue;
        const axis = this.fingerAxis.get(b.bone);
        const ang = amount * (i === 1 ? 80 : i === 2 ? 95 : 70) * DEG;
        b.bone.quaternion.copy(b.restQ);
        if (axis) b.bone.quaternion.multiply(_q.setFromAxisAngle(axis, ang));
      }
    }
    for (const i of [1, 2, 3]) {
      const b = this.bones.get(`thumb_0${i}_${s}`);
      if (b) b.bone.quaternion.copy(b.restQ);
    }
  }
}
