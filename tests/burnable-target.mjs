// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.webgpu.js';
import * as burnTargetMod from '../burnable-target.mjs';
import {createSceneBurnBody} from '../scene-burn-body.mjs';
import {residentLightCoverage} from '../scene-resident-coverage.mjs';
import {createFireShadowCasters} from '../fire-shadow-casters.mjs';
import {createLocalSceneVisibility} from '../scene-local-visibility.mjs';

const {resolveBurnableTarget}=burnTargetMod;
const object=new THREE.Group(),mesh=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial());object.add(mesh);
object.position.set(2,3,4);object.rotation.set(.2,.3,.4);const pose=object.matrix.clone(),entry={id:'bear',object,source:'bear.glb'};
assert.equal(resolveBurnableTarget([entry],'bear'),entry);assert.deepEqual(object.position.toArray(),[2,3,4]);assert.deepEqual(object.matrix.elements,pose.elements);
assert.throws(()=>resolveBurnableTarget([entry],'missing'),/existing mesh/);
object.add(mesh.clone());assert.throws(()=>resolveBurnableTarget([entry],'bear'),/one volumetric mesh/);object.remove(object.children[1]);
mesh.geometry=new THREE.PlaneGeometry();assert.throws(()=>resolveBurnableTarget([entry],'bear'),/volumetric bounds/);

