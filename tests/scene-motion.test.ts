import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Character, APPEARANCES } from '../src/scene/character.js';

function pose(actor: Character) {
  return [actor.root, actor.head, actor.torso, ...actor.arms, ...actor.legs].map(part => [part.position.toArray(), part.rotation.toArray()]);
}

test('reduced motion keeps typing and idle character poses static', () => {
  const actor = new Character(new THREE.Scene(), { x: 0, z: 0 }, APPEARANCES.ceo);
  actor.sit();
  actor.update(0.1, 1, true, true);
  const first = pose(actor);
  actor.update(0.1, 4, true, true);
  assert.deepEqual(pose(actor), first);
});

test('reduced motion completes a requested trip once and preserves its arrival behavior', () => {
  const actor = new Character(new THREE.Scene(), { x: 0, z: 0 }, APPEARANCES.ceo);
  let arrivals = 0;
  assert.equal(actor.moveTo({ x: 2, z: 2 }, [], () => { arrivals++; actor.sit(Math.PI); }), true);
  actor.update(0.1, 1, false, true);
  assert.equal(actor.moving, false);
  assert.equal(arrivals, 1);
  assert.ok(Math.hypot(actor.position.x - 2, actor.position.z - 2) < 0.2);
  actor.update(0.1, 2, false, true);
  assert.equal(arrivals, 1);
});
