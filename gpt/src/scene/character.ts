import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { RoleId } from '../../shared/types';
import { findRoute, type Point } from './navigation';
import type { Obstacle } from './scenery';

interface Appearance { skin: string; hair: string; shirt: string; trousers?: string; glasses?: boolean; longHair?: boolean; beard?: boolean; }
export const APPEARANCES: Record<RoleId, Appearance> = {
 ceo:{skin:'#a87555',hair:'#1a1a1a',shirt:'#0d0d0d',glasses:true},
 pm:{skin:'#e6b18b',hair:'#3d302c',shirt:'#10a37f',longHair:true},
 designer:{skin:'#c7926c',hair:'#2a2a2a',shirt:'#f08fc0',longHair:true},
 frontend:{skin:'#f0c399',hair:'#333333',shirt:'#5b8def',glasses:true},
 backend:{skin:'#96644c',hair:'#1f1f1f',shirt:'#f4f4f4',beard:true},
 qa:{skin:'#dab18d',hair:'#493b32',shirt:'#9b8cff',longHair:true},
};
const cube = new THREE.BoxGeometry(1, 1, 1);
const materials = new Map<string, THREE.MeshStandardMaterial>();
function material(color: string) {
  let mat = materials.get(color);
  if (!mat) { mat = new THREE.MeshStandardMaterial({ color, roughness: 1, flatShading: true }); materials.set(color, mat); }
  return mat;
}

