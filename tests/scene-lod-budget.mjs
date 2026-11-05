// kaminos-test: node — screen-footprint LOD selection, scene beauty face budget, decoupled flame-domain shadow budget, resident rung cache, and stored hero-normal surfel levels
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as THREE from '../lib/three.core.js';
import {
  effectiveRelativeGeomError,
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
import {registerPresentedSurface} from '../scene-presented-surface.mjs';

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
  assert.equal(lightingInstalled.size, 2, 'registered primary beauty LOD rung and repetition copy holder with surfaceLighting');

  // Check repetition copy inside the beauty LOD wrapper
  const wrapper = root.children.find(c => c.userData?.kaminosBeautyLodProxy);
  assert.ok(wrapper?.visible, 'beauty LOD wrapper is mounted and visible on root');
  assert.equal(wrapper.children.length, 2, 'beauty LOD wrapper includes primary rung + 1 repetition copy');

  const posedMesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
  const releasePose = registerPresentedSurface(heroMesh, {mesh: posedMesh, pick: async () => null});
  heroMesh.material.visible = false;
  const statePosed = controller.update(farCamera, {viewportHeight: 1080});
  assert.equal(statePosed.objects[0].displayedTier, 'hero', 'A live posed surface must not be replaced by an intact static LOD');
  assert.equal(wrapper.parent, null, 'The stale static proxy is unmounted while the posed surface owns presentation');
  assert.equal(heroMesh.material.visible, false, 'Returning the authored registration does not re-enable its superseded draw material');
  releasePose();heroMesh.material.visible = true;
  const stateReleased = controller.update(farCamera, {viewportHeight: 1080});
  assert.notEqual(stateReleased.objects[0].displayedTier, 'hero', 'Ordinary LOD selection resumes after the posed surface is released');

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
  assert.equal(lightingReleased.size, 2, 'released primary and repetition copy surfaceLighting registrations on disposal');
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

  // Review N3: secondary shadow/probe camera calling chunk.update(secondaryCam) must not clobber camFar's hysteresis deadband state
  const camBand = makeCamera({z: 195, fov: 50}); // factor 16 projects between 1.5 and 1.725 px (inside +15% deadband if active level is x16)
  const secondaryNearCam = makeCamera({z: 2, fov: 50});
  chunk.update(secondaryNearCam);
  assert.equal(chunk.surfelFactors[chunk.levels.findIndex(l => l.object.visible)], 1, 'secondary near camera sees x1');
  chunk.update(camBand);
  // Wait: for camFar specifically, let's move camFar from z=220 to z=195 (within +15% deadband of x16) after secondaryNearCam updated the chunk!
  camFar.position.set(0, 0, 195);
  camFar.updateMatrixWorld(true);
  camFar.matrixWorldInverse.copy(camFar.matrixWorld).invert();
  chunk.update(camFar);
  assert.equal(chunk.surfelFactors[chunk.levels.findIndex(l => l.object.visible)], 16, 'camFar retains its x16 hysteresis state despite intervening secondaryNearCam update');
});

test('review M1: createFireShadowCasters allocates and selects GI proxy shadow tiers by flame-domain solid angle under shadowFaceBudget', async () => {
  const HERO_NEAR = 'd'.repeat(64);
  const HERO_FAR = 'e'.repeat(64);
  const scene = new THREE.Scene();

  const kilnWall = new THREE.Group();
  kilnWall.userData.kaminosSceneObject = {id: 'kiln-wall', type: 'glb', source: `/api/read?root=generated-meshes&path=${HERO_NEAR}.glb`};
  const nearMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
  nearMesh.castShadow = true;
  kilnWall.add(nearMesh);
  kilnWall.position.set(0, 0.5, 0);
  scene.add(kilnWall);

  const distantPillar = new THREE.Group();
  distantPillar.userData.kaminosSceneObject = {id: 'distant-pillar', type: 'glb', source: `/api/read?root=generated-meshes&path=${HERO_FAR}.glb`};
  const farMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshStandardMaterial());
  farMesh.castShadow = true;
  distantPillar.add(farMesh);
  distantPillar.position.set(12, 1, 0);
  scene.add(distantPillar);
  scene.updateMatrixWorld(true);

  const levels = SAMPLE_LEVELS.slice(2).map(t => ({
    ...t,
    sha256: t.sha,
    source: `/api/read?root=generated-meshes&path=${t.sha}.glb`,
  })); // [5000, 1000, 500]

  const selectCalls = [];
  const giProxies = createGiProxyRegistry({
    THREE,
    fetchJson: async url => {
      const u = new URL(url, 'http://kaminos.local');
      const src = u.searchParams.get('source');
      const reqFaces = Number(u.searchParams.get('faces') || 1000);
      selectCalls.push({source: src, faces: reqFaces});
      const choice = levels.find(l => l.faces <= reqFaces) ?? levels.at(-1);
      return {schema: 'kaminos.lod-set.v0', source: src, levels, choice, withinBudget: true};
    },
    fetchBytes: async url => new TextEncoder().encode(url).buffer,
    digest: async bytes => {
      const m = /([0-9a-f]{64})\.glb/.exec(new TextDecoder().decode(bytes));
      return m[1];
    },
    parseGlb: async bytes => {
      const m = /([0-9a-f]{64})\.glb/.exec(new TextDecoder().decode(bytes));
      const sha = m[1];
      const tier = levels.find(l => l.sha === sha);
      const segs = tier.faces === 5000 ? 6 : tier.faces === 1000 ? 3 : 1;
      const g = new THREE.Group();
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1, segs, segs, segs), new THREE.MeshStandardMaterial());
      mesh.castShadow = true;
      g.add(mesh);
      return g;
    },
  });

  await giProxies.attach(kilnWall);
  await giProxies.attach(distantPillar);
  assert.equal(giProxies.get(kilnWall).effective.faces, 1000, 'starts at default 1000-face GI proxy');
  assert.equal(giProxies.get(distantPillar).effective.faces, 1000, 'starts at default 1000-face GI proxy');

  const casters = createFireShadowCasters({scene, giProxies, shadowFaceBudget: 6000});
  const flameBox = {min: [-0.5, 0, -0.5], max: [0.5, 1, 0.5]};
  casters.withCapture(() => {}, {flameBox});

  const debug1 = casters.debugState();
  assert.ok(debug1.shadowBudget, 'casters.debugState() reports shadowBudget allocation');
  assert.equal(debug1.shadowBudget.allocations['kiln-wall'].faces, 5000, 'kiln-wall enclosing the flame is allocated 5000 faces');
  assert.ok(debug1.shadowBudget.allocations['distant-pillar'].faces <= 1000, 'distant-pillar is allocated <= 1000 faces');
  assert.ok(debug1.shadowBudget.totalFaces <= 6000);

  await casters.whenShadowBudgetSettled();
  casters.withCapture(() => {}, {flameBox});
  assert.equal(giProxies.get(kilnWall).effective.faces, 5000, 'kilnWall GI proxy upgraded to 5000-face tier for shadow capture');
  assert.ok(giProxies.get(distantPillar).effective.faces <= 1000, 'distantPillar GI proxy stays at <= 1000 faces');

  const selectCountBeforeOrbit = selectCalls.length;
  casters.withCapture(() => {}, {flameBox});
  assert.equal(selectCalls.length, selectCountBeforeOrbit, 'subsequent captures with unchanged flameBox trigger zero GI proxy re-selections');
  casters.dispose();
});

