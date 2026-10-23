// Contact shadows: soft dark blobs on the mat under the parts of a fighter that touch it (feet, knees, hands, hips,
// back, head). They are what makes a body sit on the canvas instead of floating over it: the key light's shadow map
// gives the cast shadow, these give the tight, dark contact where skin meets the mat (ambient occlusion), and on the
// 'low' tier, which has no shadow map, they are the only shadow. One instanced draw call for both fighters, no
// textures (the falloff is computed in the shader), a few hundred bytes uploaded a frame.

import * as THREE from 'three';

/** A bone that can touch the mat: how big its blob is, and the height (m) at which it has faded out. */
interface Contact {
  bone: string;
  /** Second bone: the blob stretches from `bone` to it (feet: ankle to ball). */
  to?: string;
  radius: number;
  fade: number;
  strength: number;
}

const CONTACTS: readonly Contact[] = [
  { bone: 'foot_l', to: 'ball_l', radius: 0.11, fade: 0.32, strength: 0.85 },
  { bone: 'foot_r', to: 'ball_r', radius: 0.11, fade: 0.32, strength: 0.85 },
  { bone: 'calf_l', radius: 0.12, fade: 0.32, strength: 0.75 },
  { bone: 'calf_r', radius: 0.12, fade: 0.32, strength: 0.75 },
  { bone: 'hand_l', radius: 0.1, fade: 0.28, strength: 0.6 },
  { bone: 'hand_r', radius: 0.1, fade: 0.28, strength: 0.6 },
  { bone: 'pelvis', to: 'spine_02', radius: 0.24, fade: 0.42, strength: 0.85 },
  { bone: 'spine_03', to: 'spine_02', radius: 0.24, fade: 0.42, strength: 0.85 },
  { bone: 'head', radius: 0.13, fade: 0.36, strength: 0.7 },
];

/** Per fighter: the contacts plus one wide, faint pool under the whole body. */
const PER_FIGHTER = CONTACTS.length + 1;

const vert = /* glsl */ `
attribute float aAlpha;
varying vec2 vUv;
varying float vAlpha;
void main() {
  vUv = uv * 2.0 - 1.0;
  vAlpha = aAlpha;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`;

const frag = /* glsl */ `
varying vec2 vUv;
varying float vAlpha;
void main() {
  float r2 = dot(vUv, vUv);
  if (r2 > 1.0 || vAlpha <= 0.0) discard;
  // a gaussian-ish core with a long soft edge
  float a = exp(-r2 * 3.2) - 0.0408 * r2;
  gl_FragColor = vec4(0.0, 0.0, 0.0, clamp(a, 0.0, 1.0) * vAlpha);
}`;

export type BonePos = (side: 0 | 1, bone: string, out: THREE.Vector3) => THREE.Vector3;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class ContactShadows {
  readonly mesh: THREE.InstancedMesh;
  private alpha: Float32Array;
  private alphaAttr: THREE.InstancedBufferAttribute;
  /** Darkness of the wide pool under the body (stronger when there is no shadow map). */
  private pool: number;

  constructor(hasShadowMap: boolean) {
    const n = PER_FIGHTER * 2;
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    this.alpha = new Float32Array(n);
    this.alphaAttr = new THREE.InstancedBufferAttribute(this.alpha, 1);
    this.alphaAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aAlpha', this.alphaAttr);
    const mat = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, n);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
    this.mesh.name = 'contact-shadows';
    this.pool = hasShadowMap ? 0.28 : 0.5;
  }

  /** Place the blobs from the fighters' bones (world space; the mat is at y = 0). */
  update(bonePos: BonePos): void {
    let i = 0;
    for (const side of [0, 1] as const) {
      // the pool: under the hips, wide; a standing fighter gets a faint one, a fighter lying down a big dark one
      bonePos(side, 'pelvis', _a);
      bonePos(side, 'head', _b);
      const lying = 1 - THREE.MathUtils.smoothstep(_b.y, 0.5, 1.2);
      const cx = (_a.x + _b.x * lying) / (1 + lying);
      const cz = (_a.z + _b.z * lying) / (1 + lying);
      const len = Math.hypot(_b.x - _a.x, _b.z - _a.z);
      const ang = Math.atan2(_b.x - _a.x, _b.z - _a.z);
      this.set(i++, cx, cz, ang, 0.55 + len * 0.5, 0.55, this.pool * (0.6 + lying * 0.5));
      for (const c of CONTACTS) {
        bonePos(side, c.bone, _a);
        let h = _a.y;
        let x = _a.x;
        let z = _a.z;
        let along = 0;
        let ang2 = 0;
        if (c.to) {
          bonePos(side, c.to, _b);
          h = Math.min(h, _b.y);
          x = (x + _b.x) / 2;
          z = (z + _b.z) / 2;
          along = Math.hypot(_b.x - _a.x, _b.z - _a.z);
          ang2 = Math.atan2(_b.x - _a.x, _b.z - _a.z);
        }
        const near = 1 - THREE.MathUtils.smoothstep(h, 0.02, c.fade);
        const r = c.radius * (1 + (1 - near) * 0.8);
        this.set(i++, x, z, ang2, r * 2, r * 2 + along * 1.3, c.strength * near * near);
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
  }

  private set(i: number, x: number, z: number, ang: number, w: number, l: number, a: number): void {
    _q.setFromAxisAngle(UP, ang);
    _m.compose(_p.set(x, 0.002, z), _q, _s.set(w, 1, l));
    this.mesh.setMatrixAt(i, _m);
    this.alpha[i] = a;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.removeFromParent();
  }
}
