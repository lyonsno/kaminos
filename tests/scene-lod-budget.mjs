// kaminos-test: node — screen-footprint LOD selection, scene beauty face budget, decoupled flame-domain shadow budget, resident rung cache, and stored hero-normal surfel levels
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as THREE from '../lib/three.core.js';
import {
  screenPixelError,
  selectFootprintTier,
  allocateSceneBeautyLods,
  allocateShadowCasterLods,
  createSceneBeautyLodController,
} from '../scene-lod-budget.mjs';
import {
  buildSurfelField,
  mergeSurfelLevel,
  sampleSurfelNormals,
  surfelNormals,
  createSurfelObject,
  attachStoredSurfelLevels,
} from '../trellis-surfels.mjs';
import {createGiProxyRegistry} from '../scene-gi-proxies.mjs';
import {createFireShadowCasters} from '../fire-shadow-casters.mjs';

const sha = text => createHash('sha256').update(text).digest('hex');

function makeCamera({z = 5, fov = 50, aspect = 1.5, near = 0.01, far = 200} = {}) {
  const camera = new THREE.PerspectiveCamera(fov, aspect, near, far);
  camera.position.set(0, 0, z);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return camera;
}

const SAMPLE_LEVELS = [
  {
    sha: sha('tier-25000'),
    faces: 25000,
    textureSize: 1024,
    closed: true,
    error: {relative: {p95: 0.0012, max: 0.004, mean: 0.0004}},
    normalMap: {texelSize: 1 / 1024},
  },
  {
    sha: sha('tier-10000'),
    faces: 10000,
    textureSize: 512,
    closed: true,
    error: {relative: {p95: 0.0025, max: 0.008, mean: 0.0009}},
    normalMap: {texelSize: 1 / 512},
  },
  {
    sha: sha('tier-5000'),
    faces: 5000,
    textureSize: 512,
    closed: true,
    error: {relative: {p95: 0.0042, max: 0.012, mean: 0.0015}},
    normalMap: {texelSize: 1 / 512},
  },
  {
    sha: sha('tier-1000'),
    faces: 1000,
    textureSize: 256,
    closed: true,
    error: {relative: {p95: 0.0085, max: 0.025, mean: 0.003}},
    normalMap: {texelSize: 1 / 256},
  },
  {
    sha: sha('tier-500'),
    faces: 500,
    textureSize: 256,
    closed: true,
    error: {relative: {p95: 0.015, max: 0.04, mean: 0.0055}},
    normalMap: {texelSize: 1 / 256},
  },
];

test('screenPixelError combines geometric error with texel magnification and uses closest bounding-box surface distance', () => {
  const camera = makeCamera({z: 4, fov: 50});
  const unitBox = new THREE.Box3(new THREE.Vector3(-0.5, -0.5, -0.5), new THREE.Vector3(0.5, 0.5, 0.5));
  const diag = Math.sqrt(3);

  // Curved object: geometric error (0.0085) > 0.5 * texelSize (0.5 / 256 = 0.001953125)
  const curvedTier = {faces: 1000, error: {relative: {p95: 0.0085}}, normalMap: {texelSize: 1 / 256}};
  const curvedPx = screenPixelError(curvedTier, {worldBox: unitBox, worldDiag: diag, camera, viewportHeight: 1080});

  // Flat painted wall: geometric error is near zero (0.00005), but 256x256 texture texelSize (1/256) guards against blur
  const flatTier256 = {faces: 500, error: {relative: {p95: 0.00005}}, normalMap: {texelSize: 1 / 256}};
  const flatTier1024 = {faces: 25000, error: {relative: {p95: 0.00005}}, normalMap: {texelSize: 1 / 1024}};
  const flatPx256 = screenPixelError(flatTier256, {worldBox: unitBox, worldDiag: diag, camera, viewportHeight: 1080});
  const flatPx1024 = screenPixelError(flatTier1024, {worldBox: unitBox, worldDiag: diag, camera, viewportHeight: 1080});
  assert.ok(flatPx256 > 1.0, `flat 256-texel tier at close range has >1px texel magnification (${flatPx256})`);
  assert.ok(Math.abs(flatPx256 / flatPx1024 - 4) < 1e-6, '256-texel tier has 4x the pixel error of 1024-texel tier on a flat surface');
  assert.ok(curvedPx > flatPx256, 'geometric error dominates when larger than 0.5 * texelSize');

  // Closest bounding-box surface distance vs center distance:
  // A deep enclosure extending from z = -10 to z = 3.5 (center at z = -3.25, front face 0.5m from camera at z = 4)
  const deepWallBox = new THREE.Box3(new THREE.Vector3(-2, -2, -10), new THREE.Vector3(2, 2, 3.5));
  const smallFrontBox = new THREE.Box3(new THREE.Vector3(-0.5, -0.5, 3.0), new THREE.Vector3(0.5, 0.5, 3.5));
  const deepErr = screenPixelError(curvedTier, {worldBox: deepWallBox, worldDiag: diag, camera, viewportHeight: 1080});
  const frontErr = screenPixelError(curvedTier, {worldBox: smallFrontBox, worldDiag: diag, camera, viewportHeight: 1080});
  assert.ok(Math.abs(deepErr - frontErr) < 1e-6, 'closest surface distance (0.5m) governs pixel error regardless of how deep the box extends behind');
});

