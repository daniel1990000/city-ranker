// Fighter portraits for the menus: each fighter's head and shoulders rendered from the real 3D model under studio
// light into a small image, one per frame in the background, cached for the session.

import * as THREE from 'three';
import { createFighterView } from './fighter/fighterView';
import { lookFromSeed } from './fighter/look';
import { RELAXED } from './fighter/poses';
import type { FighterSpec } from '../game/fight/types';

const SIZE = 256;
const cache = new Map<string, string>();
const waiting = new Map<string, ((url: string) => void)[]>();
const queue: FighterSpec[] = [];
let busy = false;
let renderer: THREE.WebGLRenderer | null = null;

/** Use the app's renderer (portraits render into an off-screen target). */
export function setPortraitRenderer(r: THREE.WebGLRenderer): void {
  renderer = r;
}

/** A portrait image URL for this fighter (resolves when rendered). */
export function portrait(f: FighterSpec): Promise<string> {
  const hit = cache.get(f.id);
  if (hit) return Promise.resolve(hit);
  return new Promise(res => {
    const list = waiting.get(f.id);
    if (list) {
      list.push(res);
      return;
    }
    waiting.set(f.id, [res]);
    queue.push(f);
    void pump();
  });
}

async function pump(): Promise<void> {
  if (busy || !renderer) return;
  busy = true;
  const r = renderer;
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(24, 1, 0.05, 10);
  const key = new THREE.DirectionalLight(0xfff0e0, 3.2);
  key.position.set(0.8, 1.2, 1.4);
  const rim = new THREE.DirectionalLight(0xffc080, 2.4);
  rim.position.set(-1.2, 0.8, -1.2);
  scene.add(key, rim, new THREE.HemisphereLight(0x9098b0, 0x302018, 0.9));
  const target = new THREE.WebGLRenderTarget(SIZE, SIZE, { samples: 4, colorSpace: THREE.SRGBColorSpace });
  const pixels = new Uint8Array(SIZE * SIZE * 4);
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  try {
    while (queue.length) {
      const f = queue.shift() as FighterSpec;
      const look = lookFromSeed(f.lookSeed, f.lookHints, f.division);
      const view = await createFighterView(look);
      view.pose(RELAXED);
      view.root.rotation.y = 0.32;
      scene.add(view.root);
      // frame the head: the model's head bone, through the fighter's scale
      const head = new THREE.Vector3();
      const hb = view.rig.get('head');
      if (hb) head.copy(hb.wp);
      view.root.updateMatrixWorld(true);
      view.root.localToWorld(head);
      cam.position.set(head.x + 0.18, head.y + 0.02, head.z + 0.95);
      cam.lookAt(head.x, head.y - 0.06, head.z);
      const prevTarget = r.getRenderTarget();
      const prevClear = r.getClearAlpha();
      r.setRenderTarget(target);
      r.setClearColor(0x000000, 0);
      r.clear();
      r.render(scene, cam);
      r.readRenderTargetPixels(target, 0, 0, SIZE, SIZE, pixels);
      r.setRenderTarget(prevTarget);
      r.setClearAlpha(prevClear);
      // flip rows (GL is bottom-up)
      const img = ctx.createImageData(SIZE, SIZE);
      for (let y = 0; y < SIZE; y++) img.data.set(pixels.subarray((SIZE - 1 - y) * SIZE * 4, (SIZE - y) * SIZE * 4), y * SIZE * 4);
      ctx.putImageData(img, 0, 0);
      const url = canvas.toDataURL('image/webp', 0.85);
      scene.remove(view.root);
      view.dispose();
      cache.set(f.id, url);
      for (const cb of waiting.get(f.id) ?? []) cb(url);
      waiting.delete(f.id);
      await new Promise(res => setTimeout(res, 16));
    }
  } finally {
    target.dispose();
    busy = false;
  }
}
