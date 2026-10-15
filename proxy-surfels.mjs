// Surfel proxy layer: one instanced disc per surface record, drawn in the
// ordinary scene pass from the latest CPU snapshot. Discs face the record
// normal and use standard PBR, so environment reflection and scene lighting come
// from the host scene; thickness drives tint and opacity. Between snapshots each
// disc moves along its recorded velocity by sim time, so a stalled sim holds
// still instead of drifting.
import * as THREE from './lib/three.webgpu.js';
import { attribute, positionGeometry, vec3, float, cross, normalize, select, abs, mix, smoothstep, uniform, transformNormalToView, faceDirection } from './lib/three.tsl.js';
import { SURFEL_FLOATS, surfelExtrapolationSeconds } from './proxy-snapshot.mjs';

export function createSurfelProxyLayer({ radius = 0.05, thicknessScale = 0.12, maxExtrapolationS = 0.25, minCapacity = 4096 } = {}) {
  const disc = new THREE.CircleGeometry(1, 10);
  let geometry = null, buffer = null, capacity = 0, mesh = null;
  // Growing builds a fresh geometry and disposes the previous one, so the old
  // instance buffer's GPU allocation is released with it.
  const allocate = count => {
    capacity = Math.max(minCapacity, 2 ** Math.ceil(Math.log2(Math.max(1, count))));
    buffer = new THREE.InstancedInterleavedBuffer(new Float32Array(capacity * SURFEL_FLOATS), SURFEL_FLOATS);
    buffer.setUsage(THREE.DynamicDrawUsage);
    const next = new THREE.InstancedBufferGeometry();
    // Own copies of the 12-vertex disc: disposing the previous geometry must
    // not free buffers this one still draws.
    next.index = disc.index.clone();
    next.setAttribute('position', disc.getAttribute('position').clone());
    next.setAttribute('surfelPosition', new THREE.InterleavedBufferAttribute(buffer, 3, 0));
    next.setAttribute('surfelNormal', new THREE.InterleavedBufferAttribute(buffer, 3, 3));
    next.setAttribute('surfelVelocity', new THREE.InterleavedBufferAttribute(buffer, 3, 6));
    next.setAttribute('surfelThickness', new THREE.InterleavedBufferAttribute(buffer, 1, 9));
    next.instanceCount = 0;
    const previous = geometry;
    geometry = next;
    if (mesh) mesh.geometry = next;
    previous?.dispose();
  };
  allocate(minCapacity);

  const extrapolation = uniform(0), radiusUniform = uniform(radius), thicknessUniform = uniform(thicknessScale);
  const center = attribute('surfelPosition', 'vec3'), velocity = attribute('surfelVelocity', 'vec3');
  const normal = normalize(attribute('surfelNormal', 'vec3'));
  const helper = select(abs(normal.y).greaterThan(0.99), vec3(1, 0, 0), vec3(0, 1, 0));
  const tangent = normalize(cross(helper, normal)), bitangent = cross(normal, tangent);
  const depth = smoothstep(float(0), thicknessUniform, attribute('surfelThickness', 'float'));
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.06, metalness: 0, transparent: true, side: THREE.DoubleSide });
  // The mesh sits at the identity transform, so object space is world space.
  material.positionNode = center.add(velocity.mul(extrapolation))
    .add(tangent.mul(positionGeometry.x).add(bitangent.mul(positionGeometry.y)).mul(radiusUniform));
  material.normalNode = transformNormalToView(normal).mul(faceDirection);
  material.colorNode = mix(vec3(0.36, 0.62, 0.68), vec3(0.03, 0.11, 0.15), depth);
  material.opacityNode = mix(float(0.42), float(0.92), depth);

  mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Water proxy surfels';
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.userData.kaminosProxyPreview = true;
  mesh.visible = false;

  let snapshot = null, uploads = 0, extrapolationS = 0, thickness = null;
  return {
    mesh,
    setSnapshot(next) {
      if (next?.kind !== 'surfels' || next.floatsPerSurfel !== SURFEL_FLOATS) throw Error('Surfel layer needs a surfel snapshot');
      if (next.count > capacity) allocate(next.count);
      buffer.array.set(next.data);
      buffer.clearUpdateRanges();
      buffer.addUpdateRange(0, next.count * SURFEL_FLOATS);
      buffer.needsUpdate = true;
      geometry.instanceCount = next.count;
      snapshot = next; uploads++;
      if (next.count) {
        const values = Array.from({ length: next.count }, (_, i) => next.data[i * SURFEL_FLOATS + 9]).sort((a, b) => a - b);
        thickness = { min: values[0], p50: values[values.length >> 1], max: values.at(-1) };
      } else thickness = null;
    },
    update({ simTimeS }) {
      extrapolationS = snapshot && Number.isFinite(simTimeS) ? surfelExtrapolationSeconds(simTimeS, snapshot.simTimeS, maxExtrapolationS) : 0;
      extrapolation.value = extrapolationS;
    },
    state: () => ({ visible: mesh.visible, count: geometry.instanceCount, capacity, uploads, extrapolationS, radius: radiusUniform.value,
      snapshotWriteTick: snapshot?.writeTick ?? null, snapshotSimTimeS: snapshot?.simTimeS ?? null, activeRecords: snapshot?.activeRecords ?? null,
      stride: snapshot?.stride ?? null, thickness }),
    dispose() { mesh.removeFromParent(); geometry.dispose(); disc.dispose(); material.dispose(); },
  };
}
