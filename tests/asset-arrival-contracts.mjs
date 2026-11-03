import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from '../lib/three.core.js';
import * as assetArrival from '../asset-arrival.mjs';
import {
  ASSET_ARRIVAL_TARGET_DIAGONAL,
  assetArrivalViewDirection,
  assetArrivalFramingWindow,
  computeAssetArrivalFraming,
  computeAssetArrivalPlacement,
  inspectArrivalMaterialProfile,
  planArrivalStudioLights,
  resolveAssetArrivalMode,
} from '../asset-arrival.mjs';
import { orbitCamera } from '../scene-navigation.mjs';
import { checkedSceneLightRecord } from '../scene-spot-light.mjs';

const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: ${actual} != ${expected}`);

function placedWorldBox(object) {
  object.updateWorldMatrix(true, true);
  return new THREE.Box3().setFromObject(object, true);
}

function offCenterAsset({ rotationY = 0 } = {}) {
  // Authored far from the origin in centimetres, like a raw DCC export.
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(40, 120, 60));
  mesh.position.set(300, 80, -150);
  const root = new THREE.Group();
  root.add(mesh);
  root.rotation.y = rotationY;
  return root;
}

function arrive(root, options) {
  const box = placedWorldBox(root);
  const placement = computeAssetArrivalPlacement({
    bounds: { min: box.min.toArray(), max: box.max.toArray() },
    rootPosition: root.position.toArray(),
    ...options,
  });
  root.scale.multiplyScalar(placement.scale);
  root.position.fromArray(placement.position);
  return placement;
}

test('an off-center asset rests on the ground at the anchor with the shared size', () => {
  for (const rotationY of [0, 0.7]) {
    const root = offCenterAsset({ rotationY });
    const placement = arrive(root, { groundY: -0.85, anchor: [1.5, -2] });
    const box = placedWorldBox(root);
    close(box.min.y, -0.85, 'bottom on ground');
    close((box.min.x + box.max.x) / 2, 1.5, 'center x at anchor');
    close((box.min.z + box.max.z) / 2, -2, 'center z at anchor');
    close(box.getSize(new THREE.Vector3()).length(), ASSET_ARRIVAL_TARGET_DIAGONAL, 'diagonal');
    for (const axis of [0, 1, 2]) {
      close(placement.bounds.min[axis], box.min.getComponent(axis), 'predicted min');
      close(placement.bounds.max[axis], box.max.getComponent(axis), 'predicted max');
    }
  }
});

test('degenerate bounds do not place', () => {
  assert.equal(computeAssetArrivalPlacement({ bounds: { min: [1, 1, 1], max: [1, 1, 1] } }), null);
  assert.equal(computeAssetArrivalPlacement({ bounds: { min: [Infinity, 0, 0], max: [-Infinity, 0, 0] } }), null);
});

test('arrival mode follows clearing, and reopen-style raw loads have none', () => {
  assert.equal(resolveAssetArrivalMode({ cleared: true }), 'fresh');
  assert.equal(resolveAssetArrivalMode({ cleared: false }), 'append');
  assert.equal(resolveAssetArrivalMode({ cleared: true, normalize: false }), null);
  assert.equal(resolveAssetArrivalMode({ cleared: false, normalize: false, arrival: 'append' }), 'append');
  assert.equal(resolveAssetArrivalMode({ cleared: true, arrival: false }), null);
});

test('arrival view looks down at the asset from the front-right', () => {
  const [x, y, z] = assetArrivalViewDirection();
  close(Math.hypot(x, y, z), 1, 'unit direction');
  assert.ok(x > 0 && y > 0 && z > x, 'front-biased elevated three-quarter view');
});

test('arrival framing fits the asset points tightly inside an off-centre window', () => {
  // An L-shaped cloud: its box is much larger than its silhouette.
  const points = [];
  for (let i = 0; i <= 20; i++) { points.push(-0.4 + 0.04 * i, -0.85, 0.4); points.push(-0.4, -0.85 + 0.08 * i, -0.4); points.push(0.4, -0.85, -0.4 + 0.04 * i); }
  for (const aspect of [0.6, 1.4, 2.2]) {
    const window = assetArrivalFramingWindow({ overlayTopNdc: 0.73 });
    const framing = computeAssetArrivalFraming({ points, fovDeg: 40, aspect, window });
    const camera = new THREE.PerspectiveCamera(40, aspect, framing.near, framing.far);
    camera.position.fromArray(framing.position);
    camera.lookAt(new THREE.Vector3().fromArray(framing.target));
    camera.updateMatrixWorld();
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < points.length; i += 3) {
      const ndc = new THREE.Vector3(points[i], points[i + 1], points[i + 2]).project(camera);
      assert.ok(ndc.z > -1 && ndc.z < 1, 'point inside clip depth');
      x0 = Math.min(x0, ndc.x); x1 = Math.max(x1, ndc.x); y0 = Math.min(y0, ndc.y); y1 = Math.max(y1, ndc.y);
    }
    const eps = 1e-9;
    assert.ok(x0 >= window.left - eps && x1 <= window.right + eps && y0 >= window.bottom - eps && y1 <= window.top + eps, `outside window at aspect ${aspect}: ${[x0, x1, y0, y1]}`);
    const xTight = Math.abs(x0 - window.left) < 1e-6 && Math.abs(x1 - window.right) < 1e-6;
    const yTight = Math.abs(y0 - window.bottom) < 1e-6 && Math.abs(y1 - window.top) < 1e-6;
    assert.ok(xTight || yTight, `fit is not tight at aspect ${aspect}: ${[x0, x1, y0, y1]}`);
    // The slack axis is centred in the linear fit, which perspective skews slightly.
    assert.ok(Math.abs((x0 + x1) / 2 - (window.left + window.right) / 2) < 0.02, `horizontally centred at aspect ${aspect}`);
    assert.ok(Math.abs((y0 + y1) / 2 - (window.bottom + window.top) / 2) < 0.02, `vertically centred at aspect ${aspect}`);
  }
});

test('arrival window clears an overlay at the top of the viewport', () => {
  assert.deepEqual(assetArrivalFramingWindow({ overlayTopNdc: 1 }), { left: -0.62, right: 0.62, bottom: -0.62, top: 0.62 });
  assert.equal(assetArrivalFramingWindow({ overlayTopNdc: 0.5 }).top, 0.45);
});

test('arrival material profile classifies dark-metallic, specular-metallic, bright-matte, and balanced assets', () => {
  const darkMetal = inspectArrivalMaterialProfile([{ color: [0.08, 0.09, 0.1], roughness: 0.35, metalness: 0.85, weight: 10 }]);
  assert.equal(darkMetal.kind, 'dark-metallic');
  const brightMatte = inspectArrivalMaterialProfile([{ color: [0.82, 0.8, 0.76], roughness: 0.82, metalness: 0.0, weight: 10 }]);
  assert.equal(brightMatte.kind, 'bright-matte');
  const specMetal = inspectArrivalMaterialProfile([{ color: [0.55, 0.56, 0.58], roughness: 0.25, metalness: 0.8, weight: 10 }]);
  assert.equal(specMetal.kind, 'specular-metallic');
  const balanced = inspectArrivalMaterialProfile([{ color: [0.42, 0.38, 0.34], roughness: 0.55, metalness: 0.05, weight: 10 }]);
  assert.equal(balanced.kind, 'balanced');
});

test('arrival studio light rig plans warm key and cool rim spot records and applies optional material tuning', () => {
  const bounds = { min: [-0.6, -0.85, -0.5], max: [0.6, 0.55, 0.5] };
  const darkMetal = inspectArrivalMaterialProfile([{ color: [0.08, 0.09, 0.1], roughness: 0.35, metalness: 0.85, weight: 10 }]);
  const brightMatte = inspectArrivalMaterialProfile([{ color: [0.82, 0.8, 0.76], roughness: 0.82, metalness: 0.0, weight: 10 }]);

  const untunedDark = planArrivalStudioLights({ bounds, groundY: -0.85, materialProfile: darkMetal, materialTuning: false });
  const untunedBright = planArrivalStudioLights({ bounds, groundY: -0.85, materialProfile: brightMatte, materialTuning: false });
  assert.equal(untunedDark.lights.length, 2);
  for (const record of untunedDark.lights) {
    const checked = checkedSceneLightRecord(record);
    assert.equal(checked.id, record.id);
    const dir = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(...record.transform.rotation));
    const aimed = new THREE.Vector3(...record.transform.position).addScaledVector(dir, record.light.aimDistance);
    for (let axis = 0; axis < 3; axis++) {
      assert.ok(Math.abs(aimed.getComponent(axis) - untunedDark.target[axis]) < 1e-2, `light ${record.id} aims at target axis ${axis}`);
    }
  }
  assert.deepEqual(
    untunedDark.lights.map(l => l.light.intensity),
    untunedBright.lights.map(l => l.light.intensity),
    'optional material tuning is inactive when materialTuning is false',
  );

  const tunedDark = planArrivalStudioLights({ bounds, groundY: -0.85, materialProfile: darkMetal, materialTuning: true });
  const tunedBright = planArrivalStudioLights({ bounds, groundY: -0.85, materialProfile: brightMatte, materialTuning: true });
  const darkRim = tunedDark.lights.find(l => l.id === '@studio-rim-light').light.intensity;
  const baseRim = untunedDark.lights.find(l => l.id === '@studio-rim-light').light.intensity;
  const brightKey = tunedBright.lights.find(l => l.id === '@studio-key-light').light.intensity;
  const baseKey = untunedBright.lights.find(l => l.id === '@studio-key-light').light.intensity;
  assert.ok(darkRim > baseRim, `dark-metallic tuning boosts rim grazing light (${darkRim} > ${baseRim})`);
  assert.ok(brightKey < baseKey, `bright-matte tuning trims key light to prevent washout (${brightKey} < ${baseKey})`);
  assert.ok(tunedDark.environmentDelta.exposureScale > 1 && tunedBright.environmentDelta.exposureScale < 1);
});

test('startup studio light lifecycle yields on scene spot lights, preserves promoted light edits, and records undo history', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const syncStart = html.indexOf('function syncArrivalStudioLighting(');
  const syncEnd = html.indexOf('function autoCalibrateSceneGIFromScene(', syncStart);
  const syncBody = html.slice(syncStart, syncEnd);
  assert.ok(
    !syncBody.includes('mountSceneSpotLight(record)'),
    'syncArrivalStudioLighting must not overwrite promoted @studio-key-light / @studio-rim-light records in workingScene.objects',
  );
  assert.match(
    syncBody,
    /sceneLightingPreparation\?\.request\(\)/,
    'syncArrivalStudioLighting must request sceneLightingPreparation when stage light visibility changes',
  );
  const mountStart = html.indexOf('function mountSceneSpotLight(raw)');
  const mountEnd = html.indexOf('function disposeSceneSpotLight(id)', mountStart);
  assert.match(
    html.slice(mountStart, mountEnd),
    /syncArrivalStudioLighting\(\)/,
    'mountSceneSpotLight must sync arrival studio lighting so stage lights yield immediately when any scene spot light is added',
  );
  const disposeEnd = html.indexOf('function groupPivotPose(', mountEnd);
  assert.match(
    html.slice(mountEnd, disposeEnd),
    /syncArrivalStudioLighting\(\)/,
    'disposeSceneSpotLight must sync arrival studio lighting when a scene spot light is removed',
  );
  const promoteStart = html.indexOf('function promoteArrivalStudioLightsToScene(');
  const promoteEnd = html.indexOf('function readSceneGIControls()', promoteStart);
  const promoteBody = html.slice(promoteStart, promoteEnd);
  assert.match(
    promoteBody,
    /recordSceneObjectInsertion\(/,
    'promoteArrivalStudioLightsToScene must record scene object insertion for undo/redo history and dirty state',
  );
});

test('fresh asset arrival framing resets tilted orbit camera.up so the horizon never rolls', () => {
  const camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.01, 100);
  camera.position.set(0, 0.6, 3);
  const target = new THREE.Vector3(0, 0, 0);
  camera.lookAt(target);
  for (let i = 0; i < 20; i++) {
    orbitCamera(camera, target, target, -0.08, 0.04);
    camera.lookAt(target);
  }
  assert.ok(Math.abs(camera.up.x) > 0.3, 'precondition: orbitCamera tilts camera.up in the previous azimuth plane');

  const points = [-0.5, -0.85, -0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, -0.85, -0.5];
  const framing = computeAssetArrivalFraming({ points, fovDeg: 40, aspect: 16 / 9 });
  assert.deepEqual(framing.up, [0, 1, 0], 'computeAssetArrivalFraming must return upright camera up vector');

  camera.position.fromArray(framing.position);
  target.fromArray(framing.target);
  camera.up.fromArray(framing.up);
  camera.lookAt(target);
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  close(right.y, 0, 'camera right axis must stay level with the horizon after fresh arrival framing');

  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const frameStart = html.indexOf('function frameAssetArrival(object)');
  const frameEnd = html.indexOf('async function showGLB(', frameStart);
  assert.match(
    html.slice(frameStart, frameEnd),
    /camera\.up\.fromArray\(framing\.up\)/,
    'frameAssetArrival must restore camera.up from framing.up before controls.update()',
  );
});

test('studio look library defines curated looks and arrival rig materializes as a grouped Kaminos object with one-click drag and saved-scene differentiation', () => {
  assert.equal(assetArrival.DEFAULT_STUDIO_LOOK_ID, 'sculptural-studio');
  for (const id of ['sculptural-studio', 'obsidian-stage', 'warm-gallery', 'technical-daylight']) {
    const look = assetArrival.resolveStudioLook(id);
    assert.equal(look.id, id);
    assert.ok(['studio', 'sunset', 'warehouse', 'courtyard'].includes(look.environment.name), `valid HDR_ENVS name for ${id}`);
    const plan = planArrivalStudioLights({ bounds: { min: [-0.6, -0.85, -0.5], max: [0.6, 0.55, 0.5] }, groundY: -0.85, lookId: id });
    assert.equal(plan.lookId, id);
    assert.equal(plan.lights[0].light.color, look.keyLight.color);
    assert.equal(plan.lights[1].light.color, look.rimLight.color);
  }

  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const promoteStart = html.indexOf('function promoteArrivalStudioLightsToScene(');
  const promoteEnd = html.indexOf('function readSceneGIControls()', promoteStart);
  const promoteBody = html.slice(promoteStart, promoteEnd);
  assert.match(
    promoteBody,
    /@studio-light-rig/,
    'promoteArrivalStudioLightsToScene must group promoted studio lights into the @studio-light-rig Kaminos scene group',
  );
  assert.match(
    promoteBody,
    /scenePlacementTools\?\.start\(dragOp\)/,
    'grabArrivalStudioRig / promoteArrivalStudioLightsToScene must support one-click interactive drag via scenePlacementTools.start',
  );
  assert.ok(
    !promoteBody.includes("startDrag === 'move' ? 'move'") && promoteBody.includes("const dragOp = startDrag === 'move' ? 'translate' : startDrag;"),
    'promoteArrivalStudioLightsToScene must normalize move to translate so scenePlacementTools.start receives a valid transformPose operation',
  );
  const outlinerStart = html.indexOf('data-arrival-studio-rig="true"');
  const outlinerRow = html.slice(outlinerStart - 120, outlinerStart + 650);
  assert.match(
    outlinerRow,
    /data-arrival-rig-action="translate"/,
    'Outliner Grab button must pass translate action to grabArrivalStudioRig',
  );
  const mountStart = html.indexOf('function mountSceneSpotLight(raw)');
  const mountEnd = html.indexOf('function groupPivotPose(', mountStart);
  assert.match(
    html.slice(mountStart, mountEnd),
    /reusedStudioLight/,
    'mountSceneSpotLight must reuse studioKeyLight and studioRimLight when promoting @studio-key-light and @studio-rim-light so promotion causes zero shader recompilation',
  );

  const applyDocStart = html.indexOf('async function applySceneDocument(');
  const applyDocEnd = html.indexOf('// File input handler for Load Scene', applyDocStart);
  assert.match(
    html.slice(applyDocStart, applyDocEnd),
    /arrivalLightingState\.sceneKind\s*=\s*['"]authored-scene['"]/,
    'applySceneDocument must mark saved scenes with objects as authored-scene so unauthored stage studio lights are not injected',
  );
});

test('arrived mesh materials get 16x anisotropic texture filtering and reversible surface micro-roughness polish', () => {
  assert.equal(typeof assetArrival.prepareArrivedMeshMaterials, 'function', 'prepareArrivedMeshMaterials must be exported');
  const mapTex = { isTexture: true, anisotropy: 1, needsUpdate: false };
  const normalTex = { isTexture: true, anisotropy: 1, needsUpdate: false };
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x22262c, roughness: 0.6, metalness: 0.85 }),
  );
  mesh.material.map = mapTex;
  mesh.material.normalMap = normalTex;
  mesh.material.envMapIntensity = 1.0;
  const root = new THREE.Group();
  root.add(mesh);

  const darkProfile = inspectArrivalMaterialProfile([{ color: [0.08, 0.09, 0.1], roughness: 0.6, metalness: 0.85, weight: 10 }]);
  const polished = assetArrival.prepareArrivedMeshMaterials(root, {
    maxAnisotropy: 16,
    materialTuning: true,
    materialProfile: darkProfile,
  });
  assert.equal(mapTex.anisotropy, 16, 'albedo map must be upgraded to 16x anisotropic filtering');
  assert.equal(normalTex.anisotropy, 16, 'normal map must be upgraded to 16x anisotropic filtering');
  assert.ok(polished.texturesUpdated >= 2, 'prepareArrivedMeshMaterials reports updated textures');
  assert.ok(mesh.material.roughness < 0.6, `dark-metallic surface polish tightens flat scalar roughness (${mesh.material.roughness} < 0.6)`);
  assert.ok(mesh.material.envMapIntensity > 1.0, `dark-metallic surface polish lifts envMapIntensity (${mesh.material.envMapIntensity} > 1.0)`);

  assetArrival.prepareArrivedMeshMaterials(root, {
    maxAnisotropy: 16,
    materialTuning: false,
    materialProfile: darkProfile,
  });
  close(mesh.material.roughness, 0.6, 'disabling materialTuning restores original scalar roughness');
  close(mesh.material.envMapIntensity, 1.0, 'disabling materialTuning restores original envMapIntensity');
  assert.equal(mapTex.anisotropy, 16, '16x anisotropic texture filtering remains active when materialTuning is toggled off');

  // Verify authored envMapIntensity (e.g. 0.5) scales with baseEnvMapIntensity without double-scaling
  const authoredMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.8, envMapIntensity: 0.5 }),
  );
  assetArrival.prepareArrivedMeshMaterials(authoredMesh, {
    maxAnisotropy: 16,
    materialTuning: false,
    baseEnvMapIntensity: 2.0,
  });
  close(authoredMesh.material.envMapIntensity, 1.0, 'untuned material scales authored envMapIntensity (0.5) by baseEnvMapIntensity (2.0)');
  assetArrival.prepareArrivedMeshMaterials(authoredMesh, {
    maxAnisotropy: 16,
    materialTuning: true,
    materialProfile: darkProfile,
    baseEnvMapIntensity: 2.0,
  });
  close(authoredMesh.material.envMapIntensity, 1.15, 'tuned dark-metallic material scales baseEnv (1.0) by 1.15 once');
});

test('studio look library includes opticalFinish, supports ?look= deep link, exposes viewport look pill, and records atomic undo/redo snapshots', () => {
  assert.equal(typeof assetArrival.resolveStudioLookFromSearch, 'function', 'resolveStudioLookFromSearch must be exported');
  assert.equal(assetArrival.resolveStudioLookFromSearch('?glb=kiln.glb&look=obsidian-stage'), 'obsidian-stage');
  assert.equal(assetArrival.resolveStudioLookFromSearch('?glb=kiln.glb&look=unknown-look'), null);
  assert.equal(assetArrival.resolveStudioLookFromSearch('?glb=kiln.glb'), null);

  const sculptural = assetArrival.resolveStudioLook('sculptural-studio');
  const obsidian = assetArrival.resolveStudioLook('obsidian-stage');
  assert.ok(sculptural.opticalFinish && obsidian.opticalFinish, 'looks define opticalFinish');
  assert.ok(
    obsidian.opticalFinish.floorReflection > sculptural.opticalFinish.floorReflection,
    'obsidian-stage has stronger floor contact reflection than sculptural-studio',
  );
  assert.ok(
    obsidian.opticalFinish.glintStrength > 0 && sculptural.opticalFinish.glintStrength > 0,
    'studio looks define positive high-threshold specular glint strength',
  );

  const workspaceSource = readFileSync(new URL('../authoring-workspace.mjs', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.ok(
    workspaceSource.includes('id="viewport-studio-look-pill"') || html.includes('id="viewport-studio-look-pill"'),
    'viewport toolbar must expose #viewport-studio-look-pill for one-click look switching',
  );
  assert.ok(
    workspaceSource.includes('id="viewport-studio-look-select"') || html.includes('id="viewport-studio-look-select"'),
    'viewport toolbar must expose #viewport-studio-look-select',
  );
  assert.match(
    html,
    /resolveStudioLookFromSearch\(window\.location\.search\)/,
    'startup URL handling must support ?look=<lookId> query parameter',
  );
  assert.match(
    html,
    /scenePlacementTools\.edits\.register\(\s*['"]@studio-look-switch['"]/,
    'scenePlacementTools.edits must register an atomic @studio-look-switch target for Cmd+Z undo/redo',
  );
  const applyLookStart = html.indexOf('async function applyStudioLookToCurrentScene(');
  const applyLookEnd = html.indexOf('window._kaminosArrivalLighting =', applyLookStart);
  const applyLookBody = html.slice(applyLookStart, applyLookEnd);
  assert.match(
    applyLookBody,
    /scenePlacementTools\?\.edits\?\.recordApplied\(\s*['"]@studio-look-switch['"]/,
    'applyStudioLookToCurrentScene must record an atomic @studio-look-switch undo/redo entry',
  );
  assert.match(
    applyLookBody,
    /recipes:\s*sceneEnvironment\.read\(\)\.recipes/,
    'applyStudioLookToCurrentScene must preserve per-environment recipes when restoring look environment',
  );
  const recordArrivalStart = html.indexOf('function recordAssetArrivalLightingAndGI(');
  const recordArrivalEnd = html.indexOf('function refreshArrivalLightingFromWorkingScene(', recordArrivalStart);
  const recordArrivalBody = html.slice(recordArrivalStart, recordArrivalEnd);
  assert.match(
    recordArrivalBody,
    /groundPlane\.material\.color\.set\(/,
    'fresh asset arrival must apply the active Studio Look floor color and roughness out of the box',
  );
  const disposeStart = html.indexOf('function disposeSceneSpotLight(id)');
  const disposeEnd = html.indexOf('function groupPivotPose(', disposeStart);
  assert.match(
    html.slice(disposeStart, disposeEnd),
    /scene\.add\(binding\.light,\s*binding\.light\.target\)/,
    'disposeSceneSpotLight must re-attach reused studio SpotLight nodes to scene when un-promoting on Undo',
  );
});

test('loading telemetry tracker reports byte progress, elapsed time, stall detection when hung, and completion receipt', () => {
  assert.equal(typeof assetArrival.createLoadingTelemetryTracker, 'function', 'createLoadingTelemetryTracker must be exported');
  const tracker = assetArrival.createLoadingTelemetryTracker({ stallThresholdMs: 5000 });
  const op1 = tracker.start('asset', { label: 'stale.glb', phase: 'downloading', now: 500 });
  const op2 = tracker.start('asset', { label: 'kiln.glb', phase: 'downloading', now: 1000 });
  tracker.cancel('asset', { token: op1.token, now: 1100 });
  assert.equal(tracker.read(1100).active, true, 'stale cancel token must not cancel a newer active load');
  tracker.cancel('asset', { token: op2.token, now: 1150 });
  assert.equal(tracker.read(1150).active, false, 'matching cancel token clears discarded load so it never triggers a false stall');
  assert.equal(tracker.read(1150).lastCompleted, null, 'cancelled stale load does not record a false completion receipt');
  tracker.start('asset', { label: 'kiln.glb', phase: 'downloading', now: 1000 });
  let state = tracker.read(1400);
  assert.equal(state.active, true);
  assert.equal(state.primary.label, 'kiln.glb');
  assert.equal(state.primary.phase, 'downloading');
  assert.equal(state.primary.stalled, false);

  tracker.progress('asset', { loadedBytes: 2621440, totalBytes: 5242880, now: 1800 });
  state = tracker.read(1800);
  close(state.primary.progressRatio, 0.5, '50% byte progress');
  assert.equal(state.primary.elapsedMs, 800);
  assert.match(state.summary, /50%/, 'summary includes percentage');
  assert.match(state.summary, /2\.5\s*\/\s*5\.0\s*MB/, 'summary includes MB downloaded');

  // Simulate a hang: 5.5s with zero progress updates
  state = tracker.read(7300);
  assert.equal(state.primary.stalled, true, 'operation without progress for >= stallThresholdMs is flagged as stalled');
  assert.match(state.summary, /Stalled/i, 'summary warns when loading is hung/stalled');

  tracker.complete('asset', { now: 7600 });
  state = tracker.read(7600);
  assert.equal(state.active, false);
  assert.equal(state.lastCompleted?.label, 'kiln.glb');
  assert.equal(state.lastCompleted?.durationMs, 6600);

  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.ok(html.includes('id="loading-telemetry-pill"'), 'index.html must include #loading-telemetry-pill');
  assert.ok(html.includes('window.kaminosLoadingTelemetry'), 'index.html must expose window.kaminosLoadingTelemetry');
});