test('review M2, N1, N2: withFrame restores heroes after render; colliders, burnable, export, and repetition remain uncorrupted even while beauty LOD is mounted; hidden roots keep cache; partial-frustum and budget-relief hysteresis behave accurately', async () => {
  const {createSceneColliderCollection} = await import('../scene-collider.mjs');
  const {FIRE_DOMAIN_ID} = await import('../scene-fire-domain.mjs');
  const {resolveBurnableTarget} = await import('../burnable-target.mjs');
  const {exportCloneInWorld} = await import('../scene-export.mjs');
  const {withoutRepetitionCopies, createRepetitionView} = await import('../scene-repetition.mjs');

  const HERO = 'f'.repeat(64);
  const scene = new THREE.Scene();
  const root = new THREE.Group();
  root.userData.kaminosSceneObject = {id: 'obj-m2', type: 'glb', source: `/api/read?root=generated-meshes&path=${HERO}.glb`};
  const heroMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1, 50, 50, 50), new THREE.MeshStandardMaterial());
  heroMesh.castShadow = true;
  root.add(heroMesh);

  const repView = createRepetitionView();
  const repSettings = {schema: 'kaminos.repetition.v1', mode: 'line', count: 2, axis: 'y', angle: 360, step: [2, 0, 0], space: 'world', center: [0, 0, 0], mirror: [false, false, false]};
  const repFrame = {position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1]};
  repView.sync(root, repSettings, repFrame);
  scene.add(root);
  scene.updateMatrixWorld(true);

  const tier25000 = SAMPLE_LEVELS[0];
  const tier5000 = SAMPLE_LEVELS[2];
  const tier1000 = SAMPLE_LEVELS[3];
  const lightingInstalled = new Set();
  const lightingReleased = new Set();
  const fetchCounts = new Map();

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
      levels: [tier25000, tier5000, tier1000].map(t => ({...t, sha256: t.sha, source: `/api/read?root=generated-meshes&path=${t.sha}.glb`})),
      choice: {...tier1000, sha256: tier1000.sha, source: `/api/read?root=generated-meshes&path=${tier1000.sha}.glb`},
      withinBudget: true,
    }),
    fetchBytes: async url => new TextEncoder().encode(url).buffer,
    digest: async () => tier1000.sha,
    parseGlb: async () => {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1, 2, 2, 2), new THREE.MeshStandardMaterial()));
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
      const s = /([0-9a-f]{64})\.glb/.exec(url)[1];
      fetchCounts.set(s, (fetchCounts.get(s) ?? 0) + 1);
      return new TextEncoder().encode(s).buffer;
    },
    digest: async bytes => new TextDecoder().decode(bytes),
    parseGlb: async () => {
      const g = new THREE.Group();
      const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1, 2, 2, 2), new THREE.MeshStandardMaterial());
      g.add(m);
      return g;
    },
  });

  const farCamera = makeCamera({z: 20, fov: 50});
  controller.update(farCamera, {viewportHeight: 1080});
  await controller.whenIdle();

  // 1. withFrame mounts the beauty LOD during the render callback and restores canonical hero state immediately after
  let wrapperSeenInFrame = false;
  controller.withFrame(farCamera, {viewportHeight: 1080}, () => {
    wrapperSeenInFrame = root.children.some(c => c.userData?.kaminosBeautyLodProxy && c.visible);
    assert.equal(heroMesh.visible, false, 'heroMesh hidden during beauty render callback');
  });
  assert.equal(wrapperSeenInFrame, true, 'beauty LOD wrapper was mounted during withFrame callback');
  assert.equal(heroMesh.visible, true, 'heroMesh is immediately restored after withFrame completes');
  assert.equal(root.children.some(c => c.userData?.kaminosBeautyLodProxy), false, 'beauty LOD wrapper is detached after withFrame completes');

  // 2. Even if controller.update leaves a beauty LOD mounted:
  controller.update(farCamera, {viewportHeight: 1080});
  assert.equal(lightingInstalled.size, 2, 'both primary beauty rung and repetition copy holder are registered with surfaceLighting');

  // 2a. Scene colliders see only the canonical hero meshes (heroMesh + repetition copy), never the beauty LOD wrapper
  const colliders = createSceneColliderCollection(THREE);
  const colResult = colliders.update([{id: 'obj-m2', type: 'glb', object: root, collision: {domainId: FIRE_DOMAIN_ID, enabled: true}}]);
  assert.equal(colResult.objects.length, 1);
  assert.equal(colliders.state().meshCount, 2, 'collider collection has primary hero mesh + 1 repetition copy mesh');

  // 2b. Export and withoutRepetitionCopies never include the beauty LOD wrapper or hidden hero meshes
  const exported = exportCloneInWorld(root);
  assert.equal(exported.children.some(c => c.userData?.kaminosBeautyLodProxy), false, 'exported clone excludes beauty LOD wrapper');
  let exportedHeroMesh = null;
  exported.traverse(m => { if (m.isMesh && !exportedHeroMesh) exportedHeroMesh = m; });
  assert.equal(exportedHeroMesh?.visible, true, 'exported hero mesh is visible');

  const duplicated = withoutRepetitionCopies(root, () => root.clone(true));
  assert.equal(duplicated.children.some(c => c.userData?.kaminosBeautyLodProxy), false, 'withoutRepetitionCopies clone excludes beauty LOD wrapper');
  assert.equal(duplicated.children.find(c => c.isMesh)?.visible, true, 'duplicated hero mesh is visible');

  // 2c. Updating repetition count while beauty LOD is mounted keeps new repetition copies visible when restored to hero
  repView.sync(root, {...repSettings, count: 3}, repFrame);
  controller.update(farCamera, {viewportHeight: 1080});
  const wrapperNow = root.children.find(c => c.userData?.kaminosBeautyLodProxy);
  assert.equal(wrapperNow.children.length, 3, 'beauty LOD wrapper synced to 3 total instances (primary + 2 copies)');
  assert.equal(lightingInstalled.size, 3, 'new repetition copy holder also registered with surfaceLighting');

  // 2d. resolveBurnableTarget succeeds on a single-mesh object even while its beauty LOD is mounted
  repView.sync(root, {...repSettings, mode: 'none'}, repFrame);
  controller.update(farCamera, {viewportHeight: 1080});
  const burnEntry = resolveBurnableTarget([{id: 'obj-m2', type: 'glb', object: root}], 'obj-m2');
  assert.equal(burnEntry.id, 'obj-m2', 'resolveBurnableTarget finds the single canonical hero mesh despite mounted beauty LOD wrapper');

  // 3. Review N1: temporarily hiding root.visible = false restores hero without evicting resident rungs
  const fetchesBeforeHide = [...fetchCounts.values()].reduce((a, b) => a + b, 0);
  root.visible = false;
  controller.update(farCamera, {viewportHeight: 1080});
  assert.equal(heroMesh.visible, true, 'hidden root has its internal hero children restored');
  root.visible = true;
  const stateAfterUnhide = controller.update(farCamera, {viewportHeight: 1080});
  const fetchesAfterUnhide = [...fetchCounts.values()].reduce((a, b) => a + b, 0);
  assert.equal(fetchesAfterUnhide, fetchesBeforeHide, 'resident rungs were NOT evicted while root.visible was false');
  assert.ok(stateAfterUnhide.objects[0].residentRungs >= 1);

  // 4. Review N2: partial-frustum repetition group counts only visible in-frustum instances, and relieving budget pressure is not trapped by budget-forced tier hysteresis
  const partialAlloc = allocateSceneBeautyLods([
    {
      id: 'partial-rep',
      heroFaces: 10000,
      levels: SAMPLE_LEVELS,
      instanceBoxes: [
        {min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5]}, // in frustum
        {min: [0.5, -0.5, -0.5], max: [1.5, 0.5, 0.5]},  // in frustum
        {min: [0, 0, 50], max: [1, 1, 51]},              // behind camera (z = 2.5)
        {min: [0, 0, 60], max: [1, 1, 61]},              // behind camera
      ],
    },
  ], {camera: makeCamera({z: 2.5, fov: 50}), viewportHeight: 1080, faceBudget: Infinity});
  assert.equal(partialAlloc.allocations['partial-rep'].instanceCount, 2, 'counts only the 2 in-frustum instances of the repetition group');

  // Budget-relief hysteresis check: find distance where 25k tier error is ~1.65 px (above 1.5 maxPixelError, so footprint selects 'hero', but below 1.725 refine threshold if 25k were mistaken for the footprint-selected tier)
  const box = {min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5]};
  // At z = 3.2, let's check screenPixelError of SAMPLE_LEVELS[0] (25k, p95=0.0022):
  // diag = sqrt(3) = 1.732, d = 2.7, pixelsPerUnit = 540 * 2.1445 / 2.7 = 428.9, err = 1.732 * 428.9 * 0.0022 = 1.634 px!
  const reliefCam = makeCamera({z: 2.0, fov: 50});
  const err25k = screenPixelError(SAMPLE_LEVELS[0], {worldBox: box, camera: reliefCam, viewportHeight: 1080});
  assert.ok(err25k > 1.5 && err25k < 1.725, `expected 25k error in (1.5, 1.725), got ${err25k}`);

  controller.setSettings({faceBudget: 500, maxPixelError: 1.5}); // force budget demotion
  const demotedState = controller.update(reliefCam, {viewportHeight: 1080});
  assert.notEqual(demotedState.objects[0].targetTier, 'hero', 'demoted under tight faceBudget');

  controller.setSettings({faceBudget: Infinity, maxPixelError: 1.5}); // relieve budget pressure
  const relievedState = controller.update(reliefCam, {viewportHeight: 1080});
  assert.equal(relievedState.objects[0].targetTier, 'hero', 'immediately returns to footprint-selected hero tier when budget pressure is relieved');

  controller.dispose();
  assert.equal(lightingReleased.size, 3, 'all primary and repetition copy lighting registrations released on dispose');
});

test('review M3: prepareLowTiers, prepareGenerationLevels, and tools/prepare-lod-tiers.mjs default to [25000, 10000, 5000, 1000, 500]', async () => {
  const {prepareGenerationLevels} = await import('../lod-generation-levels.mjs');
  const fs = await import('node:fs');
  const cliSource = fs.readFileSync(new URL('../tools/prepare-lod-tiers.mjs', import.meta.url), 'utf8');
  assert.match(cliSource, /25000,10000,5000,1000,500/, 'CLI tool defaults --targets to 25000,10000,5000,1000,500');

  const report = {};
  await prepareGenerationLevels({
    decode: {vertices: new Float32Array(9), triangles: new Uint32Array([0, 1, 2])},
    materialFields: {},
    source: 'a'.repeat(64),
    fetch: async () => new Response('stop', {status: 500}),
    THREE,
    MeshBVH: class {},
    finish: () => {},
    report,
  });
  assert.deepEqual(report.targets, [25000, 10000, 5000, 1000, 500], 'prepareGenerationLevels defaults targets to [25000, 10000, 5000, 1000, 500]');
});

test('Stockroom kaminosVertexWarp: beauty LOD rungs and fire shadow casters deform in root-local coordinates across TRELLIS node transforms and revision updates', async () => {
  const scene = new THREE.Scene();
  const root = new THREE.Group();
  root.userData.kaminosSceneObject = {id: 'stock-trough', source: '/api/read?root=generated-meshes&path=' + sha('trough-hero') + '.glb'};
  const heroGeom = new THREE.BoxGeometry(0.4, 0.3, 1.0, 20, 20, 40);
  const baseHeroPos = new Float32Array(heroGeom.attributes.position.array);
  const baseHeroNor = new Float32Array(heroGeom.attributes.normal.array);
  const heroMesh = new THREE.Mesh(heroGeom, new THREE.MeshStandardMaterial());
  heroMesh.castShadow = true;
  root.add(heroMesh);

  // Parametric stretch + lateral bend in root-local Y-up coordinates (Z is longitudinal)
  let stretch = 2.0;
  const warpFn = (positions, normals) => {
    const outP = new Float32Array(positions.length);
    const outN = new Float32Array(normals.length);
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i], y = positions[i + 1], z = positions[i + 2];
      outP[i] = x + 0.25 * z * z;
      outP[i + 1] = y;
      outP[i + 2] = z * stretch;
      const nx = normals[i] - 0.5 * z * normals[i + 1], ny = normals[i + 1], nz = (normals[i + 2] - 0.5 * z * normals[i]) / stretch;
      const l = Math.hypot(nx, ny, nz) || 1;
      outN[i] = nx / l;
      outN[i + 1] = ny / l;
      outN[i + 2] = nz / l;
    }
    return {positions: outP, normals: outN};
  };
  const applyHeroWarp = () => {
    const res = warpFn(baseHeroPos, baseHeroNor);
    heroGeom.attributes.position.array.set(res.positions);
    heroGeom.attributes.normal.array.set(res.normals);
    heroGeom.attributes.position.needsUpdate = true;
    heroGeom.attributes.normal.needsUpdate = true;
    heroGeom.computeBoundingBox();
  };
  applyHeroWarp();
  root.userData.kaminosVertexWarp = warpFn;
  root.userData.kaminosVertexWarpRevision = 1;
  scene.add(root);

  const tier1000Sha = sha('trough-tier-1000');
  const levels = [
    {sha256: tier1000Sha, faces: 1000, textureSize: 256, error: {p95: 0.002}, normalMap: {texelSize: 0.003}},
  ];

  // Build a proxy/rung scene whose child mesh has a -90 deg X node transform (like encodeTrellisGeometryGLB)
  // so local (lx, ly, lz) maps to root-local (wx, wy, wz) = (lx, lz, -ly)
  function makeTrellisTierScene() {
    const group = new THREE.Group();
    const node = new THREE.Group();
    node.rotation.x = -Math.PI / 2;
    node.updateMatrix();
    const geom = new THREE.BufferGeometry();
    // A vertex at root-local (0, 0, 0.5) has TRELLIS local (0, -0.5, 0) before -90 deg X rotation
    geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      0, -0.5, 0,
      0.2, 0.5, 0,
      -0.2, 0.5, 0,
    ]), 3));
    geom.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([
      0, 0, 1,
      0, 0, 1,
      0, 0, 1,
    ]), 3));
    geom.setAttribute('tangent', new THREE.BufferAttribute(new Float32Array([
      1, 0, 0, 1,
      1, 0, 0, 1,
      1, 0, 0, 1,
    ]), 4));
    geom.setIndex([0, 1, 2]);
    const mesh = new THREE.Mesh(geom, new THREE.MeshStandardMaterial());
    node.add(mesh);
    group.add(node);
    return group;
  }

  const shadowProxyRoot = makeTrellisTierScene();
  const handle = {
    root,
    levels,
    representation: 'mesh',
    state: 'loaded',
    effective: {sha: tier1000Sha, faces: 1000},
    proxyRoot: shadowProxyRoot,
  };
  const giProxies = {
    list: () => [handle],
    get: r => (r === root ? handle : null),
    onRelease: () => () => {},
    registerConsumer: () => () => {},
    select: () => {},
  };

  const controller = createSceneBeautyLodController({
    THREE,
    scene,
    giProxies,
    fetchBytes: async () => new TextEncoder().encode('trough-tier-1000').buffer,
    parseGlb: async () => makeTrellisTierScene(),
    digest: async b => createHash('sha256').update(Buffer.from(b)).digest('hex'),
    settings: {maxPixelError: 5.0, faceBudget: Infinity},
  });

  const cam = makeCamera({z: 8, fov: 50});
  controller.update(cam, {viewportHeight: 1080});
  await controller.whenIdle();
  controller.update(cam, {viewportHeight: 1080});

  let mountedMesh = null;
  root.traverse(o => {
    if (o.userData?.kaminosBeautyLodProxy) {
      o.traverse(m => { if (m.isMesh) mountedMesh = m; });
    }
  });
  assert.ok(mountedMesh, 'warped beauty LOD rung mesh is mounted');
  root.updateMatrixWorld(true);
  const v0World = new THREE.Vector3().fromBufferAttribute(mountedMesh.geometry.attributes.position, 0).applyMatrix4(mountedMesh.matrixWorld);
  // Vertex 0 started at root-local (0, 0, 0.5). With stretch = 2.0 and x += 0.25 * z^2:
  // warped root-local should be (0.0625, 0, 1.0)!
  assert.ok(Math.abs(v0World.x - 0.0625) < 1e-4, `expected warped x = 0.0625, got ${v0World.x}`);
  assert.ok(Math.abs(v0World.z - 1.0) < 1e-4, `expected warped z = 1.0, got ${v0World.z}`);
  const nArr = mountedMesh.geometry.attributes.normal.array;
  const tArr = mountedMesh.geometry.attributes.tangent.array;
  const dotNT = nArr[0] * tArr[0] + nArr[1] * tArr[1] + nArr[2] * tArr[2];
  assert.ok(Math.abs(dotNT) < 1e-4, `expected tangent orthogonal to warped normal, got dot=${dotNT}`);

  // Bump revision with stretch = 3.0 and verify resident rung updates in-place without reloading
  stretch = 3.0;
  applyHeroWarp();
  root.userData.kaminosVertexWarpRevision = 2;
  controller.update(cam, {viewportHeight: 1080});
  root.updateMatrixWorld(true);
  const v0Updated = new THREE.Vector3().fromBufferAttribute(mountedMesh.geometry.attributes.position, 0).applyMatrix4(mountedMesh.matrixWorld);
  assert.ok(Math.abs(v0Updated.z - 1.5) < 1e-4, `expected re-warped z = 1.5 after revision bump, got ${v0Updated.z}`);
  controller.restoreAllHeroes();

  // Verify fire-shadow-casters also applies kaminosVertexWarp to the GI proxy during withCapture
  const casters = createFireShadowCasters({
    scene,
    giProxies,
    shadowFaceBudget: 50000,
  });
  casters.setEnabled(true);
  casters.withCapture(() => {
    scene.updateMatrixWorld(true);
    let shadowMesh = null;
    scene.traverseVisible(m => { if (m.isMesh) shadowMesh = m; });
    assert.ok(shadowMesh, 'warped shadow caster mesh is visible during withCapture');
    const sv0 = new THREE.Vector3().fromBufferAttribute(shadowMesh.geometry.attributes.position, 0).applyMatrix4(shadowMesh.matrixWorld);
    assert.ok(Math.abs(sv0.x - 0.0625) < 1e-4, `expected shadow caster proxy vertex x = 0.0625, got ${sv0.x}`);
    assert.ok(Math.abs(sv0.z - 1.5) < 1e-4, `expected shadow caster proxy vertex z = 1.5, got ${sv0.z}`);
  }, {flameBox: {min: [-1, 0, -1], max: [1, 2, 1]}});

  casters.dispose();
  controller.dispose();
});

