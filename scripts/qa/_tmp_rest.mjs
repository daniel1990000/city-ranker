// dump rest-pose bone world positions of the fighter glb (node + three)
import fs from 'fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
const buf = fs.readFileSync(process.argv[2]);
const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
await MeshoptDecoder.ready;
loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', g => {
  g.scene.updateMatrixWorld(true);
  const v = new THREE.Vector3(), q = new THREE.Quaternion();
  g.scene.traverse(o => { if (o.isBone && !/_0[23]_|index|middle|ring|pinky|thumb_0[23]/.test(o.name)) { o.getWorldPosition(v); o.getWorldQuaternion(q); const y = new THREE.Vector3(0,1,0).applyQuaternion(q); console.log(o.name.padEnd(12), v.toArray().map(x=>x.toFixed(3)).join(' '), ' localY->', y.toArray().map(x=>x.toFixed(2)).join(' '), ' parent', o.parent.name); } });
  g.scene.traverse(o => { if (o.isSkinnedMesh) console.log('mesh', o.name, Object.keys(o.morphTargetDictionary||{}).length); });
}, e => console.log('ERR', e));
