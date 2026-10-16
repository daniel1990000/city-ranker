import { test } from 'vitest';
import * as fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
test('face', async () => {
  await MeshoptDecoder.ready;
  for (const sx of ['m', 'f']) {
    const buf = fs.readFileSync(`public/assets/fighters/fighter_${sx}.glb`);
    const l = new GLTFLoader(); l.setMeshoptDecoder(MeshoptDecoder);
    const g: any = await new Promise((res, rej) => l.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', res, rej));
    let body: THREE.Mesh | null = null;
    g.scene.traverse((o: any) => { if (o.isMesh && (o.material.name === 'body')) body = o; });
    const p = (body as any).geometry.attributes.position;
    let top = -1, nose = { y: 0, z: -1 }, chinY = 9;
    const pts: [number, number, number][] = [];
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); pts.push([x, y, z]); if (y > top) top = y; }
    for (const [x, y, z] of pts) if (y > top - 0.3 && Math.abs(x) < 0.01 && z > nose.z) nose = { y, z };
    // chin: lowest point near the midline in front of the neck
    for (const [x, y, z] of pts) if (Math.abs(x) < 0.01 && z > nose.z - 0.05 && y < nose.y && y > top - 0.35) chinY = Math.min(chinY, y);
    // forehead hairline proxy: front midline points between nose and top: z profile
    const prof: string[] = [];
    for (let yy = chinY; yy <= top; yy += 0.02) { let zmax = -9; for (const [x, y, z] of pts) if (Math.abs(x) < 0.01 && Math.abs(y - yy) < 0.01 && z > zmax) zmax = z; prof.push(`${yy.toFixed(2)}:${zmax.toFixed(3)}`); }
    console.log(sx, 'top', top.toFixed(3), 'nose', nose.y.toFixed(3), nose.z.toFixed(3), 'chin', chinY.toFixed(3));
    console.log('profile', prof.join(' '));
  }
});