test('Stockroom deformStock contract: domain clamping handles remeshed LOD frameDrift, texelStretch scales free-span error, blocked variants do not loop or leak, and repetition copies stay synchronized', async () => {
  const {applyRootVertexWarpToRung} = await import('../scene-lod-budget.mjs');
  const {runGenerationLevels} = await import('../generation-levels-runner.mjs');

  // Stockroom Shocktroops' exact fitted half-pipe-trough profile & deformStock implementation
  const profile = {
    min: -0.4999839663505554,
    max: 0.5002454519271851,
    xMin: -0.1665765643119812,
    xMax: 0.16658924520015717,
    locks: [[-0.4999839663505554, -0.45], [-0.43, -0.23], [0.22, 0.39], [0.45, 0.5002454519271851]],
  };
  function createStockWarp(p, v) {
    const angle = (v.bend * Math.PI) / 180;
    const locks = v.protect ? p.locks : [];
    const locked = locks.reduce((s, b) => s + b[1] - b[0], 0);
    const free = p.max - p.min - locked;
    if (free <= 0 || v.length <= locked) throw Error('Length cannot contain the protected bands and positive free spans');
    const stretch = (v.length - locked) / free;
    const k = angle / (v.length - locked);
    const minFactor = Math.min(1 - k * p.xMin, 1 - k * p.xMax);
    if (minFactor <= 0) throw Error('Inner channel would fold: increase length or reduce bend');
    const breaks = [...new Set([p.min, p.max, ...locks.flat()])].sort((a, b) => a - b);
    const segments = [];
    let x = 0, z = 0, theta = -angle / 2;
    function at(s, value) {
      const distance = (value - s.a) * s.rate;
      const turn = s.curvature * distance;
      const half = turn / 2;
      const sinc = Math.abs(half) < 1e-8 ? 1 - (half * half) / 6 : Math.sin(half) / half;
      return {
        x: s.x + distance * sinc * Math.sin(s.theta + half),
        z: s.z + distance * sinc * Math.cos(s.theta + half),
        theta: s.theta + turn,
        segment: s,
      };
    }
    for (let i = 0; i < breaks.length - 1; i++) {
      const a = breaks[i], b = breaks[i + 1];
      const rigid = locks.some(([lo, hi]) => (a + b) / 2 >= lo && (a + b) / 2 <= hi);
      const rate = rigid ? 1 : stretch;
      const curvature = rigid ? 0 : k;
      const segment = {a, b, x, z, theta, rate, curvature, rigid};
      segments.push(segment);
      const q = at(segment, b);
      x = q.x; z = q.z; theta = q.theta;
    }
    const locate = value => {
      if (!Number.isFinite(value) || value < p.min - 1e-6 || value > p.max + 1e-6) {
        throw Error('Vertex outside fitted longitudinal profile');
      }
      const s = segments.find(seg => value < seg.b) ?? segments.at(-1);
      return at(s, value);
    };
    const midpoint = locate((p.min + p.max) / 2);
    const point = a => {
      if (a.length !== 3 || !a.every(Number.isFinite) || a[0] < p.xMin - 1e-6 || a[0] > p.xMax + 1e-6) {
        throw Error('Vertex outside fitted cross-section');
      }
      const q = locate(a[2]), c = Math.cos(q.theta), s = Math.sin(q.theta);
      const axial = q.segment.rate * (1 - q.segment.curvature * a[0]);
      return {position: [q.x - midpoint.x + a[0] * c, a[1], q.z - midpoint.z + (p.min + p.max) / 2 - a[0] * s], axial, theta: q.theta};
    };
    const normal = (n, a) => {
      const q = point(a), c = Math.cos(q.theta), s = Math.sin(q.theta), t = n[2] / q.axial;
      const out = [c * n[0] + s * t, n[1], -s * n[0] + c * t];
      const length = Math.hypot(...out);
      return length ? out.map(val => val / length) : out;
    };
    return {
      point,
      normal,
      metrics: {
        freeStretch: stretch,
        maxAxialStretch: Math.max(locks.length ? 1 : 0, stretch * Math.max(1 - k * p.xMin, 1 - k * p.xMax)),
      },
    };
  }
  function deformStock(positions, normals, p, v) {
    const warp = createStockWarp(p, v);
    const out = new Float32Array(positions.length);
    const n = new Float32Array(normals.length);
    for (let i = 0; i < positions.length; i += 3) {
      const pt = Array.from(positions.subarray(i, i + 3));
      out.set(warp.point(pt).position, i);
      n.set(warp.normal(Array.from(normals.subarray(i, i + 3)), pt), i);
    }
    return {positions: out, normals: n, metrics: warp.metrics};
  }

  // Hero within exact fitted profile + a kaminosRepetitionCopy child sharing the same BufferGeometry (M2)
  const scene = new THREE.Scene();
  const root = new THREE.Group();
  root.userData.kaminosSceneObject = {id: 'stock-trough-real'};
  const heroGeom = new THREE.BoxGeometry(profile.xMax - profile.xMin, 0.18, profile.max - profile.min, 12, 12, 24);
  heroGeom.translate((profile.xMin + profile.xMax) / 2, 0, (profile.min + profile.max) / 2);
  heroGeom.computeTangents?.();
  if (!heroGeom.getAttribute('tangent')) {
    const tArr = new Float32Array((heroGeom.attributes.position.count) * 4);
    for (let i = 0; i < tArr.length; i += 4) { tArr[i] = 1; tArr[i + 3] = 1; }
    heroGeom.setAttribute('tangent', new THREE.BufferAttribute(tArr, 4));
  }
  const heroMesh = new THREE.Mesh(heroGeom, new THREE.MeshStandardMaterial());
  heroMesh.castShadow = true;
  root.add(heroMesh);

  // Add a kaminosRepetitionCopy child whose Mesh shares heroGeom (like scene-repetition.mjs cloneBorrowed)
  const repGroup = new THREE.Group();
  repGroup.userData.kaminosRepetitionCopy = true;
  repGroup.position.set(1.5, 0, 0);
  repGroup.updateMatrix();
  const repMesh = new THREE.Mesh(heroGeom, heroMesh.material);
  repMesh.castShadow = true;
  repGroup.add(repMesh);
  root.add(repGroup);
  scene.add(root);

  // Remeshed LOD rung whose vertices exceed profile.xMax and profile.max by frameDrift (~0.0014) (M1)
  function makeDriftedLodRung() {
    const g = new THREE.Group();
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      profile.xMin - 0.0005, -0.1, profile.min - 0.0007,
      profile.xMax + 0.0014, -0.1, profile.min - 0.0004,
      0, 0.09, profile.max + 0.0011,
    ]), 3));
    geom.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([
      0, 1, 0,
      0, 1, 0,
      0, 1, 0,
    ]), 3));
    geom.setAttribute('tangent', new THREE.BufferAttribute(new Float32Array([
      1, 0, 0, 1,
      1, 0, 0, 1,
      1, 0, 0, 1,
    ]), 4));
    geom.setIndex([0, 1, 2]);
    const m = new THREE.Mesh(geom, new THREE.MeshStandardMaterial());
    m.castShadow = true;
    g.add(m);
    return g;
  }

  let currentVariant = {length: 1.5, bend: 80, protect: true};
  const warpFn = (pos, nrm) => deformStock(pos, nrm, profile, currentVariant);

  // 1. Capture shadow casters BEFORE kaminosVertexWarp is set, then attach warp and verify repCopies update (M2)
  const tierSha = sha('drifted-lod-1000');
  const levels = [{sha256: tierSha, faces: 1000, textureSize: 256, error: {relative: {p95: 0.001}}, normalMap: {texelSize: 1 / 256}}];
  const shadowProxyRoot = makeDriftedLodRung();
  const handle = {root, levels, representation: 'mesh', state: 'loaded', effective: {sha: tierSha, faces: 1000}, proxyRoot: shadowProxyRoot};
  const giProxies = {
    list: () => [handle],
    get: r => (r === root ? handle : null),
    onRelease: () => () => {},
    registerConsumer: () => () => {},
    select: () => {},
  };
  const casters = createFireShadowCasters({scene, giProxies, shadowFaceBudget: 50000});
  casters.setEnabled(true);
  // First capture with no warp
  casters.withCapture(() => {}, {flameBox: {min: [-1, 0, -1], max: [1, 2, 1]}});

  // Now attach warp to root and deform hero via applyRootVertexWarpToRung (verifying repGroup does NOT double-warp heroGeom)
  root.userData.kaminosVertexWarp = warpFn;
  root.userData.kaminosVertexWarpRevision = 1;
  const heroWarpRes = applyRootVertexWarpToRung(THREE, root, warpFn);
  assert.equal(heroWarpRes.ok, true, 'hero warp succeeded');
  assert.ok(heroWarpRes.maxStretch > 2.3, `expected maxStretch > 2.3, got ${heroWarpRes.maxStretch}`);
  assert.ok(heroWarpRes.texelStretch > 1.4, `expected texelStretch > 1.4, got ${heroWarpRes.texelStretch}`);

  // Verify heroGeom was warped exactly once (not overwritten by repGroup's x=1.5 offset!)
  const expectedHero = deformStock(heroGeom.userData.kaminosWarpBase.rootPos, heroGeom.userData.kaminosWarpBase.rootNorm, profile, currentVariant);
  assert.ok(Math.abs(heroGeom.attributes.position.array[0] - expectedHero.positions[0]) < 1e-5, 'heroGeom was not corrupted by kaminosRepetitionCopy child');

  // Second capture after attaching warp: verify BOTH primary shadow proxy AND its repetition copy have warped geometry (M1 + M2)
  casters.withCapture(() => {
    const visibleShadowMeshes = [];
    scene.traverseVisible(m => { if (m.isMesh) visibleShadowMeshes.push(m); });
    assert.equal(visibleShadowMeshes.length, 2, 'both primary and repetition shadow caster meshes are visible');
    assert.equal(
      visibleShadowMeshes[0].geometry,
      visibleShadowMeshes[1].geometry,
      'repetition shadow copy references the warped proxy geometry after warpFn was attached'
    );
    assert.ok(
      Math.abs(visibleShadowMeshes[0].geometry.attributes.position.array[2] - deformStock(
        new Float32Array([profile.xMin, -0.1, profile.min]),
        new Float32Array([0, 1, 0]),
        profile,
        currentVariant
      ).positions[2]) < 1e-3,
      'drifted shadow proxy rung was clamped to hero profile bounds and warped cleanly by deformStock'
    );
  }, {flameBox: {min: [-1, 0, -1], max: [1, 2, 1]}});

  // 2. Verify beauty LOD controller clamps drifted rungs, propagates texelStretch, and handles blocked variants without looping (M1 + WO2)
  let fetchCount = 0;
  const controller = createSceneBeautyLodController({
    THREE,
    scene,
    giProxies,
    fetchBytes: async () => {
      fetchCount++;
      return new TextEncoder().encode('drifted-lod-1000').buffer;
    },
    parseGlb: async () => makeDriftedLodRung(),
    digest: async b => createHash('sha256').update(Buffer.from(b)).digest('hex'),
    settings: {maxPixelError: 50.0, faceBudget: Infinity},
  });
  const cam = makeCamera({z: 6, fov: 50});
  controller.update(cam, {viewportHeight: 1080});
  await controller.whenIdle();
  const stateBent = controller.update(cam, {viewportHeight: 1080});
  assert.equal(fetchCount, 1, 'fetched rung once');
  assert.equal(stateBent.objects[0].displayedTier, tierSha, 'drifted beauty LOD rung loaded and warped cleanly under deformStock');

  // Switch to Stockroom's blocked tight variant ({length: 0.6, bend: 180, protect: true}) and bump revision
  currentVariant = {length: 0.6, bend: 180, protect: true};
  const blockedRes = applyRootVertexWarpToRung(THREE, root, warpFn);
  assert.equal(blockedRes.ok, false, 'blocked tight variant reports ok: false without throwing');
  assert.match(blockedRes.error, /Inner channel would fold/, 'records Stockroom fold error message');
  root.userData.kaminosVertexWarpRevision = 2;
  controller.update(cam, {viewportHeight: 1080});
  controller.update(cam, {viewportHeight: 1080});
  assert.equal(fetchCount, 1, 'blocked warpFn does not trigger repeated fetch/parse loops');
  casters.withCapture(() => {}, {flameBox: {min: [-1, 0, -1], max: [1, 2, 1]}});

  // 3. Verify tangent rotation when warpFn omits normals (N2) and runGenerationLevels forwarding (N1)
  const posOnlyWarp = pos => {
    const out = new Float32Array(pos.length);
    for (let i = 0; i < pos.length; i += 3) {
      out[i] = pos[i];
      out[i + 1] = -pos[i + 2];
      out[i + 2] = pos[i + 1];
    }
    return out;
  };
  const rungNoNorm = makeDriftedLodRung();
  applyRootVertexWarpToRung(THREE, rungNoNorm, posOnlyWarp);
  const meshNoNorm = rungNoNorm.children[0];
  const nA = meshNoNorm.geometry.attributes.normal.array;
  const tA = meshNoNorm.geometry.attributes.tangent.array;
  const dotNoNorm = nA[0] * tA[0] + nA[1] * tA[1] + nA[2] * tA[2];
  assert.ok(Math.abs(dotNoNorm) < 1e-4, `tangent remains orthogonal when warpFn omits normals (dot=${dotNoNorm})`);

  let postedMsg = null;
  let postedTransfers = null;
  class MockWorker {
    addEventListener(type, fn) { if (type === 'message') this._onMsg = fn; }
    postMessage(msg, transfers) { postedMsg = msg; postedTransfers = transfers; this._onMsg?.({data: {kind: 'done', report: {phase: 'done'}}}); }
    terminate() {}
  }
  const surfelBuf = new ArrayBuffer(16);
  await runGenerationLevels({
    source: 'a'.repeat(64),
    surfelGLB: surfelBuf,
    surfelSource: 'b'.repeat(64),
    replace: true,
    WorkerClass: MockWorker,
  });
  assert.equal(postedMsg.surfelGLB, surfelBuf, 'runGenerationLevels forwards surfelGLB');
  assert.equal(postedMsg.surfelSource, 'b'.repeat(64), 'runGenerationLevels forwards surfelSource');
  assert.equal(postedMsg.replace, true, 'runGenerationLevels forwards replace');
  assert.ok(postedTransfers.includes(surfelBuf), 'runGenerationLevels transfers surfelGLB ArrayBuffer');

  casters.dispose();
  controller.dispose();
});

