import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from '../lib/three.core.js';
const source = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const match = source.match(/function motionGroundOpenKnee\(hip, knee, hock\) \{([\s\S]*?)\n\}/);
assert.ok(match, 'ground stance must open the folded knee before aligning the hip-to-paw support line');
const open = Function('THREE', `return function(hip,knee,hock){${match[1]}}`)(THREE);
for (const rotation of [0, .7]) {
  const root = new THREE.Object3D(), hip = new THREE.Object3D(), knee = new THREE.Object3D(), hock = new THREE.Object3D();
  root.rotation.set(rotation, -.3, .2); root.add(hip); hip.add(knee); knee.add(hock);
  knee.position.set(0,-1,0); hock.position.set(.5,Math.sqrt(.75),0);
  root.updateMatrixWorld(true);
  open(hip,knee,hock); root.updateMatrixWorld(true);
  const p = knee.getWorldPosition(new THREE.Vector3());
  const angle = hip.getWorldPosition(new THREE.Vector3()).sub(p).angleTo(hock.getWorldPosition(new THREE.Vector3()).sub(p));
  assert.ok(Math.abs(angle - 150*Math.PI/180) < 1e-10, 'support stance opens to a bent 150-degree knee, not a locked straight leg');
  assert.ok(Math.abs(hock.getWorldPosition(new THREE.Vector3()).distanceTo(p)-1)<1e-10, 'opening preserves limb length');
  const q = knee.quaternion.clone(); open(hip,knee,hock);
  assert.ok(q.angleTo(knee.quaternion)<1e-7, 'already open stance is unchanged');
}
console.log('cat open stance contracts passed');
