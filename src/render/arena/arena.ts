// The venue in three.js: platform, canvas mat with the Cage Kings crown, the eight-sided fence, posts and pads, the
// lighting rig with visible beams and haze, the crowd (instanced billboards) and the sky for outdoor venues. Built
// from a VenuePreset (venues.ts) and the shared geometry in layout.ts. Mobile budget: one shadow-casting light, a
// handful of draw calls for the cage, one instanced draw call for the whole crowd.

import * as THREE from 'three';
import { CAGE, PLATFORM_APOTHEM, cageVertex, layoutCrowd, panelCentre, panelWidth, thinCrowd, type Spot } from './layout';
import { Rand } from './rand';
import { getVenue, type VenueId, type VenuePreset } from './venues';

export type Quality = 'low' | 'high';

export interface Arena {
  group: THREE.Group;
  venue: VenuePreset;
  /** The light that throws the fighters' shadows (follow the action with its target). */
  key: THREE.SpotLight;
  update(dt: number, camera: THREE.Camera): void;
  setExcitement(v: number): void;
  setNames(a: string, b: string): void;
  dispose(): void;
}

const OCT_R = (apothem: number) => apothem / Math.cos(Math.PI / 8);

function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void, srgb = true): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const c = cv.getContext('2d') as CanvasRenderingContext2D;
  draw(c);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 4;
  return t;
}

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

/** The crown mark: an original design (five points, three jewels) used on the mat and the menus. */
export function drawCrown(c: CanvasRenderingContext2D, cx: number, cy: number, s: number, fill: string): void {
  c.save();
  c.translate(cx, cy);
  c.scale(s, s);
  c.fillStyle = fill;
  c.beginPath();
  c.moveTo(-1, 0.45);
  c.lineTo(-1.05, -0.45);
  c.lineTo(-0.55, -0.05);
  c.lineTo(-0.28, -0.62);
  c.lineTo(0, -0.12);
  c.lineTo(0.28, -0.62);
  c.lineTo(0.55, -0.05);
  c.lineTo(1.05, -0.45);
  c.lineTo(1, 0.45);
  c.closePath();
  c.fill();
  c.fillRect(-1, 0.55, 2, 0.18);
  for (const x of [-1.05, -0.28, 0.28, 1.05]) {
    c.beginPath();
    c.arc(x, x === -1.05 || x === 1.05 ? -0.53 : -0.72, 0.1, 0, Math.PI * 2);
    c.fill();
  }
  c.restore();
}

function matTexture(v: VenuePreset): THREE.CanvasTexture {
  const r = new Rand(v.seed);
  return canvasTex(1024, 1024, c => {
    c.fillStyle = hex(v.mat.base);
    c.fillRect(0, 0, 1024, 1024);
    // canvas weave and wear
    for (let i = 0; i < 9000; i++) {
      c.fillStyle = `rgba(${r.next() < 0.5 ? '255,255,255' : '0,0,0'},${0.02 + r.next() * 0.03 * v.mat.wear})`;
      c.fillRect(r.next() * 1024, r.next() * 1024, 1 + r.next() * 3, 1 + r.next() * 3);
    }
    // centre logo: crown over the name, in a ring
    const print = hex(v.mat.print);
    const accent = hex(v.mat.accent);
    c.globalAlpha = 0.85;
    c.strokeStyle = print;
    c.lineWidth = 10;
    c.beginPath();
    c.arc(512, 512, 250, 0, Math.PI * 2);
    c.stroke();
    drawCrown(c, 512, 440, 120, accent);
    c.fillStyle = print;
    c.font = 'bold 120px Oswald, Impact, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('CAGE KINGS', 512, 610);
    // sponsor-style panels toward the fence (invented brands)
    c.font = 'bold 54px Oswald, Impact, sans-serif';
    c.globalAlpha = 0.6;
    const brands = ['IRONVEIN', 'NORTHLINE', 'GRITLAB', 'KAIJU ENERGY'];
    brands.forEach((b, i) => {
      c.save();
      c.translate(512, 512);
      c.rotate((i * Math.PI) / 2);
      c.fillText(b, 0, -400);
      c.restore();
    });
    c.globalAlpha = 1;
  });
}

