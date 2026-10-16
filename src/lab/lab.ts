// Fighter lab (dev only, not in the store build): generated fighters under arena light for screenshots.
//   lab.html            a lineup of fighters in their stance
//   lab.html?close      head-and-shoulders close-up of the first one
//   lab.html?pose=relaxed&seed=3&n=1
import * as THREE from 'three';
import { createFighterView } from '../render/fighter/fighterView';
import { lookFromSeed } from '../render/fighter/look';
import { RELAXED, STANCE } from '../render/fighter/poses';
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

async function main(): Promise<void> {
  const spacing = 1.0;
  for (let i = 0; i < n; i++) {
    const [h, d] = hints[i % hints.length];
    const look = lookFromSeed(seed0 + i * 7, h, d);
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
