// Surfel proxy layer: one instanced disc per surface record, drawn in the
// ordinary scene pass from the latest CPU snapshot. Discs face the record
// normal and use standard PBR, so environment reflection and scene lighting come
// from the host scene; thickness drives tint and opacity. Between snapshots each
// disc moves along its recorded velocity by sim time, so a stalled sim holds
// still instead of drifting.
import * as THREE from './lib/three.webgpu.js';
import { attribute, positionGeometry, vec3, float, cross, normalize, select, abs, mix, smoothstep, uniform, transformNormalToView, cameraPosition, sqrt, max, dot, length } from './lib/three.tsl.js';
import { SURFEL_FLOATS, surfelExtrapolationSeconds } from './proxy-snapshot.mjs';

export function createSurfelProxyLayer({ radius = 0.05, thicknessScale = 0.12, maxExtrapolationS = 0.25, minCapacity = 4096, facing = 0.75 } = {}) {
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

  const extrapolation = uniform(0), radiusUniform = uniform(radius), thicknessUniform = uniform(thicknessScale), facingUniform = uniform(facing);
  const center = attribute('surfelPosition', 'vec3'), velocity = attribute('surfelVelocity', 'vec3');
  const recordNormal = normalize(attribute('surfelNormal', 'vec3'));
  const position = center.add(velocity.mul(extrapolation));
  // Each disc turns between its record normal (tiles pooled water) and the
  // camera (reads as a bead in streams and spray). Slow surfels lie along their
  // normal; fast ones turn toward the viewer up to the facing limit.
  const toCamera = normalize(cameraPosition.sub(position));
  const outward = select(dot(recordNormal, toCamera).lessThan(0), recordNormal.negate(), recordNormal);
  const moving = smoothstep(float(0.15), float(0.8), length(velocity));
  const turn = facingUniform.mul(moving);
  const axis = normalize(mix(outward, toCamera, turn));
  // Pooled discs lie flat and grow so neighbours overlap into a sheet.
  const size = radiusUniform.mul(mix(float(1.8), float(1), moving));
  const helper = select(abs(axis.y).greaterThan(0.99), vec3(1, 0, 0), vec3(0, 1, 0));
  const tangent = normalize(cross(helper, axis)), bitangent = cross(axis, tangent);
  const depth = smoothstep(float(0), thicknessUniform, attribute('surfelThickness', 'float'));
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.08, metalness: 0, transparent: true, side: THREE.DoubleSide });
  // The mesh sits at the identity transform, so object space is world space.
  material.positionNode = position.add(tangent.mul(positionGeometry.x).add(bitangent.mul(positionGeometry.y)).mul(size));
  // Sphere-like shading across the disc: rim normals tilt outward, so each
  // disc catches environment reflection like a droplet.
  const bulge = sqrt(max(float(0), float(1).sub(positionGeometry.x.mul(positionGeometry.x)).sub(positionGeometry.y.mul(positionGeometry.y))));
  material.normalNode = transformNormalToView(normalize(tangent.mul(positionGeometry.x).add(bitangent.mul(positionGeometry.y)).add(axis.mul(bulge))));
  material.colorNode = mix(vec3(0.62, 0.84, 0.9), vec3(0.18, 0.42, 0.52), depth);
  material.opacityNode = mix(float(0.5), float(0.85), depth);

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
    // Live style tuning without rebuilding the material.
    setStyle({ radius: r, facing: f, thicknessScale: t } = {}) {
      if (Number.isFinite(r) && r > 0) radiusUniform.value = r;
      if (Number.isFinite(f)) facingUniform.value = Math.min(1, Math.max(0, f));
      if (Number.isFinite(t) && t > 0) thicknessUniform.value = t;
      return { radius: radiusUniform.value, facing: facingUniform.value, thicknessScale: thicknessUniform.value };
    },
    state: () => ({ visible: mesh.visible, count: geometry.instanceCount, capacity, uploads, extrapolationS, radius: radiusUniform.value, facing: facingUniform.value,
      snapshotWriteTick: snapshot?.writeTick ?? null, snapshotSimTimeS: snapshot?.simTimeS ?? null, activeRecords: snapshot?.activeRecords ?? null,
      stride: snapshot?.stride ?? null, thickness }),
    dispose() { mesh.removeFromParent(); geometry.dispose(); disc.dispose(); material.dispose(); },
  };
}