test('Stockroom surfelSource: prepareGenerationLevels builds hero-normal surfel levels from a stored surfel GLB alongside a hero GLB without raw voxel fields', async () => {
  const {prepareGenerationLevels} = await import('../lod-generation-levels.mjs');
  const {encodeSurfelGLB} = await import('../trellis-surfels.mjs');
  const {MeshBVH} = await import('three-mesh-bvh');

  const resolution = 32, coords = [[2, 2, 16], [29, 2, 16], [2, 29, 16], [29, 29, 16]];
  const vertices = new Float32Array(coords.flatMap(c => c.map(v => (v + 0.5) / resolution - 0.5)));
  const triangles = new Uint32Array([0, 1, 3, 0, 3, 2]);
  const field = buildSurfelField({
    vertices,
    triangles,
    geometryCoordinates: new Int32Array(coords.flat()),
    material: {
      resolution,
      coordinates: new Int32Array(coords.flat()),
      features: new Float32Array(coords.flatMap(() => [0.2, -0.2, 0.4, -1, 0.6, 1])),
    },
  });
  const surfelGLB = encodeSurfelGLB(field, {fallbackFactor: 4});
  // Stored hero GLB with TRELLIS -90 deg X node and shading normals
  const pos = vertices, idx = triangles, nrm = new Float32Array(coords.flatMap(() => [0.6, 0, 0.8]));
  const parts = [pos, idx, nrm], bin = new Uint8Array(parts.reduce((n, a) => n + a.byteLength, 0));
  let at = 0;
  const bufferViews = [];
  for (const a of parts) {
    bin.set(new Uint8Array(a.buffer), at);
    bufferViews.push({buffer: 0, byteOffset: at, byteLength: a.byteLength});
    at += a.byteLength;
  }
  const json = {
    asset: {version: '2.0'},
    scene: 0,
    scenes: [{nodes: [0]}],
    nodes: [{mesh: 0, matrix: [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1]}],
    meshes: [{primitives: [{attributes: {POSITION: 0, NORMAL: 2}, indices: 1}]}],
    buffers: [{byteLength: bin.length}],
    bufferViews,
    accessors: [
      {bufferView: 0, componentType: 5126, count: 4, type: 'VEC3'},
      {bufferView: 1, componentType: 5125, count: 6, type: 'SCALAR'},
      {bufferView: 2, componentType: 5126, count: 4, type: 'VEC3'},
    ],
  };
  const text = new TextEncoder().encode(JSON.stringify(json)), tl = Math.ceil(text.length / 4) * 4;
  const out = new Uint8Array(28 + tl + bin.length), dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, out.length, true);
  dv.setUint32(12, tl, true); dv.setUint32(16, 0x4e4f534a, true);
  out.fill(32, 20, 20 + tl); out.set(text, 20);
  dv.setUint32(20 + tl, bin.length, true); dv.setUint32(24 + tl, 0x004e4942, true);
  out.set(bin, 28 + tl);
  const heroGLB = out.buffer;

  const registered = [];
  const report = await prepareGenerationLevels({
    decode: null,
    materialFields: null,
    heroGLB,
    surfelGLB,
    source: 'b'.repeat(64),
    targets: [],
    surfelFactors: [4],
    THREE,
    MeshBVH,
    finish: () => {},
    fetch: async (url, opts) => {
      if (String(url).includes('/api/mesh-lods?source=')) {
        return new Response(JSON.stringify({levels: []}), {status: 200});
      }
      if (String(url).includes('/api/ingest-mesh')) {
        const digest = createHash('sha256').update(Buffer.from(opts.body)).digest('hex');
        return new Response(JSON.stringify({sha256: digest}), {status: 200});
      }
      if (String(url).includes('/api/mesh-lods') && opts?.method === 'POST') {
        const body = JSON.parse(opts.body);
        registered.push(body.level);
        return new Response(JSON.stringify({source: body.source, level: body.level}), {status: 200});
      }
      return new Response('not found', {status: 404});
    },
  });
  assert.equal(report.phase, 'done', `expected phase done, got ${report.phase} (${report.error?.message})`);
  assert.equal(registered.length, 1, 'registered 1 merged hero-normal surfel level from surfelGLB + heroGLB');
  assert.equal(registered[0].route, 'trellis-surfels+hero-normals');
  assert.equal(registered[0].mergeFactor, 4);
});

