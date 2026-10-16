// Materials for the realistic fighters. The skin is a standard PBR material patched (onBeforeCompile) with what a
// fight needs: tone and warmth, stubble, bruising per zone (face, body, legs), sweat sheen and tattoo ink. Regions
// are found from the bind-pose position (before skinning, after the body morphs), so no extra textures or UV work
// is needed. Hair and brows are re-coloured from the luminance of their CC0 textures.

import * as THREE from 'three';
import type { FighterLook, TattooId } from './look';

export interface SkinUniforms {
  uTint: { value: THREE.Color };
  uBeard: { value: number };
  uBeardColor: { value: THREE.Color };
  /** head, body, legs damage 0..1 */
  uDamage: { value: THREE.Vector3 };
  uSweat: { value: number };
  /** Model height scale (base male = 1): region heights are authored for 1.747 m. */
  uK: { value: number };
  uTattoo: { value: number };
  uInk: { value: THREE.Color };
}

const TATTOO_BITS: Record<TattooId, number> = { sleeveL: 1, sleeveR: 2, chest: 4, back: 8, ribs: 16, forearmL: 32, forearmR: 64, calf: 128 };

const NOISE = /* glsl */ `
float ck_hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float ck_noise(vec3 x){ vec3 i = floor(x); vec3 f = fract(x); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(ck_hash(i+vec3(0,0,0)), ck_hash(i+vec3(1,0,0)), f.x), mix(ck_hash(i+vec3(0,1,0)), ck_hash(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(ck_hash(i+vec3(0,0,1)), ck_hash(i+vec3(1,0,1)), f.x), mix(ck_hash(i+vec3(0,1,1)), ck_hash(i+vec3(1,1,1)), f.x), f.y), f.z); }
float ck_box(vec3 p, vec3 lo, vec3 hi, float soft){ vec3 a = smoothstep(lo - soft, lo + soft, p) * (1.0 - smoothstep(hi - soft, hi + soft, p)); return a.x * a.y * a.z; }
`;

function bindPosVertex(shader: THREE.WebGLProgramParametersWithUniforms): void {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vBind;')
    .replace('#include <skinning_vertex>', 'vBind = transformed;\n#include <skinning_vertex>');
}

