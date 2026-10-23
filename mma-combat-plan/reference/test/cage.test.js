import test from 'node:test';
import assert from 'node:assert/strict';
import { Octagon, SECTORS } from '../src/sim/cage.js';
import { stepLocomotion, separate } from '../src/sim/locomotion.js';
import { vAngle, vFromAngle, wrapPi } from '../src/core/math.js';
import { mergeTunables } from '../src/core/tunables.js';
import { makeWorld } from '../src/testing/helpers.js';

const oct = new Octagon();

test('geometry: 30 ft across the flats; apothem, circumradius and side match the regular octagon', () => {
  assert.ok(Math.abs(oct.apothem - 4.57) < 1e-9);
  assert.ok(Math.abs(oct.circumradius - 4.57 / Math.cos(Math.PI / 8)) < 1e-9);
  assert.ok(Math.abs(oct.side - 2 * 4.57 * Math.tan(Math.PI / 8)) < 1e-9);
  assert.ok(Math.abs(oct.side - oct.circumradius * 2 * Math.sin(Math.PI / 8)) < 1e-9, 'side = 2 R sin(π/8)');
  assert.equal(oct.normals.length, 8);
  oct.normals.forEach((n, k) => { assert.ok(Math.abs(Math.hypot(n.x, n.y) - 1) < 1e-12); assert.ok(Math.abs(wrapPi(vAngle(n) - (Math.PI / 8 + (k * Math.PI) / 4))) < 1e-9); });
});

test('inside: centre yes, 1 cm past a wall no; discs are kept inside by clamp; nearestWall picks the right wall', () => {
  assert.ok(oct.inside({ x: 0, y: 0 }));
  for (let k = 0; k < 8; k++) {
    const n = oct.normals[k];
    assert.ok(oct.inside({ x: n.x * (oct.apothem - 0.001), y: n.y * (oct.apothem - 0.001) }));
    assert.ok(!oct.inside({ x: n.x * (oct.apothem + 0.01), y: n.y * (oct.apothem + 0.01) }));
    const near = oct.nearestWall({ x: n.x * 3, y: n.y * 3 });
    assert.equal(near.index, k); assert.ok(Math.abs(near.gap - (oct.apothem - 3)) < 1e-9);
    const c = oct.clamp({ x: n.x * 9, y: n.y * 9 }, 0.28);
    assert.ok(c.contact && c.wall !== null && oct.inside(c.pos, 0.28 - 1e-9));
  }
  const corner = oct.clamp({ x: 20, y: 0.1 }, 0.28);
  assert.ok(oct.inside(corner.pos, 0.28 - 1e-9), 'corners resolve in a couple of passes');
  assert.ok(!oct.clamp({ x: 0, y: 0 }, 0.28).contact);
});

test('wall sense: sector binning follows the facing and is stable under rotation; pinned flags', () => {
  const n = oct.normals[2];
  const p = { x: n.x * (oct.apothem - 0.2), y: n.y * (oct.apothem - 0.2) };
  const toWall = vAngle(n);
  const expect = (rel) => SECTORS[((Math.round(rel / (Math.PI / 4)) % 8) + 8) % 8];
  for (let step = 0; step < 16; step++) {
    const facing = (step * Math.PI) / 8;
    const s = oct.sense(p, facing, 0.28);
    assert.equal(s.sector, expect(wrapPi(toWall - facing)), `facing ${step}`);
    assert.ok(s.pinned);
    assert.equal(s.backAgainstCage, ['back', 'back_left', 'back_right'].includes(s.sector));
    assert.equal(s.facingCage, ['front', 'front_left', 'front_right'].includes(s.sector));
  }
  const open = oct.sense({ x: 0, y: 0 }, 0, 0.28);
  assert.ok(!open.pinned && !open.backAgainstCage && !open.facingCage);
  assert.equal(oct.sense(p, toWall, 0.28).sector, 'front');
  assert.equal(oct.sense(p, toWall + Math.PI, 0.28).sector, 'back');
});

test('locomotion: forward is faster than sideways is faster than backward; limping and stamina slow you; locked fighters turn but do not move', () => {
  const tun = mergeTunables();
  const w = makeWorld();
  const [a, b] = w.fighters;
  const speedFor = (dirAngle, setup) => {
    const w2 = makeWorld(); const [x, y] = w2.fighters;
    x.pos = { x: 0, y: 0 }; y.pos = { x: 3, y: 0 }; x.facing = 0;
    setup?.(x);
    const v = vFromAngle(dirAngle);
    const d = stepLocomotion(x, y, v, tun);
    return Math.hypot(d.x, d.y);
  };
  const fwd = speedFor(0), side = speedFor(Math.PI / 2), back = speedFor(Math.PI);
  assert.ok(fwd > side && side > back, `${fwd} ${side} ${back}`);
  assert.ok(Math.abs(back / fwd - tun.fighter.loco[4] / tun.fighter.loco[0]) < 0.05);
  assert.ok(speedFor(0, (x) => { x.status.limpTicks = 100; }) < fwd * 0.7);
  assert.ok(speedFor(0, (x) => { x.stamina = 5; }) < fwd);
  assert.ok(speedFor(0, (x) => { x.ratings.movement = 100; }) > fwd);
  // facing tracks the opponent at a limited turn rate; locked fighters do not translate
  a.pos = { x: 0, y: 0 }; b.pos = { x: 0, y: 3 }; a.facing = 0;
  const d = stepLocomotion(a, b, { x: 1, y: 0 }, tun, { locked: true });
  assert.deepEqual(d, { x: 0, y: 0 });
  assert.ok(a.facing > 0 && a.facing <= (tun.fighter.turnRateDegPerTick * Math.PI) / 180 + 1e-9);
  for (let i = 0; i < 40; i++) stepLocomotion(a, b, { x: 0, y: 0 }, tun);
  assert.ok(Math.abs(wrapPi(a.facing - Math.PI / 2)) < 1e-6, 'ends up facing the opponent');
});

test('separation pushes overlapping fighters apart symmetrically and leaves others alone', () => {
  const w = makeWorld();
  const [a, b] = w.fighters;
  a.pos = { x: -0.1, y: 0 }; b.pos = { x: 0.1, y: 0 };
  separate(a, b);
  assert.ok(Math.abs(Math.hypot(b.pos.x - a.pos.x, b.pos.y - a.pos.y) - (a.radius + b.radius)) < 1e-9);
  assert.ok(Math.abs(a.pos.x + b.pos.x) < 1e-9, 'symmetric about the midpoint');
  const before = { ...a.pos };
  b.pos = { x: 3, y: 0 };
  separate(a, b);
  assert.deepEqual(a.pos, before);
});