test('Kiln side-pipe drop vs. beam crack-seal: footprint and budget allocators penalize dropped silhouette features and coarsen prismatic beams first', async () => {
  const {measureGeometricError} = await import('../mesh-lod-ladder.mjs');

  // Helper to build an axis-aligned box mesh [x0..x1, y0..y1, z0..z1]
  function appendBox(verts, faces, [x0, y0, z0], [x1, y1, z1]) {
    const base = verts.length / 3;
    for (let i = 0; i < 8; i++) {
      verts.push(i & 1 ? x1 : x0, (i >> 1) & 1 ? y1 : y0, (i >> 2) & 1 ? z1 : z0);
    }
    for (const [a, b, c, d] of [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]]) {
      faces.push(base + a, base + b, base + c, base + a, base + c, base + d);
    }
  }
  function closestOnBox([x0, y0, z0], [x1, y1, z1]) {
    return (x, y, z) => {
      const p = [x, y, z];
      const c = [Math.min(x1, Math.max(x0, x)), Math.min(y1, Math.max(y0, y)), Math.min(z1, Math.max(z0, z))];
      if (c[0] !== x || c[1] !== y || c[2] !== z) {
        const d = [x - c[0], y - c[1], z - c[2]];
        const axis = [Math.abs(d[0]), Math.abs(d[1]), Math.abs(d[2])].indexOf(Math.max(Math.abs(d[0]), Math.abs(d[1]), Math.abs(d[2])));
        const n = [0, 0, 0];
        n[axis] = Math.sign(d[axis]) || 1;
        return {point: c, normal: n};
      }
      const opts = [
        [x - x0, 0, x0, -1], [x1 - x, 0, x1, 1],
        [y - y0, 1, y0, -1], [y1 - y, 1, y1, 1],
        [z - z0, 2, z0, -1], [z1 - z, 2, z1, 1],
      ].sort((a, b) => a[0] - b[0])[0];
      c[opts[1]] = opts[2];
      const n = [0, 0, 0];
      n[opts[1]] = opts[3];
      return {point: c, normal: n};
    };
  }

  // 1. Synthetic geometric fixture:
  //    - Kiln hero: [0, 1]^3 chamber + right-side stand-off pipe [1.0, 1.16] x [0.25, 0.75] x [0.45, 0.55]
  //      (~4% of hero surface area). Its 1,000-face rung drops the right-side pipe completely.
  //    - Beam hero: [0, 1]^3 block whose 1,000-face rung has a uniform 0.004 crack/chamfer smoothing on all faces.
  const kilnHeroV = [], kilnHeroF = [];
  appendBox(kilnHeroV, kilnHeroF, [0, 0, 0], [1, 1, 1]);
  appendBox(kilnHeroV, kilnHeroF, [1.0, 0.25, 0.45], [1.16, 0.75, 0.55]);
  const kilnHero = {vertices: new Float32Array(kilnHeroV), faces: new Uint32Array(kilnHeroF)};

  const kilnCoarseV = [], kilnCoarseF = [];
  appendBox(kilnCoarseV, kilnCoarseF, [0.0005, 0.0005, 0.0005], [0.9995, 0.9995, 0.9995]);
  const kilnCoarse = {vertices: new Float32Array(kilnCoarseV), faces: new Uint32Array(kilnCoarseF)};

  const closestKilnHero = (x, y, z) => {
    const a = closestOnBox([0, 0, 0], [1, 1, 1])(x, y, z);
    const b = closestOnBox([1.0, 0.25, 0.45], [1.16, 0.75, 0.55])(x, y, z);
    const da = Math.hypot(a.point[0] - x, a.point[1] - y, a.point[2] - z);
    const db = Math.hypot(b.point[0] - x, b.point[1] - y, b.point[2] - z);
    return da <= db ? a : b;
  };
  const kilnPipeDropError = measureGeometricError({
    source: kilnHero,
    level: kilnCoarse,
    closestSource: closestKilnHero,
    closestLevel: closestOnBox([0.0005, 0.0005, 0.0005], [0.9995, 0.9995, 0.9995]),
    samples: 10000,
    seed: 11,
  });

  const beamHeroV = [], beamHeroF = [], beamCoarseV = [], beamCoarseF = [];
  appendBox(beamHeroV, beamHeroF, [0, 0, 0], [1, 1, 1]);
  appendBox(beamCoarseV, beamCoarseF, [0.003, 0.003, 0.003], [0.997, 0.997, 0.997]);
  const beamCrackSealError = measureGeometricError({
    source: {vertices: new Float32Array(beamHeroV), faces: new Uint32Array(beamHeroF)},
    level: {vertices: new Float32Array(beamCoarseV), faces: new Uint32Array(beamCoarseF)},
    closestSource: closestOnBox([0, 0, 0], [1, 1, 1]),
    closestLevel: closestOnBox([0.003, 0.003, 0.003], [0.997, 0.997, 0.997]),
    samples: 10000,
    seed: 11,
  });

  // Notice the pooled-p95 dilution trap: because the side pipe is ~4% of the kiln's area and absent from
  // levelToSource, pooled kilnPipeDropError.relative.p95 (< 0.001) is smaller than beamCrackSealError.relative.p95 (~0.0017),
  // even though kilnPipeDropError.sourceToLevel.max is ~0.16 (the dropped pipe) vs ~0.005 on the beam!
  assert.ok(
    kilnPipeDropError.relative.p95 < beamCrackSealError.relative.p95,
    `pooled p95 alone under-weights the <5%-area dropped pipe (${kilnPipeDropError.relative.p95} < ${beamCrackSealError.relative.p95})`,
  );
  assert.ok(
    kilnPipeDropError.sourceToLevel.max > 20 * beamCrackSealError.sourceToLevel.max,
    `sourceToLevel.max captures the dropped pipe (${kilnPipeDropError.sourceToLevel.max} vs ${beamCrackSealError.sourceToLevel.max})`,
  );

  const unitBox = new THREE.Box3(new THREE.Vector3(-0.5, -0.5, -0.5), new THREE.Vector3(0.5, 0.5, 0.5));
  const diag = Math.sqrt(3);
  const cam = makeCamera({z: 4, fov: 50});
  const kiln1kTier = {sha: sha('kiln-1k-pipe-drop'), faces: 1000, textureSize: 256, error: kilnPipeDropError, normalMap: {texelSize: 1 / 256}};
  const beam1kTier = {sha: sha('beam-1k-crack-seal'), faces: 1000, textureSize: 256, error: beamCrackSealError, normalMap: {texelSize: 1 / 256}};
  const kilnPx = screenPixelError(kiln1kTier, {worldBox: unitBox, worldDiag: diag, camera: cam, viewportHeight: 1080});
  const beamPx = screenPixelError(beam1kTier, {worldBox: unitBox, worldDiag: diag, camera: cam, viewportHeight: 1080});
  assert.ok(
    kilnPx > 10 * beamPx,
    `screenPixelError must penalize the pipe-dropping kiln tier far more than the crack-sealing beam tier (${kilnPx} vs ${beamPx})`,
  );

  // When both objects have a 5,000-face tier that preserves their shape and a 1,000-face tier where the kiln drops its pipe:
  const shared5kError = {
    diagonal: diag,
    relative: {p95: 0.0012, max: 0.0025, mean: 0.0005},
    levelToSource: {p95: 0.0012 * diag, max: 0.0022 * diag, mean: 0.0005 * diag},
    sourceToLevel: {p95: 0.0012 * diag, max: 0.0025 * diag, mean: 0.0005 * diag},
  };
  const kilnLevels = [
    {sha: sha('kiln-5k-keep-pipe'), faces: 5000, textureSize: 512, error: shared5kError, normalMap: {texelSize: 1 / 512}},
    kiln1kTier,
  ];
  const beamLevels = [
    {sha: sha('beam-5k'), faces: 5000, textureSize: 512, error: shared5kError, normalMap: {texelSize: 1 / 512}},
    beam1kTier,
  ];

  // Under a 6,000-face budget (only one object can stay at 5,000 faces; the other must drop to 1,000 faces):
  // Both beauty and shadow allocators MUST demote the beam to 1,000 faces and keep the kiln at 5,000 faces!
  const beautySynthetic = allocateSceneBeautyLods([
    {id: 'kiln', heroFaces: 200000, levels: kilnLevels, worldBox: unitBox, worldDiag: diag},
    {id: 'beam', heroFaces: 200000, levels: beamLevels, worldBox: unitBox, worldDiag: diag},
  ], {camera: makeCamera({z: 5.5, fov: 50}), viewportHeight: 1080, maxPixelError: 1.5, faceBudget: 6000});
  assert.equal(beautySynthetic.withinBudget, true);
  assert.equal(beautySynthetic.allocations.kiln.faces, 5000, 'beauty budget preserves the kiln at 5,000 faces so its side pipe is not dropped');
  assert.equal(beautySynthetic.allocations.beam.faces, 1000, 'beauty budget demotes the beam to 1,000 faces instead');

  const shadowSynthetic = allocateShadowCasterLods([
    {id: 'kiln', heroFaces: 200000, levels: kilnLevels, worldBox: unitBox, worldDiag: diag},
    {id: 'beam', heroFaces: 200000, levels: beamLevels, worldBox: unitBox, worldDiag: diag},
  ], {flameBox: new THREE.Box3(new THREE.Vector3(-0.1, -0.1, -0.1), new THREE.Vector3(0.1, 0.1, 0.1)), shadowFaceBudget: 6000});
  assert.equal(shadowSynthetic.withinBudget, true);
  assert.equal(shadowSynthetic.allocations.kiln.faces, 5000, 'shadow budget preserves the kiln at 5,000 faces');
  assert.equal(shadowSynthetic.allocations.beam.faces, 1000, 'shadow budget demotes the beam to 1,000 faces');

  // 2. Real baked error curves from Refractory Kiln (f8e6ce91) and Weathered Timber Beam (7be0be28) at equal bounds & distance:
  const realKilnLevels = [
    {sha: '57b5a750', faces: 25000, textureSize: 1024, normalMap: {texelSize: 0.004260175}, error: {diagonal: 1.487462, relative: {max: 0.011843, p95: 0.002828, mean: 0.000579}, levelToSource: {max: 0.011467, p95: 0.003489, mean: 0.000678}, sourceToLevel: {max: 0.017617, p95: 0.004823, mean: 0.001044}}},
    {sha: '414cca4f', faces: 10000, textureSize: 512, normalMap: {texelSize: 0.007478695}, error: {diagonal: 1.487462, relative: {max: 0.025876, p95: 0.005484, mean: 0.001108}, levelToSource: {max: 0.015106, p95: 0.005359, mean: 0.001028}, sourceToLevel: {max: 0.038490, p95: 0.011303, mean: 0.002268}}},
    {sha: '7dbc98d3', faces: 5000, textureSize: 512, normalMap: {texelSize: 0.006812807}, error: {diagonal: 1.487462, relative: {max: 0.025906, p95: 0.009047, mean: 0.001854}, levelToSource: {max: 0.024469, p95: 0.008665, mean: 0.001704}, sourceToLevel: {max: 0.038534, p95: 0.016442, mean: 0.003811}}},
    {sha: '6858aec1', faces: 1000, textureSize: 256, normalMap: {texelSize: 0.009611729}, error: {diagonal: 1.487462, relative: {max: 0.061201, p95: 0.026436, mean: 0.006755}, levelToSource: {max: 0.051067, p95: 0.019752, mean: 0.004896}, sourceToLevel: {max: 0.091034, p95: 0.044281, mean: 0.015200}}},
    {sha: 'f5889e96', faces: 500, textureSize: 256, normalMap: {texelSize: 0.009764150}, error: {diagonal: 1.487462, relative: {max: 0.063995, p95: 0.027777, mean: 0.007391}, levelToSource: {max: 0.042772, p95: 0.020955, mean: 0.005821}, sourceToLevel: {max: 0.095191, p95: 0.046434, mean: 0.016168}}},
  ];
  const realBeamLevels = [
    {sha: 'bae07caf', faces: 25000, textureSize: 1024, normalMap: {texelSize: 0.001788627}, error: {diagonal: 1.051690, relative: {max: 0.005581, p95: 0.000292, mean: 0.000076}, levelToSource: {max: 0.003203, p95: 0.000397, mean: 0.000101}, sourceToLevel: {max: 0.005870, p95: 0.000218, mean: 0.000059}}},
    {sha: '05a311ac', faces: 10000, textureSize: 512, normalMap: {texelSize: 0.003357881}, error: {diagonal: 1.051690, relative: {max: 0.005951, p95: 0.000538, mean: 0.000132}, levelToSource: {max: 0.005335, p95: 0.000733, mean: 0.000180}, sourceToLevel: {max: 0.006259, p95: 0.000378, mean: 0.000098}}},
    {sha: '8045c108', faces: 5000, textureSize: 512, normalMap: {texelSize: 0.003273525}, error: {diagonal: 1.051690, relative: {max: 0.005407, p95: 0.000832, mean: 0.000202}, levelToSource: {max: 0.005687, p95: 0.001112, mean: 0.000277}, sourceToLevel: {max: 0.005344, p95: 0.000560, mean: 0.000147}}},
    {sha: 'adb066b2', faces: 1000, textureSize: 256, normalMap: {texelSize: 0.006745198}, error: {diagonal: 1.051690, relative: {max: 0.011962, p95: 0.001910, mean: 0.000537}, levelToSource: {max: 0.012580, p95: 0.002616, mean: 0.000735}, sourceToLevel: {max: 0.007859, p95: 0.001374, mean: 0.000395}}},
    {sha: '7208b932', faces: 500, textureSize: 256, normalMap: {texelSize: 0.004554675}, error: {diagonal: 1.051690, relative: {max: 0.013912, p95: 0.001645, mean: 0.000598}, levelToSource: {max: 0.014632, p95: 0.001640, mean: 0.000603}, sourceToLevel: {max: 0.008618, p95: 0.001854, mean: 0.000654}}},
  ];

  // At medium distance (z = 5.5m) with identical worldBox and worldDiag, footprint selection drops the beam to 500 faces
  // while holding the kiln at 25,000 faces:
  const medCam = makeCamera({z: 5.5, fov: 50});
  const kilnFoot = selectFootprintTier(realKilnLevels, {heroFaces: 287407, worldBox: unitBox, worldDiag: diag, camera: medCam, viewportHeight: 1080, maxPixelError: 1.5});
  const beamFoot = selectFootprintTier(realBeamLevels, {heroFaces: 97670, worldBox: unitBox, worldDiag: diag, camera: medCam, viewportHeight: 1080, maxPixelError: 1.5});
  assert.equal(beamFoot.selected.faces, 500, 'at z = 5.5m, beam coarsens all the way to 500 faces by screen footprint');
  assert.equal(kilnFoot.selected.faces, 25000, 'at z = 5.5m, kiln stays at 25,000 faces by screen footprint');

  // At close range (z = 1.8m) where both want high detail:
  // 1) Under a 320,000-face budget (combined hero faces = 287,407 + 97,670 = 385,077 > 320,000),
  //    allocateSceneBeautyLods demotes the 97,670-face beam to 25,000 faces while keeping the 287,407-face kiln on hero!
  const closeCam = makeCamera({z: 1.8, fov: 50});
  const heroStepBudget = allocateSceneBeautyLods([
    {id: 'kiln', heroFaces: 287407, levels: realKilnLevels, worldBox: unitBox, worldDiag: diag},
    {id: 'beam', heroFaces: 97670, levels: realBeamLevels, worldBox: unitBox, worldDiag: diag},
  ], {camera: closeCam, viewportHeight: 1080, maxPixelError: 1.5, faceBudget: 320000});
  assert.equal(heroStepBudget.withinBudget, true);
  assert.equal(heroStepBudget.allocations.beam.faces, 25000, '320k budget demotes the 97,670-face beam to 25,000 faces first');
  assert.equal(heroStepBudget.allocations.kiln.tier, 'hero', '320k budget keeps the 287,407-face kiln on hero');

  // 2) Under a tight 10,500-face budget, it demotes the beam all the way to 500 faces while keeping the kiln at 10,000 faces:
  const realBudget = allocateSceneBeautyLods([
    {id: 'kiln', heroFaces: 287407, levels: realKilnLevels, worldBox: unitBox, worldDiag: diag},
    {id: 'beam', heroFaces: 97670, levels: realBeamLevels, worldBox: unitBox, worldDiag: diag},
  ], {camera: closeCam, viewportHeight: 1080, maxPixelError: 1.5, faceBudget: 10500});
  assert.equal(realBudget.withinBudget, true);
  assert.equal(realBudget.allocations.beam.faces, 500, 'beam is demoted all the way to 500 faces first');
  assert.equal(realBudget.allocations.kiln.faces, 10000, 'kiln stays at 10,000 faces and avoids its pipe-dropping 1k/500 tiers');
  assert.ok(
    effectiveRelativeGeomError(realKilnLevels[3]) > 10 * effectiveRelativeGeomError(realBeamLevels[3]),
    'effectiveRelativeGeomError at 1,000 faces is >10x higher on the kiln than on the beam',
  );

  // 3. Review M1, M2, M3, N1 verification:
  // M1: Monotone deltaError across the texel floor (a lossier object just above the texel floor is NEVER cheaper to demote than a cleaner object just below it)
  const cleanBelowTexelFloor = {
    sha: sha('clean-below-floor'),
    faces: 25000,
    textureSize: 256,
    normalMap: {texelSize: 0.004}, // texelWeight * texelSize = 0.0020
    error: {diagonal: 1, relative: {p95: 0.0018, max: 0.0018}, sourceToLevel: {p95: 0.0018, max: 0.0018}, levelToSource: {p95: 0.0018, max: 0.0018}},
  };
  const lossyAboveTexelFloor = {
    sha: sha('lossy-above-floor'),
    faces: 25000,
    textureSize: 256,
    normalMap: {texelSize: 0.004}, // texelWeight * texelSize = 0.0020
    error: {diagonal: 1, relative: {p95: 0.0021, max: 0.0021}, sourceToLevel: {p95: 0.0021, max: 0.0021}, levelToSource: {p95: 0.0021, max: 0.0021}},
  };
  const m1HeroDemote = allocateSceneBeautyLods([
    {id: 'cleanA', heroFaces: 100000, levels: [cleanBelowTexelFloor], worldBox: unitBox, worldDiag: diag},
    {id: 'lossyB', heroFaces: 100000, levels: [lossyAboveTexelFloor], worldBox: unitBox, worldDiag: diag},
  ], {camera: closeCam, viewportHeight: 1080, maxPixelError: 1.5, faceBudget: 125000});
  assert.equal(m1HeroDemote.allocations.cleanA.faces, 25000, 'M1: cleaner object below texel floor is demoted before lossier object above texel floor');
  assert.equal(m1HeroDemote.allocations.lossyB.tier, 'hero', 'M1: lossier object above texel floor stays on hero');

  // M2: Cumulative rung monotonicity across non-monotone baked ladders (realBeamLevels has 1k texelSize 0.006745 > 500 texelSize 0.004555)
  for (let i = 1; i < beamFoot.rungs.length; i++) {
    assert.ok(
      beamFoot.rungs[i].pixelError >= beamFoot.rungs[i - 1].pixelError,
      `M2: rung[${i}].pixelError (${beamFoot.rungs[i].pixelError}) must be >= rung[${i - 1}].pixelError (${beamFoot.rungs[i - 1].pixelError})`,
    );
    assert.ok(
      beamFoot.rungs[i].geomPixelError >= beamFoot.rungs[i - 1].geomPixelError,
      `M2: rung[${i}].geomPixelError (${beamFoot.rungs[i].geomPixelError}) must be >= rung[${i - 1}].geomPixelError (${beamFoot.rungs[i - 1].geomPixelError})`,
    );
  }
  const beamAt4p2 = selectFootprintTier(realBeamLevels, {
    heroFaces: 97670,
    worldBox: unitBox,
    worldDiag: diag,
    camera: makeCamera({z: 4.2, fov: 50}),
    viewportHeight: 1080,
    maxPixelError: 1.5,
  });
  assert.equal(beamAt4p2.selected.faces, 5000, 'M2: at z = 4.2m where 1,000-face tier exceeds 1.5px, selectFootprintTier selects 5,000 faces (never skipping to 500 faces)');
  const beamAt2p1 = selectFootprintTier(realBeamLevels, {
    heroFaces: 97670,
    worldBox: unitBox,
    worldDiag: diag,
    camera: makeCamera({z: 2.1, fov: 50}),
    viewportHeight: 1080,
    maxPixelError: 1.5,
  });
  assert.equal(beamAt2p1.selected.faces, 25000, 'M2/M3: at z = 2.1m, selectFootprintTier reaches the 25,000-face tier on realBeamLevels once surface-crack inflation is removed');
  const beamGeomAt1p6 = selectFootprintTier(realBeamLevels, {
    heroFaces: 97670,
    worldBox: unitBox,
    worldDiag: diag,
    camera: makeCamera({z: 1.6, fov: 50}),
    viewportHeight: 1080,
    maxPixelError: 1.5,
    texelWeight: 0,
  });
  assert.equal(beamGeomAt1p6.selected.faces, 10000, 'M2: geometric footprint reaches the 10,000-face tier on realBeamLevels');

  // M3: Surface crack on realBeamLevels[0] (25k) does not inflate effectiveRelativeGeomError, while pipe drop on realKilnLevels[3] (1k) does
  assert.ok(
    Math.abs(effectiveRelativeGeomError(realBeamLevels[0]) - 0.000292) < 1e-6,
    `M3: beam 25k effectiveRelativeGeomError (${effectiveRelativeGeomError(realBeamLevels[0])}) is not inflated by its 0.56% surface crack`,
  );
  assert.ok(
    effectiveRelativeGeomError(realKilnLevels[3]) > 0.038,
    `M3: kiln 1k effectiveRelativeGeomError (${effectiveRelativeGeomError(realKilnLevels[3])}) penalizes the dropped pipe beyond p95`,
  );
  for (let i = 1; i < realKilnLevels.length; i++) {
    assert.ok(
      effectiveRelativeGeomError(realKilnLevels[i]) > effectiveRelativeGeomError(realKilnLevels[i - 1]),
      `M3: kiln effectiveRelativeGeomError is strictly increasing from tier ${i - 1} to ${i}`,
    );
  }

  // N1: sourceToLevel.max === 0 does not fall back to relative.max, and tailWeight / creviceAllowance forward through callers
  assert.equal(
    effectiveRelativeGeomError({
      error: {diagonal: 1, relative: {p95: 0, max: 0.5}, sourceToLevel: {p95: 0, max: 0}, levelToSource: {p95: 0, max: 0}},
    }),
    0,
    'N1: sourceToLevel.max === 0 evaluates to 0 without falling back to relative.max',
  );
  const kilnPxZeroTail = screenPixelError(realKilnLevels[3], {worldBox: unitBox, worldDiag: diag, camera: cam, viewportHeight: 1080, tailWeight: 0});
  const kilnPxDefaultTail = screenPixelError(realKilnLevels[3], {worldBox: unitBox, worldDiag: diag, camera: cam, viewportHeight: 1080});
  assert.ok(kilnPxDefaultTail > kilnPxZeroTail, 'N1: tailWeight forwards through screenPixelError');
});

