import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { brickTexture, woodTexture, rugTexture, cityTexture, boardTexture, screenTexture, pixelTexture } from './textures';
import type { RoleId } from '../../shared/types';
import { ROOM, DESKS, DESK_ANGLES, MEETING, MEETING_SPOTS } from './layout';

export interface Obstacle { x: number; z: number; w: number; d: number; }
type Parent = THREE.Group | THREE.Scene;
type Material = THREE.Material;
const C = { wood: '#c99a6b', edge: '#8a5a3a', darkWood: '#6b4a35', desk: '#dcb48a', cream: '#e8e6dc', dark: '#30302e', metal: '#5e5d59', gold: '#d4a27f', teal: '#c6613f', foliage: '#6f8b4a' };

export class Scenery {
  readonly obstacles: Obstacle[] = [];
  readonly screens = new Map<RoleId, THREE.MeshStandardMaterial>();
  readonly board = new THREE.Group();
  private root = new THREE.Group();
  private materials = new Map<string, THREE.MeshStandardMaterial>();
  private cube = new THREE.BoxGeometry(1, 1, 1);
  private geometries: THREE.BufferGeometry[] = [this.cube];
  private textureMaterials: Material[] = [];
  private randomSeed = 41;
  constructor(private scene: THREE.Scene) {
    scene.add(this.root);
    this.build();
    this.batch();
  }
  private random() { this.randomSeed = (this.randomSeed * 16807) % 2147483647; return this.randomSeed / 2147483647; }
  private mat(color: string) {
    let mat = this.materials.get(color);
    if (!mat) {
      mat = new THREE.MeshStandardMaterial({ color, roughness: 0.9, flatShading: true });
      if (['#9db56f', '#d97757'].includes(color)) { mat.emissive.set(color); mat.emissiveIntensity = 0.5; }
      this.materials.set(color, mat);
    }
    return mat;
  }
  private mapped(texture: THREE.Texture, emissive = false) {
    const mat = new THREE.MeshStandardMaterial({ map: texture, roughness: 1, ...(emissive ? { emissive: '#ffffff', emissiveMap: texture, emissiveIntensity: 0.32 } : {}) });
    this.textureMaterials.push(mat); return mat;
  }
  private group(x: number, y: number, z: number, rotation = 0, parent: Parent = this.root) {
    const group = new THREE.Group(); group.position.set(x, y, z); group.rotation.y = rotation; parent.add(group); return group;
  }
  private box(parent: Parent, w: number, h: number, d: number, x: number, y: number, z: number, color: string | Material) {
    const mesh = new THREE.Mesh(this.cube, typeof color === 'string' ? this.mat(color) : color);
    mesh.scale.set(w, h, d); mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
  }
  private cylinder(parent: Parent, radius: number, height: number, x: number, y: number, z: number, color: string, top = radius, sides = 8) {
    const geometry = new THREE.CylinderGeometry(top, radius, height, sides); this.geometries.push(geometry);
    const mesh = new THREE.Mesh(geometry, this.mat(color)); mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
  }
  private plane(parent: Parent, w: number, h: number, x: number, y: number, z: number, mat: Material) {
    const geometry = new THREE.PlaneGeometry(w, h); this.geometries.push(geometry);
    const mesh = new THREE.Mesh(geometry, mat); mesh.position.set(x, y, z); mesh.receiveShadow = true; parent.add(mesh); return mesh;
  }
  private rug(x: number, z: number, w: number, d: number, base: string, accent = '#f0eee6') {
    const mat = this.mapped(rugTexture(base, accent));
    const mesh = this.plane(this.root, w, d, x, 0.135, z, mat); mesh.rotation.x = -Math.PI / 2;
    for (let i = 0; i < 16; i++) for (const end of [-1, 1]) this.box(this.root, 0.06, 0.018, 0.16, x - w / 2 + 0.12 + i * (w - 0.24) / 15, 0.14, z + end * (d / 2 + 0.035), '#e3dacc');
  }
  private plant(parent: Parent, x: number, y: number, z: number, scale = 1, color = '#c5c3bb') {
    if (parent === this.root && y < 0.3) this.obstacles.push({ x, z, w: 0.68 * scale, d: 0.68 * scale });
    const g = this.group(x, y, z, 0, parent); g.scale.setScalar(scale);
    this.cylinder(g, 0.3, 0.5, 0, 0.25, 0, color, 0.36);
    this.cylinder(g, 0.35, 0.06, 0, 0.52, 0, '#ded6b7', 0.35);
    this.cylinder(g, 0.29, 0.02, 0, 0.554, 0, '#5d4830');
    for (let i = 0; i < 9; i++) {
      const a = i * 2.4, tall = 0.7 + i % 3 * 0.17;
      const stem = this.box(g, 0.035, tall, 0.035, Math.cos(a) * 0.1, 0.55 + tall / 2, Math.sin(a) * 0.1, '#486f2e'); stem.rotation.z = Math.cos(a) * 0.3;
      const leaf = this.group(Math.cos(a) * 0.25, 0.96 + i % 3 * 0.22, Math.sin(a) * 0.25, a, g); leaf.rotation.z = (i % 2 ? 1 : -1) * 0.35;
      this.box(leaf, 0.23, 0.085, 0.67, 0, 0, 0.09, ['#6f8b4a', '#7f9a55', '#5f7d43', '#8ea562'][i % 4]);
      this.box(leaf, 0.14, 0.08, 0.25, 0, 0.035, 0.48, '#74904d');
      this.box(leaf, 0.02, 0.018, 0.65, 0, 0.05, 0.09, '#96ab57');
    }
    return g;
  }
  private books(parent: Parent, x: number, y: number, z: number, count: number, size = 1) {
    let offset = 0;
    for (let i = 0; i < count; i++) {
      const width = (0.09 + this.random() * 0.06) * size, height = (0.33 + this.random() * 0.13) * size;
      this.box(parent, width, height, 0.3 * size, x + offset, y + height / 2, z, ['#788c5d', '#d97757', '#d4a27f', '#6a9bcc', '#e3dacc', '#c46686'][i % 6]);
      this.box(parent, width * 0.75, 0.014, 0.012, x + offset, y + height * 0.8, z + 0.157 * size, '#e7d5a3');
      this.box(parent, width * 0.75, 0.014, 0.012, x + offset, y + height * 0.22, z + 0.157 * size, '#cbb990');
      offset += width + 0.025 * size;
    }
  }
  private bookStack(parent: Parent, x: number, y: number, z: number) {
    for (let i = 0; i < 3; i++) {
      const g = this.group(x, y + i * 0.09, z, i % 2 * 0.12, parent);
      this.box(g, 0.42, 0.025, 0.3, 0, 0.014, 0, ['#d97757', '#6a9bcc', '#788c5d'][i]);
      this.box(g, 0.39, 0.055, 0.27, 0, 0.045, 0, '#e2d5b8');
      this.box(g, 0.42, 0.022, 0.3, 0, 0.084, 0, ['#d97757', '#6a9bcc', '#788c5d'][i]);
    }
  }
  private mug(parent: Parent, x: number, y: number, z: number, color = '#e5dfc5') {
    this.cylinder(parent, 0.09, 0.18, x, y + 0.09, z, color, 0.095);
    this.cylinder(parent, 0.076, 0.015, x, y + 0.186, z, '#574631');
    this.box(parent, 0.08, 0.09, 0.035, x + 0.1, y + 0.105, z, color);
  }
  private keyboard(parent: Parent, x: number, y: number, z: number, width = 0.73) {
    this.box(parent, width, 0.065, 0.29, x, y, z, C.cream);
    for (let row = 0; row < 3; row++) for (let col = 0; col < 11; col++) this.box(parent, width / 14, 0.018, 0.038, x - width * 0.43 + col * width / 12, y + 0.041, z - 0.09 + row * 0.068, '#aba89c');
    this.box(parent, 0.31, 0.018, 0.035, x, y + 0.041, z + 0.115, '#a09c8f');
  }
  private lamp(parent: Parent, x: number, y: number, z: number, color = '#d97757') {
    this.cylinder(parent, 0.18, 0.045, x, y + 0.025, z, color);
    this.cylinder(parent, 0.027, 0.48, x, y + 0.27, z, color);
    const arm = this.cylinder(parent, 0.022, 0.38, x - 0.09, y + 0.57, z, C.dark); arm.rotation.z = -0.55;
    const shade = this.cylinder(parent, 0.18, 0.2, x - 0.19, y + 0.7, z, color, 0.07); shade.rotation.z = -0.35;
    this.cylinder(parent, 0.13, 0.01, x - 0.21, y + 0.61, z, '#f4d89a');
  }
  private chair(x: number, z: number, color = '#4a4946', rotation = 0, office = true) {
    const g = this.group(x, 0.15, z, rotation);
    this.box(g, 0.7, 0.13, 0.66, 0, 0.78, 0, color);
    this.box(g, 0.68, 0.73, 0.15, 0, 1.18, 0.3, color);
    this.box(g, 0.61, 0.64, 0.07, 0, 1.2, 0.39, '#403f3b');
    if (office) {
      this.cylinder(g, 0.06, 0.63, 0, 0.4, 0, C.metal);
      for (let i = 0; i < 5; i++) {
        const branch = this.group(0, 0.11, 0, i * Math.PI * 2 / 5, g);
        this.box(branch, 0.08, 0.07, 0.46, 0, 0, 0.19, C.metal);
        this.box(branch, 0.14, 0.1, 0.12, 0, -0.015, 0.41, '#31312e');
      }
      for (const side of [-1, 1]) { this.box(g, 0.05, 0.3, 0.05, side * 0.4, 0.92, 0, C.metal); this.box(g, 0.11, 0.075, 0.45, side * 0.4, 1.07, -0.06, '#32312e'); }
    } else for (const dx of [-0.28, 0.28]) for (const dz of [-0.25, 0.25]) this.box(g, 0.05, 0.74, 0.05, dx, 0.38, dz, C.darkWood);
  }
  private desk(x: number, z: number, role?: RoleId, ceo = false) {
    const rotation = role ? DESK_ANGLES[role] : 0;
    const g = this.group(x, 0, z, rotation); const w = ceo ? 3.1 : 2.7;
    const sideways = Math.abs(Math.sin(rotation)) > 0.5;
    this.obstacles.push({ x, z, w: sideways ? 1.4 : w, d: sideways ? w : 1.4 });
    this.box(g, w, 0.16, 1.4, 0, 1.5, 0, C.desk);
    this.box(g, w + 0.04, 0.04, 1.43, 0, 1.595, 0, '#d5a265');
    this.box(g, w - 0.15, 0.18, 0.1, 0, 1.33, 0.58, C.edge);
    for (const side of [-1, 1]) {
      this.box(g, 0.48, 1.28, 0.96, side * (w / 2 - 0.3), 0.76, 0.05, C.wood);
      for (let i = 0; i < 3; i++) {
        this.box(g, 0.43, 0.33, 0.035, side * (w / 2 - 0.3), 0.48 + i * 0.36, 0.553, '#bd8751');
        this.box(g, 0.11, 0.037, 0.048, side * (w / 2 - 0.3), 0.48 + i * 0.36, 0.588, C.darkWood);
      }
    }
    this.box(g, 0.46, 1.07, 0.73, 0.6, 0.69, 0.17, '#64635c');
    this.box(g, 0.4, 0.99, 0.035, 0.6, 0.69, 0.55, '#807f77');
    for (let i = 0; i < 3; i++) this.box(g, 0.26, 0.015, 0.018, 0.6, 1.05 - i * 0.05, 0.575, '#3a3936');
    this.box(g, 0.027, 0.027, 0.015, 0.69, 0.51, 0.574, '#88c96a');
    this.box(g, 0.63, 0.09, 0.45, -0.07, 1.69, -0.17, '#b3b0a6');
    this.box(g, 0.24, 0.17, 0.17, -0.07, 1.79, -0.23, '#a3a093');
    this.box(g, 1.0, 0.83, 0.61, -0.07, 2.25, -0.26, C.cream);
    this.box(g, 0.63, 0.38, 0.02, -0.07, 2.28, -0.578, '#bab8ae');
    for (let row = 0; row < 6; row++) this.box(g, 0.48, 0.015, 0.015, -0.07, 2.14 + row * 0.055, -0.593, '#979384');
    this.box(g, 0.13, 0.08, 0.015, -0.07, 1.96, -0.593, '#a9a69b');
    this.box(g, 0.92, 0.76, 0.07, -0.07, 2.25, 0.075, '#aaa79c');
    const screenMat = this.mapped(screenTexture(role === 'designer' ? '#e39ab3' : '#e8e6dc', role || 'terminal'), true);
    if (role) this.screens.set(role, screenMat);
    const display = this.group(x, 0, z, rotation, this.scene);
    this.plane(display, 0.75, 0.55, -0.07, 2.28, 0.116, screenMat);
    this.box(g, 0.07, 0.022, 0.02, 0.24, 1.96, 0.122, '#858171');
    this.keyboard(g, -0.07, 1.665, 0.38);
    this.box(g, 0.24, 0.02, 0.3, 0.57, 1.64, 0.38, '#7a7971');
    this.box(g, 0.1, 0.065, 0.15, 0.58, 1.682, 0.38, '#c1bfb7');
    this.lamp(g, -w / 2 + 0.32, 1.625, -0.09, ceo ? '#d97757' : '#d4a27f');
    this.mug(g, 0.83, 1.625, 0.27, role === 'designer' ? '#c46686' : '#f0eee6');
    this.cylinder(g, 0.1, 0.2, -0.76, 1.73, 0.42, '#5f5e58');
    for (let i = 0; i < 5; i++) { const p = this.box(g, 0.022, 0.24 + i % 2 * 0.08, 0.022, -0.8 + i * 0.023, 1.87, 0.42, ['#d4a27f', '#d97757', '#788c5d'][i % 3]); p.rotation.z = (i - 2) * 0.07; }
    this.plant(g, w / 2 - 0.35, 1.625, -0.3, 0.32, '#ddd5af');
    this.bookStack(g, -0.93, 1.64, -0.44);
    const chairPosition = new THREE.Vector3(0, 0, 1.05).applyAxisAngle(new THREE.Vector3(0, 1, 0), rotation);
    this.chair(x + chairPosition.x, z + chairPosition.z, ceo ? '#a8502f' : '#4a4946', rotation);
    const cable = this.box(g, 0.04, 0.68, 0.04, 0.38, 1.22, -0.51, '#3a3936'); cable.rotation.z = 0.13;
    this.box(g, 0.36, 0.04, 0.04, 0.51, 0.89, -0.51, '#3a3936');
  }
  private shelf(x: number, z: number, width: number, height: number, rotation = 0) {
    const g = this.group(x, 0.13, z, rotation);
    this.box(g, width, height, 0.075, 0, height / 2, -0.23, '#725037');
    for (const side of [-1, 1]) this.box(g, 0.1, height, 0.62, side * (width / 2), height / 2, 0, '#b4814d');
    for (let row = 0; row < 5; row++) {
      const y = 0.11 + row * (height - 0.15) / 4;
      this.box(g, width, 0.09, 0.68, 0, y, 0.025, C.wood);
      if (row < 4) { this.books(g, -width / 2 + 0.2, y + 0.045, 0.05, Math.floor(width / 0.2) - 1, Math.min(1.6, height / 3.3)); }
    }
    this.plant(g, 0, height + 0.12, 0, 0.5, '#cbc8b5');
    this.obstacles.push({ x, z, w: rotation ? 0.75 : width, d: rotation ? width : 0.75 });
  }
  private pipe(x: number, z: number, length: number, rotation: number, y = 5.65) {
    const g = this.group(x, 0, z, rotation);
    const main = this.cylinder(g, 0.075, length, 0, y, 0, '#54534e'); main.rotation.z = Math.PI / 2;
    for (const p of [-length / 2 + 0.2, length / 2 - 0.2, 0]) { const cuff = this.cylinder(g, 0.104, 0.12, p, y, 0, '#73716a'); cuff.rotation.z = Math.PI / 2; }
  }
  private build() {
    const { width, depth } = ROOM, left = -width / 2, back = -depth / 2;
    const floor = woodTexture(); floor.wrapS = floor.wrapT = THREE.RepeatWrapping; floor.repeat.set(2, 2);
    this.box(this.root, width + 0.25, 0.5, depth + 0.25, 0, -0.14, 0, '#665b4e');
    this.box(this.root, width, 0.1, depth, 0, 0.08, 0, this.mapped(floor));
    this.box(this.root, width + 0.26, 0.11, 0.13, 0, 0.08, -back + 0.08, '#b78850');
    this.box(this.root, 0.13, 0.11, depth + 0.26, -left + 0.08, 0.08, 0, '#b78850');
    const bricks = (length: number, height: number) => {
      const texture = brickTexture(); texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(length / 3.2, height / 2);
      return this.mapped(texture);
    };
    this.box(this.root, 14.8, 5.8, 0.18, -3.6, 3, back - 0.05, bricks(14.8, 5.8));
    this.box(this.root, 7.3, 5.8, 0.18, 7.43, 3, back - 0.05, '#30302e');
    this.box(this.root, 0.18, 1.65, depth, left - 0.05, 0.95, 0, bricks(depth, 1.65));
    this.box(this.root, 0.18, 4.15, 9.2, left - 0.05, 3.87, 3.9, bricks(9.2, 4.15));
    this.box(this.root, 0.18, 4.15, 0.55, left - 0.05, 3.87, back + 0.26, bricks(0.55, 4.15));
    this.box(this.root, 0.18, 0.3, 7.3, left - 0.05, 5.8, -4.35, bricks(7.3, 0.3));
    this.box(this.root, width, 0.12, 0.18, 0, 0.2, back + 0.14, C.darkWood);
    this.box(this.root, 0.18, 0.12, depth, left + 0.14, 0.2, 0, C.darkWood);
    // A window opening, mullions, city view, and sill are separate geometry.
    const window = this.group(left + 0.08, 3.67, -4.32, Math.PI / 2);
    this.plane(window, 6.85, 3.73, 0, 0, -0.015, this.mapped(cityTexture(), true));
    for (const y of [-1.94, 1.94]) this.box(window, 7.1, 0.15, 0.15, 0, y, 0.04, '#584d3c');
    for (let i = 0; i < 6; i++) this.box(window, 0.07, 3.88, 0.16, -3.44 + i * 1.376, 0, 0.04, '#524f45');
    for (const y of [-0.6, 0.64]) this.box(window, 7.1, 0.07, 0.16, 0, y, 0.06, '#524f45');
    this.box(window, 7.25, 0.14, 0.6, 0, -1.96, 0.2, '#b58e56');
    for (let i = 0; i < 4; i++) this.plant(window, -2.7 + i * 1.7, -1.89, 0.24, 0.4, ['#b67b44', '#6f6d66', '#9d7743'][i % 3]);
    this.pipe(-3.6, back + 0.18, 14.6, 0); this.pipe(left + 0.22, -4.35, 7.4, Math.PI / 2);
    for (const x of [-10.3, 3.55, 9.4]) {
      this.cylinder(this.root, 0.075, 5.5, x, 2.94, back + 0.2, '#54534e');
      for (const y of [0.4, 2.8, 5.35]) this.cylinder(this.root, 0.11, 0.12, x, y, back + 0.2, '#7b7971');
    }
    this.rug(-7, -5.7, 4.7, 3.7, '#c6613f');
    this.rug(-9.1, 3.5, 3.1, 3.6, '#788c5d');
    this.rug(MEETING.x, MEETING.z, 6.1, 5.3, '#a85a76');
    this.rug(6.9, 5.7, 5.7, 4.5, '#5f8cb8');
    for (const role of Object.keys(DESK_ANGLES) as RoleId[]) {
      const p = DESKS[role]; this.desk(p.x, p.z, role, role === 'ceo');
    }
    this.shelf(-9.4, -7.86, 1.4, 4.3);
    this.shelf(-10.4, 5.1, 2.7, 4.2, Math.PI / 2);
    this.shelf(10.15, 0.8, 1.45, 3.2);
    this.plant(this.root, -9.2, 0.1, -1, 1.1);
    this.plant(this.root, -4.5, 0.1, -7.6, 1.45);
    this.plant(this.root, 2.7, 0.1, -7.7, 1.4);
    this.plant(this.root, 10.05, 0.1, -6.8, 1.38);
    this.plant(this.root, 10, 0.1, 3.8, 1.2);
    this.plant(this.root, -7.6, 0.1, 7.1, 1.25, '#b57d45');
    this.plant(this.root, 2.3, 0.1, 7.2, 1.25, '#be8b52');
    // Mission board and the long cabinet underneath it.
    const cabinet = this.group(-0.75, 0, -2.5);
    this.obstacles.push({ x: -1, z: -7.87, w: 5.2, d: 0.82 });
    this.box(cabinet, 5.2, 2.6, 0.19, -0.25, 3.77, -5.87, '#6e482e');
    this.box(cabinet, 5.03, 2.43, 0.06, -0.25, 3.77, -5.74, '#dbad60');
    this.board.position.set(-1, 3.77, back + 0.31); this.board.userData.action = 'board'; this.scene.add(this.board);
    this.plane(this.board, 4.82, 2.24, 0, 0, 0, this.mapped(boardTexture()));
    this.box(cabinet, 5.2, 0.13, 0.82, -0.25, 1.58, -5.37, '#b9854b');
    this.box(cabinet, 5.04, 1.32, 0.65, -0.25, 0.87, -5.47, C.edge);
    for (let i = 0; i < 7; i++) {
      this.box(cabinet, 0.62, 0.5, 0.66, -2.41 + i * 0.72, 0.68, -5.42, '#ac7845');
      this.box(cabinet, 0.09, 0.025, 0.045, -2.41 + i * 0.72, 0.9, -5.07, '#60452f');
      this.books(cabinet, -2.65 + i * 0.72, 1.13, -5.25, 3);
    }
    this.bookStack(cabinet, -2.07, 1.66, -5.32); this.plant(cabinet, -0.9, 1.66, -5.34, 0.4);
    this.box(cabinet, 0.53, 0.31, 0.44, 1.22, 1.84, -5.29, '#dacdaf');
    this.box(cabinet, 0.15, 0.04, 0.015, 1.22, 1.84, -5.06, '#866647');
    // Server racks with individually built bays, LEDs, and cables.
    for (const x of [5.7, 7.6]) {
      const g = this.group(x, 0.15, -7.6); this.obstacles.push({ x, z: -7.6, w: 1.25, d: 1.2 });
      this.box(g, 1.27, 4.38, 1.05, 0, 2.19, 0, '#3a3936');
      this.box(g, 1.13, 4.19, 0.07, 0, 2.18, 0.56, '#9e4a2e');
      for (let row = 0; row < 13; row++) {
        const y = 0.28 + row * 0.313;
        this.box(g, 0.99, 0.24, 0.045, 0, y, 0.605, '#4a4944');
        for (let col = 0; col < 5; col++) this.box(g, 0.085, 0.016, 0.012, -0.37 + col * 0.1, y + 0.03, 0.633, '#858172');
        this.box(g, 0.04, 0.035, 0.015, 0.32, y + 0.045, 0.64, row % 3 ? '#9db56f' : '#d4a27f');
        this.box(g, 0.03, 0.035, 0.015, 0.4, y + 0.045, 0.64, '#d97757');
      }
      this.box(g, 0.035, 4.35, 0.035, -0.58, 2.18, 0.61, '#73716a');
      this.box(g, 0.035, 4.35, 0.035, 0.58, 2.18, 0.61, '#73716a');
      for (let i = 0; i < 3; i++) {
        this.box(this.root, 0.025, 4.8, 0.025, x + 0.5 + i * 0.07, 3.1, back + 0.13, ['#d97757', '#6a9bcc', '#d4a27f'][i]);
        this.box(this.root, 1.1, 0.025, 0.025, x, 5.5 - i * 0.09, back + 0.13, ['#d97757', '#6a9bcc', '#d4a27f'][i]);
      }
    }
    // Coffee counter, machine, cups, and two bar stools.
    const coffee = this.group(-9.1, 0.1, 1.8);
    this.obstacles.push({ x: -9.1, z: 1.8, w: 2.8, d: 1.45 });
    this.box(coffee, 2.5, 1.4, 0.94, 0, 0.7, 0, C.wood);
    this.box(coffee, 2.8, 0.15, 1.45, 0, 1.47, 0.12, '#d2a06a');
    for (let i = 0; i < 3; i++) { this.box(coffee, 0.76, 1.14, 0.04, -0.8 + i * 0.8, 0.74, 0.49, '#ba8651'); this.box(coffee, 0.08, 0.035, 0.035, -0.8 + i * 0.8, 1.16, 0.535, C.darkWood); }
    this.box(coffee, 0.85, 0.77, 0.67, -0.5, 1.96, -0.06, '#928e7e');
    this.box(coffee, 0.73, 0.51, 0.04, -0.5, 1.88, 0.3, '#363532');
    this.box(coffee, 0.85, 0.13, 0.7, -0.5, 2.34, -0.06, '#b5b2a8');
    for (const dx of [-0.72, -0.28]) { this.cylinder(coffee, 0.06, 0.13, dx, 2.11, 0.33, '#c6c4ae'); this.mug(coffee, dx, 1.61, 0.33); }
    for (let i = 0; i < 4; i++) this.mug(coffee, -1.05 + i * 0.6, 1.555, 0.64);
    this.plant(coffee, 1.0, 1.555, -0.15, 0.37, '#a77941');
    for (const x of [-9.76, -8.58]) {
      this.obstacles.push({ x, z: 3.7, w: 0.65, d: 0.65 });
      this.cylinder(this.root, 0.34, 0.14, x, 0.96, 3.7, C.teal);
      for (const dx of [-0.19, 0.19]) for (const dz of [-0.19, 0.19]) this.box(this.root, 0.055, 0.82, 0.055, x + dx, 0.48, 3.7 + dz, '#634930');
      this.box(this.root, 0.43, 0.045, 0.05, x, 0.35, 3.9, '#7c5c39');
    }
    // Meeting zone with movable characters and an actual laptop mesh.
    const meeting = this.group(MEETING.x, 0, MEETING.z);
    this.obstacles.push({ x: MEETING.x, z: MEETING.z, w: MEETING.width, d: MEETING.depth });
    this.box(meeting, MEETING.width, 0.15, MEETING.depth, 0, 1.49, 0, '#b78044');
    for (const dx of [-1.8, 1.8]) for (const dz of [-0.8, 0.8]) this.box(meeting, 0.14, 1.31, 0.14, dx, 0.75, dz, '#91602f');
    this.plant(meeting, 0.68, 1.57, -0.03, 0.31, '#b19a60');
    this.box(meeting, 0.73, 0.055, 0.48, -0.65, 1.62, 0.05, '#bebbb2');
    const laptop = this.group(-0.65, 1.92, -0.16, 0, meeting); laptop.rotation.x = -0.12;
    this.box(laptop, 0.74, 0.55, 0.05, 0, 0, 0, '#b0afa9');
    this.plane(laptop, 0.62, 0.4, 0, 0, 0.028, this.mapped(screenTexture('#a9c4e2', 'meeting'), true));
    for (const x of [-0.92, 1.15]) this.box(meeting, 0.34, 0.025, 0.42, x, 1.59, 0.65, '#ece0bc');
    for (const role of Object.keys(MEETING_SPOTS) as RoleId[]) {
      const p = MEETING_SPOTS[role], rotation = role === 'designer' ? Math.PI / 2 : ['ceo', 'pm'].includes(role) ? Math.PI : 0;
      this.chair(p.x, p.z, C.teal, rotation, false);
    }
    // Lounge: upholstered sofa, gold cushions, round table, reading material.
    const couch = this.group(7, 0.12, 5.2, Math.PI); this.obstacles.push({ x: 7, z: 5.2, w: 3.85, d: 1.25 });
    this.box(couch, 3.7, 0.42, 1.1, 0, 0.37, 0, '#b5583a');
    this.box(couch, 3.72, 1.12, 0.28, 0, 0.85, 0.49, '#c6613f');
    for (const side of [-1, 1]) this.box(couch, 0.36, 0.8, 1.18, side * 1.8, 0.68, 0, '#cc6f4d');
    for (let i = 0; i < 3; i++) this.box(couch, 1.08, 0.19, 0.84, -1.14 + i * 1.14, 0.69, -0.04, '#d97757');
    for (const x of [-1.13, 1.1]) { const pillow = this.box(couch, 0.61, 0.59, 0.16, x, 1.03, 0.26, '#e3dacc'); pillow.rotation.z = x * 0.11; this.box(couch, 0.23, 0.23, 0.022, x, 1.03, 0.16, '#faf9f5'); }
    const loungeTable = this.group(6.6, 0, 6.8);
    this.cylinder(loungeTable, 0.83, 0.13, 0, 0.88, 0, '#b48047', 0.83, 16);
    this.obstacles.push({ x: 6.6, z: 6.8, w: 1.66, d: 1.66 });
    for (let i = 0; i < 3; i++) this.box(loungeTable, 0.1, 0.72, 0.1, Math.cos(i * 2.09) * 0.5, 0.47, Math.sin(i * 2.09) * 0.5, '#725231');
    this.bookStack(loungeTable, -0.23, 0.965, 0.17); this.plant(loungeTable, 0.25, 0.965, -0.28, 0.3, '#ad8b3f'); this.mug(loungeTable, -0.55, 0.965, -0.24);
    // Low divider, a little office robot, and open cutaway rail.
    const divider = this.group(-2.2, 0.13, 7.45);
    this.obstacles.push({ x: -2.2, z: 7.45, w: 3.6, d: 0.6 });
    this.box(divider, 3.7, 0.09, 0.71, 0, 1.15, 0, C.wood);
    this.box(divider, 3.7, 0.07, 0.63, 0, 0.08, 0, C.edge);
    for (const x of [-1.8, -0.6, 0.6, 1.8]) this.box(divider, 0.08, 1.11, 0.64, x, 0.64, 0, C.wood);
    for (let i = 0; i < 3; i++) this.books(divider, -1.6 + i * 1.2, 0.13, 0.07, 6, 1.6);
    this.plant(divider, -1.25, 1.2, 0, 0.42, '#a98247'); this.bookStack(divider, -0.4, 1.2, 0);
    this.box(divider, 0.27, 0.34, 0.21, 0.7, 1.5, 0, '#d38368');
    this.box(divider, 0.34, 0.24, 0.26, 0.7, 1.81, 0, '#cac8c1');
    for (const x of [0.62, 0.78]) this.box(divider, 0.05, 0.05, 0.017, x, 1.83, 0.14, '#9e4a2e');
    this.box(divider, 0.02, 0.16, 0.02, 0.7, 2.0, 0, '#7c7a72');
    this.box(divider, 0.05, 0.05, 0.05, 0.7, 2.1, 0, '#bf6646');
    for (const x of [0.6, 0.8]) this.box(divider, 0.07, 0.15, 0.09, x, 1.27, 0, '#a44d30');
    for (let i = 0; i < 9; i++) {
      const x = left + 0.15 + i * 1.58;
      this.box(this.root, 0.09, 1.2, 0.09, x, 0.7, -back, C.metal);
    }
    for (const y of [0.48, 0.91, 1.31]) this.box(this.root, 12.7, 0.06, 0.07, -4.53, y, -back, C.metal);
    this.box(this.root, 12.9, 0.085, 0.15, -4.53, 1.35, -back, '#bd8952');
    // Warm pendant lights; no ceiling hides the layout.
    for (const x of [-8.55, 1.1]) {
      this.cylinder(this.root, 0.018, 0.85, x, 5.36, -5.8, '#4a4032');
      this.cylinder(this.root, 0.37, 0.28, x, 4.81, -5.8, '#d97757', 0.12);
      this.cylinder(this.root, 0.29, 0.025, x, 4.66, -5.8, '#ffe6a1');
      const light = new THREE.PointLight('#ffcd85', 6, 7, 2); light.position.set(x, 4.56, -5.8); this.scene.add(light);
    }
    // Small framed prints retain the reference's lived-in office atmosphere.
    for (const [x, y] of [[-4.5, 4.35], [10.2, 3.95]]) {
      this.box(this.root, 0.82, 1.12, 0.1, x, y, back + 0.14, '#c59453');
      const art = pixelTexture(48, 64, ctx => { ctx.fillStyle = '#e7d8a9'; ctx.fillRect(0, 0, 48, 64); ctx.fillStyle = '#d38166'; ctx.fillRect(5, 7, 38, 38); ctx.fillStyle = '#cfac67'; ctx.fillRect(5, 35, 38, 17); for (let i = 0; i < 7; i++) { ctx.fillStyle = i % 2 ? '#838179' : '#727069'; ctx.fillRect(5 + i * 5, 17 + i * 7 % 18, 5, 25); } });
      this.plane(this.root, 0.68, 0.94, x, y, back + 0.2, this.mapped(art));
    }
  }
  private batch() {
    this.root.updateMatrixWorld(true);
    const batches = new Map<Material, THREE.BufferGeometry[]>();
    this.root.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      const geometry = object.geometry.clone().applyMatrix4(object.matrixWorld);
      const mat = object.material as Material;
      const list = batches.get(mat) || []; list.push(geometry); batches.set(mat, list);
    });
    for (const [mat, parts] of batches) {
      const merged = mergeGeometries(parts); parts.forEach(part => part.dispose());
      if (!merged) throw new Error('Geometri kantor gagal digabungkan.');
      const mesh = new THREE.Mesh(merged, mat); mesh.castShadow = true; mesh.receiveShadow = true; this.scene.add(mesh);
    }
    this.scene.remove(this.root);
    const live = new Set<THREE.BufferGeometry>();
    this.scene.traverse(object => { if (object instanceof THREE.Mesh) live.add(object.geometry); });
    this.geometries.forEach(geometry => { if (!live.has(geometry)) geometry.dispose(); });
    this.root.clear(); this.geometries.length = 0;
  }
}
