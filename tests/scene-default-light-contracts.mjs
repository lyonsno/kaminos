import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as THREE from '../lib/three.webgpu.js';

const source = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const end = source.indexOf('  // Transform gizmo');
const start = source.lastIndexOf('  if (fireLightFieldRouteParams()', end);
assert.ok(start > 0 && end > start, 'scene startup lighting section exists');
const scene = new THREE.Scene();
let restored = false;
const context = vm.createContext({
  THREE, scene, rimLight: null,
  fireLightFieldRouteParams: () => new URLSearchParams(),
  setRimLight() { restored = true; context.rimLight.visible = false; },
});
vm.runInContext(source.slice(start, end), context);
const lights = [];
scene.traverse(object => { if (object.isLight) lights.push(object); });
assert.ok(restored, 'authored rim settings are restored');
assert.equal(lights.filter(light => light.isDirectionalLight).length, 0,
  'startup must not install an uncontrolled directional light');
assert.equal(lights.length, 1, 'only the authored rim light is installed');
assert.equal(lights[0], context.rimLight);
assert.equal(lights[0].visible, false, 'authored off state is preserved');
console.log('scene default light contracts passed');
