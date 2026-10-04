import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { AGENTS, agentState, STATE_LABELS, type Task, type RoleId } from '../../shared/types';
import { Scenery } from './scenery';
import { ROOM, DESKS, SEATS, MEETING_SPOTS, DESK_ANGLES, AMBIENT_ROUTES } from './layout';
import { Character, APPEARANCES } from './character';

export interface WorldProps { selected: RoleId | null; task?: Task; showNames: boolean; onSelect: (id: RoleId) => void; onBoard: () => void; }

export class OfficeWorld {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-15, 15, 10, -10, 0.1, 120);
  readonly controls: OrbitControls;
  private scenery: Scenery;
  private characters = new Map<RoleId, Character>();
  private ambient: Character[] = [];
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private hovered: RoleId | null = null;
  private meeting = false;
  private destinations = new Map<RoleId, string>();
  private observer: ResizeObserver;
  private cleanups: (() => void)[] = [];
  private previousTime = 0;
  private previousFrame = 0;
  private previousShadow = -1;
  private started = 0;
  private width = 1;
  private height = 1;
  private down?: { x: number; y: number; };
  private ambientNext = [1, 6];
  private ambientTrip = [0, 0];
  private disposed = false;
  private reducedMotion = false;
  constructor(private host: HTMLDivElement, private read: () => WorldProps, private labels: Map<RoleId, HTMLButtonElement>) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
    this.renderer.domElement.setAttribute('aria-label', 'Kantor 3D isometrik interaktif');
    host.prepend(this.renderer.domElement);
    this.scene.background = new THREE.Color('#f0eee6');
    this.scene.add(new THREE.HemisphereLight('#faf9f5', '#8a7a66', 2.3));
    const sun = new THREE.DirectionalLight('#ffdbac', 3.3);
    sun.position.set(-7, 17, 12); sun.target.position.set(0, 0, -1);
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -19, right: 19, top: 18, bottom: -18, near: 0.1, far: 55 });
    sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.03; sun.shadow.radius = 2.5;
    this.scene.add(sun, sun.target);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: '#f0eee6', roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.41; ground.receiveShadow = true; ground.userData.ground = true; this.scene.add(ground);
    this.scenery = new Scenery(this.scene);
    const anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    this.scene.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        for (const value of Object.values(material)) {
          if (value instanceof THREE.Texture) value.anisotropy = anisotropy;
        }
      }
    });
    for (const agent of AGENTS) {
      const character = new Character(this.scene, SEATS[agent.id], APPEARANCES[agent.id], agent.id);
      character.sit(DESK_ANGLES[agent.id]); this.characters.set(agent.id, character); this.destinations.set(agent.id, 'desk');
    }
    const coffee = new Character(this.scene, AMBIENT_ROUTES[0][0], { skin: '#dbaa7b', hair: '#533c30', shirt: '#388c8a', longHair: true }); coffee.stand();
    const visitor = new Character(this.scene, AMBIENT_ROUTES[1][0], { skin: '#d3a170', hair: '#43302c', shirt: '#936246', glasses: true }); visitor.stand(Math.PI / 2);
    this.ambient = [coffee, visitor];
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true; this.controls.dampingFactor = 0.09;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updateMotion = () => {
      this.reducedMotion = motion.matches; this.controls.enableDamping = !this.reducedMotion;
      this.renderer.shadowMap.needsUpdate = true;
    };
    updateMotion(); motion.addEventListener('change', updateMotion);
    this.cleanups.push(() => motion.removeEventListener('change', updateMotion));
    this.controls.minPolarAngle = Math.PI / 8; this.controls.maxPolarAngle = Math.PI / 2.7;
    this.controls.minZoom = 0.65; this.controls.maxZoom = 3.5;
    this.controls.screenSpacePanning = true; this.controls.enablePan = true;
    this.controls.target.set(0, 1.55, 0);
    this.controls.rotateSpeed = 0.55;
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    this.reset();
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(host);
    this.listen('pointerdown', (event: PointerEvent) => { this.down = { x: event.clientX, y: event.clientY }; });
    this.listen('pointermove', (event: PointerEvent) => this.hover(event));
    this.listen('pointerleave', () => { this.hovered = null; });
    this.listen('pointerup', (event: PointerEvent) => {
      if (event.button !== 0 || !this.down || Math.hypot(event.clientX - this.down.x, event.clientY - this.down.y) > 5) return;
      const action = this.pick(event);
      if (action?.role) this.read().onSelect(action.role);
      else if (action?.board) this.read().onBoard();
      this.down = undefined;
    });
    this.listen('contextmenu', (event: Event) => event.preventDefault());
    const lost = (event: Event) => { event.preventDefault(); host.dispatchEvent(new CustomEvent('office-render-error', { detail: 'Koneksi grafis terputus. Muat ulang halaman.' })); };
    this.renderer.domElement.addEventListener('webglcontextlost', lost);
    this.cleanups.push(() => this.renderer.domElement.removeEventListener('webglcontextlost', lost));
    this.resize();
    this.renderer.setAnimationLoop(time => this.frame(time));
  }
  private listen(type: string, callback: (event: any) => void) {
    this.renderer.domElement.addEventListener(type, callback);
    this.cleanups.push(() => this.renderer.domElement.removeEventListener(type, callback));
  }
  private resize() {
    this.width = Math.max(1, this.host.clientWidth); this.height = Math.max(1, this.host.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(this.width, this.height);
    this.fit();
  }
  private fit() {
    this.camera.updateMatrixWorld(true);
    const points: THREE.Vector3[] = [];
    const halfWidth = ROOM.width / 2, halfDepth = ROOM.depth / 2;
    for (const x of [-halfWidth - 0.3, halfWidth + 0.3]) for (const z of [-halfDepth - 0.3, halfDepth + 0.3]) for (const y of [-0.5, 0.15]) points.push(new THREE.Vector3(x, y, z));
    for (const z of [-halfDepth - 0.1, halfDepth + 0.1]) points.push(new THREE.Vector3(-halfWidth - 0.15, ROOM.wallHeight + 0.15, z));
    for (const x of [-halfWidth - 0.15, halfWidth + 0.15]) points.push(new THREE.Vector3(x, ROOM.wallHeight + 0.15, -halfDepth - 0.15));
    const view = points.map(point => point.applyMatrix4(this.camera.matrixWorldInverse));
    const minX = Math.min(...view.map(p => p.x)), maxX = Math.max(...view.map(p => p.x));
    const minY = Math.min(...view.map(p => p.y)), maxY = Math.max(...view.map(p => p.y));
    const aspect = this.width / this.height;
    const halfHeight = Math.max((maxY - minY) / 2, (maxX - minX) / (2 * aspect)) * 1.075;
    const centerX = (minX + maxX) / 2, centerY = (minY + maxY) / 2;
    this.camera.left = centerX - halfHeight * aspect; this.camera.right = centerX + halfHeight * aspect;
    this.camera.top = centerY + halfHeight; this.camera.bottom = centerY - halfHeight;
    this.camera.updateProjectionMatrix();
  }
  zoom(delta: number) { this.camera.zoom = THREE.MathUtils.clamp(this.camera.zoom * (1 + delta), 0.65, 3.5); this.camera.updateProjectionMatrix(); }
  private clearCameraInertia() {
    // Finish accumulated drag before a preset replaces the camera position.
    const damping = this.controls.enableDamping;
    this.controls.enableDamping = false; this.controls.update(); this.controls.enableDamping = damping;
  }
  rotate(delta: number) {
    this.clearCameraInertia();
    const offset = this.camera.position.clone().sub(this.controls.target);
    offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), delta);
    this.camera.position.copy(this.controls.target).add(offset); this.camera.lookAt(this.controls.target); this.controls.update();
  }
  reset() {
    this.clearCameraInertia();
    if (this.controls) this.controls.minPolarAngle = Math.PI / 8;
    this.controls?.target.set(0, 1.55, 0);
    this.camera.position.set(26, 24.5, 31.5); this.camera.lookAt(0, 1.55, 0); this.camera.zoom = 1;
    this.controls?.update(); this.fit();
  }
  topView() {
    this.clearCameraInertia();
    this.controls.minPolarAngle = 0.001; this.controls.target.set(0, 0, 0);
    this.camera.position.set(0, 35, 0.05); this.camera.lookAt(this.controls.target); this.camera.zoom = 1;
    this.controls.update(); this.fit();
  }
  setMeeting(enabled: boolean) { this.meeting = enabled; }
  private pick(event: PointerEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    for (const hit of this.raycaster.intersectObjects(this.scene.children, true)) {
      let object: THREE.Object3D | null = hit.object;
      while (object) {
        if (object.userData.role) return { role: object.userData.role as RoleId };
        if (object.userData.action === 'board') return { board: true };
        object = object.parent;
      }
      if (hit.object instanceof THREE.Mesh && hit.object.material instanceof THREE.Material && hit.object.material.transparent) continue;
      return null;
    }
    return null;
  }
  private hover(event: PointerEvent) {
    if (event.buttons) return;
    const action = this.pick(event); this.hovered = action?.role || null;
    this.renderer.domElement.style.cursor = action ? 'pointer' : 'grab';
  }
  private frame(timestamp: number) {
    if (this.disposed || timestamp - this.previousFrame < 1000 / 30) return;
    this.previousFrame = timestamp;
    if (!this.started) this.started = timestamp;
    const delta = Math.min(0.25, this.previousTime ? (timestamp - this.previousTime) / 1000 : 0);
    this.previousTime = timestamp;
    if (document.hidden) return;
    const time = (timestamp - this.started) / 1000, props = this.read();
    for (const agent of AGENTS) {
      const state = agentState(agent.id, props.task), actor = this.characters.get(agent.id)!;
      const destination = this.meeting && state !== 'working' ? 'meeting' : 'desk';
      if (this.destinations.get(agent.id) !== destination) {
        const target = destination === 'meeting' ? MEETING_SPOTS[agent.id] : SEATS[agent.id];
        const angle = destination === 'desk' ? DESK_ANGLES[agent.id] : agent.id === 'designer' ? Math.PI / 2 : ['ceo', 'pm'].includes(agent.id) ? Math.PI : 0;
        if (actor.moveTo(target, this.scenery.obstacles, () => actor.sit(angle))) this.destinations.set(agent.id, destination);
      }
      actor.update(delta, time, state === 'working', this.reducedMotion);
      actor.ring.visible = props.selected === agent.id || this.hovered === agent.id;
      const screen = this.scenery.screens.get(agent.id)!;
      screen.emissiveIntensity = state === 'working' ? 0.4 + (this.reducedMotion ? 0 : Math.sin(time * 4) * 0.08) : 0.22;
      const label = this.labels.get(agent.id);
      if (label) {
        const visible = props.showNames || props.selected === agent.id || this.hovered === agent.id || state === 'working';
        const position = actor.root.position.clone().add(new THREE.Vector3(0, 2.73, 0)).project(this.camera);
        label.hidden = !visible || position.z > 1 || position.z < -1;
        const left = `${(position.x * 0.5 + 0.5) * this.width}px`, top = `${(-position.y * 0.5 + 0.5) * this.height}px`;
        if (label.style.left !== left) label.style.left = left;
        if (label.style.top !== top) label.style.top = top;
        const motion = actor.moving ? 'walking' : 'seated';
        if (label.dataset.motion !== motion) label.dataset.motion = motion;
        const subtitle = label.querySelector('small')!, text = actor.moving ? 'Lagi jalan' : state === 'working' ? 'Ngetik…' : agent.role;
        if (subtitle.textContent !== text) subtitle.textContent = text;
        if (label.dataset.state !== state) label.dataset.state = state;
        const title = `${agent.name} · ${STATE_LABELS[state]}`; if (label.title !== title) label.title = title;
      }
    }
    for (let i = 0; i < this.ambient.length; i++) {
      const actor = this.ambient[i];
      if (!this.reducedMotion && i < 2 && time > this.ambientNext[i] && !actor.moving) {
        this.ambientTrip[i] = 1 - this.ambientTrip[i];
        actor.moveTo(AMBIENT_ROUTES[i][this.ambientTrip[i]], this.scenery.obstacles, () => { actor.stand(i ? Math.PI / 2 : -Math.PI / 2); });
        this.ambientNext[i] = time + 12 + i * 3;
      }
      actor.update(delta, time, i === 2, this.reducedMotion);
    }
    const shadowsMoving = !this.reducedMotion && ([...this.characters.values(), ...this.ambient].some(actor => actor.moving) ||
      AGENTS.some(agent => agentState(agent.id, props.task) === 'working'));
    if (time - this.previousShadow >= (shadowsMoving ? 0.15 : 0.8)) {
      this.renderer.shadowMap.needsUpdate = true; this.previousShadow = time;
    }
    this.controls.update(); this.renderer.render(this.scene, this.camera);
  }
  dispose() {
    this.disposed = true; this.renderer.setAnimationLoop(null); this.observer.disconnect(); this.controls.dispose(); this.cleanups.forEach(cleanup => cleanup());
    const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
    this.scene.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      geometries.add(object.geometry);
      for (const mat of Array.isArray(object.material) ? object.material : [object.material]) {
        materials.add(mat); for (const value of Object.values(mat)) if (value instanceof THREE.Texture) textures.add(value);
      }
    });
    textures.forEach(texture => texture.dispose()); geometries.forEach(geometry => geometry.dispose()); materials.forEach(mat => mat.dispose());
    this.scene.traverse(object => { if (object instanceof THREE.Light && 'shadow' in object) (object as THREE.DirectionalLight).shadow?.dispose(); });
    this.renderer.dispose(); this.renderer.domElement.remove();
  }
}
