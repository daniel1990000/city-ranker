// Hit effects: sweat spray and impact flashes, as one pooled Points cloud (one draw call, no allocations per hit).

import * as THREE from 'three';

const MAX = 600;

export class HitFx {
  readonly points: THREE.Points;
  private pos = new Float32Array(MAX * 3);
  private vel = new Float32Array(MAX * 3);
  private life = new Float32Array(MAX);
  private size = new Float32Array(MAX);
  private col = new Float32Array(MAX * 3);
  private next = 0;
  /** Live particles after the last update (nothing to move or upload while it is 0). */
  private alive = 0;
  /** A burst wrote sizes and colours: upload them with the next update. */
  private spawned = false;
  private geo = new THREE.BufferGeometry();

  constructor() {
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    this.geo.setAttribute('aLife', new THREE.BufferAttribute(this.life, 1));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
      uniforms: { uScale: { value: 400 } },
      vertexShader: `attribute float aSize; attribute float aLife; varying float vLife; varying vec3 vCol; uniform float uScale;
        void main(){ vLife = aLife; vCol = color; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
        gl_PointSize = aLife > 0.0 ? aSize * uScale / -mv.z : 0.0; }`,
      fragmentShader: `varying float vLife; varying vec3 vCol; void main(){ if (vLife <= 0.0) discard; vec2 d = gl_PointCoord - 0.5; float r = length(d);
        if (r > 0.5) discard; float a = (1.0 - r * 2.0) * clamp(vLife * 3.0, 0.0, 1.0); gl_FragColor = vec4(vCol * a, a); }`,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
  }

  /** A burst at `at`, flying toward `dir` (world), strength 0..1. */
  burst(at: THREE.Vector3, dir: THREE.Vector3, strength: number, kind: 'sweat' | 'flash' = 'sweat'): void {
    const n = kind === 'flash' ? 6 : Math.round(10 + strength * 40);
    this.spawned = true;
    for (let i = 0; i < n; i++) {
      const k = this.next;
      this.next = (this.next + 1) % MAX;
      this.pos[k * 3] = at.x;
      this.pos[k * 3 + 1] = at.y;
      this.pos[k * 3 + 2] = at.z;
      const sp = kind === 'flash' ? 0.2 : 1 + Math.random() * 2.5 * (0.5 + strength);
      this.vel[k * 3] = dir.x * sp + (Math.random() - 0.5) * 1.6;
      this.vel[k * 3 + 1] = dir.y * sp + Math.random() * 1.4;
      this.vel[k * 3 + 2] = dir.z * sp + (Math.random() - 0.5) * 1.6;
      this.life[k] = kind === 'flash' ? 0.12 : 0.35 + Math.random() * 0.4;
      this.size[k] = kind === 'flash' ? 0.35 + strength * 0.4 : 0.012 + Math.random() * 0.02;
      const c = kind === 'flash' ? [1, 0.92, 0.75] : [0.75, 0.82, 0.9];
      this.col[k * 3] = c[0];
      this.col[k * 3 + 1] = c[1];
      this.col[k * 3 + 2] = c[2];
    }
  }

  update(dt: number): void {
    if (this.alive === 0 && !this.spawned) return;
    let alive = 0;
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      this.vel[i * 3 + 1] -= 9.8 * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.pos[i * 3 + 1] < 0) this.life[i] = 0;
      if (this.life[i] > 0) alive++;
    }
    // positions and lives move every frame while anything is alive (and once more to hide the last ones);
    // sizes and colours only change when a burst spawns
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aLife as THREE.BufferAttribute).needsUpdate = true;
    if (this.spawned) {
      (this.geo.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
      (this.geo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
      this.spawned = false;
    }
    this.alive = alive;
  }

  dispose(): void {
    this.geo.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}