test('selectFootprintTier enforces the +/-15% hysteresis deadband against camera jitter', () => {
  const unitBox = new THREE.Box3(new THREE.Vector3(-0.5, -0.5, -0.5), new THREE.Vector3(0.5, 0.5, 0.5));
  const diag = Math.sqrt(3);
  const tier10k = SAMPLE_LEVELS[1]; // p95 = 0.0025

  // Find distance where tier10k has exactly 1.5 px error:
  // pixelsPerUnit = (1080 / 2) * cot(25 deg) / d_surface = 1158.0338 / d_surface
  // At pixelError = 1.5: d_surface = diag * 0.0025 * 1158.0338 / 1.5 = 3.34295
  // Since unitBox has max.z = 0.5, camera z = d_surface + 0.5.
  const camAtError = targetPx => {
    const ppu = 540 * (1 / Math.tan((25 * Math.PI) / 180));
    const dSurface = (diag * tier10k.error.relative.p95 * ppu) / targetPx;
    return makeCamera({z: dSurface + 0.5, fov: 50});
  };

  // 1. Starting on 'hero', at 1.40 px (below 1.5, but above coarsen threshold 0.85 * 1.5 = 1.275): stays on 'hero'
  const stayHero = selectFootprintTier([tier10k], {
    heroFaces: 300000, worldBox: unitBox, worldDiag: diag,
    camera: camAtError(1.40), viewportHeight: 1080, maxPixelError: 1.5, activeTier: 'hero', hysteresis: 0.15,
  });
  assert.equal(stayHero.selected.id, 'hero', 'does not coarsen inside the deadband (1.40 px > 1.275 px)');

  // 2. Move farther so error drops to 1.20 px (<= 1.275 px): coarsens to 10k tier
  const coarsened = selectFootprintTier([tier10k], {
    heroFaces: 300000, worldBox: unitBox, worldDiag: diag,
    camera: camAtError(1.20), viewportHeight: 1080, maxPixelError: 1.5, activeTier: 'hero', hysteresis: 0.15,
  });
  assert.equal(coarsened.selected.id, tier10k.sha, 'coarsens once error <= 0.85 * maxPixelError');

  // 3. Move closer so error rises to 1.65 px (above 1.5, but <= refine threshold 1.15 * 1.5 = 1.725): stays on 10k tier
  const stay10k = selectFootprintTier([tier10k], {
    heroFaces: 300000, worldBox: unitBox, worldDiag: diag,
    camera: camAtError(1.65), viewportHeight: 1080, maxPixelError: 1.5, activeTier: tier10k.sha, hysteresis: 0.15,
  });
  assert.equal(stay10k.selected.id, tier10k.sha, 'does not refine inside the deadband (1.65 px <= 1.725 px)');

  // 4. Move closer so error reaches 1.80 px (> 1.725 px): refines back to 'hero'
  const refined = selectFootprintTier([tier10k], {
    heroFaces: 300000, worldBox: unitBox, worldDiag: diag,
    camera: camAtError(1.80), viewportHeight: 1080, maxPixelError: 1.5, activeTier: tier10k.sha, hysteresis: 0.15,
  });
  assert.equal(refined.selected.id, 'hero', 'refines once error > 1.15 * maxPixelError');
});