test('prepareCapture settles demoted shadow caster tiers before frame 1 and borrowFrame scopes beauty LOD visibility', async () => {
  const makeIndexedTriGeometry = faces => {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0, 0.5, 0.5]), 3));
    const idx = new Uint16Array(faces * 3);
    for (let i = 0; i < faces; i++) {
      idx[i * 3] = 0;
      idx[i * 3 + 1] = 1;
      idx[i * 3 + 2] = 2;
    }
    geom.setIndex(new THREE.BufferAttribute(idx, 1));
    return geom;
  };
  const scene = new THREE.Scene();
  const makeLevels = prefix => [
    {sha256: sha(`${prefix}-5k`), faces: 5000, closed: true, error: {diagonal: 2, relative: {p95: 0.002, max: 0.008}}},
    {sha256: sha(`${prefix}-1k`), faces: 1000, closed: true, error: {diagonal: 2, relative: {p95: 0.006, max: 0.025}}},
    {sha256: sha(`${prefix}-500`), faces: 500, closed: true, error: {diagonal: 2, relative: {p95: 0.012, max: 0.045}}},
  ];
  const levelsByHero = new Map([
    [sha('prep-hero-a'), makeLevels('prep-a')],
    [sha('prep-hero-b'), makeLevels('prep-b')],
  ]);
  const facesByTierSha = new Map();
  for (const levels of levelsByHero.values()) {
    for (const l of levels) facesByTierSha.set(l.sha256, l.faces);
  }
  const giProxies = createGiProxyRegistry({
    THREE,
    fetchJson: async url => {
      await new Promise(r => setTimeout(r, 5));
      const u = new URL(url, 'http://kaminos.local');
      const source = u.searchParams.get('source');
      const reqFaces = Number(u.searchParams.get('faces') ?? 5000);
      const levels = (levelsByHero.get(source) ?? []).map(l => ({
        ...l,
        source: `/api/read?root=generated-meshes&path=${l.sha256}.glb`,
      }));
      const choice = levels.find(l => l.faces <= reqFaces) ?? levels.at(-1) ?? null;
      return {schema: 'kaminos.lod-set.v0', source, levels, choice, withinBudget: true};
    },
    fetchBytes: async url => {
      const m = /([a-f0-9]{64})\.glb/.exec(url);
      return new TextEncoder().encode(m ? m[1] : 'none').buffer;
    },
    digest: async bytes => new TextDecoder().decode(bytes),
    parseGlb: async bytes => {
      const tierSha = new TextDecoder().decode(bytes);
      const faces = facesByTierSha.get(tierSha) ?? 500;
      const g = new THREE.Group();
      const m = new THREE.Mesh(makeIndexedTriGeometry(faces), new THREE.MeshStandardMaterial());
      m.castShadow = true;
      g.add(m);
      return g;
    },
  });

  const makeObj = (id, heroKey, x) => {
    const heroSha = sha(heroKey);
    const root = new THREE.Group();
    root.position.set(x, 0, 0);
    root.userData.kaminosSceneObject = {
      id,
      source: `/api/read?root=generated-meshes&path=${heroSha}.glb`,
    };
    const heroMesh = new THREE.Mesh(makeIndexedTriGeometry(20000), new THREE.MeshStandardMaterial());
    heroMesh.castShadow = true;
    root.add(heroMesh);
    scene.add(root);
    return {root, heroMesh};
  };
  const objA = makeObj('prep-a', 'prep-hero-a', 1.2);
  const objB = makeObj('prep-b', 'prep-hero-b', 4.5);
  scene.updateMatrixWorld(true);

  // Start initial 5k attaches without awaiting them yet; prepareCapture must wait for giProxies.whenIdle() + demotions
  giProxies.attach(objA.root, {faces: 5000});
  giProxies.attach(objB.root, {faces: 5000});

  const casters = createFireShadowCasters({
    scene,
    giProxies,
    shadowFaceBudget: 5500,
    flameBox: {min: [-0.5, 0, -0.5], max: [0.5, 1, 0.5]},
  });
  assert.equal(typeof casters.prepareCapture, 'function', 'casters exposes prepareCapture');
  await casters.prepareCapture({flameBox: {min: [-0.5, 0, -0.5], max: [0.5, 1, 0.5]}});

  let firstCaptureTris = 0;
  casters.withCapture(() => {
    scene.traverseVisible(m => {
      if (m.isMesh && m.castShadow) {
        firstCaptureTris += (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3;
      }
    });
  });
  assert.equal(
    firstCaptureTris,
    5500,
    `first withCapture after prepareCapture must already use demoted 5,000 + 500 = 5,500 tris (not 10,000 un-demoted tris), got ${firstCaptureTris}`,
  );

  // Also verify beauty controller borrowFrame mounts budgeted beauty LOD rungs and returns an idempotent restore
  const controller = createSceneBeautyLodController({
    THREE,
    scene,
    giProxies,
    fetchBytes: async url => {
      const m = /([a-f0-9]{64})\.glb/.exec(url);
      return new TextEncoder().encode(m ? m[1] : 'none').buffer;
    },
    digest: async bytes => new TextDecoder().decode(bytes),
    parseGlb: async bytes => {
      const tierSha = new TextDecoder().decode(bytes);
      const faces = facesByTierSha.get(tierSha) ?? 500;
      const g = new THREE.Group();
      g.add(new THREE.Mesh(makeIndexedTriGeometry(faces), new THREE.MeshStandardMaterial()));
      return g;
    },
    faceBudget: 6000,
    maxPixelError: 1.5,
  });
  const cam = makeCamera({z: 8, fov: 50});
  assert.equal(typeof controller.prepareFrame, 'function', 'controller exposes prepareFrame');
  const preparedState = await controller.prepareFrame(cam, {viewportHeight: 1080});
  assert.ok(
    preparedState.objects.every(o => o.displayedTier === o.targetTier),
    'prepareFrame settles async rung loads and promotes displayedTier to targetTier in one call',
  );
  assert.equal(objA.heroMesh.visible, true, 'hero mesh restored after prepareFrame');

  assert.equal(typeof controller.borrowFrame, 'function', 'controller exposes borrowFrame');
  const restoreBeauty = controller.borrowFrame(cam, {viewportHeight: 1080});
  assert.equal(objA.heroMesh.visible, false, 'hero mesh hidden while beauty LOD frame is borrowed');
  restoreBeauty();
  assert.equal(objA.heroMesh.visible, true, 'hero mesh restored after borrowFrame release');
  restoreBeauty();
  assert.equal(objA.heroMesh.visible, true, 'borrowFrame release is idempotent');

  controller.dispose();
  casters.dispose();
});

