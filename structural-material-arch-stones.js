import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const STONE_ASSETS = [
  ['02-rain-worn', '6adaf416c224c6b9dd8541fa8ebdf6cd472069d6e32a4d4f9e8cffcb1dd53e9d'],
  ['03-bedded-stone', '3b8a5f07921371a8bfa8a2e80fbec4481b3b76c2e4986f9cbb83490403cb6e8b'],
  ['04-aged-masonry', 'df2c96c9bb1e9530ec26e6d70d40455e1acaf2a0d405ed2a0ba9fb23d5500607'],
  ['05-quarry-split', '88c494b997c4ff9d41690c9c0935f38c646162037faf77b83c1f29893a47db28'],
].map(([id, sha256]) => ({ id, sha256, url: `./assets/arch-stones/${id}.glb` }));

const STONE_DETAILS = {
  original: STONE_ASSETS,
  '5k': [{ id: '03-bedded-stone-5k', sha256: 'e39f199f7ad2dacfccf7f2085c00e3fbef3ac856e156f5b5c9d7c2be4d506992', url: './assets/arch-stones/03-bedded-stone-5k.glb', triangles: 4943 }],
  '10k': [{ id: '03-bedded-stone-10k', sha256: '8d69eb64ce35dcad125813870393f3ae645631e5de37a24c8b85db79f86b2495', url: './assets/arch-stones/03-bedded-stone-10k.glb', triangles: 9773 }],
  '500-normal': [{ id: '03-bedded-stone-500-normal', sha256: '33eb6f774a3b2bd52751c052029b529359957a71ec3eeee2e93c51bee46d8011', url: './assets/arch-stones/03-bedded-stone-500-normal.glb', triangles: 500, normalMapped: true, normalTextureSize: 1024 }],
};

export function stoneAssetsForDetail(detail) {
  if (!Object.hasOwn(STONE_DETAILS, detail)) throw new Error(`Unknown stone detail: ${detail}`);
  return STONE_DETAILS[detail];
}

export function inspectStoneVisual(witness, expectedDetail = witness?.visual?.detail ?? 'original') {
  const visual = witness?.visual, errors = [];
  if (visual?.route !== 'handy-weathered-stone-v1') return ['Weathered stone route absent or substituted'];
  let expectedAssets;
  try { expectedAssets = stoneAssetsForDetail(expectedDetail); } catch (error) { return [error.message]; }
  if ((visual.detail ?? 'original') !== expectedDetail) errors.push('Requested stone detail substituted');
  if (!Array.isArray(visual.assets) || !Array.isArray(visual.bodies) || !witness.state?.bodies?.length) return ['Stone/body inventory missing'];
  for (const expected of expectedAssets) {
    const actual = visual.assets.find(asset => asset.id === expected.id);
    if (actual?.sha256 !== expected.sha256 || !(actual?.bytes > 0) || !(actual?.triangles > 0)) errors.push(`Unverified stone ${expected.id}`);
    if (expected.triangles !== undefined && actual?.triangles !== expected.triangles) errors.push(`Unexpected triangle count for ${expected.id}`);
    if (expected.normalMapped && (actual?.normalMapped !== true || actual?.normalTextureWidth !== expected.normalTextureSize || actual?.normalTextureHeight !== expected.normalTextureSize)) errors.push(`Unbound or incorrect normal texture for ${expected.id}`);
  }
  if (visual.assets.length !== expectedAssets.length) errors.push('Stone inventory changed');
  if (visual.bodies.length !== witness.state.bodies.length || new Set(visual.bodies.map(body => body.index)).size !== visual.bodies.length) errors.push('Incomplete visual bodies');
  let triangles = 0;
  for (const body of witness.state.bodies) {
    const displayed = visual.bodies.find(item => item.index === body.index);
    const asset = visual.assets.find(item => item.id === displayed?.asset);
    if (!asset) errors.push(`Body ${body.index} has no stone`);
    else triangles += asset.triangles;
    if (expectedAssets.find(item => item.id === displayed?.asset)?.normalMapped && displayed.normalMapped !== true) errors.push(`Body ${body.index} lost its normal material`);
  }
  if (!(triangles > 0) || visual.triangles !== triangles) errors.push('Rendered triangle inventory disagrees');
  return errors;
}

export function fitStoneGeometry(source, body) {
  if (!Array.isArray(body.halfExtents) || body.halfExtents.length !== 3 || !body.halfExtents.every(value => Number.isFinite(value) && value > 0)) throw new Error('Stone body extents must be positive and finite');
  const target = new THREE.Vector3(...body.halfExtents).multiplyScalar(2);
  const geometry = source.clone();
  geometry.computeBoundingBox();
  const size = geometry.boundingBox.getSize(new THREE.Vector3());
  if (!size.toArray().every(value => Number.isFinite(value) && value > 0)) { geometry.dispose(); throw new Error('Stone needs positive volume extents'); }
  const center = geometry.boundingBox.getCenter(new THREE.Vector3());
  geometry.translate(-center.x, -center.y, -center.z);
  geometry.scale(target.x / size.x, target.y / size.y, target.z / size.z);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

export function structuralFaceAt(point, half) {
  if (![point.x, point.y, point.z, half.x, half.y, half.z].every(Number.isFinite) || ![half.x, half.y, half.z].every(value => value > 0)) throw new Error('Contact and extents must be finite, with positive extents');
  // Rough triangle normals do not define authored box-connection ownership.
  const axes = ['x', 'y', 'z'];
  const axis = axes.reduce((best, key) => Math.abs(point[key] / half[key]) > Math.abs(point[best] / half[best]) ? key : best);
  const normal = new THREE.Vector3();
  normal[axis] = Math.sign(point[axis]) || 1;
  return normal;
}

export async function loadStoneAssets(detail = '500-normal') {
  const loader = new GLTFLoader(), assets = [];
  try {
    for (const entry of stoneAssetsForDetail(detail)) {
      const response = await fetch(entry.url);
      if (!response.ok) throw new Error(`Stone ${entry.id}: HTTP ${response.status}`);
      const bytes = await response.arrayBuffer();
      const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
      if (digest !== entry.sha256) throw new Error(`Stone ${entry.id}: source digest mismatch`);
      const gltf = await loader.parseAsync(bytes, '');
      const meshes = [];
      gltf.scene.traverse(object => { if (object.isMesh) meshes.push(object); });
      const asset = { ...entry, scene: gltf.scene, meshes, bytes: bytes.byteLength };
      assets.push(asset);
      if (meshes.length !== 1 || Array.isArray(meshes[0].material)) throw new Error(`Stone ${entry.id}: expected one mesh/material`);
      gltf.scene.updateMatrixWorld(true);
      asset.geometry = meshes[0].geometry.clone().applyMatrix4(meshes[0].matrixWorld);
      asset.material = meshes[0].material;
      asset.triangles = (asset.geometry.index?.count ?? asset.geometry.attributes.position.count) / 3;
    }
    return assets;
  } catch (error) { disposeStoneAssets(assets); throw error; }
}

export function disposeStoneAssets(assets) {
  const geometries = new Set(), materials = new Set(), textures = new Set();
  for (const asset of assets) {
    if (asset.geometry) geometries.add(asset.geometry);
    asset.scene.traverse(object => {
      if (object.geometry) geometries.add(object.geometry);
      for (const material of object.material ? [object.material].flat() : []) {
        materials.add(material);
        for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
      }
    });
  }
  for (const value of [...geometries, ...materials, ...textures]) value.dispose();
}