test('allocateSceneBeautyLods respects frustum culling, pinned edit objects, repetition multiplicity, and greedy marginal-error budget', () => {
  const camera = makeCamera({z: 1.0, fov: 50});
  const frontBox = new THREE.Box3(new THREE.Vector3(-0.4, -0.4, -0.4), new THREE.Vector3(0.4, 0.4, 0.4));
  const behindCameraBox = new THREE.Box3(new THREE.Vector3(-0.4, -0.4, 10), new THREE.Vector3(0.4, 0.4, 11));
  const diag = Math.hypot(0.8, 0.8, 0.8);

  // At z = 2.0, all objects in front want 'hero' by screen footprint alone.
  // Object 'edited' is pinned (in polyEdit), 100k hero faces.
  // Object 'single' is a single 100k hero mesh.
  // Object 'repeated' is a 100k hero mesh with 6 visible repetition copies (total 600k hero faces; 25k tier = 150k faces).
  // Object 'offscreen' is behind the camera (z = 10..11), 200k hero faces.
  const repeatedBoxes = Array.from({length: 6}, (_, i) =>
    new THREE.Box3(new THREE.Vector3(-0.4 + i * 0.05, -0.4, -0.4), new THREE.Vector3(0.4 + i * 0.05, 0.4, 0.4)));

  const result = allocateSceneBeautyLods([
    {id: 'edited', heroFaces: 100000, levels: SAMPLE_LEVELS, instanceBoxes: [frontBox], worldDiag: diag, pinned: true},
    {id: 'single', heroFaces: 100000, levels: SAMPLE_LEVELS, instanceBoxes: [frontBox], worldDiag: diag, pinned: false},
    {id: 'repeated', heroFaces: 100000, levels: SAMPLE_LEVELS, instanceBoxes: repeatedBoxes, worldDiag: diag, pinned: false},
    {id: 'offscreen', heroFaces: 200000, levels: SAMPLE_LEVELS, instanceBoxes: [behindCameraBox], worldDiag: diag, pinned: false},
  ], {
    camera,
    viewportHeight: 1080,
    maxPixelError: 1.5,
    // Budget 260,000 faces:
    // 'edited' is pinned at 100k.
    // 'offscreen' is outside the frustum -> 0 faces counted against budget.
    // Between 'single' (100k) and 'repeated' (6 x 100k = 600k), 'repeated' has 6x lower marginal error per face saved,
    // so 'repeated' is demoted to 25k (6 x 25k = 150k), bringing total in-frustum faces to 100k + 100k + 150k = 350k,
    // and then further demoted to 10k (6 x 10k = 60k) -> 100k + 100k + 60k = 260k <= 260k while 'single' stays at 'hero' (100k)!
    faceBudget: 260000,
  });

  assert.equal(result.withinBudget, true);
  assert.equal(result.totalFaces, 260000);
  assert.equal(result.allocations.offscreen.inFrustum, false);
  assert.equal(result.allocations.offscreen.totalFaces, 0, 'off-frustum object consumes 0 faces of the beauty budget');
  assert.equal(result.allocations.edited.tier, 'hero', 'pinned object stays on hero');
  assert.equal(result.allocations.single.tier, 'hero', 'single close object stays on hero because repeated group yields 6x more face savings per pixel error');
  assert.equal(result.allocations.repeated.tier, SAMPLE_LEVELS[1].sha, 'repeated group is demoted to 10k (6 x 10k = 60k faces)');
  assert.equal(result.allocations.repeated.demotedByBudget, true);
});