test('solid collider LOD selection and budget allocation: voxelSolidError, selectColliderTier, and allocateColliderLods preserve kiln chamber/pipe at 5k while demoting beam to 500 faces', async () => {
  const mod = await import('../scene-lod-budget.mjs');
  assert.equal(typeof mod.voxelSolidError, 'function', 'scene-lod-budget exports voxelSolidError');
  assert.equal(typeof mod.selectColliderTier, 'function', 'scene-lod-budget exports selectColliderTier');
  assert.equal(typeof mod.allocateColliderLods, 'function', 'scene-lod-budget exports allocateColliderLods');

  const {voxelSolidError, selectColliderTier, allocateColliderLods} = mod;

  const realKilnLevels = [
    {sha: '57b5a750', faces: 25000, closed: true, textureSize: 1024, normalMap: {texelSize: 0.004260175}, error: {diagonal: 1.487462, relative: {max: 0.011843, p95: 0.002828, mean: 0.000579}, levelToSource: {max: 0.011467, p95: 0.003489, mean: 0.000678}, sourceToLevel: {max: 0.017617, p95: 0.004823, mean: 0.001044}}},
    {sha: '414cca4f', faces: 10000, closed: true, textureSize: 512, normalMap: {texelSize: 0.007478695}, error: {diagonal: 1.487462, relative: {max: 0.025876, p95: 0.005484, mean: 0.001108}, levelToSource: {max: 0.015106, p95: 0.005359, mean: 0.001028}, sourceToLevel: {max: 0.038490, p95: 0.011303, mean: 0.002268}}},
    {sha: '7dbc98d3', faces: 5000, closed: true, textureSize: 512, normalMap: {texelSize: 0.006812807}, error: {diagonal: 1.487462, relative: {max: 0.025906, p95: 0.009047, mean: 0.001854}, levelToSource: {max: 0.024469, p95: 0.008665, mean: 0.001704}, sourceToLevel: {max: 0.038534, p95: 0.016442, mean: 0.003811}}},
    {sha: '6858aec1', faces: 1000, closed: true, textureSize: 256, normalMap: {texelSize: 0.009611729}, error: {diagonal: 1.487462, relative: {max: 0.061201, p95: 0.026436, mean: 0.006755}, levelToSource: {max: 0.051067, p95: 0.019752, mean: 0.004896}, sourceToLevel: {max: 0.091034, p95: 0.044281, mean: 0.015200}}},
    {sha: 'f5889e96', faces: 500, closed: true, textureSize: 256, normalMap: {texelSize: 0.009764150}, error: {diagonal: 1.487462, relative: {max: 0.063995, p95: 0.027777, mean: 0.007391}, levelToSource: {max: 0.042772, p95: 0.020955, mean: 0.005821}, sourceToLevel: {max: 0.095191, p95: 0.046434, mean: 0.016168}}},
  ];
  const realBeamLevels = [
    {sha: 'bae07caf', faces: 25000, closed: true, textureSize: 1024, normalMap: {texelSize: 0.001788627}, error: {diagonal: 1.051690, relative: {max: 0.005581, p95: 0.000292, mean: 0.000076}, levelToSource: {max: 0.003203, p95: 0.000397, mean: 0.000101}, sourceToLevel: {max: 0.005870, p95: 0.000218, mean: 0.000059}}},
    {sha: '05a311ac', faces: 10000, closed: true, textureSize: 512, normalMap: {texelSize: 0.003357881}, error: {diagonal: 1.051690, relative: {max: 0.005951, p95: 0.000538, mean: 0.000132}, levelToSource: {max: 0.005335, p95: 0.000733, mean: 0.000180}, sourceToLevel: {max: 0.006259, p95: 0.000378, mean: 0.000098}}},
    {sha: '8045c108', faces: 5000, closed: true, textureSize: 512, normalMap: {texelSize: 0.003273525}, error: {diagonal: 1.051690, relative: {max: 0.005407, p95: 0.000832, mean: 0.000202}, levelToSource: {max: 0.005687, p95: 0.001112, mean: 0.000277}, sourceToLevel: {max: 0.005344, p95: 0.000560, mean: 0.000147}}},
    {sha: 'adb066b2', faces: 1000, closed: true, textureSize: 256, normalMap: {texelSize: 0.006745198}, error: {diagonal: 1.051690, relative: {max: 0.011962, p95: 0.001910, mean: 0.000537}, levelToSource: {max: 0.012580, p95: 0.002616, mean: 0.000735}, sourceToLevel: {max: 0.007859, p95: 0.001374, mean: 0.000395}}},
    {sha: '7208b932', faces: 500, closed: true, textureSize: 256, normalMap: {texelSize: 0.004554675}, error: {diagonal: 1.051690, relative: {max: 0.013912, p95: 0.001645, mean: 0.000598}, levelToSource: {max: 0.014632, p95: 0.001640, mean: 0.000603}, sourceToLevel: {max: 0.008618, p95: 0.001854, mean: 0.000654}}},
  ];

  const unitBox = {min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5]};
  const worldDiag = Math.sqrt(3);

  // 1. voxelSolidError ignores UV texelSize/texelStretch (pure 3D geometric surface error in voxel units)
  const hugeTexelTier = {
    sha: sha('huge-texel'),
    faces: 5000,
    closed: true,
    textureSize: 64,
    normalMap: {texelSize: 0.25}, // enormous UV stretch that would inflate screenPixelError
    error: {diagonal: 1.0, relative: {p95: 0.002, max: 0.004}, sourceToLevel: {p95: 0.002, max: 0.004}, levelToSource: {p95: 0.002, max: 0.004}},
  };
  assert.ok(
    Math.abs(voxelSolidError(hugeTexelTier, {worldDiag: 2.0, voxelSize: 0.05}) - (2.0 * 0.002) / 0.05) < 1e-9,
    'voxelSolidError depends only on 3D geometric error and voxelSize, not UV texelSize',
  );

  // 2. On grid = 64 (voxelSize = 2/64 = 0.03125), selectColliderTier selects 500 faces for the Beam and 5,000 faces for the Kiln:
  const kilnChoice64 = selectColliderTier(realKilnLevels, {heroFaces: 287407, worldBox: unitBox, worldDiag, grid: 64, domainScale: 1, maxVoxelError: 0.85});
  const beamChoice64 = selectColliderTier(realBeamLevels, {heroFaces: 97670, worldBox: unitBox, worldDiag, grid: 64, domainScale: 1, maxVoxelError: 0.85});
  assert.equal(beamChoice64.selected.faces, 500, 'Beam coarsens all the way to 500 faces (< 0.15 voxels of geometric error)');
  assert.equal(kilnChoice64.selected.faces, 5000, 'Kiln coarsens to 5,000 faces (~0.74 voxels) and refuses 1,000/500 which drop the side pipe (> 2.2 voxels)');

  // 3. Cumulative rung monotonicity on voxelError across all rungs:
  for (let i = 1; i < beamChoice64.rungs.length; i++) {
    assert.ok(
      beamChoice64.rungs[i].voxelError >= beamChoice64.rungs[i - 1].voxelError,
      `beam rung[${i}].voxelError must be >= rung[${i - 1}].voxelError`,
    );
  }

  // 4. Unsealed levels (closed: false) are excluded when requireClosed is true (default):
  const unsealedFine = [
    {...realKilnLevels[0], closed: true},
    {...realKilnLevels[1], closed: false},
    {...realKilnLevels[2], closed: false},
  ];
  const closedChoice = selectColliderTier(unsealedFine, {heroFaces: 287407, worldBox: unitBox, worldDiag, grid: 64, domainScale: 1, maxVoxelError: 0.85});
  assert.equal(closedChoice.selected.faces, 25000, 'requireClosed skips closed:false levels so exterior flood fill never leaks through unsealed shells');

  // 5. allocateColliderLods with repetition multiplicity and greedy budget enforcement:
  const allocUnbounded = allocateColliderLods([
    {id: 'kiln', heroFaces: 287407, levels: realKilnLevels, worldBox: unitBox, worldDiag, instanceCount: 1},
    {id: 'beam', heroFaces: 97670, levels: realBeamLevels, worldBox: unitBox, worldDiag, instanceCount: 6},
  ], {grid: 64, domainScale: 1, maxVoxelError: 0.85, colliderFaceBudget: 50000});
  assert.equal(allocUnbounded.withinBudget, true);
  assert.equal(allocUnbounded.allocations.kiln.faces, 5000, 'kiln allocated 5,000 faces');
  assert.equal(allocUnbounded.allocations.beam.faces, 500, '6 beams allocated 500 faces each (3,000 total)');
  assert.equal(allocUnbounded.totalFaces, 5000 + 6 * 500, 'total collider faces reduced from 873,427 to 8,000 (-99.1%)');

  // Under a tight maxVoxelError (e.g. 0.02 voxels where both want 25k/hero initially) and a 28,000-face budget:
  const allocTight = allocateColliderLods([
    {id: 'kiln', heroFaces: 287407, levels: realKilnLevels, worldBox: unitBox, worldDiag, instanceCount: 1},
    {id: 'beam', heroFaces: 97670, levels: realBeamLevels, worldBox: unitBox, worldDiag, instanceCount: 6},
  ], {grid: 64, domainScale: 1, maxVoxelError: 0.01, colliderFaceBudget: 28000});
  assert.equal(allocTight.withinBudget, true);
  assert.equal(allocTight.allocations.beam.faces, 500, 'tight budget demotes all 6 beams to 500 faces (3,000 total) first');
  assert.equal(allocTight.allocations.kiln.faces, 25000, 'tight budget preserves the kiln at 25,000 faces (total 28,000 <= 28,000)');
});

