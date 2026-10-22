// Image-based lighting for the arena: a small "room" built from the venue's own lights (the lighting grid above,
// the front and rim lights, the glow of the crowd) is pre-filtered once per venue into an environment map. Every
// standard material then picks up soft ambient light and real reflections from it: sweat and skin highlights,
// the glove leather, the cage steel, the vinyl padding.

import * as THREE from 'three';
import type { VenuePreset } from './arena/venues';

let renderer: THREE.WebGLRenderer | null = null;
const cache = new Map<string, THREE.Texture>();

/** The app's renderer (needed to pre-filter the maps). */
export function setEnvRenderer(r: THREE.WebGLRenderer): void {
  renderer = r;
}

const hdr = (hex: number, k: number): THREE.Color => new THREE.Color(hex).multiplyScalar(k);

/** The pre-filtered environment for a venue (built once, cached). Null before the renderer is set. */
export function venueEnvironment(v: VenuePreset): THREE.Texture | null {
  const hit = cache.get(v.id);
  if (hit) return hit;
  if (!renderer) return null;
  const scene = new THREE.Scene();
  const rig = v.rig;
  // the room: dark walls the colour of the venue's shadows, a floor a little lighter (the lit mat bounces)
  const room = new THREE.Mesh(new THREE.BoxGeometry(40, 18, 40), new THREE.MeshBasicMaterial({ color: hdr(v.background, 1.6), side: THREE.BackSide }));
  room.position.y = 7;
  scene.add(room);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), new THREE.MeshBasicMaterial({ color: hdr(v.mat.base, 0.5) }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -1.9;
  scene.add(floor);
  // the lighting grid straight above: a bright square (the key), and the spot cans around it
  const key = new THREE.Mesh(new THREE.PlaneGeometry(rig.trussSize * 1.2, rig.trussSize * 1.2), new THREE.MeshBasicMaterial({ color: hdr(rig.key.color, rig.key.intensity * 3) }));
  key.rotation.x = Math.PI / 2;
  key.position.y = rig.trussHeight + 1;
  scene.add(key);
  const can = new THREE.PlaneGeometry(0.9, 0.9);
  for (let i = 0; i < Math.max(4, rig.fixtures); i++) {
    const a = (i / Math.max(4, rig.fixtures)) * Math.PI * 2;
    const m = new THREE.Mesh(can, new THREE.MeshBasicMaterial({ color: hdr(rig.beam.color, 6) }));
    m.rotation.x = Math.PI / 2;
    m.position.set(Math.cos(a) * rig.trussSize, rig.trussHeight, Math.sin(a) * rig.trussSize);
    scene.add(m);
  }
  // front light (the camera side) and rim light (behind), as large soft panels
  const front = new THREE.Mesh(new THREE.PlaneGeometry(10, 4), new THREE.MeshBasicMaterial({ color: hdr(rig.front.color, rig.front.intensity * 0.9) }));
  front.position.set(0, 4, 14);
  front.lookAt(0, 1, 0);
  scene.add(front);
  const rim = new THREE.Mesh(new THREE.PlaneGeometry(10, 4), new THREE.MeshBasicMaterial({ color: hdr(rig.rim.color, rig.rim.intensity * 0.9) }));
  rim.position.set(0, 5, -14);
  rim.lookAt(0, 1, 0);
  scene.add(rim);
  for (const a of rig.accents) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.8, 8, 6), new THREE.MeshBasicMaterial({ color: hdr(a.color, a.intensity * 2.5) }));
    m.position.set(a.pos[0], a.pos[1], a.pos[2]);
    scene.add(m);
  }
  // the crowd: a dim band all round at seat height
  const band = new THREE.Mesh(
    new THREE.CylinderGeometry(15, 15, 6, 24, 1, true),
    new THREE.MeshBasicMaterial({ color: hdr(v.crowd.lightColor, 0.12 + v.crowd.light * 0.25), side: THREE.BackSide }),
  );
  band.position.y = 2.5;
  scene.add(band);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(scene, 0.04);
  pmrem.dispose();
  scene.traverse(o => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
  });
  cache.set(v.id, rt.texture);
  return rt.texture;
}