export class Character {
  readonly root = new THREE.Group();
  readonly head = new THREE.Group();
  readonly torso = new THREE.Group();
  readonly arms: THREE.Group[] = [];
  readonly legs: THREE.Group[] = [];
  readonly ring: THREE.Mesh;
  private path: Point[] = [];
  private finish?: () => void;
  private seated = true;
  private walking = false;
  private phase = 0;
  private sitAngle = 0;
  private armColor: string;
  constructor(scene: THREE.Scene, position: Point, appearance: Appearance, readonly role?: RoleId) {
    this.armColor = appearance.shirt;
    this.root.position.set(position.x, 0.14, position.z);
    if (role) this.root.userData.role = role;
    scene.add(this.root);
    const { skin, hair, shirt, trousers = '#464646' } = appearance;
    this.root.add(this.torso); this.torso.add(this.head);
    this.box(this.torso, 0.57, 0.65, 0.32, 0, 0, 0, shirt);
    this.box(this.torso, 0.55, 0.18, 0.33, 0, -0.38, 0, trousers);
    this.box(this.torso, 0.24, 0.49, 0.035, 0, 0.025, -0.18, '#f1f1f1');
    if (role === 'ceo') this.box(this.torso, 0.085, 0.4, 0.035, 0, 0, -0.208, '#4a4a4a');
    this.box(this.torso, 0.1, 0.1, 0.035, 0.17, 0.1, -0.187, '#bebebe');
    this.box(this.torso, 0.17, 0.15, 0.16, 0, 0.38, 0, skin);
    this.head.position.y = 0.69;
    this.box(this.head, 0.53, 0.52, 0.46, 0, 0, 0, skin);
    this.box(this.head, 0.45, 0.13, 0.45, 0, -0.27, 0, skin);
    this.box(this.head, 0.1, 0.1, 0.07, 0, -0.02, -0.267, '#dba383');
    this.box(this.head, 0.58, 0.15, 0.53, 0, 0.26, 0.025, hair);
    this.box(this.head, 0.57, 0.4, 0.15, 0, 0.045, 0.235, hair);
    for (const side of [-1, 1]) {
      this.box(this.head, 0.12, 0.37, 0.29, side * 0.25, 0.09, 0.08, hair);
      this.box(this.head, 0.08, 0.14, 0.12, side * 0.29, -0.04, 0.01, skin);
      this.box(this.head, 0.07, 0.07, 0.018, side * 0.14, 0.05, -0.24, '#212121');
      this.box(this.head, 0.035, 0.025, 0.018, side * 0.14 + 0.016, 0.067, -0.251, '#fbf0cf');
      this.box(this.head, 0.085, 0.02, 0.02, side * 0.14, 0.12, -0.25, hair);
      const arm = new THREE.Group(); arm.position.set(side * 0.35, 0.17, 0); this.torso.add(arm); this.arms.push(arm);
      this.box(arm, 0.18, 0.36, 0.2, 0, -0.13, 0, shirt);
      this.box(arm, 0.15, 0.29, 0.15, 0, -0.4, -0.015, skin);
      this.box(arm, 0.18, 0.12, 0.18, 0, -0.59, -0.015, skin);
      const leg = new THREE.Group(); leg.position.set(side * 0.155, 0, 0); this.root.add(leg); this.legs.push(leg);
      this.box(leg, 0.22, 0.43, 0.23, 0, -0.2, 0, trousers);
      const shin = new THREE.Group(); shin.position.set(0, -0.41, 0); leg.add(shin); leg.userData.shin = shin;
      this.box(shin, 0.2, 0.43, 0.21, 0, -0.2, 0, trousers);
      this.box(shin, 0.25, 0.12, 0.37, 0, -0.45, -0.065, '#383838');
    }
    for (let i = 0; i < 5; i++) this.box(this.head, 0.12, 0.1 + i % 2 * 0.04, 0.1, -0.24 + i * 0.12, 0.2, -0.22, hair);
    if (appearance.longHair) {
      this.box(this.head, 0.48, 0.54, 0.16, 0, -0.2, 0.31, hair);
      this.box(this.head, 0.15, 0.65, 0.22, 0.34, -0.19, 0.18, hair);
      this.box(this.head, 0.09, 0.37, 0.11, -0.32, -0.2, 0.04, hair);
    }
    if (appearance.beard) {
      this.box(this.head, 0.43, 0.18, 0.045, 0, -0.21, -0.242, hair);
      this.box(this.head, 0.21, 0.035, 0.055, 0, -0.105, -0.263, hair);
      this.box(this.head, 0.14, 0.033, 0.017, 0, -0.19, -0.274, skin);
    } else this.box(this.head, 0.12, 0.022, 0.02, 0, -0.19, -0.25, '#a86b51');
    if (appearance.glasses) {
      for (const side of [-1, 1]) {
        this.box(this.head, 0.2, 0.15, 0.016, side * 0.14, 0.046, -0.276, '#212121');
        this.box(this.head, 0.15, 0.095, 0.019, side * 0.14, 0.046, -0.288, '#aeaeae');
        this.box(this.head, 0.045, 0.055, 0.019, side * 0.14, 0.047, -0.301, '#3d3d3d');
      }
      this.box(this.head, 0.075, 0.028, 0.02, 0, 0.047, -0.278, '#212121');
    }
    for (const part of [this.head, this.torso, ...this.arms, ...this.legs, ...this.legs.map(leg => leg.userData.shin as THREE.Group)]) {
      const batches = new Map<THREE.Material, THREE.BufferGeometry[]>();
      for (const child of [...part.children]) {
        if (!(child instanceof THREE.Mesh)) continue;
        child.updateMatrix();
        const geo = child.geometry.clone().applyMatrix4(child.matrix), mat = child.material as THREE.Material;
        const list = batches.get(mat) || []; list.push(geo); batches.set(mat, list); part.remove(child);
      }
      for (const [mat, list] of batches) {
        const geo = mergeGeometries(list)!; list.forEach(g => g.dispose());
        const mesh = new THREE.Mesh(geo, mat); mesh.castShadow = true; mesh.receiveShadow = true; part.add(mesh);
      }
    }
    const ringMat = new THREE.MeshBasicMaterial({ color: '#0d0d0d', transparent: true, opacity: 0.9, depthWrite: false });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.47, 0.53, 32), ringMat); this.ring.rotation.x = -Math.PI / 2; this.ring.position.y = 0.01; this.ring.visible = false; this.root.add(this.ring);
    this.pose(0, false);
  }
  private box(parent: THREE.Group, w: number, h: number, d: number, x: number, y: number, z: number, color: string) {
    const mesh = new THREE.Mesh(cube, material(color)); mesh.scale.set(w, h, d); mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh);
  }
  get position(): Point { return { x: this.root.position.x, z: this.root.position.z }; }
  get moving() { return this.walking; }
  moveTo(point: Point, obstacles: Obstacle[], onArrival: () => void = () => {}) {
    this.path = findRoute(this.position, point, obstacles); this.finish = onArrival;
    if (!this.path.length) return false;
    this.seated = false; this.walking = true; return true;
  }
  sit(angle = 0) { this.seated = true; this.walking = false; this.sitAngle = angle; this.root.rotation.y = angle; }
  stand(angle = 0) { this.seated = false; this.walking = false; this.root.rotation.y = angle; }
  private pose(time: number, working: boolean) {
    this.torso.position.y = this.seated ? 1.31 : 1.4;
    this.torso.position.z = this.seated ? -0.02 : 0;
    if (this.walking) {
      this.torso.position.y += Math.abs(Math.sin(this.phase * 2)) * 0.045;
      for (let i = 0; i < 2; i++) {
        this.legs[i].position.y = 0.91;
        this.legs[i].rotation.x = Math.sin(this.phase + i * Math.PI) * 0.48;
        (this.legs[i].userData.shin as THREE.Group).rotation.x = Math.max(0, -Math.sin(this.phase + i * Math.PI)) * 0.35;
        (this.legs[i].userData.shin as THREE.Group).scale.y = 1;
        this.arms[i].rotation.x = -Math.sin(this.phase + i * Math.PI) * 0.35;
        this.arms[i].rotation.z = i ? -0.08 : 0.08;
      }
      this.head.rotation.y = Math.sin(this.phase * 0.3) * 0.025;
    } else {
      for (let i = 0; i < 2; i++) {
        this.legs[i].position.y = this.seated ? 0.95 : 0.91;
        this.legs[i].rotation.x = this.seated ? Math.PI / 2 : 0;
        (this.legs[i].userData.shin as THREE.Group).rotation.x = this.seated ? -Math.PI / 2 : 0;
        (this.legs[i].userData.shin as THREE.Group).scale.y = this.seated ? 1.87 : 1;
        this.arms[i].rotation.x = this.seated ? 1.65 + (working ? Math.sin(time * 13 + i * 2.2) * 0.13 : Math.sin(time * 1.8 + i) * 0.015) : 0;
        this.arms[i].rotation.z = i ? -0.09 : 0.09;
      }
      this.head.rotation.x = this.seated ? 0.045 + Math.sin(time * 1.2) * 0.015 : 0;
      this.head.rotation.y = Math.sin(time * 0.52) * (working ? 0.022 : 0.07);
    }
  }
  update(delta: number, time: number, working: boolean, reducedMotion = false) {
    if (reducedMotion) {
      if (this.walking) {
        const target = this.path.at(-1);
        if (target) this.root.position.set(target.x, this.root.position.y, target.z);
        this.path = []; this.walking = false;
        const done = this.finish; this.finish = undefined; done?.();
      }
      if (this.seated) this.root.rotation.y = this.sitAngle;
      this.phase = 0; this.pose(0, false); return;
    }
    if (this.walking) {
      const target = this.path[0];
      if (target) {
        const dx = target.x - this.root.position.x, dz = target.z - this.root.position.z, distance = Math.hypot(dx, dz);
        const step = Math.min(distance, delta * 1.5);
        if (distance > 0.001) {
          this.root.position.x += dx / distance * step; this.root.position.z += dz / distance * step;
          const targetAngle = Math.atan2(-dx, -dz);
          const diff = Math.atan2(Math.sin(targetAngle - this.root.rotation.y), Math.cos(targetAngle - this.root.rotation.y));
          this.root.rotation.y += diff * Math.min(1, delta * 12);
          this.phase += delta * 9;
        }
        if (distance < 0.05) this.path.shift();
      } else {
        this.walking = false; const done = this.finish; this.finish = undefined; done?.();
      }
    }
    if (this.seated) this.root.rotation.y = this.sitAngle;
    this.pose(time, working);
  }
}