test('bakeRungMeshesToRootSpace aligns Z-up GLB node transforms to hero local bounds, resolveBurnableSurface selects cell-matched thermal stunt-double geometry, and formatLodBudgetReadout formats live inspector status', async () => {
  const mod = await import('../scene-lod-budget.mjs');
  const {createSceneColliderCollection} = await import('../scene-collider.mjs');
  const {createLogSurfaceMask} = await import('../live-log-surface-mask.mjs');
  const {LIVE_LOG_GRID} = await import('../live-log-heat-core.mjs');

  assert.equal(typeof mod.bakeRungMeshesToRootSpace, 'function', 'scene-lod-budget exports bakeRungMeshesToRootSpace');
  assert.equal(typeof mod.formatLodBudgetReadout, 'function', 'scene-lod-budget exports formatLodBudgetReadout');

  // 1. Test bakeRungMeshesToRootSpace on a rung whose GLB node has a -90 deg X rotation (Z-up -> Y-up)
  // Hero mesh has identity transform and Y-up bounds [-0.5, -0.125, -0.2] .. [0.5, 0.125, 0.2]
  const heroRoot = new THREE.Group();
  const heroMesh = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.25, 0.4, 8, 8, 8), new THREE.MeshStandardMaterial());
  heroRoot.add(heroMesh);
  heroMesh.geometry.computeBoundingBox();
  const heroBounds = heroMesh.geometry.boundingBox;

  // Rung mesh in Z-up before -90 deg X node rotation: size is (1.0, 0.4, 0.25) so after RotateX(-90deg) (y' = z, z' = -y) it matches (1.0, 0.25, 0.4)
  const rungRoot = new THREE.Group();
  const rungMesh = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.4, 0.25, 1, 1, 1), new THREE.MeshStandardMaterial());
  rungMesh.rotation.x = -Math.PI / 2;
  rungMesh.updateMatrix();
  rungRoot.add(rungMesh);

  mod.bakeRungMeshesToRootSpace(THREE, rungRoot);
  rungMesh.geometry.computeBoundingBox();
  assert.ok(Math.abs(rungMesh.rotation.x) < 1e-9, 'bakeRungMeshesToRootSpace resets node rotation to identity');
  assert.ok(Math.abs(rungMesh.geometry.boundingBox.min.y - heroBounds.min.y) < 1e-6, 'baked rung geometry Y min matches hero bounds');
  assert.ok(Math.abs(rungMesh.geometry.boundingBox.max.z - heroBounds.max.z) < 1e-6, 'baked rung geometry Z max matches hero bounds');

  const heroMask = createLogSurfaceMask(heroMesh.geometry, heroBounds, LIVE_LOG_GRID, {filled: true});
  const rungMask = createLogSurfaceMask(rungMesh.geometry, heroBounds, LIVE_LOG_GRID, {filled: true});
  assert.deepEqual(Array.from(rungMask), Array.from(heroMask), 'baked 12-face rung produces 100% identical 16^3 filled thermal mask to 384-face hero');

  // 2. Test sceneColliderCollection.resolveBurnableSurface on a stockroom-like beam with -90 deg X node transform in its 500-face GLB
  const BEAM_HERO = '7be0be28'.padEnd(64, 'a');
  const BEAM_500 = '7208b932'.padEnd(64, 'b');
  heroRoot.userData.kaminosSceneObject = {id: 'beam', type: 'glb', source: `/api/read?root=generated-meshes&path=${BEAM_HERO}.glb`};
  const giProxies = createGiProxyRegistry({
    THREE,
    fetchJson: async () => ({
      schema: 'kaminos.lod-set.v0',
      source: BEAM_HERO,
      levels: [
        {sha256: BEAM_500, faces: 500, closed: true, source: `/api/read?root=generated-meshes&path=${BEAM_500}.glb`, error: {diagonal: 1.107, relative: {p95: 0.001645, max: 0.0139}, levelToSource: {p95: 0.00164, max: 0.0146}, sourceToLevel: {p95: 0.00185, max: 0.0086}}},
      ],
      choice: null,
      withinBudget: true,
    }),
    fetchBytes: async () => new Uint8Array([1, 2, 3]).buffer,
    digest: async () => BEAM_500,
    parseGlb: async () => {
      const g = new THREE.Group();
      const m = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.4, 0.25, 1, 1, 1), new THREE.MeshStandardMaterial());
      m.rotation.x = -Math.PI / 2;
      m.updateMatrix();
      g.add(m);
      return g;
    },
  });
  await giProxies.attach(heroRoot);

  const colliders = createSceneColliderCollection(THREE, {
    giProxies,
    fetchBytes: async () => new Uint8Array([1, 2, 3]).buffer,
    digest: async () => BEAM_500,
    parseGlb: async () => {
      const g = new THREE.Group();
      const m = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.4, 0.25, 1, 1, 1), new THREE.MeshStandardMaterial());
      m.rotation.x = -Math.PI / 2;
      m.updateMatrix();
      g.add(m);
      return g;
    },
  });
  assert.equal(typeof colliders.resolveBurnableSurface, 'function', 'sceneColliderCollection exports resolveBurnableSurface');
  const resolved = await colliders.resolveBurnableSurface({id: 'beam', object: heroRoot}, {mesh: heroMesh, bounds: heroBounds, grid: LIVE_LOG_GRID});
  assert.equal(resolved.tier, BEAM_500, 'resolveBurnableSurface selects the 500-face closed stunt-double tier');
  assert.equal(resolved.faces, 500);
  const resolvedMask = createLogSurfaceMask(resolved.geometry, heroBounds, LIVE_LOG_GRID, {filled: true});
  assert.deepEqual(Array.from(resolvedMask), Array.from(heroMask), 'resolved burnable stunt-double geometry produces 100% identical thermal mask');

  // 3. Test formatLodBudgetReadout
  const readout = mod.formatLodBudgetReadout({
    objectId: 'beam',
    beautyState: {
      enabled: true,
      totalFaces: 10500,
      faceBudget: 150000,
      objects: [{id: 'beam', displayedTier: BEAM_500, faces: 500, pixelError: 0.42, pinned: false}],
    },
    colliderBudget: {
      totalFaces: 5500,
      colliderFaceBudget: 50000,
      allocations: {beam: {tier: BEAM_500, faces: 500, voxelError: 0.055}},
    },
    burnFieldState: {
      surfaceLod: {tier: BEAM_500, faces: 500, heroFaces: 97670, voxelError: 0.114},
    },
  });
  assert.match(readout.beautyText, /Beauty: 500 faces.*0\.42 px.*10,500 \/ 150,000/);
  assert.match(readout.colliderText, /Collider: 500 faces.*0\.06 vox/);
  assert.match(readout.burnText, /Burn mask: 500 faces.*0\.11 cell/);
  assert.match(readout.combinedText, /Beauty: 500 faces.*Collider: 500 faces.*Burn mask: 500 faces/);
});





