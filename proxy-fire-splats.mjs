// Fire splat proxy layer: soft billboards drawn from the latest heat-block
// snapshot. Smoky blocks are dark alpha splats; hot blocks are additive glow
// splats coloured along a blackbody-like ramp. Billboards face whichever camera
// renders them, so an agent's second camera draws the fire from its own view.
import * as THREE from './lib/three.webgpu.js';
import { attribute, positionGeometry, vec3, float, cross, normalize, select, abs, mix, smoothstep, uniform, cameraPosition, exp, max, min } from './lib/three.tsl.js';
import { HEAT_BLOCK_FLOATS } from './proxy-snapshot.mjs';

function splatMesh({ name, blending, colorFor, opacityFor, sizeScale, stretch }) {
  const quad = new THREE.PlaneGeometry(2, 2);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = quad.index.clone();
  geometry.setAttribute('position', quad.getAttribute('position').clone());
  quad.dispose();
  const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending, side: THREE.DoubleSide });
  const centre = attribute('blockCentre', 'vec3');
  const toCamera = normalize(cameraPosition.sub(centre));
  const helper = select(abs(toCamera.y).greaterThan(0.99), vec3(1, 0, 0), vec3(0, 1, 0));
  const right = normalize(cross(helper, toCamera)), up = cross(toCamera, right);
  // Taller than wide: block rows sit four cells apart, so stretched splats
  // blend into a column instead of banding.
  material.positionNode = centre.add(right.mul(positionGeometry.x).add(up.mul(positionGeometry.y.mul(stretch))).mul(attribute('blockSize', 'float').mul(sizeScale)));
  const radial = positionGeometry.x.mul(positionGeometry.x).add(positionGeometry.y.mul(positionGeometry.y));
  const falloff = exp(radial.mul(-2.4)).mul(smoothstep(float(1), float(0.7), radial));
  material.colorNode = colorFor(attribute('blockHeat', 'float'), attribute('blockSmoke', 'float'));
  material.opacityNode = opacityFor(attribute('blockHeat', 'float'), attribute('blockSmoke', 'float')).mul(falloff);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.userData.kaminosProxyPreview = true;
  return mesh;
}

export function createFireSplatLayer({ heatExposure = 1, smokeDensity = 2, sizeScale = 1.15, stretch = 1.5 } = {}) {
  // Heat is normalised by the snapshot's hottest block, so only the flame core
  // glows; the warm plume around it reads through the smoke splats instead.
  const exposure = uniform(heatExposure), density = uniform(smokeDensity), scale = uniform(sizeScale), stretchUniform = uniform(stretch), heatMax = uniform(1);
  // Blackbody-like ramp: deep red, orange, then pale yellow as heat rises.
  const ramp = t => mix(mix(vec3(0.55, 0.06, 0.01), vec3(1.0, 0.42, 0.06), smoothstep(float(0.08), float(0.45), t)),
    vec3(1.0, 0.86, 0.55), smoothstep(float(0.45), float(1.1), t));
  const relative = heat => heat.div(max(heatMax, float(1e-6)));
  const smoke = splatMesh({ name: 'Fire proxy smoke splats', blending: THREE.NormalBlending, sizeScale: scale, stretch: stretchUniform,
    colorFor: () => vec3(0.05, 0.05, 0.055),
    opacityFor: (heat, smokeValue) => min(float(0.85), smokeValue.mul(density)) });
  const glow = splatMesh({ name: 'Fire proxy glow splats', blending: THREE.AdditiveBlending, sizeScale: scale.mul(0.95), stretch: stretchUniform,
    colorFor: heat => ramp(relative(heat)).mul(exposure),
    opacityFor: heat => smoothstep(float(0.3), float(0.9), relative(heat)).mul(0.4) });
  smoke.renderOrder = 10; glow.renderOrder = 11;
  const group = new THREE.Group();
  group.name = 'Fire splat proxy';
  group.add(smoke, glow);
  let snapshot = null, uploads = 0, capacity = 0, buffer = null;
  const allocate = count => {
    capacity = Math.max(1024, 2 ** Math.ceil(Math.log2(Math.max(1, count))));
    buffer = new THREE.InstancedInterleavedBuffer(new Float32Array(capacity * HEAT_BLOCK_FLOATS), HEAT_BLOCK_FLOATS);
    buffer.setUsage(THREE.DynamicDrawUsage);
    for (const mesh of [smoke, glow]) {
      const next = new THREE.InstancedBufferGeometry();
      next.index = mesh.geometry.index.clone();
      next.setAttribute('position', mesh.geometry.getAttribute('position').clone());
      next.setAttribute('blockCentre', new THREE.InterleavedBufferAttribute(buffer, 3, 0));
      next.setAttribute('blockHeat', new THREE.InterleavedBufferAttribute(buffer, 1, 3));
      next.setAttribute('blockSmoke', new THREE.InterleavedBufferAttribute(buffer, 1, 4));
      next.setAttribute('blockSize', new THREE.InterleavedBufferAttribute(buffer, 1, 6));
      next.instanceCount = 0;
      const previous = mesh.geometry;
      mesh.geometry = next;
      previous.dispose();
    }
  };
  allocate(1024);
  return {
    group,
    meshes: [smoke, glow],
    setSnapshot(next) {
      if (next?.kind !== 'heat-blocks' || next.floatsPerBlock !== HEAT_BLOCK_FLOATS) throw Error('Fire splat layer needs a heat-block snapshot');
      if (next.count > capacity) allocate(next.count);
      buffer.array.set(next.data);
      buffer.clearUpdateRanges();
      buffer.addUpdateRange(0, next.count * HEAT_BLOCK_FLOATS);
      buffer.needsUpdate = true;
      for (const mesh of [smoke, glow]) mesh.geometry.instanceCount = next.count;
      heatMax.value = Math.max(1e-6, next.summary?.heatMax ?? 1);
      snapshot = next; uploads++;
    },
    setStyle({ heatExposure: h, smokeDensity: d, sizeScale: z, stretch: st, visible } = {}) {
      if (typeof visible === 'boolean') group.visible = visible;
      if (Number.isFinite(st) && st > 0) stretchUniform.value = st;
      if (Number.isFinite(h) && h > 0) exposure.value = h;
      if (Number.isFinite(d) && d >= 0) density.value = d;
      if (Number.isFinite(z) && z > 0) scale.value = z;
      return { heatExposure: exposure.value, smokeDensity: density.value, sizeScale: scale.value, stretch: stretchUniform.value, visible: group.visible };
    },
    state: () => ({ visible: group.visible, count: smoke.geometry.instanceCount, capacity, uploads,
      snapshotWriteTick: snapshot?.writeTick ?? null, summary: snapshot?.summary ?? null,
      style: { heatExposure: exposure.value, smokeDensity: density.value, sizeScale: scale.value } }),
    dispose() { group.removeFromParent(); for (const mesh of [smoke, glow]) { mesh.geometry.dispose(); mesh.material.dispose(); } },
  };
}