test('allocateShadowCasterLods allocates by flame-domain solid angle and is completely invariant to camera orbit', () => {
  const flameBox = new THREE.Box3(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 1.0, 0.5));
  const nearFlameBox = new THREE.Box3(new THREE.Vector3(-0.6, 0, -0.6), new THREE.Vector3(0.6, 1.2, 0.6)); // d_flame clamped to 0.05 * diag
  const farFromFlameBox = new THREE.Box3(new THREE.Vector3(8, 0, 8), new THREE.Vector3(9, 1, 9));
  const diag = Math.sqrt(3);

  const candidates = [
    {id: 'kiln-wall', levels: SAMPLE_LEVELS, worldBox: nearFlameBox, worldDiag: diag, instanceCount: 1},
    {id: 'distant-pillar', levels: SAMPLE_LEVELS, worldBox: farFromFlameBox, worldDiag: diag, instanceCount: 1},
  ];

  // With shadowFaceBudget = 6000:
  // kiln-wall (right around the flame) gets 5000 faces; distant-pillar (far from the flame) gets 1000 or 500 faces.
  const shadowAlloc1 = allocateShadowCasterLods(candidates, {flameBox, shadowFaceBudget: 6000});
  assert.ok(shadowAlloc1.totalFaces <= 6000, `shadow faces ${shadowAlloc1.totalFaces} <= 6000`);
  assert.equal(shadowAlloc1.allocations['kiln-wall'].faces, 5000, 'caster enclosing the flame keeps 5000-face tier');
  assert.ok(shadowAlloc1.allocations['distant-pillar'].faces <= 1000, 'distant caster drops to <=1000 faces');

  // Verify camera state is not even an input and cannot perturb shadow caster selection
  const shadowAlloc2 = allocateShadowCasterLods(candidates, {flameBox, shadowFaceBudget: 6000});
  assert.deepEqual(shadowAlloc2, shadowAlloc1);
});

