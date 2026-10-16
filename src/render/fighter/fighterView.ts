// A fighter on screen: loads the two MPFB bodies once (meshopt-compressed glTF), clones one per fighter, applies the
// look (morphs, skin, hair, garments) and exposes posing, damage and sweat. See docs/ARCHITECTURE.md contract 2.

import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { FighterLook } from './look';
import { makeGarmentMaterial, makeHairMaterial, makeSkinMaterial, type SkinUniforms } from './materials';
import { FighterRig, type Pose } from './rig';

const BASE = './assets/fighters/';

interface BodyAsset {
  gltf: GLTF;
  /** Standing height of the model (m), from fighters.json. */
  height: number;
}

let bodies: Promise<Record<'m' | 'f', BodyAsset>> | null = null;
const texCache = new Map<string, Promise<THREE.Texture>>();
const texLoader = new THREE.TextureLoader();

function tex(name: string, srgb = true): Promise<THREE.Texture> {
  const key = `${name}|${srgb}`;
  let p = texCache.get(key);
  if (!p) {
    p = texLoader.loadAsync(`${BASE}tex/${name}.webp`).then(t => {
      t.flipY = false;
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = 4;
      return t;
    });
    texCache.set(key, p);
  }
  return p;
}

/** Load both bodies (once). */
export function loadFighterBodies(): Promise<Record<'m' | 'f', BodyAsset>> {
  if (!bodies) {
    bodies = (async () => {
      await MeshoptDecoder.ready;
      const loader = new GLTFLoader();
      loader.setMeshoptDecoder(MeshoptDecoder);
      const info = (await (await fetch(`${BASE}fighters.json`)).json()) as Record<'m' | 'f', { height: number }>;
      const [m, f] = await Promise.all([loader.loadAsync(`${BASE}fighter_m.glb`), loader.loadAsync(`${BASE}fighter_f.glb`)]);
      return { m: { gltf: m, height: info.m.height }, f: { gltf: f, height: info.f.height } };
    })();
  }
  return bodies;
}

export interface FighterView {
  /** Put this in the scene; its position / rotation / scale place the fighter. */
  root: THREE.Group;
  rig: FighterRig;
  look: FighterLook;
  /** Scale from model to world (look.height / model height). */
  scale: number;
  pose(p: Pose, look?: THREE.Vector3, lookWeight?: number): void;
  setDamage(head: number, body: number, legs: number): void;
  setSweat(v: number): void;
  setShadows(on: boolean): void;
  dispose(): void;
}

function matName(o: THREE.Mesh): string {
  const m = o.material as THREE.Material | THREE.Material[];
  return Array.isArray(m) ? m[0]?.name ?? '' : m.name;
}

/** Build one fighter for `look`. */
export async function createFighterView(look: FighterLook): Promise<FighterView> {
  const all = await loadFighterBodies();
  const body = all[look.sex];
  const scene = cloneSkinned(body.gltf.scene) as THREE.Group;
  const k = body.height / 1.747;
  const [skinMap, hairMap, browMap, eyeMap, lashMap, teethMap] = await Promise.all([
    tex(`skin_${look.race}_${look.sex}`),
    look.hair === 'bald' || look.hair === 'buzz' ? Promise.resolve(null) : tex(`hair_${look.hair}`),
    tex(`brow_${look.brow}`),
    tex(`eye_${look.eyes}`),
    tex('lashes'),
    tex('teeth'),
  ]);
  const hairNormal = look.hair === 'short02' ? await tex('hair_short02_n', false) : undefined;
  const skin = makeSkinMaterial(skinMap, look, k);
  let skinU: SkinUniforms = skin.u;
  const disposables: THREE.Material[] = [skin.mat];
  const meshes: THREE.Mesh[] = [];
  scene.traverse(o => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });
  for (const mesh of meshes) {
    const name = matName(mesh);
    mesh.frustumCulled = false;
    // morphs: the same names on every part, so clothes and hair follow the body
    if (mesh.morphTargetDictionary && mesh.morphTargetInfluences) {
      for (const [key, idx] of Object.entries(mesh.morphTargetDictionary)) mesh.morphTargetInfluences[idx] = look.morphs[key] ?? 0;
    }
    let mat: THREE.Material | null = null;
    if (name === 'body') mat = skin.mat;
    else if (name.startsWith('hair_')) {
      if (name === `hair_${look.hair}` && hairMap) mat = makeHairMaterial(hairMap, look.hairColor, hairNormal);
    } else if (name.startsWith('brow_')) {
      if (name === `brow_${look.brow}`) mat = makeHairMaterial(browMap, look.hairColor, undefined, 0.12);
    } else if (name === 'eyes') mat = new THREE.MeshStandardMaterial({ map: eyeMap, roughness: 0.08 });
    else if (name === 'lashes') {
      const m = new THREE.MeshStandardMaterial({ map: lashMap, alphaTest: 0.4, side: THREE.DoubleSide, color: 0x222222 });
      mat = m;
    } else if (name === 'teeth') mat = new THREE.MeshStandardMaterial({ map: teethMap, roughness: 0.3 });
    else if (name === 'shorts') mat = makeGarmentMaterial('shorts', look, k);
    else if (name === 'gloves') mat = makeGarmentMaterial('gloves', look, k);
    else if (name === 'top') mat = makeGarmentMaterial('top', look, k);
    if (!mat) {
      mesh.visible = false;
      mesh.parent?.remove(mesh);
      continue;
    }
    if (mat !== skin.mat) disposables.push(mat);
    mesh.material = mat;
    mesh.castShadow = name === 'body' || name === 'shorts' || name.startsWith('hair_');
    mesh.receiveShadow = name === 'body' || name === 'shorts' || name === 'top';
  }
  const root = new THREE.Group();
  root.name = 'fighter';
  root.add(scene);
  const scale = look.height / body.height;
  root.scale.setScalar(scale);
  const rig = new FighterRig(scene, body.height);
  return {
    root,
    rig,
    look,
    scale,
    pose(p, lookAt, w) {
      rig.apply(p, lookAt, w);
    },
    setDamage(head, bodyD, legs) {
      skinU.uDamage.value.set(head, bodyD, legs);
    },
    setSweat(v) {
      skinU.uSweat.value = v;
    },
    setShadows(on) {
      scene.traverse(o => {
        if ((o as THREE.Mesh).isMesh) o.castShadow = on && o.castShadow;
      });
    },
    dispose() {
      for (const m of disposables) m.dispose();
      root.removeFromParent();
      skinU = skin.u;
    },
  };
}
