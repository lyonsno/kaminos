import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as fingerFluidCore from '../finger-fluid-webgpu-core.js';

const source = readFileSync(
  new URL('../finger-fluid-webgpu-core.js', import.meta.url),
  'utf8',
);

const identityMatrix = Object.freeze([
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
]);
const externalCamera = {
  schema: 'kaminos.finger-fluid.external-camera.v0',
  identity: 'lerms-hill-camera-17',
  generation: 23,
  projectionType: 'orthographic',
  view: identityMatrix,
  projection: identityMatrix,
  viewProjection: identityMatrix,
  inverseViewProjection: identityMatrix,
  position: [0, 0, 4],
  right: [1, 0, 0],
  up: [0, 1, 0],
  forward: [0, 0, -1],
  near: 0.1,
  far: 100,
  viewport: {
    width: 1280,
    height: 720,
  },
};

assert.equal(
  fingerFluidCore.KAMINOS_FINGER_FLUID_MOVING_HILL_PRESENTATION_MODE,
  'moving_hill_consumer',
);
assert.equal(
  fingerFluidCore.KAMINOS_FINGER_FLUID_MOVING_HILL_PRESENTATION_ROUTE,
  'kaminos/finger-fluid/moving-hill-consumer-presentation-v0',
);
assert.equal(
  fingerFluidCore.KAMINOS_FINGER_FLUID_EXTERNAL_CAMERA_SCHEMA,
  externalCamera.schema,
);
assert.equal(
  fingerFluidCore.resolveFingerFluidPresentationMode('moving_hill_consumer'),
  'moving_hill_consumer',
);
assert.throws(
  () => fingerFluidCore.resolveFingerFluidPresentationMode('automatic'),
  /presentation mode automatic is unsupported/,
  'an unknown presentation mode must not silently fall back to the analytic playground',
);
assert.match(
  source,
  /export function createFingerFluidPerspectiveOrbitCamera\(\{/,
  'the browser witness needs one canonical perspective-camera packet builder',
);
const orbitCamera = fingerFluidCore.createFingerFluidPerspectiveOrbitCamera({
  identity: 'moving-hill-witness-camera',
  generation: 9,
  width: 640,
  height: 360,
  pixelRatio: 2,
  yaw: -0.58,
  pitch: 0.42,
  distance: 6.1,
  target: [0, -0.18, 0],
});
assert.equal(orbitCamera.identity, 'moving-hill-witness-camera');
assert.equal(orbitCamera.generation, 9);
assert.equal(orbitCamera.projectionType, 'perspective');
assert.deepEqual(orbitCamera.viewport, { width: 1280, height: 720 });
assert.ok(
  orbitCamera.viewProjection.every(Number.isFinite)
    && orbitCamera.inverseViewProjection.every(Number.isFinite),
  'the canonical orbit packet must contain finite mutually validated transforms',
);

const validatedCamera = fingerFluidCore.validateFingerFluidExternalCamera(
  externalCamera,
  { width: 1280, height: 720 },
);
assert.equal(validatedCamera.identity, externalCamera.identity);
assert.equal(validatedCamera.generation, externalCamera.generation);
assert.equal(validatedCamera.projectionType, 'orthographic');
assert.deepEqual([...validatedCamera.viewProjection], identityMatrix);
assert.deepEqual([...validatedCamera.inverseViewProjection], identityMatrix);
assert.notEqual(
  validatedCamera.viewProjection,
  externalCamera.viewProjection,
  'the renderer must retain an immutable camera snapshot instead of consumer-owned mutable arrays',
);

assert.throws(
  () => fingerFluidCore.validateFingerFluidExternalCamera(
    { ...externalCamera, viewport: { width: 1279, height: 720 } },
    { width: 1280, height: 720 },
  ),
  /viewport 1279x720 does not match render extent 1280x720/,
);
assert.throws(
  () => fingerFluidCore.validateFingerFluidExternalCamera(
    { ...externalCamera, viewProjection: [...identityMatrix.slice(0, 15), Number.NaN] },
    { width: 1280, height: 720 },
  ),
  /viewProjection\[15\] is invalid/,
);
assert.throws(
  () => fingerFluidCore.validateFingerFluidExternalCamera(
    {
      ...externalCamera,
      viewProjection: [
        2, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1,
      ],
    },
    { width: 1280, height: 720 },
  ),
  /viewProjection does not match projection multiplied by view/,
);

assert.match(
  source,
  /presentationMode = KAMINOS_FINGER_FLUID_ANALYTIC_PRESENTATION_MODE/,
  'the solver factory must expose an explicit requested presentation mode',
);
assert.match(
  source,
  /supportContactRoute === KAMINOS_FINGER_FLUID_MOVING_HILL_SUPPORT_CONTACT_ROUTE[\s\S]*safePresentationMode !== KAMINOS_FINGER_FLUID_MOVING_HILL_PRESENTATION_MODE[\s\S]*moving Hill support requires moving_hill_consumer presentation/,
  'moving-Hill collision support must fail before silently presenting analytic playground geometry',
);
assert.match(
  source,
  /const drawAnalyticSupport = safePresentationMode === KAMINOS_FINGER_FLUID_ANALYTIC_PRESENTATION_MODE/,
  'analytic support presentation must be explicitly gated by the effective presentation mode',
);
assert.match(
  source,
  /if \(drawAnalyticSupport\) \{[\s\S]*analyticSupportPresentationPass\.draw\(analyticSupportVertexCount\)/,
);
assert.match(
  source,
  /if \(drawDynamicToyMesh\) \{[\s\S]*dynamicIndexedMeshPass\.drawIndexed\(DYNAMIC_REFLECTION_MESH_INDEX_COUNT\)/,
);
assert.match(
  source,
  /externalCamera = null/,
  'render must accept an exact external camera packet',
);
assert.match(
  source,
  /safePresentationMode === KAMINOS_FINGER_FLUID_MOVING_HILL_PRESENTATION_MODE[\s\S]*validateFingerFluidExternalCamera\(externalCamera, extent\)/,
  'moving-Hill presentation must fail loudly rather than deriving a private orbit camera',
);
assert.match(
  source,
  /particleVisibility = 'visible'/,
  'the renderer must expose a particle-attribution negative-witness control',
);
assert.match(
  source,
  /presentationEvidence:\s*\{[\s\S]*requestedMode:[\s\S]*effectiveMode:[\s\S]*fallbackReason:\s*null[\s\S]*analyticSupportDrawCount:[\s\S]*dynamicToyMeshDrawCount:[\s\S]*particleVisibility:/,
  'runtime evidence must preserve requested/effective presentation and per-frame draw attribution',
);
assert.match(
  source,
  /cameraEvidence:\s*\{[\s\S]*schema:\s*KAMINOS_FINGER_FLUID_EXTERNAL_CAMERA_SCHEMA[\s\S]*identity:[\s\S]*generation:[\s\S]*fallbackReason:\s*null/,
  'runtime evidence must preserve exact external camera identity without fallback',
);

console.log('finger fluid moving-Hill presentation contracts passed');