test('createSceneBeautyLodController caches resident rungs, never blanks while loading, routes through surfaceLighting, and restores heroes for shadow capture', async () => {
  const HERO = 'c'.repeat(64);
  const scene = new THREE.Scene();
  const root = new THREE.Group();
  root.userData.kaminosSceneObject = {id: 'obj-1', type: 'glb', source: `/api/read?root=generated-meshes&path=${HERO}.glb`};
  const heroMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1, 10, 10, 10), new THREE.MeshStandardMaterial());
  heroMesh.castShadow = true;
  root.add(heroMesh);
  // Add a repetition copy on root
  const repCopy = new THREE.Group();
  repCopy.userData.kaminosRepetitionCopy = true;
  repCopy.matrixAutoUpdate = false;
  repCopy.matrix.makeTranslation(2, 0, 0);
  const repMesh = new THREE.Mesh(heroMesh.geometry, heroMesh.material);
  repMesh.castShadow = true;
  repCopy.add(repMesh);
  root.add(repCopy);
  scene.add(root);
  scene.updateMatrixWorld(true);

  const tier5000 = SAMPLE_LEVELS[2];
  const tier1000 = SAMPLE_LEVELS[3];
  const gates = new Map();
  const fetchCounts = new Map();
  const lightingInstalled = new Set();
  const lightingReleased = new Set();

  const surfaceLighting = {
    registerProxyRoot(proxyRoot) {
      lightingInstalled.add(proxyRoot);
      return () => lightingReleased.add(proxyRoot);
    },
  };

  const giProxies = createGiProxyRegistry({
    THREE,
    fetchJson: async () => ({
      schema: 'kaminos.lod-set.v0',
      source: HERO,
      levels: [tier5000, tier1000].map(t => ({
        ...t,
        sha256: t.sha,
        source: `/api/read?root=generated-meshes&path=${t.sha}.glb`,
      })),
      choice: {
        ...tier1000,
        sha256: tier1000.sha,
        source: `/api/read?root=generated-meshes&path=${tier1000.sha}.glb`,
      },
      withinBudget: true,
    }),
    fetchBytes: async url => new TextEncoder().encode(url).buffer,
    digest: async () => tier1000.sha,
    parseGlb: async () => {
      const g = new THREE.Group();
      const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1, 2, 2, 2), new THREE.MeshStandardMaterial());
      m.castShadow = true;
      g.add(m);
      return g;
    },
  });
  await giProxies.attach(root);

  const controller = createSceneBeautyLodController({
    THREE,
    scene,
    giProxies,
    surfaceLighting,
    fetchBytes: async url => {
      const match = /([0-9a-f]{64})\.glb/.exec(url);
      const s = match[1];
      fetchCounts.set(s, (fetchCounts.get(s) ?? 0) + 1);
      if (gates.has(s)) await gates.get(s).promise;
      return new TextEncoder().encode(s).buffer;
    },
    digest: async bytes => new TextDecoder().decode(bytes),
    parseGlb: async bytes => {
      const s = new TextDecoder().decode(bytes);
      const segs = s === tier5000.sha ? 4 : 2;
      const g = new THREE.Group();
      const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1, segs, segs, segs), new THREE.MeshStandardMaterial());
      m.castShadow = true;
      g.add(m);
      g.userData.tierSha = s;
      return g;
    },
  });

  // Hold tier5000 fetch in flight to verify non-blocking display
  let resolve5000;
  gates.set(tier5000.sha, {promise: new Promise(r => { resolve5000 = r; })});

  // Camera far enough (z = 25) that tier5000 / tier1000 is requested; constrain budget so tier5000 is chosen
  const camera = makeCamera({z: 8, fov: 50});
  controller.setSettings({faceBudget: 12000, maxPixelError: 0.01}); // forces demotion from hero (2 * 600 = 1200? Wait: BoxGeometry(1,1,1,10,10,10) has 1200 faces * 2 copies = 2400 faces)
  // Let's set heroFaces override or use a budget of 1500 faces so 2 * 1200 = 2400 exceeds 1500, and tier5000? Wait: let's make heroMesh have 20000 faces or pass faceBudget: 1500 with tier1000 (2 * 1000 = 2000).
  // Even simpler: at z = 30, maxPixelError = 5.0 selects tier5000 or tier1000 by screen footprint!
  controller.setSettings({faceBudget: Infinity, maxPixelError: 1.5});
  // At z = 8, let's check which tier is selected, or hold both tier5000 and tier1000 in flight:
  let resolve1000;
  gates.set(tier1000.sha, {promise: new Promise(r => { resolve1000 = r; })});

  const farCamera = makeCamera({z: 20, fov: 50});
  const stateWhileLoading = controller.update(farCamera, {viewportHeight: 1080});
  const objState1 = stateWhileLoading.objects.find(o => o.id === 'obj-1');
  assert.notEqual(objState1.targetTier, 'hero', 'requests a coarse tier at z = 20');
  assert.equal(objState1.displayedTier, 'hero', 'keeps hero displayed while coarse tier is still loading');
  assert.equal(heroMesh.visible, true, 'hero mesh is NEVER blanked while coarse tier is in flight');

  // Resolve the in-flight loads
  resolve5000();
  resolve1000();
  await controller.whenIdle();
  gates.clear();

  const stateLoaded = controller.update(farCamera, {viewportHeight: 1080});
  const objState2 = stateLoaded.objects.find(o => o.id === 'obj-1');
  assert.equal(objState2.displayedTier, objState2.targetTier, 'switches to the coarse tier once loaded');
  assert.equal(heroMesh.visible, false, 'hero mesh is hidden while beauty LOD wrapper is displayed');
  assert.equal(lightingInstalled.size, 1, 'registered beauty LOD rung with surfaceLighting');

  // Check repetition copy inside the beauty LOD wrapper
  const wrapper = root.children.find(c => c.userData?.kaminosBeautyLodProxy);
  assert.ok(wrapper?.visible, 'beauty LOD wrapper is mounted and visible on root');
  assert.equal(wrapper.children.length, 2, 'beauty LOD wrapper includes primary rung + 1 repetition copy');

  // Move camera close (z = 1.2) -> switches immediately back to 'hero', then back to z = 20 -> reuses resident rung without re-fetching!
  const nearCamera = makeCamera({z: 1.2, fov: 50});
  const stateNear = controller.update(nearCamera, {viewportHeight: 1080});
  assert.equal(stateNear.objects[0].displayedTier, 'hero');
  assert.equal(heroMesh.visible, true);

  const fetchesBefore = fetchCounts.get(objState2.targetTier);
  const stateFarAgain = controller.update(farCamera, {viewportHeight: 1080});
  assert.equal(stateFarAgain.objects[0].displayedTier, objState2.targetTier);
  assert.equal(fetchCounts.get(objState2.targetTier), fetchesBefore, 'reused resident rung from cache without re-fetching');

  // Verify fireShadowCasters.withCapture sees the hero originalTriangles (not the beauty LOD wrapper) and substitutes the GI proxy caster
  const casters = createFireShadowCasters({scene, giProxies});
  casters.withCapture(() => {
    const insideWrapper = root.children.find(c => c.userData?.kaminosBeautyLodProxy);
    assert.equal(insideWrapper, undefined, 'beauty LOD wrapper is detached during shadow caster capture');
  });
  const casterDebug = casters.debugState();
  assert.equal(casterDebug.originalTriangles, 2400, 'fireShadowCasters measures originalTriangles from the hero mesh (2 x 1200), not the beauty LOD');

  // Release disposes cached rungs and unregisters surfaceLighting
  controller.release(root);
  assert.equal(lightingReleased.size, 1, 'released surfaceLighting registration on disposal');
  assert.equal(heroMesh.visible, true, 'restores hero visibility when released');
  casters.dispose();
});

