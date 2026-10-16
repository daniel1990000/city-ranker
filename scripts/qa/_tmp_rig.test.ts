import { test } from 'vitest';
import * as fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { FighterRig } from '../../src/render/fighter/rig';
import { STANCE } from '../../src/render/fighter/poses';
test('rig', async () => {
  await MeshoptDecoder.ready;
  const buf = fs.readFileSync('public/assets/fighters/fighter_m.glb');
  const l = new GLTFLoader(); l.setMeshoptDecoder(MeshoptDecoder);
  const g: any = await new Promise((res, rej) => l.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', res, rej));
  const scene = g.scene as THREE.Object3D;
  const rig = new FighterRig(scene, 1.747);
  rig.apply(STANCE);
  scene.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  for (const n of ['pelvis', 'upperarm_l', 'lowerarm_l', 'hand_l', 'hand_r', 'thigh_l', 'calf_l', 'foot_l', 'foot_r', 'head']) {
    const b = scene.getObjectByName(n)!; b.getWorldPosition(v);
    const info = (rig as any).get(n);
    console.log(n.padEnd(11), 'three', v.toArray().map(x => x.toFixed(3)).join(' '), ' mine', info.wp.toArray().map((x: number) => x.toFixed(3)).join(' '));
  }
  const arm = scene.getObjectByName('Humanrig') ?? scene.getObjectByName('Root')!.parent!;
  console.log('armature node', arm.name, arm.position.toArray(), arm.quaternion.toArray(), arm.scale.toArray());
});
