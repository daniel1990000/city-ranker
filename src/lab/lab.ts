// Fighter lab (dev only, not in the store build): generated fighters under arena light for screenshots.
//   lab.html            a lineup of fighters in their stance
//   lab.html?close      head-and-shoulders close-up of the first one
//   lab.html?pose=relaxed&seed=3&n=1
import * as THREE from 'three';
import { createFighterView } from '../render/fighter/fighterView';
import { lookFromSeed } from '../render/fighter/look';
import { clonePose, mixPose, RELAXED, STANCE } from '../render/fighter/poses';
import { CLIPS, sampleClip } from '../render/fighter/clips';
import { FighterAnimator } from '../render/fighter/animator';
import type { ActionId } from '../game/fight/types';
import type { DivisionId, LookHints } from '../game/fight/types';

const params = new URLSearchParams(location.search);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0b0f);
const cam = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.1, 100);
const key = new THREE.SpotLight(0xffe8cc, 120, 0, 0.7, 0.6, 1.4);
key.position.set(0.5, 6, 2);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
scene.add(key, key.target);
const rim = new THREE.DirectionalLight(0xffb070, 2.4);
rim.position.set(-3, 3, -4);
scene.add(rim);
const front = new THREE.DirectionalLight(0xfff2e0, 1.1);
front.position.set(1, 1.8, 5);
scene.add(front);
scene.add(new THREE.HemisphereLight(0x8890a0, 0x201810, 0.5));
const floor = new THREE.Mesh(new THREE.CircleGeometry(8, 64), new THREE.MeshStandardMaterial({ color: 0x3a4250, roughness: 0.9 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const n = Number(params.get('n') ?? 6);
const seed0 = Number(params.get('seed') ?? 1);
const close = params.has('close');
const pose = params.get('pose') === 'relaxed' ? RELAXED : STANCE;
const hints: [LookHints, DivisionId][] = [
  [{ sex: 'm', skin: 'light', build: 'athletic' }, 'mLight'],
  [{ sex: 'm', skin: 'dark', build: 'muscular', beard: true }, 'mMiddle'],
  [{ sex: 'f', skin: 'tan' }, 'wBantam'],
  [{ sex: 'm', skin: 'brown', build: 'heavy', tattoos: true }, 'mHeavy'],
  [{ sex: 'f', skin: 'dark' }, 'wStraw'],
  [{ sex: 'm', skin: 'tan', build: 'lean', beard: true, tattoos: true }, 'mWelter'],
];

async function sheet(list: string): Promise<void> {
  // one fighter per clip, frozen at the clip's impact (or at ?u=), seen from the side, 6 per row
  const ids = list.split(',') as ActionId[];
  const look = lookFromSeed(seed0, { sex: params.get('sex') === 'f' ? 'f' : 'm', skin: 'tan', build: 'athletic' }, 'mWelter');
  const cols = 6;
  for (let i = 0; i < ids.length; i++) {
    const clip = CLIPS[ids[i]];
    const u = params.has('u') ? Number(params.get('u')) : clip.impact ?? 0.5;
    const f = await createFighterView(look);
    f.pose(sampleClip(clip, u, clonePose(STANCE), mixPose));
    f.root.position.set((i % cols) * 1.6 - (cols - 1) * 0.8, 0, -Math.floor(i / cols) * 2.4);
    f.root.rotation.y = Math.PI / 2;
    scene.add(f.root);
  }
  const rows = Math.ceil(ids.length / cols);
  cam.position.set(0, 1.4 + rows * 0.9, 9 + rows * 1.2);
  cam.lookAt(0, 0.6, -(rows - 1) * 1.2);
  cam.fov = 38;
  cam.updateProjectionMatrix();
  (window as unknown as { labReady: boolean }).labReady = true;
}

/** One fighter seen from the side; window.labSet(action, u) poses it (scripts/qa contact sheets drive this). */
async function single(): Promise<void> {
  const look = lookFromSeed(seed0, { sex: params.get('sex') === 'f' ? 'f' : 'm', skin: 'tan', build: 'athletic' }, 'mWelter');
  const f = await createFighterView(look);
  f.root.rotation.y = Math.PI / 2;
  scene.add(f.root);
  // a stand-in opponent target (a dim pole at head height, 1.0 m away) to judge reach
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.75, 12), new THREE.MeshStandardMaterial({ color: 0x334455, transparent: true, opacity: 0.35 }));
  pole.position.set(params.has('ground') ? 0 : 1.05, 0.875, 0);
  if (!params.has('nopole')) scene.add(pole);
  cam.position.set(0.4, 1.0, 4.2);
  cam.lookAt(0.4, 0.85, 0);
  (window as unknown as { labSet: (a: ActionId, u: number) => void }).labSet = (a, u) => {
    f.pose(sampleClip(CLIPS[a], u, clonePose(STANCE), mixPose));
  };
  (window as unknown as { labBones: (names: string[]) => Record<string, number[]> }).labBones = names =>
    Object.fromEntries(names.map(n => [n, (f.rig.get(n)?.wp.toArray() ?? []).map(v => Math.round(v * 1000) / 1000)]));
  (window as unknown as { labClip: (a: ActionId) => number }).labClip = a => CLIPS[a].impact ?? 0.5;
  // rest positions divided by the rig's scale (as authored for the base male)
  (window as unknown as { labRest: (names: string[]) => Record<string, number[]> }).labRest = names =>
    Object.fromEntries(names.map(n => [n, f.rig.restPos(n).toArray().map(v => Math.round((v / f.rig.k) * 1000) / 1000)]));
  (window as unknown as { labCam: (p: number[], t: number[]) => void }).labCam = (p, t) => {
    cam.position.set(p[0], p[1], p[2]);
    cam.lookAt(t[0], t[1], t[2]);
  };
  (window as unknown as { labReady: boolean }).labReady = true;
}

/**
 * Two fighters facing each other as in the fight scene (lab.html?pair&sex=f): `labPair(a, b, u, gap)` poses them with
 * clips a and b at time u, `gap` metres apart (0 = sharing one anchor, as on the ground); `labPlay` drives them
 * through the real animator (blends included); `labCheck()` measures penetration between the bodies and the mat.
 * The two bodies differ in size on purpose (?h=1.6,1.7 sets the heights).
 */
async function pair(): Promise<void> {
  const sex = params.get('sex') === 'f' ? 'f' : 'm';
  const heights = (params.get('h') ?? (sex === 'f' ? '1.6,1.7' : '1.75,1.9')).split(',').map(Number);
  const views = await Promise.all(
    [0, 1].map(async i => {
      const look = lookFromSeed(seed0 + i * 5, { sex, skin: i === 0 ? 'tan' : 'dark', build: 'athletic' }, sex === 'f' ? 'wBantam' : 'mWelter');
      look.height = heights[i];
      // different trunks so the two are easy to tell apart
      const v = await createFighterView(look);
      scene.add(v.root);
      return v;
    }),
  );
  const anims = [new FighterAnimator(0), new FighterAnimator(0.37)];
  const place = (gap: number) => {
    views[0].root.position.set(-gap / 2, 0, 0);
    views[0].root.rotation.y = Math.PI / 2;
    views[1].root.position.set(gap / 2, 0, 0);
    views[1].root.rotation.y = -Math.PI / 2;
  };
  place(1);
  views.forEach(v => v.pose(STANCE));
  cam.position.set(0, 2.15, 4.3);
  cam.lookAt(0, 1.0, 0);
  const w = window as unknown as Record<string, unknown>;
  const lookAtOther = (i: number) => {
    const o = views[1 - i];
    o.root.updateMatrixWorld(true);
    const hp = (o.rig.get('head')?.wp ?? new THREE.Vector3()).clone().applyMatrix4(o.root.matrixWorld);
    views[i].root.updateMatrixWorld(true);
    return views[i].root.worldToLocal(hp);
  };
  w.labPair = (a: ActionId, b: ActionId, u: number, gap = 1, look = 0.55) => {
    place(gap);
    views[0].pose(sampleClip(CLIPS[a], u, clonePose(STANCE), mixPose));
    views[1].pose(sampleClip(CLIPS[b], u, clonePose(STANCE), mixPose));
    // twice so each look-at sees the other's final head
    for (const i of [0, 1]) views[i].pose(sampleClip(CLIPS[i === 0 ? a : b], u, clonePose(STANCE), mixPose), lookAtOther(i), look);
  };
  /**
   * Run both animators through a list of steps [actionA, actionB, ticks, length, impact] at 60 fps and stop at the end
   * (or after `stopAt` frames). Lets the blends and the impact alignment be seen as in the game.
   */
  w.labPlay = (steps: [ActionId, ActionId, number, number, number][], gap = 1, stopAt = -1, look = 0.55) => {
    place(gap);
    let frame = 0;
    for (const [a, b, ticks, length, impact] of steps) {
      for (let t = 0; t < ticks; t++) {
        if (stopAt >= 0 && frame >= stopAt) return frame;
        for (const i of [0, 1]) views[i].pose(anims[i].update(i === 0 ? a : b, t, length, impact, 1 / 60), lookAtOther(i), look);
        frame++;
      }
    }
    return frame;
  };
  w.labCam = (p: number[], t: number[]) => {
    cam.position.set(p[0], p[1], p[2]);
    cam.lookAt(t[0], t[1], t[2]);
  };
  w.labCheck = () => bodyCheck(views);
  w.labClipImpact = (a: ActionId) => CLIPS[a].impact ?? 0.5;
  w.labReady = true;
}

/** Capsules (world space) approximating a posed body: [a, b, radius, part name]. */
function capsules(v: Awaited<ReturnType<typeof createFighterView>>): [THREE.Vector3, THREE.Vector3, number, string][] {
  v.root.updateMatrixWorld(true);
  const s = v.look.height / 1.747;
  const P = (n: string) => (v.rig.get(n)?.wp ?? new THREE.Vector3()).clone().applyMatrix4(v.root.matrixWorld);
  const out: [THREE.Vector3, THREE.Vector3, number, string][] = [];
  const add = (a: string, b: string, r: number, name = a) => out.push([P(a), P(b), r * s, name]);
  add('pelvis', 'spine_02', 0.13, 'hips');
  add('spine_02', 'neck_01', 0.13, 'chest');
  add('neck_01', 'head', 0.055, 'neck');
  const head = P('head');
  const top = head.clone().add(P('head').sub(P('neck_01')).normalize().multiplyScalar(0.1 * s));
  out.push([head, top, 0.095 * s, 'head']);
  for (const side of ['l', 'r']) {
    add(`upperarm_${side}`, `lowerarm_${side}`, 0.048, `upperarm_${side}`);
    add(`lowerarm_${side}`, `hand_${side}`, 0.042, `forearm_${side}`);
    const h = P(`hand_${side}`);
    const g = h.clone().add(h.clone().sub(P(`lowerarm_${side}`)).normalize().multiplyScalar(0.07 * s));
    out.push([g, g.clone(), 0.06 * s, `glove_${side}`]);
    add(`thigh_${side}`, `calf_${side}`, 0.075, `thigh_${side}`);
    add(`calf_${side}`, `foot_${side}`, 0.05, `shin_${side}`);
    add(`foot_${side}`, `ball_${side}`, 0.04, `foot_${side}`);
  }
  return out;
}

function segDist(p1: THREE.Vector3, q1: THREE.Vector3, p2: THREE.Vector3, q2: THREE.Vector3): number {
  // closest distance between two segments (Ericson, Real-Time Collision Detection 5.1.9)
  const d1 = q1.clone().sub(p1);
  const d2 = q2.clone().sub(p2);
  const r = p1.clone().sub(p2);
  const a = d1.dot(d1);
  const e = d2.dot(d2);
  const f = d2.dot(r);
  let s = 0;
  let t = 0;
  if (a <= 1e-9 && e <= 1e-9) return r.length();
  if (a <= 1e-9) t = Math.min(1, Math.max(0, f / e));
  else {
    const c = d1.dot(r);
    if (e <= 1e-9) s = Math.min(1, Math.max(0, -c / a));
    else {
      const b = d1.dot(d2);
      const den = a * e - b * b;
      s = den !== 0 ? Math.min(1, Math.max(0, (b * f - c * e) / den)) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = Math.min(1, Math.max(0, -c / a));
      } else if (t > 1) {
        t = 1;
        s = Math.min(1, Math.max(0, (b - c) / a));
      }
    }
  }
  return p1.clone().addScaledVector(d1, s).sub(p2.clone().addScaledVector(d2, t)).length();
}