test('attachStoredSurfelLevels upgrades x4 to hero normals and adds x8 and x16 levels to SurfelChunk', () => {
  const resolution = 64;
  const coords = [];
  for (let x = 8; x < 16; x++) for (let y = 8; y < 16; y++) coords.push([x, y, 16]);
  const vertices = new Float32Array(coords.flatMap(c => c.map(v => (v + 0.5) / resolution - 0.5)));
  const triangles = new Uint32Array([0, 1, 2]);
  const geometryCoordinates = new Int32Array(coords.flat());
  const material = {
    resolution,
    coordinates: geometryCoordinates,
    features: new Float32Array(coords.flatMap(() => [0.5, 0.2, -0.3, -1, 0.6, 1])),
  };
  const baseField = buildSurfelField({vertices, triangles, geometryCoordinates, material});
  const surfelRoot = createSurfelObject(THREE, baseField, {levels: [1, 2, 4], chunkVoxels: 64, viewportHeight: 1080, targetPixels: 1.5});

  // Build stored x4, x8, x16 levels with a tilted hero normal [0.6, -0.8, 0]
  const storedLevels = [4, 8, 16].map(factor => {
    const {field: merged} = mergeSurfelLevel(baseField, factor);
    const {field: baked} = sampleSurfelNormals(merged, () => [0.6, -0.8, 0]);
    return {mergeFactor: factor, field: baked};
  });

  const summary = attachStoredSurfelLevels(THREE, surfelRoot, storedLevels);
  assert.deepEqual(summary.levels, [1, 2, 4, 8, 16]);
  assert.deepEqual(surfelRoot.surfelOptions.levels, [1, 2, 4, 8, 16]);

  const chunk = surfelRoot.children.find(c => c.isLOD);
  assert.deepEqual(chunk.surfelFactors, [1, 2, 4, 8, 16]);
  assert.equal(chunk.levels.length, 5);
  assert.equal(chunk.levels[2].object.userData.heroNormals, true, 'x4 level was replaced in-place with hero-normal surfel level');
  assert.equal(chunk.levels[3].object.userData.heroNormals, true, 'x8 hero-normal level added');
  assert.equal(chunk.levels[4].object.userData.heroNormals, true, 'x16 hero-normal level added');

  // Verify far camera selects x8 and x16
  surfelRoot.updateMatrixWorld(true);
  const camFar = makeCamera({z: 220, fov: 50});
  chunk.update(camFar);
  const chosenIdx = chunk.levels.findIndex(l => l.object.visible);
  assert.equal(chunk.surfelFactors[chosenIdx], 16, 'far camera selects the newly attached x16 hero-normal surfel level');
});