/** The skin: base texture + everything a fight does to it. */
export function makeSkinMaterial(map: THREE.Texture, look: FighterLook, k: number): { mat: THREE.MeshStandardMaterial; u: SkinUniforms } {
  const mat = new THREE.MeshStandardMaterial({ map, roughness: 0.62, metalness: 0 });
  const tint = new THREE.Color(1, 1, 1).multiplyScalar(look.tone);
  tint.r *= 1 + look.warmth * 0.05;
  tint.b *= 1 - look.warmth * 0.06;
  let bits = 0;
  for (const t of look.tattoos) bits |= TATTOO_BITS[t];
  const u: SkinUniforms = {
    uTint: { value: tint },
    uBeard: { value: look.beard },
    uBeardColor: { value: new THREE.Color(look.hairColor).multiplyScalar(0.55) },
    uDamage: { value: new THREE.Vector3() },
    uSweat: { value: 0 },
    uK: { value: k },
    uTattoo: { value: bits },
    uInk: { value: new THREE.Color(look.tattooInk) },
  };
  mat.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, u);
    bindPosVertex(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vBind;
uniform vec3 uTint; uniform float uBeard; uniform vec3 uBeardColor; uniform vec3 uDamage; uniform float uSweat;
uniform float uK; uniform float uTattoo; uniform vec3 uInk;
${NOISE}
bool ck_bit(float bits, float b){ return mod(floor(bits / b), 2.0) > 0.5; }
float ck_tattoo(vec3 p){
  float ink = 0.0;
  float ax = abs(p.x);
  // blackwork: noise-cut bands so every piece looks hand-drawn
  float bands = smoothstep(0.35, 0.55, ck_noise(vec3(p.x * 18.0, p.y * 46.0, p.z * 18.0))) * smoothstep(0.3, 0.6, sin(p.y * 70.0 + ck_noise(p * 9.0) * 6.0) * 0.5 + 0.5);
  float tribal = smoothstep(0.52, 0.6, ck_noise(p * vec3(22.0, 30.0, 22.0)) + 0.25 * sin(p.y * 40.0));
  if (p.x > 0.0 && ck_bit(uTattoo, 1.0)) ink = max(ink, tribal * ck_box(vec3(ax, p.y, p.z), vec3(0.20, 1.20, -0.2), vec3(0.37, 1.43, 0.2), 0.01));
  if (p.x < 0.0 && ck_bit(uTattoo, 2.0)) ink = max(ink, tribal * ck_box(vec3(ax, p.y, p.z), vec3(0.20, 1.20, -0.2), vec3(0.37, 1.43, 0.2), 0.01));
  if (ck_bit(uTattoo, 4.0)) ink = max(ink, bands * ck_box(p, vec3(-0.13, 1.27, 0.05), vec3(0.13, 1.37, 0.4), 0.01));
  if (ck_bit(uTattoo, 8.0)) ink = max(ink, tribal * ck_box(p, vec3(-0.15, 1.15, -0.4), vec3(0.15, 1.42, -0.06), 0.01));
  if (ck_bit(uTattoo, 16.0)) ink = max(ink, bands * ck_box(vec3(ax, p.y, p.z), vec3(0.09, 1.08, -0.1), vec3(0.16, 1.24, 0.12), 0.01));
  if (p.x > 0.0 && ck_bit(uTattoo, 32.0)) ink = max(ink, bands * ck_box(vec3(ax, p.y, p.z), vec3(0.37, 1.09, -0.2), vec3(0.50, 1.22, 0.3), 0.01));
  if (p.x < 0.0 && ck_bit(uTattoo, 64.0)) ink = max(ink, bands * ck_box(vec3(ax, p.y, p.z), vec3(0.37, 1.09, -0.2), vec3(0.50, 1.22, 0.3), 0.01));
  if (ck_bit(uTattoo, 128.0)) ink = max(ink, tribal * ck_box(vec3(ax, p.y, p.z), vec3(0.12, 0.18, -0.2), vec3(0.24, 0.42, 0.0), 0.01));
  return ink;
}`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
vec3 bp = vBind / uK;
diffuseColor.rgb *= uTint;
// stubble: lower face and jaw, in front of the ears, broken up by noise
float jaw = ck_box(bp, vec3(-0.075, 1.515, 0.02), vec3(0.075, 1.618, 0.2), 0.012);
float lips = ck_box(bp, vec3(-0.026, 1.567, 0.07), vec3(0.026, 1.596, 0.2), 0.004);
float stub = jaw * (1.0 - lips) * smoothstep(0.25, 0.75, ck_noise(bp * 900.0)) * uBeard;
diffuseColor.rgb = mix(diffuseColor.rgb, uBeardColor, stub * 0.85);
// bruising: cheekbones and brows for head damage, ribs for body, outer thighs for legs
float face = ck_box(vec3(abs(bp.x), bp.y, bp.z), vec3(0.018, 1.615, 0.03), vec3(0.068, 1.685, 0.2), 0.012);
float ribs = ck_box(vec3(abs(bp.x), bp.y, bp.z), vec3(0.04, 1.04, -0.05), vec3(0.17, 1.30, 0.3), 0.03);
float thigh = ck_box(vec3(abs(bp.x), bp.y, bp.z), vec3(0.06, 0.52, -0.15), vec3(0.22, 0.88, 0.15), 0.04);
float blot = 0.55 + 0.45 * ck_noise(bp * 60.0);
float red = clamp(face * uDamage.x * 1.2 + ribs * uDamage.y + thigh * uDamage.z, 0.0, 1.0) * blot;
diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.95, 0.42, 0.45), red * 0.7);
float purple = face * smoothstep(0.55, 1.0, uDamage.x) * blot;
diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.55, 0.38, 0.55), purple * 0.6);
// ink
float ink = ck_tattoo(bp);
diffuseColor.rgb = mix(diffuseColor.rgb, uInk, ink * 0.85);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.28, uSweat);`,
      );
  };
  mat.customProgramCacheKey = () => 'ck-skin';
  return { mat, u };
}

