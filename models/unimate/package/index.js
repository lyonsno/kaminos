// @kaminos/unimate-webgpu: UniMate text-to-motion for any rigged skeleton, on WebGPU in the browser.
//
// Generate on your own device:          createUniMateGenerator({ device, session, beginRun, ... })
// As a model in a host app:             createUniMateConsumer(host).run({ asset, prompt, seed })
// Bring your own rig:                   readRig(bytes) -> createLabeler().label(rig) -> buildSkeletonBundle(...)
// Save the result:                      exportMotionGlb({ ... }) -> animated .glb (skinned mesh for a rig)
export { createUniMateGenerator, UNIMATE_ROUTE_ID, gaussianNoise, fetchBytes } from './unimate-generator.js';
export { createUniMateConsumer, unimateMemoryEstimate, HUB } from './unimate-consumer.js';
export { requestUniMateDevice } from './unimate-denoiser.js';
export { decodeUniMateMotion, groundedOffsets } from './unimate-decode.js';
export { readRig, turnRest, buildSkeletonBundle, quatFromTurns } from './unimate-rig-import.js';
export { parseGlb, importRig, readSkeleton } from './unimate-rig-glb.js';
export { createLabeler, LABELER_URL, PYODIDE_URL, PYODIDE_VERSION } from './unimate-rig-labels.js';
export { skeletonConditioning, canonicalizeRest, canonicalTransform, bfsOrder, topology, spectralFeatures, UNIMATE_STATS } from './unimate-rig-features.js';
export { extractSkinnedMesh, skinMatrices } from './unimate-rig-mesh.js';
export { exportMotionGlb } from './unimate-export-glb.js';