/** Penetrations deeper than 2 cm between the two bodies, into the mat, and each body's lowest point (m). */
function bodyCheck(views: Awaited<ReturnType<typeof createFighterView>>[]): { pen: string[]; mat: string[]; low: number[] } {
  const caps = views.map(capsules);
  const pen: string[] = [];
  for (const a of caps[0]) {
    for (const b of caps[1]) {
      const d = segDist(a[0], a[1], b[0], b[1]) - a[2] - b[2];
      if (d < -0.02) pen.push(`${a[3]}~${b[3]} ${Math.round(-d * 100)}cm`);
    }
  }
  const mat: string[] = [];
  const low: number[] = [];
  caps.forEach((cs, i) => {
    let lo = 9;
    for (const c of cs) {
      const y = Math.min(c[0].y, c[1].y) - c[2];
      lo = Math.min(lo, y);
      if (y < -0.02) mat.push(`${i}:${c[3]} ${Math.round(-y * 100)}cm`);
    }
    low.push(Math.round(lo * 1000) / 1000);
  });
  return { pen, mat, low };
}

async function main(): Promise<void> {
  if (params.has('pair')) return pair();
  if (params.has('single')) return single();
  if (params.has('sheet')) return sheet(params.get('sheet') as string);
  const spacing = 1.0;
  for (let i = 0; i < n; i++) {
    const [h, d] = params.has('sexf') ? ([{ sex: 'f', skin: 'tan' }, 'wBantam'] as [LookHints, DivisionId]) : hints[i % hints.length];
    const look = lookFromSeed(seed0 + i * 7, h, d);
    if (params.has('hairs')) look.hair = (params.get('hairs') as string).split(',')[i] ?? look.hair;
    const f = await createFighterView(look);
    f.pose(pose);
    if (params.has('plain')) f.root.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh && m.geometry.attributes.position.count === 1794) { const old = m.material as THREE.MeshStandardMaterial; const v = params.get('plain'); m.material = new THREE.MeshStandardMaterial({ map: old.map, alphaTest: 0.3, side: THREE.DoubleSide, normalMap: v === 'n' ? old.normalMap : null }); } });
    if (params.has('tex')) f.root.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh && m.geometry.attributes.position.count === 1794) { const old = m.material as THREE.MeshStandardMaterial; console.log('hairmap', old.map?.uuid, old.map?.flipY); m.material = new THREE.MeshBasicMaterial({ map: old.map }); } });
    if (params.has('red')) f.root.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh && m.geometry.attributes.position.count < 3000 && m.geometry.attributes.position.count > 1000) m.material = new THREE.MeshBasicMaterial({ color: 0xff0000 }); });
    if (params.has('debug')) { console.log('look', JSON.stringify({ hair: look.hair, brow: look.brow })); f.root.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { const mm = m.material as THREE.MeshStandardMaterial; console.log('part', mm.name, m.visible, m.geometry.attributes.position.count, 'uv', !!m.geometry.attributes.uv, 'map', mm.map ? (mm.map.image as HTMLImageElement)?.width : 'none', 'alphaTest', mm.alphaTest); } }); }
    f.root.position.x = (i - (n - 1) / 2) * spacing;
    f.root.rotation.y = params.has('side') ? Math.PI / 2 : 0.35;
    scene.add(f.root);
    if (params.has('damage')) {
      f.setDamage(0.9, 0.7, 0.8);
      f.setSweat(1);
    }
  }
  if (close) {
    cam.position.set(0.25, 1.62, 1.05);
    cam.lookAt(0, 1.58, 0);
  } else {
    cam.position.set(0, 1.3, 3.2 + n * 1.05);
    cam.lookAt(0, 0.95, 0);
  }
  (window as unknown as { labReady: boolean }).labReady = true;
}
renderer.setAnimationLoop(() => renderer.render(scene, cam));
main().catch(e => console.error(e));