test('resolveBurnableHeroMesh and createSceneBurnBody bind the true hero mesh even when a beauty LOD proxy is mounted, sync proxy burn materials, use stunt-double surface geometry, and interoperate with fire-shadow-casters and local visibility', async () => {
  assert.equal(typeof burnTargetMod.resolveBurnableHeroMesh, 'function', 'burnable-target exports resolveBurnableHeroMesh');

  globalThis.GPUBufferUsage = {STORAGE: 128, COPY_DST: 8, COPY_SRC: 4, UNIFORM: 64, MAP_READ: 1};
  globalThis.GPUTextureUsage = {STORAGE_BINDING: 8, TEXTURE_BINDING: 4, COPY_DST: 2};

  const resources = [];
  const makeResource = spec => {
    const r = {...spec, destroyed: 0, createView: () => ({}), destroy() { this.destroyed++; }};
    resources.push(r);
    return r;
  };
  const device = {
    limits: {maxTextureDimension2D: 2048},
    createShaderModule: () => ({getCompilationInfo: async () => ({messages: []})}),
    createComputePipelineAsync: async () => ({getBindGroupLayout: () => ({})}),
    createBuffer: makeResource,
    createTexture: makeResource,
    createBindGroup: x => x,
    queue: {writeBuffer() {}, writeTexture() {}},
  };
  const renderer = {
    backend: {device, get: () => ({})},
    library: {fromMaterial: source => new THREE.MeshStandardNodeMaterial().copy(source)},
  };

  const scene = new THREE.Scene();
  const root = new THREE.Group();
  const heroMat = new THREE.MeshStandardMaterial({color: 0x885522, roughness: 0.8, metalness: 0.0});
  // High-poly hero mesh (e.g. 6x6x6 subdivisions = 432 triangles)
  const heroGeom = new THREE.BoxGeometry(1, 0.4, 0.4, 6, 6, 6);
  const heroMesh = new THREE.Mesh(heroGeom, heroMat);
  heroMesh.castShadow = true;
  root.add(heroMesh);

  // Mount a beauty LOD proxy wrapper as the LAST child of root (simulating sceneBeautyLods)
  const proxyWrapper = new THREE.Group();
  proxyWrapper.userData.kaminosBeautyLodProxy = true;
  const proxyOrigMat = new THREE.MeshStandardMaterial({color: 0x885522, roughness: 0.8, metalness: 0.0});
  const proxyMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 0.4, 0.4, 1, 1, 1), proxyOrigMat);
  proxyMesh.castShadow = true;
  proxyMesh.userData.kaminosOriginalMaterial = proxyOrigMat;
  proxyWrapper.add(proxyMesh);
  root.add(proxyWrapper);
  heroMesh.visible = false;
  proxyWrapper.visible = true;
  scene.add(root);

  assert.equal(burnTargetMod.resolveBurnableHeroMesh(root), heroMesh, 'resolveBurnableHeroMesh returns heroMesh, not the mounted beauty proxy mesh');

  // Also simulate a second resident beauty rung in beautyLods.listResidentRungs(root) with its own baked normalMap
  const bakedNormalMap = new THREE.Texture();
  const residentRungOrigMat = new THREE.MeshStandardMaterial({color: 0x885522, roughness: 0.8, metalness: 0.0, normalMap: bakedNormalMap});
  const residentRungMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 0.4, 0.4, 2, 2, 2), residentRungOrigMat);
  residentRungMesh.castShadow = true;
  residentRungMesh.userData.kaminosOriginalMaterial = residentRungOrigMat;
  const residentRungRoot = new THREE.Group();
  residentRungRoot.add(residentRungMesh);
  const beautyLods = {
    listResidentRungs: r => r === root ? [{sha: '500'.padEnd(64, '0'), faces: 12, root: residentRungRoot}] : [],
  };

  // Provide a stunt-double surface geometry resolver (12-triangle box instead of 432-triangle hero)
  const stuntGeom = new THREE.BoxGeometry(1, 0.4, 0.4, 1, 1, 1);
  let resolvedForEntry = null;
  const resolveSurfaceGeometry = async (e, opts) => {
    resolvedForEntry = {id: e.id, grid: opts.grid};
    return {
      geometry: stuntGeom,
      tier: '7208b932'.padEnd(64, '0'),
      faces: 12,
      heroFaces: 432,
      voxelError: 0.114,
    };
  };

  const frameListeners = [];
  const onFrame = fn => {
    frameListeners.push(fn);
    return () => {
      const idx = frameListeners.indexOf(fn);
      if (idx >= 0) frameListeners.splice(idx, 1);
    };
  };

  const burnEntry = {
    id: 'beam-1',
    object: root,
    burnable: {enabled: true, material: 'wood', appearance: {profile: 'composed', glow: 1.5}},
  };

  const body = await createSceneBurnBody({
    entry: burnEntry,
    renderer,
    scene,
    ground: () => ({center: [0, 0, 0], height: 0, radius: 5}),
    onFrame,
    kelvinPerHeat: () => 1600,
    beautyLods,
    resolveSurfaceGeometry,
  });

  // 1. Hero mesh AND beauty LOD proxy meshes have the converted burn material & residentLightCoverage
  assert.notEqual(heroMesh.material, heroMat, 'heroMesh material was converted to burn NodeMaterial');
  assert.equal(proxyMesh.material, heroMesh.material, 'mounted beauty proxy mesh with same maps shares the live burn NodeMaterial');
  assert.equal(residentRungMesh.material.colorNode, heroMesh.material.colorNode, 'resident beauty rung mesh with baked normalMap shares the live burn TSL colorNode');
  assert.equal(residentRungMesh.material.opacityNode, heroMesh.material.opacityNode, 'resident beauty rung mesh with baked normalMap shares the live burn TSL opacityNode');
  assert.equal(residentRungMesh.material.normalMap, bakedNormalMap, 'resident beauty rung mesh preserves its own UV-baked normalMap');
  assert.ok(residentLightCoverage(heroMesh), 'residentLightCoverage is bound on heroMesh');
  assert.equal(residentLightCoverage(proxyMesh)?.owner, heroMesh, 'residentLightCoverage on proxyMesh points to heroMesh as owner');
  assert.equal(residentLightCoverage(residentRungMesh)?.owner, heroMesh, 'residentLightCoverage on residentRungMesh points to heroMesh as owner');

  // 2. Stunt-double surface geometry was used and recorded in field.read().surfaceLod
  assert.ok(resolvedForEntry, 'resolveSurfaceGeometry was called during createSceneBurnBody');
  const bodyState = body.read();
  assert.equal(bodyState.fields[0].surfaceLod?.faces, 12, 'field.read().surfaceLod records the 12-face stunt-double rung');
  assert.equal(bodyState.fields[0].surfaceLod?.heroFaces, 432, 'field.read().surfaceLod records heroFaces');

  // 3. fire-shadow-casters does NOT throw on burnable object with giProxy (alphaTest=0.5)
  const giProxies = {
    handleFor: node => node === root ? {state: 'loaded', proxyRoot: new THREE.Group(), levels: []} : null,
    registerConsumer: () => () => {},
  };
  const casters = createFireShadowCasters({scene, giProxies, enabled: true});
  assert.doesNotThrow(() => {
    casters.withCapture(() => {});
  }, 'fire-shadow-casters skips static gi-proxy substitution for burnable objects with residentLightCoverage');
  casters.dispose();

  // 4. createLocalSceneVisibility builds residentCellTriangles even while heroMesh is hidden and proxyMesh is visible
  const localVis = createLocalSceneVisibility();
  const visSnap = localVis.snapshot(scene);
  assert.equal(visSnap.meshCount, 1, 'local visibility includes exactly 1 mesh ( ignoring debris.caps ) while proxyMesh is visible');
  assert.ok(visSnap.geometry.coverage, 'local visibility snapshot includes resident cell coverage when beauty LOD proxy is visible');

  // 5. Disposing the burn body restores original materials and unbinds residentLightCoverage on both hero and proxies
  body.dispose();
  assert.equal(heroMesh.material, heroMat, 'heroMesh original material restored on dispose');
  assert.equal(proxyMesh.material, proxyOrigMat, 'proxyMesh original material restored on dispose');
  assert.equal(residentRungMesh.material, residentRungOrigMat, 'residentRungMesh original material restored on dispose');
  assert.equal(residentLightCoverage(heroMesh), null, 'residentLightCoverage unbound from heroMesh');
  assert.equal(residentLightCoverage(proxyMesh), null, 'residentLightCoverage unbound from proxyMesh');
});

