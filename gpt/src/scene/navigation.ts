import type { Obstacle } from './scenery';
import { ROOM } from './layout';

export interface Point { x: number; z: number; }
const STEP = 0.15;
const MIN_X = -ROOM.width / 2 + 0.5, MIN_Z = -ROOM.depth / 2 + 0.5;
const COLS = Math.floor((ROOM.width - 1) / STEP) + 1;
const ROWS = Math.floor((ROOM.depth - 1) / STEP) + 1;
const grids = new WeakMap<Obstacle[], Uint8Array>();

export function findRoute(start: Point, end: Point, obstacles: Obstacle[]): Point[] {
  const point = (index: number) => ({ x: MIN_X + (index % COLS) * STEP, z: MIN_Z + Math.floor(index / COLS) * STEP });
  let grid = grids.get(obstacles);
  if (!grid) {
    grid = new Uint8Array(COLS * ROWS);
    for (let i = 0; i < grid.length; i++) {
      const p = point(i);
      grid[i] = Number(obstacles.some(o => Math.abs(p.x - o.x) < o.w / 2 + 0.26 && Math.abs(p.z - o.z) < o.d / 2 + 0.26));
    }
    grids.set(obstacles, grid);
  }
  const blocked = (index: number) => grid[index] === 1;
  const nearest = (p: Point) => {
    let best = -1, distance = Infinity;
    for (let i = 0; i < COLS * ROWS; i++) {
      if (blocked(i)) continue;
      const x = MIN_X + (i % COLS) * STEP, z = MIN_Z + Math.floor(i / COLS) * STEP;
      const d = (x - p.x) ** 2 + (z - p.z) ** 2;
      if (d < distance) { best = i; distance = d; }
    }
    return best;
  };
  const first = nearest(start), last = nearest(end);
  if (first < 0 || last < 0) return [];
  const previous = new Map<number, number>([[first, -1]]), queue = [first];
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head];
    if (current === last) break;
    const x = current % COLS, z = Math.floor(current / COLS);
    for (const [dx, dz] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
      const nx = x + dx, nz = z + dz, next = nz * COLS + nx;
      if (nx < 0 || nx >= COLS || nz < 0 || nz >= ROWS || previous.has(next) || blocked(next)) continue;
      previous.set(next, current); queue.push(next);
    }
  }
  if (!previous.has(last)) return [];
  const indices: number[] = [];
  for (let node = last; node !== -1; node = previous.get(node)!) indices.push(node);
  indices.reverse();
  const route = indices.map(point).filter((_p, i, points) => {
    if (i === 0 || i === points.length - 1) return true;
    const before = points[i - 1], after = points[i + 1], p = points[i];
    return Math.sign(p.x - before.x) !== Math.sign(after.x - p.x) || Math.sign(p.z - before.z) !== Math.sign(after.z - p.z);
  });
  // Exact endpoints are retained only when they clear the furniture footprint.
  const clear = (p: Point) => p.x >= MIN_X && p.x <= MIN_X + (COLS - 1) * STEP &&
    p.z >= MIN_Z && p.z <= MIN_Z + (ROWS - 1) * STEP &&
    !obstacles.some(o => Math.abs(p.x - o.x) < o.w / 2 + 0.24 && Math.abs(p.z - o.z) < o.d / 2 + 0.24);
  if (clear(end)) route.push(end);
  return route;
}