function fenceTexture(): THREE.CanvasTexture {
  // chain-link diamonds, alpha in the holes
  const t = canvasTex(
    128,
    128,
    c => {
      c.clearRect(0, 0, 128, 128);
      c.strokeStyle = 'rgba(255,255,255,1)';
      c.lineWidth = 7;
      c.beginPath();
      c.moveTo(0, 64);
      c.lineTo(64, 0);
      c.lineTo(128, 64);
      c.lineTo(64, 128);
      c.closePath();
      c.stroke();
    },
    true,
  );
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** A crowd sprite atlas: 8 silhouettes (4 standing, 4 seated / arms up) in white; colour comes per instance. */
function crowdAtlas(): THREE.CanvasTexture {
  return canvasTex(512, 256, c => {
    c.clearRect(0, 0, 512, 256);
    const r = new Rand(77);
    for (let i = 0; i < 8; i++) {
      const ox = (i % 4) * 128 + 64;
      const oy = i < 4 ? 0 : 128;
      const armsUp = i >= 4 && i % 2 === 0;
      const w = 30 + r.next() * 10;
      c.fillStyle = '#fff';
      // head
      c.beginPath();
      c.ellipse(ox, oy + 24, 13, 15, 0, 0, Math.PI * 2);
      c.fill();
      // shoulders and torso
      c.beginPath();
      c.moveTo(ox - w, oy + 128);
      c.lineTo(ox - w + 4, oy + 52);
      c.quadraticCurveTo(ox, oy + 36, ox + w - 4, oy + 52);
      c.lineTo(ox + w, oy + 128);
      c.fill();
      if (armsUp) {
        c.lineWidth = 11;
        c.strokeStyle = '#fff';
        c.lineCap = 'round';
        c.beginPath();
        c.moveTo(ox - w + 6, oy + 58);
        c.lineTo(ox - w - 6, oy + 10);
        c.moveTo(ox + w - 6, oy + 58);
        c.lineTo(ox + w + 8, oy + 14);
        c.stroke();
      }
      // a darker shirt band so shading reads
      c.fillStyle = 'rgba(0,0,0,0.35)';
      c.fillRect(ox - w, oy + 92, w * 2, 36);
    }
  });
}

const CROWD_COLORS: Record<string, number[]> = {
  casual: [0x2a3040, 0x40362a, 0x30302e, 0x4a2a2a, 0x203040, 0x555048, 0x3a4630],
  night: [0x201830, 0x2a1a3a, 0x181820, 0x3a2030, 0x102030, 0x302838],
  summer: [0x6a8aa8, 0xc8b090, 0xa04a40, 0x4a7a6a, 0xd8d0c0, 0x506080],
  fair: [0x3a4a6a, 0x6a4a3a, 0x4a6a3a, 0x7a6a4a, 0x5a3a5a, 0x3a3a3a],
  fans: [0x1a1a1a, 0xb01818, 0x182a6a, 0x2a2a2a, 0xd4a64a, 0x404040],
};

function buildCrowd(v: VenuePreset, quality: Quality, excitement: { value: number }, time: { value: number }): THREE.InstancedMesh {
  let spots: Spot[] = [];
  for (const s of v.crowd.sections) spots = spots.concat(layoutCrowd([s], v.seed + spots.length));
  spots = thinCrowd(spots, quality === 'low' ? 0.5 : 1, quality === 'low' ? 1400 : 3600, v.seed);
  const geo = new THREE.PlaneGeometry(0.62, 1.15);
  geo.translate(0, 0.575, 0);
  const tex = crowdAtlas();
  const mat = new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.5, transparent: false, side: THREE.DoubleSide });
  const lightCol = new THREE.Color(v.crowd.lightColor).multiplyScalar(v.crowd.light);
  mat.onBeforeCompile = sh => {
    sh.uniforms.uExcite = excitement;
    sh.uniforms.uTime = time;
    sh.uniforms.uLight = { value: lightCol };
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec4 aInfo; // atlas cell, phase, seated, row
uniform float uExcite; uniform float uTime;
varying float vRow;`,
      )
      .replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
float cell = aInfo.x;
// atlas row 0 is the top half of the canvas (flipY puts it at v 0.5..1)
vMapUv = vec2((mod(cell, 4.0) + uv.x) / 4.0, 1.0 - (floor(cell / 4.0) + 1.0 - uv.y) / 2.0);`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
float bob = (0.04 + uExcite * 0.16) * max(0.0, sin(uTime * (3.0 + aInfo.y * 2.0) + aInfo.y * 40.0)) * position.y;
transformed.y += bob * (1.0 - aInfo.z * 0.6);
vRow = aInfo.w;`,
      )
      // cylindrical billboard: rotate each instance to face the camera around y
      .replace(
        '#include <project_vertex>',
        `vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
vec3 ipos = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
vec3 iscale = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), 1.0);
vec4 wp = modelMatrix * vec4(ipos, 1.0);
vec3 toCam = cameraPosition - wp.xyz; toCam.y = 0.0; toCam = normalize(toCam);
vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
wp.xyz += right * transformed.x * iscale.x + vec3(0.0, transformed.y * iscale.y, 0.0);
mvPosition = viewMatrix * wp;
#endif
gl_Position = projectionMatrix * mvPosition;`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uLight; varying float vRow;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= uLight * (1.0 - min(vRow, 12.0) * 0.045);');
  };
  mat.customProgramCacheKey = () => 'ck-crowd';
  const mesh = new THREE.InstancedMesh(geo, mat, spots.length);
  const info = new Float32Array(spots.length * 4);
  const r = new Rand(v.seed + 5);
  const palette = CROWD_COLORS[v.crowd.palette] ?? CROWD_COLORS.casual;
  const m = new THREE.Matrix4();
  const col = new THREE.Color();
  spots.forEach((s, i) => {
    const h = s.seated ? 0.78 + r.next() * 0.1 : 0.92 + r.next() * 0.16;
    m.makeScale(0.9 + r.next() * 0.25, h, 1).setPosition(s.x, s.y, s.z);
    mesh.setMatrixAt(i, m);
    col.setHex(palette[Math.floor(r.next() * palette.length)]).multiplyScalar(0.7 + r.next() * 0.6);
    mesh.setColorAt(i, col);
    info[i * 4] = s.seated ? 4 + Math.floor(r.next() * 4) : Math.floor(r.next() * 4);
    info[i * 4 + 1] = r.next();
    info[i * 4 + 2] = s.seated ? 1 : 0;
    info[i * 4 + 3] = s.row;
  });
  geo.setAttribute('aInfo', new THREE.InstancedBufferAttribute(info, 4));
  mesh.frustumCulled = false;
  return mesh;
}

function nameScreen(): { mesh: THREE.Mesh; set: (a: string, b: string) => void } {
  const cv = document.createElement('canvas');
  cv.width = 1024;
  cv.height = 256;
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 1.6), mat);
  const set = (a: string, b: string) => {
    const c = cv.getContext('2d') as CanvasRenderingContext2D;
    const g = c.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, '#15151c');
    g.addColorStop(1, '#050507');
    c.fillStyle = g;
    c.fillRect(0, 0, 1024, 256);
    c.fillStyle = '#d4a64a';
    drawCrown(c, 512, 70, 36, '#d4a64a');
    c.font = 'bold 64px Oswald, Impact, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = '#f2f2f2';
    c.fillText(a.toUpperCase(), 256, 170);
    c.fillText(b.toUpperCase(), 768, 170);
    c.fillStyle = '#d33';
    c.fillText('VS', 512, 170);
    tex.needsUpdate = true;
  };
  set('', '');
  return { mesh, set };
}

export function createArena(venueId: VenueId, quality: Quality): Arena {
  const v = getVenue(venueId);
  const group = new THREE.Group();
  group.name = `arena-${v.id}`;
  const disposables: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T): T => {
    disposables.push(x);
    return x;
  };
  const excitement = { value: 0.2 };
  const time = { value: 0 };

  // platform and floor
  const platR = OCT_R(PLATFORM_APOTHEM);
  const skirt = new THREE.Mesh(keep(new THREE.CylinderGeometry(platR, platR, CAGE.platformHeight, 8, 1, true)), keep(new THREE.MeshStandardMaterial({ color: v.skirt, roughness: 0.8 })));
  skirt.rotation.y = Math.PI / 8;
  skirt.position.y = -CAGE.platformHeight / 2;
  group.add(skirt);
  const floor = new THREE.Mesh(keep(new THREE.CircleGeometry(60, 48)), keep(new THREE.MeshStandardMaterial({ color: v.floor, roughness: 0.95 })));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -CAGE.platformHeight;
  floor.receiveShadow = false;
  group.add(floor);
  // apron (outside the fence) and the mat (inside)
  const apron = new THREE.Mesh(keep(new THREE.CircleGeometry(platR, 8)), keep(new THREE.MeshStandardMaterial({ color: v.apron, roughness: 0.85 })));
  apron.rotation.x = -Math.PI / 2;
  apron.rotation.z = Math.PI / 8;
  apron.position.y = -0.005;
  apron.receiveShadow = true;
  group.add(apron);
  const matTex = keep(matTexture(v));
  const matR = OCT_R(CAGE.apothem);
  const matGeo = keep(new THREE.CircleGeometry(matR, 8));
  // planar UVs over the octagon so the logo is centred and undistorted
  const uv = matGeo.attributes.uv as THREE.BufferAttribute;
  const pos = matGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / (matR * 2) + 0.5, pos.getY(i) / (matR * 2) + 0.5);
  const mat = new THREE.Mesh(matGeo, keep(new THREE.MeshStandardMaterial({ map: matTex, roughness: 0.82 })));
  mat.rotation.x = -Math.PI / 2;
  mat.rotation.z = Math.PI / 8;
  mat.receiveShadow = true;
  group.add(mat);

  // fence panels
  const fenceTex = keep(fenceTexture());
  const pw = panelWidth();
  const fh = CAGE.fenceTop - CAGE.fenceBottom;
  fenceTex.repeat.set(pw / 0.09, fh / 0.09);
  const fenceMat = keep(new THREE.MeshStandardMaterial({ color: 0x15171b, map: fenceTex, alphaTest: 0.5, side: THREE.DoubleSide, metalness: 0.6, roughness: 0.45 }));
  const panelGeo = keep(new THREE.PlaneGeometry(pw, fh));
  const padMat = keep(new THREE.MeshStandardMaterial({ color: v.pad, roughness: 0.6 }));
  const railGeo = keep(new THREE.CylinderGeometry(CAGE.railRadius, CAGE.railRadius, pw, 10, 1));
  const bottomGeo = keep(new THREE.BoxGeometry(pw, 0.2, 0.12));
  const panels: { mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial; n: THREE.Vector3; pads?: THREE.MeshStandardMaterial }[] = [];
  const posts: { mat: THREE.MeshStandardMaterial; x: number; z: number }[] = [];
  for (let k = 0; k < 8; k++) {
    const pc = panelCentre(k);
    // each panel has its own material so the ones between the camera and the fight can fade out
    const pm = keep(fenceMat.clone());
    pm.transparent = true;
    const panel = new THREE.Mesh(panelGeo, pm);
    panels.push({ mesh: panel, mat: pm, n: new THREE.Vector3(pc.x, 0, pc.z).normalize() });
    panel.position.set(pc.x, CAGE.fenceBottom + fh / 2, pc.z);
    panel.lookAt(0, panel.position.y, 0);
    group.add(panel);
    // the rail and bottom pad of this side fade with its fence panel
    const sidePad = keep(padMat.clone());
    sidePad.transparent = true;
    panels[k].pads = sidePad;
    const rail = new THREE.Mesh(railGeo, sidePad);
    rail.position.set(pc.x, CAGE.railY, pc.z);
    rail.lookAt(0, CAGE.railY, 0);
    rail.rotateZ(Math.PI / 2);
    rail.castShadow = false;
    group.add(rail);
    const bottom = new THREE.Mesh(bottomGeo, sidePad);
    bottom.position.set(pc.x * 1.01, 0.1, pc.z * 1.01);
    bottom.lookAt(0, 0.1, 0);
    group.add(bottom);
    const cv = cageVertex(k);
    const postMat = keep(padMat.clone());
    postMat.transparent = true;
    const post = new THREE.Mesh(keep(new THREE.CylinderGeometry(CAGE.padRadius, CAGE.padRadius, CAGE.postHeight, 14)), postMat);
    post.position.set(cv.x, CAGE.postHeight / 2, cv.z);
    group.add(post);
    posts.push({ mat: postMat, x: cv.x, z: cv.z });
  }

  // lights
  const rig = v.rig;
  const key = new THREE.SpotLight(rig.key.color, rig.key.intensity * 1.6, 0, (rig.key.angle * Math.PI) / 180 / 2, 0.55, 0);
  key.position.set(0, rig.trussHeight, 0.6);
  key.target.position.set(0, 0, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(quality === 'low' ? 1024 : 2048, quality === 'low' ? 1024 : 2048);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = rig.trussHeight + 2;
  group.add(key, key.target);
  const front = new THREE.DirectionalLight(rig.front.color, rig.front.intensity * 0.55);
  front.position.set(0, 3.2, 9);
  group.add(front);
  const rim = new THREE.DirectionalLight(rig.rim.color, rig.rim.intensity * 0.55);
  rim.position.set(-2, 4, -8);
  group.add(rim);
  for (const a of rig.accents) {
    const l = new THREE.PointLight(a.color, a.intensity * 10, 30, 1.5);
    l.position.set(a.pos[0], a.pos[1], a.pos[2]);
    group.add(l);
  }
  group.add(new THREE.HemisphereLight(rig.fill.sky, rig.fill.ground, rig.fill.intensity * 0.9));

  // truss, fixtures and light beams
  const trussMat = keep(new THREE.MeshStandardMaterial({ color: 0x1a1c20, metalness: 0.7, roughness: 0.5 }));
  const ts = rig.trussSize;
  const beamGeo = keep(new THREE.BoxGeometry(ts * 2, 0.12, 0.12));
  for (const z of [-ts, ts]) {
    const b = new THREE.Mesh(beamGeo, trussMat);
    b.position.set(0, rig.trussHeight, z);
    group.add(b);
    const b2 = new THREE.Mesh(beamGeo, trussMat);
    b2.rotation.y = Math.PI / 2;
    b2.position.set(z, rig.trussHeight, 0);
    group.add(b2);
  }
  const coneMat = keep(
    new THREE.MeshBasicMaterial({ color: rig.beam.color, transparent: true, opacity: rig.beam.opacity * (quality === 'low' ? 0.6 : 1), blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  );
  const coneGeo = keep(new THREE.ConeGeometry(1.15, rig.trussHeight, 20, 1, true));
  coneGeo.translate(0, -rig.trussHeight / 2, 0);
  const canGeo = keep(new THREE.CylinderGeometry(0.12, 0.16, 0.3, 10));
  for (let i = 0; i < rig.fixtures; i++) {
    const a = (i / rig.fixtures) * Math.PI * 2;
    const x = Math.cos(a) * ts * 0.85;
    const z = Math.sin(a) * ts * 0.85;
    const can = new THREE.Mesh(canGeo, trussMat);
    can.position.set(x, rig.trussHeight - 0.2, z);
    group.add(can);
    const cone = new THREE.Mesh(coneGeo, coneMat);
    cone.position.set(x, rig.trussHeight - 0.3, z);
    cone.lookAt(x * 0.25, rig.trussHeight + 3, z * 0.25);
    cone.rotateX(Math.PI);
    group.add(cone);
  }
  const keyCone = new THREE.Mesh(keep(new THREE.ConeGeometry(OCT_R(CAGE.apothem) * 0.9, rig.trussHeight, 32, 1, true)), coneMat);
  keyCone.position.set(0, rig.trussHeight / 2, 0);
  group.add(keyCone);

  // sky / background
  let sky: THREE.Mesh | null = null;
  if (v.sky) {
    const skyMat = keep(
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: { top: { value: new THREE.Color(v.sky.top) }, hor: { value: new THREE.Color(v.sky.horizon) }, bot: { value: new THREE.Color(v.sky.bottom) } },
        vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader:
          'uniform vec3 top; uniform vec3 hor; uniform vec3 bot; varying vec3 vP; void main(){ float y = vP.y; vec3 c = y > 0.0 ? mix(hor, top, pow(y, 0.6)) : mix(hor, bot, pow(-y, 0.5)); gl_FragColor = vec4(c, 1.0); }',
      }),
    );
    sky = new THREE.Mesh(keep(new THREE.SphereGeometry(90, 24, 16)), skyMat);
    group.add(sky);
  }

  const crowd = buildCrowd(v, quality, excitement, time);
  disposables.push(crowd.geometry, crowd.material as THREE.Material);
  group.add(crowd);

  const screen = nameScreen();
  if (v.screens.jumbotron || v.screens.wall) {
    screen.mesh.position.set(0, v.screens.jumbotron ? rig.trussHeight + 1.4 : 6.2, v.screens.jumbotron ? 0 : -12);
    group.add(screen.mesh);
  }

  return {
    group,
    venue: v,
    key,
    update(dt, camera) {
      time.value += dt;
      // fade the fence panels the camera looks through (the broadcast trick), keep the far ones solid
      const cp = camera.position;
      for (const p of panels) {
        const toCam = new THREE.Vector3(cp.x, 0, cp.z).sub(new THREE.Vector3(p.mesh.position.x, 0, p.mesh.position.z));
        const facing = toCam.dot(p.n);
        const want = facing > 0 ? 0.12 : 1;
        p.mat.opacity += (want - p.mat.opacity) * Math.min(1, dt * 6);
        p.mat.depthWrite = p.mat.opacity > 0.9;
        if (p.pads) {
          p.pads.opacity = Math.max(0.08, p.mat.opacity);
          p.pads.depthWrite = p.pads.opacity > 0.9;
        }
      }
      // posts between the camera and the cage centre fade too
      const cd = Math.hypot(cp.x, cp.z);
      for (const q of posts) {
        const closer = (q.x * cp.x + q.z * cp.z) / Math.max(0.001, cd) > 1.5;
        const want = closer ? 0.08 : 1;
        q.mat.opacity += (want - q.mat.opacity) * Math.min(1, dt * 6);
        q.mat.depthWrite = q.mat.opacity > 0.9;
      }
      if (sky) sky.position.copy(camera.position);
    },
    setExcitement(x) {
      excitement.value = Math.max(0, Math.min(1, x));
    },
    setNames(a, b) {
      screen.set(a, b);
    },
    dispose() {
      for (const d of disposables) d.dispose();
      group.removeFromParent();
    },
  };
}

/** Apply the venue's fog and background to the scene. */
export function applyVenueAtmosphere(scene: THREE.Scene, v: VenuePreset): void {
  scene.background = new THREE.Color(v.background);
  scene.fog = new THREE.FogExp2(v.fog.color, v.fog.density);
}
