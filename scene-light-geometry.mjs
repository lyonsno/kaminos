import * as THREE from './lib/three.webgpu.js';

const hasMorph = mesh => Array.isArray(mesh.morphTargetInfluences)
  || Object.values(mesh.geometry?.morphAttributes || {}).some(attributes => attributes.length);

export function staticSceneGeometryRevision(scene) {
  scene.updateMatrixWorld(true);
  const items = [];
  scene.traverseVisible(mesh => {
    if (!mesh.isMesh || !mesh.castShadow) return;
    if (mesh.isSkinnedMesh || mesh.isInstancedMesh || hasMorph(mesh)) {
      throw new Error(`static-light-dynamic-caster:${mesh.name || mesh.uuid}:morph-skinned-instanced`);
    }
    const geometry = mesh.geometry;
    const position = geometry?.attributes?.position;
    if (!position || position.itemSize < 3) throw new Error(`static-light-position-missing:${mesh.name || mesh.uuid}`);
    const index = geometry.index;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    items.push([
      mesh.uuid, mesh.matrixWorld.elements, geometry.uuid, geometry.version,
      position.version, position.count, index?.version ?? null, index?.count ?? null,
      geometry.groups.map(group => [group.start, group.count, group.materialIndex]),
      materials.map(material => materialState(material, mesh)),
    ]);
  });
  return JSON.stringify(items);
}

function materialAt(mesh, triangleOffset) {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  if (materials.length === 1) return materials[0];
  const group = mesh.geometry.groups.find(item => triangleOffset >= item.start && triangleOffset < item.start + item.count);
  if (!group) throw new Error(`static-light-material-group-missing:${mesh.name || mesh.uuid}:${triangleOffset}`);
  return materials[group.materialIndex];
}

function materialState(material, mesh) {
  if (!material) throw new Error(`static-light-material-missing:${mesh.name || mesh.uuid}`);
  if (material.transparent || material.opacity < 1 || material.alphaTest > 0 || material.alphaMap) {
    throw new Error(`static-light-transparent-caster:${mesh.name || mesh.uuid}`);
  }
  if (material.displacementMap) throw new Error(`static-light-displaced-caster:${mesh.name || mesh.uuid}`);
  return [material.uuid, material.version, material.side, material.transparent, material.opacity, material.alphaTest];
}

// Snapshot world geometry once. The revision is based on state that controls
// ray intersections, not on the source color or display camera. Callers can
// retain a built BVH until this fingerprint changes.
export function collectStaticSceneGeometry(scene) {
  scene.updateMatrixWorld(true);
  const triangles = [];
  const surfaces = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let skippedDegenerate = 0;
  scene.traverseVisible(mesh => {
    if (!mesh.isMesh || !mesh.castShadow) return;
    if (mesh.isSkinnedMesh || mesh.isInstancedMesh || hasMorph(mesh)) {
      throw new Error(`static-light-dynamic-caster:${mesh.name || mesh.uuid}:morph-skinned-instanced`);
    }
    const geometry = mesh.geometry;
    const position = geometry?.attributes?.position;
    if (!position || position.itemSize < 3) throw new Error(`static-light-position-missing:${mesh.name || mesh.uuid}`);
    const index = geometry.index;
    const count = index?.count ?? position.count;
    if (count % 3 !== 0) throw new Error(`static-light-triangle-count-invalid:${mesh.name || mesh.uuid}`);
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (let offset = 0; offset < count; offset += 3) {
      const material = materialAt(mesh, offset);
      materialState(material, mesh);
      a.fromBufferAttribute(position, index ? index.getX(offset) : offset).applyMatrix4(mesh.matrixWorld);
      b.fromBufferAttribute(position, index ? index.getX(offset + 1) : offset + 1).applyMatrix4(mesh.matrixWorld);
      c.fromBufferAttribute(position, index ? index.getX(offset + 2) : offset + 2).applyMatrix4(mesh.matrixWorld);
      const points = [a.toArray(), b.toArray(), c.toArray()];
      if (!points.every(point => point.every(Number.isFinite))) {
        throw new Error(`static-light-nonfinite-vertex:${mesh.name || mesh.uuid}:${offset / 3}`);
      }
      const cross = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
      const twiceArea = cross.length();
      if (twiceArea === 0) {
        skippedDegenerate++;
        continue;
      }
      const identity = `${mesh.uuid}:${offset / 3}`;
      triangles.push({a: points[0], b: points[1], c: points[2],
        identity, materialIndex: materials.indexOf(material)});
      const color = material.color?.isColor ? material.color : new THREE.Color(1, 1, 1);
      surfaces.push({id: identity,
        position: a.clone().add(b).add(c).multiplyScalar(1 / 3).toArray(),
        normal: cross.multiplyScalar(1 / twiceArea).toArray(), area: twiceArea / 2,
        albedo: color.toArray(), albedoAuthority: material.map ? 'base-color-factor-excludes-texture' : 'material-base-color'});
    }
  });
  // JSON is used directly to avoid hash-collision authority over cache reuse.
  return {triangles, surfaces, revision: staticSceneGeometryRevision(scene), skippedDegenerate};
}