/** Hair and brows: alpha-tested cards, coloured from the texture's luminance. */
export function makeHairMaterial(map: THREE.Texture, color: number, normal?: THREE.Texture, alphaTest = 0.3): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ map, normalMap: normal ?? null, alphaTest, side: THREE.DoubleSide, roughness: 0.55, metalness: 0 });
  mat.alphaToCoverage = false;
  const c = new THREE.Color(color);
  mat.onBeforeCompile = shader => {
    shader.uniforms.uHair = { value: c };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uHair;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
diffuseColor.rgb = uHair * (0.35 + lum * 2.2);`,
      );
  };
  mat.customProgramCacheKey = () => 'ck-hair';
  return mat;
}

export type GarmentKind = 'shorts' | 'gloves' | 'top';

/** Fabric and leather: colour with stripes / trims placed in bind-pose space. */
export function makeGarmentMaterial(kind: GarmentKind, look: FighterLook, k: number): THREE.MeshStandardMaterial {
  const base = kind === 'gloves' ? look.gloveColor : kind === 'top' ? look.topColor : look.shortsColor;
  const mat = new THREE.MeshStandardMaterial({
    color: base,
    roughness: kind === 'gloves' ? 0.42 : 0.78,
    metalness: 0,
    sheen: 0,
  } as THREE.MeshStandardMaterialParameters);
  const style = kind === 'shorts' ? ['plain', 'side', 'split', 'trim'].indexOf(look.shorts) : kind === 'gloves' ? 10 : 20;
  mat.onBeforeCompile = shader => {
    shader.uniforms.uTrim = { value: new THREE.Color(look.shortsTrim) };
    shader.uniforms.uStyle = { value: style };
    shader.uniforms.uK = { value: k };
    bindPosVertex(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vBind;\nuniform vec3 uTrim; uniform float uStyle; uniform float uK;\n${NOISE}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
vec3 bp = vBind / uK;
float ax = abs(bp.x);
if (uStyle < 9.0) {
  // shorts: waistband, then the style
  float band = smoothstep(1.03, 1.045, bp.y);
  vec3 trim = uTrim;
  float t = 0.0;
  if (uStyle > 0.5 && uStyle < 1.5) t = smoothstep(0.012, 0.004, abs(ax - 0.165 - (1.0 - bp.y) * 0.05)) * step(0.0, bp.z + 0.1);
  if (uStyle > 1.5 && uStyle < 2.5) t = step(0.0, bp.x);
  if (uStyle > 2.5) t = smoothstep(0.69, 0.68, bp.y) * 0.0 + smoothstep(0.03, 0.0, bp.y - 0.62) * step(0.58, bp.y);
  diffuseColor.rgb = mix(diffuseColor.rgb, trim, clamp(t, 0.0, 1.0));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.04), band * 0.9);
  // woven fabric grain
  diffuseColor.rgb *= 0.92 + 0.08 * ck_noise(bp * 400.0);
} else if (uStyle < 19.0) {
  // gloves: a lighter padded knuckle strip and a white wrist strap
  float strap = smoothstep(0.012, 0.0, abs(bp.y - 1.03 - (ax - 0.5) * 0.4)) * step(0.46, ax) * step(ax, 0.56);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92), strap * 0.0);
  diffuseColor.rgb *= 0.9 + 0.1 * ck_noise(bp * 250.0);
} else {
  diffuseColor.rgb *= 0.92 + 0.08 * ck_noise(bp * 400.0);
}`,
      );
  };
  mat.customProgramCacheKey = () => `ck-${kind}`;
  return mat;
}
