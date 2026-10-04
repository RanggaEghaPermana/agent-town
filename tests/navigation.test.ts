import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findRoute, type Point } from '../src/scene/navigation';
import type { Obstacle } from '../src/scene/scenery';
import { ROOM, SEATS, MEETING_SPOTS } from '../src/scene/layout';

const furniture: Obstacle[] = [{ x: 0, z: 0, w: 3, d: 2 }, { x: 3, z: 1, w: 1.5, d: 3 }];
function clearsFurniture(point: Point) {
  return furniture.every(o => Math.abs(point.x - o.x) >= o.w / 2 + 0.239 || Math.abs(point.z - o.z) >= o.d / 2 + 0.239);
}

test('walking routes go around furniture, including the space between corners', () => {
  const route = findRoute({ x: -4, z: -2 }, { x: 5, z: 2.8 }, furniture);
  assert.ok(route.length > 2);
  for (let i = 1; i < route.length; i++) for (let step = 0; step <= 100; step++) {
    const a = route[i - 1], b = route[i], fraction = step / 100;
    assert.ok(clearsFurniture({ x: a.x + (b.x - a.x) * fraction, z: a.z + (b.z - a.z) * fraction }));
  }
  assert.deepEqual(route.at(-1), { x: 5, z: 2.8 });
});

test('a destination inside a desk ends at the closest free floor cell', () => {
  const route = findRoute({ x: -4, z: 0 }, { x: 0, z: 0 }, furniture);
  assert.ok(route.length > 0); assert.ok(clearsFurniture(route.at(-1)!));
  assert.notDeepEqual(route.at(-1), { x: 0, z: 0 });
});

test('an unreachable destination does not send a character through a wall', () => {
  assert.deepEqual(findRoute({ x: -4, z: 0 }, { x: 4, z: 0 }, [{ x: 0, z: 0, w: 1, d: 30 }]), []);
});

test('the CEO can leave the narrow gap behind the desk without crossing furniture', () => {
  const obstacles = [
    { x: -4.6, z: -3.6, w: 3.1, d: 1.4 },
    { x: -6.83, z: -5.36, w: 1.4, d: 0.75 },
    { x: -2.8, z: -5.25, w: 0.986, d: 0.986 },
  ];
  const route = findRoute({ x: -4.6, z: -4.65 }, { x: -4.2, z: -1.8 }, obstacles);
  assert.ok(route.length > 1);
  assert.deepEqual(route.at(-1), { x: -4.2, z: -1.8 });
  for (let i = 1; i < route.length; i++) for (let step = 0; step <= 30; step++) {
    const a = route[i - 1], b = route[i], t = step / 30, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
    assert.ok(obstacles.every(o => Math.abs(x - o.x) >= o.w / 2 + 0.239 || Math.abs(z - o.z) >= o.d / 2 + 0.239));
  }
});

test('routes reach the expanded office zones beyond the previous floor boundary', () => {
  const route = findRoute(SEATS.ceo, MEETING_SPOTS.designer, []);
  assert.ok(route.length > 1);
  assert.deepEqual(route.at(-1), MEETING_SPOTS.designer);
  assert.ok(route.some(p => p.z < -6));
  assert.ok(route.some(p => p.x > 8));
});

test('an out-of-room destination stops inside the floor instead of walking off it', () => {
  const route = findRoute({ x: 0, z: 0 }, { x: ROOM.width, z: ROOM.depth }, []);
  assert.ok(route.length > 0);
  assert.ok(route.every(p => Math.abs(p.x) <= ROOM.width / 2 - 0.49 && Math.abs(p.z) <= ROOM.depth / 2 - 0.49));
});
