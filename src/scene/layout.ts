import type { RoleId } from '../../shared/types';

// Furniture keeps its original scale; the floor and the gaps between zones grow.
export const ROOM = { width: 22, depth: 17, wallHeight: 5.8 };
export const DESKS = {
  ceo: { x: -7, z: -5.8 },
  frontend: { x: -5, z: -0.8 },
  backend: { x: 3.25, z: 0.9 },
  qa: { x: -0.35, z: -4.5 },
  pm: { x: -4.8, z: 4.2 },
  designer: { x: 0.15, z: 4.2 },
};
export const DESK_ANGLES: Record<RoleId, number> = {
  ceo: Math.PI, qa: Math.PI, pm: -Math.PI / 2,
  designer: -Math.PI / 2, frontend: -Math.PI / 2, backend: Math.PI,
};
export const SEATS = Object.fromEntries(Object.entries(DESK_ANGLES).map(([role, angle]) => {
  const desk = DESKS[role as RoleId];
  return [role, { x: desk.x + Math.sin(angle) * 1.05, z: desk.z + Math.cos(angle) * 1.05 }];
})) as Record<RoleId, { x: number; z: number }>;

export const MEETING = { x: 7, z: -3.5, width: 4.4, depth: 2.2 };
export const MEETING_SPOTS: Record<RoleId, { x: number; z: number }> = {
  ceo: { x: 5.7, z: -5.5 }, pm: { x: 8.3, z: -5.5 },
  designer: { x: 9.95, z: -3.5 },
  frontend: { x: 5.7, z: -1.5 }, qa: { x: 8.3, z: -1.5 },
  backend: { x: 4.05, z: -3.5 },
};
export const AMBIENT_ROUTES = [
  [{ x: -7.3, z: 3.4 }, { x: -7.3, z: 6.4 }],
  [{ x: 9.4, z: 1.1 }, { x: 9.4, z: -0.45 }],
];
