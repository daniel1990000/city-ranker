// The broadcast look: the scene is rendered into an HDR target, the bright parts glow (bloom), tone mapping, then the
// venue's colour grade, a vignette and a touch of film grain, then anti-aliasing. Three tiers so phones that can't
// afford it skip it: 'off' renders straight to the screen (the renderer tone maps), 'medium' grades and smooths
// edges (FXAA), 'high' adds bloom and multisampling. The venue's look comes from `scene.userData.grade` (a Grade).

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import { NEUTRAL_GRADE, sanitiseGrade, type Grade } from './grade';

export type PostTier = 'off' | 'medium' | 'high';

/** Colour grade, vignette and grain on the tone-mapped, sRGB-encoded image (grading maths as in grade.ts). */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uSat: { value: 1 },
    uContrast: { value: 1 },
    uLift: { value: new THREE.Vector3() },
    uGain: { value: new THREE.Vector3(1, 1, 1) },
    uVignette: { value: 0.35 },
    uGrain: { value: 0.04 },
    uTime: { value: 0 },
    uFlash: { value: 0 },
    uAspect: { value: 16 / 9 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uSat, uContrast, uVignette, uGrain, uTime, uFlash, uAspect;
    uniform vec3 uLift, uGain;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec4 src = texture2D(tDiffuse, vUv);
      vec3 c = pow(max(src.rgb, 0.0), vec3(2.2)); // back to (roughly) linear for the grade
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = l + (c - l) * uSat;
      c = (c - 0.18) * uContrast + 0.18;
      c = c * uGain + uLift * (1.0 - clamp(c, 0.0, 1.0));
      c = pow(max(c, 0.0), vec3(1.0 / 2.2));
      // vignette: an ellipse that follows the screen shape
      vec2 d = (vUv - 0.5) * vec2(uAspect, 1.0) / uAspect * 1.6;
      c *= 1.0 - uVignette * smoothstep(0.35, 1.05, length(d));
      // grain hides banding in the dark arena
      c += (hash(vUv * 1000.0 + uTime) - 0.5) * uGrain;
      // a white kick on big impacts
      c = mix(c, vec3(1.0), uFlash);
      gl_FragColor = vec4(c, src.a);
    }`,
};

export class Post {
  tier: PostTier;
  private composer: EffectComposer | null = null;
  private renderPass: RenderPass | null = null;
  private bloom: UnrealBloomPass | null = null;
  private grade: ShaderPass | null = null;
  private fxaa: ShaderPass | null = null;
  private current: Grade = { ...NEUTRAL_GRADE };
  private lastGrade: unknown = null;
  private time = 0;
  private flash = 0;
  private w = 1;
  private h = 1;
  /** Scales on the venue's bloom numbers (QA tuning). */
  bloomK = 0.15;
  thresholdK = 2;
  /** QA: switch single passes off to compare. */
  debugNoGrade = false;
  debugNoFxaa = false;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    tier: PostTier,
  ) {
    this.tier = tier;
    this.build();
  }

  /** Re-apply the grade after a tuning change. */
  retune(): void {
    this.applyGrade();
  }

  setTier(tier: PostTier): void {
    if (tier === this.tier) return;
    this.tier = tier;
    this.build();
    this.setSize(this.w, this.h);
  }

  /** A brief white flash (knockdowns); reduced motion players get none (the caller decides). */
  kick(amount: number): void {
    this.flash = Math.max(this.flash, Math.min(0.5, amount));
  }

  setSize(w: number, h: number): void {
    this.w = w;
    this.h = h;
    if (!this.composer) return;
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    const pr = this.renderer.getPixelRatio();
    if (this.fxaa) (this.fxaa.material.uniforms.resolution.value as THREE.Vector2).set(1 / (w * pr), 1 / (h * pr));
    if (this.grade) this.grade.material.uniforms.uAspect.value = w / Math.max(1, h);
  }

  render(scene: THREE.Scene, camera: THREE.Camera, dt: number): void {
    const g = (scene.userData.grade as Grade | undefined) ?? NEUTRAL_GRADE;
    if (g !== this.lastGrade) {
      this.lastGrade = g;
      this.current = sanitiseGrade(g);
      this.applyGrade();
    }
    this.renderer.toneMappingExposure = this.current.exposure;
    // three.js mixes fog in after the output conversion when drawing straight to the screen, but before it when
    // drawing into the post target; the venues' fog colours were tuned on the first, so convert them for the second
    const fog = scene.fog as THREE.FogExp2 | THREE.Fog | null;
    if (fog) {
      const base = (scene.userData.fogBase as THREE.Color | undefined) ?? (scene.userData.fogBase = fog.color.clone());
      fog.color.copy(base);
      if (this.composer) fog.color.convertSRGBToLinear();
    }
    scene.userData.postLinear = !!this.composer;
    // the same for a plain background colour (the screen clear is not converted either)
    if (scene.background instanceof THREE.Color) {
      const base = (scene.userData.bgBase as THREE.Color | undefined) ?? (scene.userData.bgBase = scene.background.clone());
      scene.background.copy(base);
      if (this.composer) scene.background.convertSRGBToLinear();
    }
    if (!this.composer || !this.renderPass) {
      this.renderer.render(scene, camera);
      return;
    }
    this.time = (this.time + dt) % 1000;
    this.flash = Math.max(0, this.flash - dt * 2.5);
    if (this.grade) {
      this.grade.material.uniforms.uTime.value = this.time;
      this.grade.material.uniforms.uFlash.value = this.flash;
    }
    this.renderPass.scene = scene;
    this.renderPass.camera = camera;
    if (this.grade) this.grade.enabled = !this.debugNoGrade;
    if (this.fxaa) this.fxaa.enabled = !this.debugNoFxaa;
    this.composer.render(dt);
  }

  private applyGrade(): void {
    const g = this.current;
    if (this.bloom) {
      this.bloom.strength = g.bloom * this.bloomK;
      this.bloom.threshold = g.bloomThreshold * this.thresholdK;
    }
    if (this.grade) {
      const u = this.grade.material.uniforms;
      u.uSat.value = g.saturation;
      u.uContrast.value = g.contrast;
      (u.uLift.value as THREE.Vector3).set(g.lift[0], g.lift[1], g.lift[2]);
      (u.uGain.value as THREE.Vector3).set(g.gain[0], g.gain[1], g.gain[2]);
      u.uVignette.value = g.vignette;
      u.uGrain.value = g.grain;
    }
  }

  private build(): void {
    this.composer?.dispose();
    this.composer = null;
    this.renderPass = null;
    this.bloom = null;
    this.grade = null;
    this.fxaa = null;
    if (this.tier === 'off') return;
    const target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples: this.tier === 'high' ? 4 : 0,
    });
    const c = new EffectComposer(this.renderer, target);
    this.renderPass = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
    c.addPass(this.renderPass);
    if (this.tier === 'high') {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.35, 0.4, 1.0);
      c.addPass(this.bloom);
    }
    c.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    c.addPass(this.grade);
    if (this.tier === 'medium') {
      this.fxaa = new ShaderPass(FXAAShader);
      c.addPass(this.fxaa);
    }
    this.composer = c;
    this.lastGrade = null;
  }
}
