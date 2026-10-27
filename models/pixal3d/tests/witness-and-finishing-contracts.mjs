import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const checksUrl = new URL('../generation-witness-checks.js', import.meta.url);
const browserWitnessUrl = new URL('../pixal3d-generation-witness.js', import.meta.url);
const runnerWitnessUrl = new URL('../run-generation-witness.mjs', import.meta.url);
const finalizerUrl = new URL('../finalize-retained-generation.mjs', import.meta.url);

assert.ok(existsSync(checksUrl), 'Missing models/pixal3d/generation-witness-checks.js');
assert.ok(existsSync(browserWitnessUrl), 'Missing models/pixal3d/pixal3d-generation-witness.js');
assert.ok(existsSync(runnerWitnessUrl), 'Missing models/pixal3d/run-generation-witness.mjs');
assert.ok(existsSync(finalizerUrl), 'Missing models/pixal3d/finalize-retained-generation.mjs');

const {
  PIXAL3D_GENERATION_ROUTE,
  PIXAL3D_GENERATION_PHASES,
  PIXAL3D_GENERATION_FIELDS,
  pixal3dGenerationPhases,
  pixal3dGenerationFields,
  pixal3dGenerationModelCallCounts,
  admitPixal3dGenerationGpuBudget,
  validatePixal3dGenerationResult,
  admitPixal3dRetainedGenerationCompletion,
  persistPixal3dGenerationPhase,
  persistPixal3dGenerationAsset,
} = await import(checksUrl);

const {
  PIXAL3D_REQUIRED_STAGES,
  runPixal3dGenerationWitness,
} = await import(browserWitnessUrl);

const {
  PIXAL3D_GLB_NODE_MATRIX,
  extractPixal3dDualGridMesh,
  finishPixal3dMesh,
} = await import('../pixal3d-mesh.js');

const {
  validatePixal3dGenerationInputs,
  pixal3dGenerationInputShapes,
} = await import('../generation-inputs.js');

const {
  PIXAL3D_DEFAULT_FOV_RAD,
  computePixal3dDistanceFromFov,
} = await import('../proj-grid.js');

const {
  generatePixal3dImage,
  resolvePixal3dGenerationFinishing,
} = await import('../generate-image.mjs');

const {
  PYTHON_POSTPROCESS_SNIPPET,
  PYTHON_UNWRAP_SNIPPET,
} = await import(finalizerUrl);

const sha = bytes => createHash('sha256').update(bytes).digest('hex');

// Helper: build a valid synthetic Pixal3D manifest in memory (fast, zero disk I/O)
function buildSyntheticManifest({
  pipelineType = '512',
  conditioningMode = pipelineType === '1024_cascade' ? 'stage-specific-1024' : 'source-512',
  samplingSteps = 2,
  numBlocks = 1,
} = {}) {
  const cascade = pipelineType === '1024_cascade';
  const baseFlowConfig = (inC, outC, projIn, res) => ({
    inChannels: inC,
    outChannels: outC,
    resolution: res,
    channels: 128,
    heads: 1,
    numBlocks,
    hidden: 128,
    frequencyDim: 256,
    contextChannels: 1024,
    contextRows: 5,
    projInChannels: projIn,
    steps: samplingSteps,
    guidanceStrength: 7.5,
    guidanceRescale: 0.7,
    guidanceInterval: [0.6, 1.0],
    rescaleT: 3.0,
    sigmaMin: 1e-5,
  });
  const nafBaseConfig = {
    dim: 256,
    numGroups: 8,
    headsRope: 4,
    headsAttn: 4,
    kernelSize: 9,
    imgLayers: 2,
    imageHeight: 512,
    imageWidth: 512,
    featureHeight: 32,
    featureWidth: 32,
    featureChannels: 1024,
    outputHeight: 128,
    outputWidth: 128,
    prefixTokens: 5,
    normEpsilon: 1e-6,
  };
  const models = {
    naf: {
      identity: { sha256: '1'.repeat(64) },
      config: nafBaseConfig,
      ...(cascade
        ? {
            highResolutionConfig: {
              ...nafBaseConfig,
              imageHeight: 1024,
              imageWidth: 1024,
              featureHeight: 64,
              featureWidth: 64,
              outputHeight: 256,
              outputWidth: 256,
            },
            textureConfig: {
              ...nafBaseConfig,
              imageHeight: 1024,
              imageWidth: 1024,
              featureHeight: 64,
              featureWidth: 64,
              outputHeight: 256,
              outputWidth: 256,
            },
          }
        : {}),
      tensors: {},
    },
    sparseFlow: {
      identity: { sha256: '2'.repeat(64) },
      config: baseFlowConfig(8, 8, 1024, 16),
      phases: 'sparse.phases',
      tensors: {},
    },
    occupancyDecoder: {
      identity: { sha256: '3'.repeat(64) },
      config: {
        resolution: 16,
        latentChannels: 8,
        outChannels: 1,
        channels: [16, 8, 4],
        numResBlocks: 0,
        numResBlocksMiddle: 0,
      },
      tensors: {},
    },
    lowResolutionShape: {
      identity: { sha256: '4'.repeat(64) },
      config: baseFlowConfig(32, 32, 2048, 32),
      tensors: {},
    },
    ...(cascade
      ? {
          highResolutionShape: {
            identity: { sha256: '5'.repeat(64) },
            config: baseFlowConfig(32, 32, 2048, 64),
            tensors: {},
          },
        }
      : {}),
    shapeDecoder: {
      identity: { sha256: '6'.repeat(64) },
      config: {
        resolution: cascade ? 64 : 32,
        inChannels: 32,
        outChannels: 7,
        channels: [64, 32, 16, 8, 4],
        numBlocks: [0, 0, 0, 0, 0],
        activationStorage: 'f32',
      },
      siluTable: 'shared.silu',
      tensors: {},
    },
    textureFlow: {
      identity: { sha256: '7'.repeat(64) },
      config: {
        ...baseFlowConfig(64, 32, 2048, cascade ? 64 : 32),
        guidanceStrength: 1.0,
        guidanceRescale: 0.0,
      },
      tensors: {},
    },
    textureDecoder: {
      identity: { sha256: '8'.repeat(64) },
      config: {
        resolution: cascade ? 64 : 32,
        inChannels: 32,
        outChannels: 6,
        channels: [64, 32, 16, 8, 4],
        numBlocks: [0, 0, 0, 0, 0],
        activationStorage: 'f32',
      },
      siluTable: 'shared.silu',
      tensors: {},
    },
  };

  const draft = {
    schema: 'pixal3d.generation-inputs.v0',
    status: 'succeeded',
    modelCalls: 0,
    pipelineType,
    conditioningMode,
    meshResolution: cascade ? 1024 : 512,
    samplingSteps,
    seed: 42,
    camera: {
      cameraAngleX: PIXAL3D_DEFAULT_FOV_RAD,
      meshScale: 1.0,
      distance: computePixal3dDistanceFromFov({
        cameraAngleX: PIXAL3D_DEFAULT_FOV_RAD,
        meshScale: 1.0,
        imageResolution: 512,
      }),
    },
    image: {
      dinoPixelTensor: 'image.dino512',
      rawImageTensor: 'image.raw512',
      ...(cascade && conditioningMode === 'stage-specific-1024'
        ? {
            highResolutionDinoPixelTensor: 'image.dino1024',
            highResolutionRawImageTensor: 'image.raw1024',
          }
        : {}),
    },
    dino: {
      identity: { files: { 'model.safetensors': { sha256: '9'.repeat(64) } } },
      prefix: {},
      layers: [],
    },
    models,
    tensors: {},
  };

  const shapes = pixal3dGenerationInputShapes(draft);
  let counter = 0;
  const addDesc = (name, shape, fixedSha) => {
    const hex = fixedSha ?? (++counter).toString(16).padStart(64, '0');
    draft.tensors[name] = {
      file: `${name.replace(/[^a-zA-Z0-9._-]/g, '_')}.f32`,
      dtype: 'float32',
      shape,
      byteLength: shape.reduce((a, b) => a * b, 4),
      sha256: hex,
    };
    return name;
  };

  addDesc('image.dino512', shapes.image512);
  addDesc('image.raw512', shapes.image512);
  if (cascade && conditioningMode === 'stage-specific-1024') {
    addDesc('image.dino1024', shapes.image1024);
    addDesc('image.raw1024', shapes.image1024);
  }
  addDesc('sparse.phases', shapes.phases);
  addDesc('shared.gelu', [65536], 'a'.repeat(64));
  addDesc('shared.silu', shapes.silu, 'b'.repeat(64));

  for (const [k, s] of Object.entries(shapes.dinoPrefix)) {
    draft.dino.prefix[k] = addDesc(`dino.prefix.${k}`, s);
  }
  for (let i = 0; i < 24; i++) {
    const layer = {};
    for (const [k, s] of Object.entries(shapes.dinoLayer)) {
      layer[k] = addDesc(`dino.L${i}.${k}`, s);
    }
    draft.dino.layers.push(layer);
  }
  for (const [role, weightShapes] of Object.entries(shapes.models)) {
    for (const [k, s] of Object.entries(weightShapes)) {
      draft.models[role].tensors[k] =
        k === 'gelu' ? 'shared.gelu' : addDesc(`${role}.${k}`, s);
    }
  }

  validatePixal3dGenerationInputs(draft);
  return draft;
}

// 1. Route, phases, fields, and GPU memory admission checks
assert.equal(PIXAL3D_GENERATION_ROUTE, 'pixal3d.image-generation.webgpu.v0');
assert.ok(Array.isArray(PIXAL3D_GENERATION_PHASES));
assert.ok(Array.isArray(PIXAL3D_GENERATION_FIELDS));
assert.ok(Array.isArray(PIXAL3D_REQUIRED_STAGES));

const manifest512 = buildSyntheticManifest({ pipelineType: '512' });
const manifest1024Stage = buildSyntheticManifest({
  pipelineType: '1024_cascade',
  conditioningMode: 'stage-specific-1024',
});
const manifest1024Preview = buildSyntheticManifest({
  pipelineType: '1024_cascade',
  conditioningMode: 'shared-512-preview',
});

assert.deepEqual(pixal3dGenerationPhases(manifest512), [
  'naf-feature-upsampling',
  'sparse-structure-sampling',
  'occupancy-decoding',
  'low-resolution-shape-sampling',
  'learned-geometry-decoding',
  'shape-conditioned-texture-sampling',
  'shape-guided-material-decoding',
]);
assert.deepEqual(pixal3dGenerationPhases(manifest1024Stage), [
  'naf-feature-upsampling',
  'sparse-structure-sampling',
  'occupancy-decoding',
  'low-resolution-shape-sampling',
  'learned-cascade-support',
  'naf-hr-feature-upsampling',
  'high-resolution-shape-sampling',
  'learned-geometry-decoding',
  'shape-conditioned-texture-sampling',
  'shape-guided-material-decoding',
]);
assert.deepEqual(pixal3dGenerationPhases(manifest1024Preview), [
  'naf-feature-upsampling',
  'sparse-structure-sampling',
  'occupancy-decoding',
  'low-resolution-shape-sampling',
  'learned-cascade-support',
  'high-resolution-shape-sampling',
  'learned-geometry-decoding',
  'shape-conditioned-texture-sampling',
  'shape-guided-material-decoding',
]);

assert.equal(pixal3dGenerationFields(manifest512).includes('highResolutionConditioning'), false);
assert.equal(pixal3dGenerationFields(manifest512).includes('noise.highResolutionShape'), false);
assert.equal(pixal3dGenerationFields(manifest1024Stage).includes('highResolutionConditioning'), true);
assert.equal(pixal3dGenerationFields(manifest1024Stage).includes('noise.highResolutionShape'), true);
assert.equal(pixal3dGenerationFields(manifest1024Preview).includes('highResolutionConditioning'), false);
assert.equal(pixal3dGenerationFields(manifest1024Preview).includes('noise.highResolutionShape'), true);

const budgetPlan = admitPixal3dGenerationGpuBudget(manifest1024Stage, 500 * 1048576);
assert.equal(budgetPlan.schema, 'pixal3d.gpu-memory-admission.v0');
assert.ok(budgetPlan.checkpointBytes.naf > 0);
assert.ok(budgetPlan.checkpointBytes.sparseFlow > 0);
assert.throws(
  () => admitPixal3dGenerationGpuBudget(manifest1024Stage, 1024),
  err =>
    err.name === 'Pixal3dMemoryBudgetError' &&
    typeof err.memoryBudget?.refusedRole === 'string' &&
    err.memoryBudget?.refusedBytes > 1024,
);

// 2. Build synthetic valid generation result and verify validatePixal3dGenerationResult
function buildSyntheticResult(m, { rows = 8 } = {}) {
  const cascade = m.pipelineType === '1024_cascade';
  const stageSpecific = cascade && m.conditioningMode === 'stage-specific-1024';
  const calls = pixal3dGenerationModelCallCounts(m);
  const stageCounts = {};
  const roleByPhase = {
    'sparse-structure-sampling': 'sparseFlow',
    'low-resolution-shape-sampling': 'lowResolutionShape',
    'high-resolution-shape-sampling': 'highResolutionShape',
    'shape-conditioned-texture-sampling': 'textureFlow',
  };
  for (const [phase, count] of Object.entries(calls)) {
    const blocks = m.models[roleByPhase[phase]].config.numBlocks;
    stageCounts[phase] = {
      'terminal-output-projection': count,
      'block-modulation': count * blocks,
    };
  }
  const levels = m.models.shapeDecoder.config.channels.map((ch, i, arr) => ({
    rows,
    resolution: m.meshResolution / 2 ** (arr.length - 1 - i),
    channels: ch,
    blocksExecuted: m.models.shapeDecoder.config.numBlocks[i],
  }));
  const makeOut = (shape, dtype = 'f32', tag = '1') => ({
    shape,
    dtype,
    byteLength: shape.reduce((a, b) => a * b, 4),
    finite: true,
    sha256: tag.repeat(64).slice(0, 64),
  });
  const outputs = {
    conditioning: makeOut([1, 1029, 1024], 'f32', 'a'),
    ...(stageSpecific ? { highResolutionConditioning: makeOut([1, 4101, 1024], 'f32', 'b') } : {}),
    'geometry.features': makeOut([rows, 7], 'f32', 'c'),
    'geometry.coordinates': makeOut([rows, 3], 'i32', 'd'),
    'material.features': makeOut([rows, 6], 'f32', 'e'),
    'material.coordinates': makeOut([rows, 3], 'i32', 'd'),
    shapeCodes: makeOut([rows, 32], 'f32', 'f'),
    textureCodes: makeOut([rows, 32], 'f32', '0'),
    'noise.sparse': makeOut([1, 8, 16, 16, 16], 'f32', '1'),
    'noise.lowResolutionShape': makeOut([rows, 32], 'f32', '2'),
    ...(cascade ? { 'noise.highResolutionShape': makeOut([rows, 32], 'f32', '3') } : {}),
    'noise.texture': makeOut([rows, 32], 'f32', '4'),
    'geometry.subdivision0': makeOut([rows, 8], 'f32', '5'),
    'geometry.subdivision1': makeOut([rows, 8], 'f32', '6'),
    'geometry.subdivision2': makeOut([rows, 8], 'f32', '7'),
    'geometry.subdivision3': makeOut([rows, 8], 'f32', '8'),
  };
  return {
    status: 'succeeded',
    requestedRoute: PIXAL3D_GENERATION_ROUTE,
    effectiveRoute: PIXAL3D_GENERATION_ROUTE,
    numericalStatus: 'not-compared',
    profileStatus: 'passed',
    profile: { routeId: PIXAL3D_GENERATION_ROUTE, evidence: { mode: 'live' } },
    backend: {
      vendor: 'apple',
      architecture: 'metal-3',
      description: 'Apple M3 Max',
      device: 'Apple M3 Max',
      isFallbackAdapter: false,
    },
    jobCompletion: { status: 'succeeded', outputPresent: true },
    composition: {
      dinoBlocksExecuted: 24,
      ...(stageSpecific ? { highResolutionDinoBlocksExecuted: 24 } : {}),
      lowResolutionRows: rows,
      highResolutionRows: rows,
      phases: pixal3dGenerationPhases(m),
      sameInvocation: true,
      featureBytesToCPUDuringServing: 0,
      coordinateBytesToCPUDuringServing: 0,
      stageCounts,
      sessionId: 'session-test-1',
      geometryResolution: m.meshResolution,
      materialResolution: m.meshResolution,
      pipelineType: m.pipelineType,
      conditioningMode: m.conditioningMode,
      geometryLevels: levels,
      materialLevels: levels.map((l, i) => ({
        ...l,
        channels: m.models.textureDecoder.config.channels[i],
        blocksExecuted: m.models.textureDecoder.config.numBlocks[i],
      })),
    },
    outputs,
  };
}

const validRes512 = buildSyntheticResult(manifest512);
assert.equal(validatePixal3dGenerationResult(validRes512, manifest512), true);

const validRes1024 = buildSyntheticResult(manifest1024Stage);
assert.equal(validatePixal3dGenerationResult(validRes1024, manifest1024Stage), true);

// Fail-first checks on validatePixal3dGenerationResult
assert.throws(
  () =>
    validatePixal3dGenerationResult(
      { ...validRes1024, backend: { ...validRes1024.backend, isFallbackAdapter: true } },
      manifest1024Stage,
    ),
  /fallback|native/i,
);
assert.throws(
  () =>
    validatePixal3dGenerationResult(
      {
        ...validRes1024,
        composition: { ...validRes1024.composition, highResolutionDinoBlocksExecuted: 12 },
      },
      manifest1024Stage,
    ),
  /composition|DINO/i,
);
assert.throws(
  () =>
    validatePixal3dGenerationResult(
      {
        ...validRes1024,
        composition: { ...validRes1024.composition, featureBytesToCPUDuringServing: 4 },
      },
      manifest1024Stage,
    ),
  /composition/i,
);

// 3. Phase and asset persistence checks
const scratch = mkdtempSync(path.join(tmpdir(), 'pixal3d-slice4-test-'));
try {
  const phaseReport = {};
  const kernelLogPath = path.join(scratch, 'kernels.jsonl');
  await persistPixal3dGenerationPhase({
    report: phaseReport,
    row: {
      phase: 'naf-feature-upsampling',
      effectiveRoute: PIXAL3D_GENERATION_ROUTE,
      sessionId: 'sess-123',
      kernel: { stage: 'naf-encoder-1x1-0', dispatch: [8, 8, 1], point: 'before-native-kernel' },
    },
    kernelLogPath,
    append: (p, data) => {
      writeFileSync(p, data, { flag: 'a' });
    },
    persist: async () => {},
  });
  assert.equal(phaseReport.nativeSessionId, 'sess-123');
  assert.equal(phaseReport.kernelEvidence?.count, 1);

  // Build a real 2x2x2 dual-grid mesh & bake PBR GLB to test persistPixal3dGenerationAsset & finalize-retained-generation.mjs
  const activeCells = [
    [1, 1, 1], [2, 1, 1], [1, 2, 1], [2, 2, 1],
    [1, 1, 2], [2, 1, 2], [1, 2, 2], [2, 2, 2],
  ];
  const center = [1.5, 1.5, 1.5];
  const geomFeatures = new Float32Array(activeCells.length * 7);
  const geomCoords = new Int32Array(activeCells.length * 3);
  const matFeatures = new Float32Array(activeCells.length * 6);
  for (let i = 0; i < activeCells.length; i++) {
    const [x, y, z] = activeCells[i];
    geomCoords.set([x, y, z], i * 3);
    const d = Math.hypot(x - center[0], y - center[1], z - center[2]) - 0.9;
    geomFeatures.set([0.5, 0.5, 0.5, d > 0 ? 1 : 0, 1, 1, 1], i * 7);
    matFeatures.set([0.7, 0.4, 0.2, 0.1, 0.8, 1.0], i * 6);
  }
  const extractedMesh = extractPixal3dDualGridMesh({
    features: geomFeatures,
    coordinates: geomCoords,
    resolution: 4,
  });
  assert.equal(extractedMesh.status, 'surface');

  const simpleUnwrap = async mesh => {
    const triCount = mesh.triangles.length / 3;
    const vertices = new Float32Array(triCount * 9);
    const normals = new Float32Array(triCount * 9);
    const triangles = new Uint32Array(triCount * 3);
    const uvs = new Float32Array(triCount * 6);
    for (let f = 0; f < triCount; f++) {
      for (let k = 0; k < 3; k++) {
        const srcIdx = mesh.triangles[f * 3 + k] * 3;
        const dstIdx = f * 3 + k;
        vertices.set(mesh.vertices.subarray(srcIdx, srcIdx + 3), dstIdx * 3);
        normals.set([0, 0, 1], dstIdx * 3);
        triangles[dstIdx] = dstIdx;
      }
      uvs.set([0.1, 0.1, 0.8, 0.1, 0.1, 0.8], f * 6);
    }
    return {
      vertices,
      normals,
      triangles,
      uvs,
      metadata: mesh.metadata,
      uvMetadata: { route: 'synthetic-test-uv' },
    };
  };

  const finishedAsset = await finishPixal3dMesh(extractedMesh, {
    unwrapMesh: simpleUnwrap,
    textureSize: 16,
    materialFields: {
      features: matFeatures,
      coordinates: geomCoords,
      resolution: 4,
    },
    provenance: {
      sessionId: 'sess-123',
      inputManifestSha256: 'f'.repeat(64),
      route: PIXAL3D_GENERATION_ROUTE,
    },
  });

  const assetReport = {
    nativeSessionId: 'sess-123',
    fixtureSha256: 'f'.repeat(64),
  };
  const assetGlbPath = path.join(scratch, 'persisted-asset.glb');
  const receipt = await persistPixal3dGenerationAsset({
    report: assetReport,
    bytes: new Uint8Array(finishedAsset.glb),
    outputPath: assetGlbPath,
    write: (file, data) => writeFileSync(file, data),
    persist: async () => {},
  });
  assert.equal(receipt.path, assetGlbPath);
  assert.equal(receipt.byteLength, finishedAsset.glb.byteLength);

  // Reject GLB if sessionId mismatches
  await assert.rejects(
    () =>
      persistPixal3dGenerationAsset({
        report: { nativeSessionId: 'wrong-session', fixtureSha256: 'f'.repeat(64) },
        bytes: new Uint8Array(finishedAsset.glb),
        outputPath: assetGlbPath,
        write: () => {},
        persist: async () => {},
      }),
    /identified current Pixal3D generation PBR asset required/,
  );

  // 4. run-generation-witness.mjs CLI fail-first checks:
  // 4a. Reject GUI /Applications/Google Chrome.app before spawning any browser (Keychain popup prevention!)
  const repoRoot = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)));
  const headCommit = execFileSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
  const fixtureDir = path.join(scratch, 'fixture');
  mkdirSync(fixtureDir, { recursive: true });
  const manifestBytes = Buffer.from(JSON.stringify(manifest512, null, 2) + '\n');
  writeFileSync(path.join(fixtureDir, 'manifest.json'), manifestBytes);

  const guiChromeReportPath = path.join(scratch, 'gui-chrome-report.json');
  const guiChromeRun = spawnSync(
    process.execPath,
    [
      fileURLToPath(runnerWitnessUrl),
      '--repo-root',
      repoRoot,
      '--expected-commit',
      headCommit,
      '--fixture',
      fixtureDir,
      '--chrome',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '--report',
      guiChromeReportPath,
      '--receiver',
      'test-receiver',
      '--skip-clean-check',
    ],
    { encoding: 'utf8' },
  );
  assert.notEqual(guiChromeRun.status, 0, 'GUI Google Chrome.app must be rejected');
  const guiChromeReport = JSON.parse(readFileSync(guiChromeReportPath, 'utf8'));
  assert.equal(guiChromeReport.status, 'failed');
  assert.match(guiChromeReport.error?.message ?? '', /GUI Google Chrome is not an isolated headless executable/);

  // 4b. Reject mismatched --expected-commit with durable report
  const badCommitReportPath = path.join(scratch, 'bad-commit-report.json');
  const badCommitRun = spawnSync(
    process.execPath,
    [
      fileURLToPath(runnerWitnessUrl),
      '--repo-root',
      repoRoot,
      '--expected-commit',
      '0'.repeat(40),
      '--fixture',
      fixtureDir,
      '--chrome',
      '/opt/chrome-for-testing',
      '--report',
      badCommitReportPath,
      '--receiver',
      'test-receiver',
    ],
    { encoding: 'utf8' },
  );
  assert.notEqual(badCommitRun.status, 0);
  const badCommitReport = JSON.parse(readFileSync(badCommitReportPath, 'utf8'));
  assert.equal(badCommitReport.status, 'failed');
  assert.equal(badCommitReport.phase, 'source-identity');

  // 4c. Required-argument rejection with explicit --report must write fresh failure report and overwrite stale success
  const missingArgFreshPath = path.join(scratch, 'missing-arg-fresh.json');
  const missingArgFreshRun = spawnSync(
    process.execPath,
    [
      fileURLToPath(runnerWitnessUrl),
      '--repo-root',
      repoRoot,
      '--expected-commit',
      headCommit,
      '--fixture',
      fixtureDir,
      '--chrome',
      '/opt/chrome-for-testing',
      '--report',
      missingArgFreshPath,
    ],
    { encoding: 'utf8' },
  );
  assert.notEqual(missingArgFreshRun.status, 0, 'omitting --receiver must exit non-zero');
  assert.equal(existsSync(missingArgFreshPath), true, 'missing required flag with explicit --report must write report');
  const missingArgFreshReport = JSON.parse(readFileSync(missingArgFreshPath, 'utf8'));
  assert.equal(missingArgFreshReport.status, 'failed');
  assert.equal(missingArgFreshReport.phase, 'argument-admission');
  assert.match(missingArgFreshReport.error?.message ?? '', /--receiver is required/);

  const missingArgStalePath = path.join(scratch, 'missing-arg-stale.json');
  writeFileSync(
    missingArgStalePath,
    JSON.stringify({ schema: 'pixal3d.image-generation-browser.v0', status: 'succeeded' }) + '\n',
  );
  const missingArgStaleRun = spawnSync(
    process.execPath,
    [
      fileURLToPath(runnerWitnessUrl),
      '--repo-root',
      repoRoot,
      '--expected-commit',
      headCommit,
      '--fixture',
      fixtureDir,
      '--chrome',
      '/opt/chrome-for-testing',
      '--report',
      missingArgStalePath,
    ],
    { encoding: 'utf8' },
  );
  assert.notEqual(missingArgStaleRun.status, 0);
  const missingArgStaleReport = JSON.parse(readFileSync(missingArgStalePath, 'utf8'));
  assert.equal(missingArgStaleReport.status, 'failed', 'stale succeeded report must be overwritten on argument failure');
  assert.equal(missingArgStaleReport.phase, 'argument-admission');
  assert.match(missingArgStaleReport.error?.message ?? '', /--receiver is required/);

  // 5. finalize-retained-generation.mjs end-to-end model-free finishing on retained fields
  const nativeDir = path.join(scratch, 'native');
  const rawDir = path.join(nativeDir, 'raw');
  mkdirSync(rawDir, { recursive: true });

  // Build a 6x6x6 active voxel block (216 cells) at resolution=512 so surface area > 1e-5
  const gridCells = [];
  for (let x = 10; x < 16; x++) {
    for (let y = 10; y < 16; y++) {
      for (let z = 10; z < 16; z++) {
        gridCells.push([x, y, z]);
      }
    }
  }
  const numRows = gridCells.length;
  const gridCenter = [12.5, 12.5, 12.5];
  const finGeomFeatures = new Float32Array(numRows * 7);
  const finGeomCoords = new Int32Array(numRows * 3);
  const finMatFeatures = new Float32Array(numRows * 6);
  for (let i = 0; i < numRows; i++) {
    const [x, y, z] = gridCells[i];
    finGeomCoords.set([x, y, z], i * 3);
    const d = Math.hypot(x - gridCenter[0], y - gridCenter[1], z - gridCenter[2]) - 2.1;
    finGeomFeatures.set([0.5, 0.5, 0.5, d > 0 ? 1 : 0, 1, 1, 1], i * 7);
    finMatFeatures.set([0.7, 0.4, 0.2, 0.1, 0.8, 1.0], i * 6);
  }

  const rawFiles = {
    conditioning: { arr: new Float32Array(1029 * 1024), shape: [1, 1029, 1024], dtype: 'f32' },
    'geometry.features': { arr: finGeomFeatures, shape: [numRows, 7], dtype: 'f32' },
    'geometry.coordinates': { arr: finGeomCoords, shape: [numRows, 3], dtype: 'i32' },
    'material.features': { arr: finMatFeatures, shape: [numRows, 6], dtype: 'f32' },
    'material.coordinates': { arr: finGeomCoords, shape: [numRows, 3], dtype: 'i32' },
    shapeCodes: { arr: new Float32Array(numRows * 32), shape: [numRows, 32], dtype: 'f32' },
    textureCodes: { arr: new Float32Array(numRows * 32), shape: [numRows, 32], dtype: 'f32' },
    'noise.sparse': { arr: new Float32Array(8 * 16 * 16 * 16), shape: [1, 8, 16, 16, 16], dtype: 'f32' },
    'noise.lowResolutionShape': { arr: new Float32Array(numRows * 32), shape: [numRows, 32], dtype: 'f32' },
    'noise.texture': { arr: new Float32Array(numRows * 32), shape: [numRows, 32], dtype: 'f32' },
    'geometry.subdivision0': { arr: new Float32Array(numRows * 8), shape: [numRows, 8], dtype: 'f32' },
    'geometry.subdivision1': { arr: new Float32Array(numRows * 8), shape: [numRows, 8], dtype: 'f32' },
    'geometry.subdivision2': { arr: new Float32Array(numRows * 8), shape: [numRows, 8], dtype: 'f32' },
    'geometry.subdivision3': { arr: new Float32Array(numRows * 8), shape: [numRows, 8], dtype: 'f32' },
  };
  const rawOutputs = {};
  const resultOutputs = {};
  for (const [name, { arr, shape, dtype }] of Object.entries(rawFiles)) {
    const file = path.join(rawDir, `${name}.${dtype}`);
    const buf = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
    writeFileSync(file, buf);
    const digest = sha(buf);
    rawOutputs[name] = { path: file, dtype, byteLength: buf.length, sha256: digest };
    resultOutputs[name] = { shape, dtype, byteLength: buf.length, sha256: digest, finite: true };
  }

  const nativeResult = {
    ...buildSyntheticResult(manifest512, { rows: numRows }),
    outputs: resultOutputs,
  };
  const nativeReport = {
    schema: 'pixal3d.image-generation-browser.v0',
    status: 'succeeded',
    finishedAt: new Date().toISOString(),
    commit: headCommit,
    expectedCommit: headCommit,
    dirty: '',
    fixtureRoot: fixtureDir,
    fixtureSha256: sha(manifestBytes),
    nativeSessionId: 'sess-native-finishing-1',
    rawOutputs,
    result: nativeResult,
  };
  writeFileSync(path.join(nativeDir, 'report.json'), JSON.stringify(nativeReport, null, 2) + '\n');

  const finishedDir = path.join(scratch, 'finished');
  const finishedGlbPath = path.join(finishedDir, 'asset.glb');
  const finalizeRun = spawnSync(
    process.execPath,
    [
      fileURLToPath(finalizerUrl),
      '--repo-root',
      repoRoot,
      '--expected-commit',
      headCommit,
      '--input-root',
      nativeDir,
      '--expected-native-commit',
      headCommit,
      '--cleanup-mode',
      'browser-mlx-surface-preserving',
      '--uv-backend',
      'browser-xatlas',
      '--target-faces',
      '100',
      '--receiver',
      'test-finisher',
      '--output',
      finishedGlbPath,
      '--skip-clean-check',
    ],
    { encoding: 'utf8' },
  );
  assert.equal(finalizeRun.status, 0, finalizeRun.stderr || finalizeRun.stdout);
  assert.equal(existsSync(finishedGlbPath), true);
  const finReport = JSON.parse(readFileSync(path.join(finishedDir, 'report.json'), 'utf8'));
  assert.equal(finReport.status, 'succeeded');
  assert.equal(finReport.modelCalls, 0);
  const finGlbBytes = readFileSync(finishedGlbPath);
  assert.equal(finReport.assetArtifact?.sha256, sha(finGlbBytes));
  const finView = new DataView(finGlbBytes.buffer, finGlbBytes.byteOffset, finGlbBytes.byteLength);
  const finJsonLen = finView.getUint32(12, true);
  const finDoc = JSON.parse(
    new TextDecoder().decode(finGlbBytes.subarray(20, 20 + finJsonLen)).trim(),
  );
  assert.deepEqual(finDoc.nodes[0].matrix, [...PIXAL3D_GLB_NODE_MATRIX]);
  assert.equal(finDoc.extras?.pixal3d?.stage, 'learned-geometry-and-material');

  // 5a-py. Embedded Python postprocess and unwrap snippets compile cleanly and default reference-cleanup / mlx-surface-preserving routes execute end-to-end
  assert.equal(typeof PYTHON_POSTPROCESS_SNIPPET, 'string');
  assert.equal(typeof PYTHON_UNWRAP_SNIPPET, 'string');
  for (const [label, snippet] of [
    ['PYTHON_POSTPROCESS_SNIPPET', PYTHON_POSTPROCESS_SNIPPET],
    ['PYTHON_UNWRAP_SNIPPET', PYTHON_UNWRAP_SNIPPET],
  ]) {
    const compileCheck = spawnSync(
      'python3',
      ['-B', '-c', `import sys; compile(sys.stdin.read(), ${JSON.stringify(label)}, "exec")`],
      { input: snippet, encoding: 'utf8' },
    );
    assert.equal(compileCheck.status, 0, `${label} failed to compile:\n${compileCheck.stderr}`);
  }

  // Create a clean git-initialized synthetic Pixal3D-MLX source repo exercising both cleanup branches
  const pySourceRoot = path.join(scratch, 'pixal3d-mlx-source');
  mkdirSync(path.join(pySourceRoot, 'trellmlx'), { recursive: true });
  writeFileSync(
    path.join(pySourceRoot, 'generate.py'),
    [
      'def _cleanup_and_simplify_mesh(vertices, faces, target_faces=100, no_cleanup=False, keep_largest=False, cleanup_mesh=None, log=None):',
      '    if log is not None:',
      '        log("synthetic _cleanup_and_simplify_mesh pass 1")',
      '    if cleanup_mesh is not None:',
      '        vertices, faces = cleanup_mesh(vertices, faces, min_component_area=1e-5, keep_largest=keep_largest)',
      '        vertices, faces = cleanup_mesh(vertices, faces, min_component_area=1e-5, keep_largest=keep_largest)',
      '    return vertices, faces',
      '',
    ].join('\n'),
  );
  writeFileSync(path.join(pySourceRoot, 'trellmlx', '__init__.py'), '\n');
  writeFileSync(
    path.join(pySourceRoot, 'trellmlx', 'mesh_cleanup.py'),
    [
      'def cleanup_mesh(vertices, faces, *, preserve_surface_parts=True, min_component_area=1e-5, keep_largest=False, **kw):',
      '    return vertices, faces',
      '',
      'def orient_faces_by_adjacency(vertices, faces, verbose=False):',
      '    return vertices, faces',
      '',
    ].join('\n'),
  );
  execFileSync('git', ['init'], { cwd: pySourceRoot, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: pySourceRoot, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: pySourceRoot, stdio: 'ignore' });
  execFileSync('git', ['add', '.'], { cwd: pySourceRoot, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'init synthetic pixal3d-mlx source'], { cwd: pySourceRoot, stdio: 'ignore' });
  const pySourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: pySourceRoot,
    encoding: 'utf8',
  }).trim();
  const pythonWithNumpy = execFileSync('python3', ['-c', 'import sys; print(sys.executable)'], {
    encoding: 'utf8',
  }).trim();

  for (const mode of ['reference-cleanup', 'mlx-surface-preserving']) {
    const pyFinDir = path.join(scratch, `finished-py-${mode}`);
    const pyFinGlb = path.join(pyFinDir, 'asset.glb');
    const pyFinRun = spawnSync(
      process.execPath,
      [
        fileURLToPath(finalizerUrl),
        '--repo-root',
        repoRoot,
        '--expected-commit',
        headCommit,
        '--input-root',
        nativeDir,
        '--expected-native-commit',
        headCommit,
        '--cleanup-mode',
        mode,
        '--uv-backend',
        'browser-xatlas',
        '--python',
        pythonWithNumpy,
        '--source-root',
        pySourceRoot,
        '--expected-source-commit',
        pySourceCommit,
        '--target-faces',
        '100',
        '--receiver',
        `test-finisher-${mode}`,
        '--output',
        pyFinGlb,
        '--skip-clean-check',
      ],
      { encoding: 'utf8' },
    );
    assert.equal(pyFinRun.status, 0, `${mode} finalizer failed:\n${pyFinRun.stderr || pyFinRun.stdout}`);
    assert.equal(existsSync(pyFinGlb), true);
    const pyFinReport = JSON.parse(readFileSync(path.join(pyFinDir, 'report.json'), 'utf8'));
    assert.equal(pyFinReport.status, 'succeeded');
    assert.equal(pyFinReport.cleanupMode, mode);
    assert.equal(pyFinReport.meshPostprocess?.status, 'succeeded');
    assert.equal(pyFinReport.meshPostprocess?.schema, 'pixal3d.mesh-postprocess.v0');
    assert.equal(pyFinReport.meshPostprocess?.requestedMode, mode);
    assert.equal(pyFinReport.meshPostprocess?.source?.commit, pySourceCommit);
    const pyGlbBytes = readFileSync(pyFinGlb);
    const pyView = new DataView(pyGlbBytes.buffer, pyGlbBytes.byteOffset, pyGlbBytes.byteLength);
    const pyJsonLen = pyView.getUint32(12, true);
    const pyDoc = JSON.parse(
      new TextDecoder().decode(pyGlbBytes.subarray(20, 20 + pyJsonLen)).trim(),
    );
    assert.equal(pyDoc.extras?.pixal3d?.geometry?.postprocess?.schema, 'pixal3d.mesh-postprocess.v0');
  }

  // 5b. Fail-first on corrupted retained field bytes
  writeFileSync(path.join(rawDir, 'geometry.features.f32'), Buffer.alloc(numRows * 7 * 4));
  const corruptDir = path.join(scratch, 'finished-corrupt');
  const corruptRun = spawnSync(
    process.execPath,
    [
      fileURLToPath(finalizerUrl),
      '--repo-root',
      repoRoot,
      '--expected-commit',
      headCommit,
      '--input-root',
      nativeDir,
      '--expected-native-commit',
      headCommit,
      '--cleanup-mode',
      'browser-mlx-surface-preserving',
      '--uv-backend',
      'browser-xatlas',
      '--target-faces',
      '100',
      '--receiver',
      'test-finisher',
      '--output',
      path.join(corruptDir, 'asset.glb'),
      '--skip-clean-check',
    ],
    { encoding: 'utf8' },
  );
  assert.notEqual(corruptRun.status, 0, 'corrupted retained field must fail finalizer');
  const corruptReport = JSON.parse(readFileSync(path.join(corruptDir, 'report.json'), 'utf8'));
  assert.equal(corruptReport.status, 'failed');

  // 6. generatePixal3dImage default CLI orchestration (browser launch Keychain flags + witness + finalizer)
  const cliConfigPath = path.join(scratch, 'cli-config.json');
  const cliConfig = {
    schema: 'pixal3d.local-generation-config.v0',
    repoRoot,
    checkpointBase: '/weights/pixal3d',
    dinoWeights: '/weights/dino/model.safetensors',
    python: '/usr/bin/python3',
    memoryPython: '/usr/bin/python3',
    sourceRoot: '/source/pixal3d-mlx',
    chrome: '/opt/isolated-chrome-for-testing',
    greenroomBin: '/opt/greenroom',
    queueDir: '/var/queue',
    expectedCommit: headCommit,
    expectedSourceCommit: 'b'.repeat(40),
    pipelineType: '512',
    conditioningMode: 'source-512',
    decoderActivationStorage: 'f16',
    steps: 2,
    seed: 42,
    targetFaces: 100,
    gpuBufferBudgetMiB: 6144,
    processMemoryBudgetMiB: 10240,
    cleanupMode: 'browser-mlx-surface-preserving',
    preparedPackageRoot: path.join(scratch, 'cli-packages'),
  };
  writeFileSync(cliConfigPath, JSON.stringify(cliConfig));
  const dummyInput = path.join(scratch, 'dummy.png');
  writeFileSync(dummyInput, Buffer.from([1, 2, 3, 4]));

  const cliCommands = [];
  const cliOutGlb = path.join(scratch, 'cli-out.glb');
  const cliReportPath = path.join(scratch, 'cli-report.json');
  const cliResult = await generatePixal3dImage(
    {
      config: cliConfigPath,
      input: dummyInput,
      output: cliOutGlb,
      report: cliReportPath,
      'run-id': 'cli-e2e-1',
    },
    {
      gitSourceIdentity: () => ({ commit: headCommit, dirty: false }),
      realpath: p => p,
      startProcessMemory: async () => ({
        stop: async () => ({ status: 'observed', peakFootprintBytes: 2048 }),
      }),
      createGenerationCommandRunner: ({ record }) => ({
        stop: async () => {},
        run: async (argv, label) => {
          cliCommands.push({ argv, label });
          record.commands.push({ argv, label, exit: { code: 0 } });
          if (label === 'Pixal3D package preparation') {
            const outIdx = argv.indexOf('--out');
            const pDir = argv[outIdx + 1];
            mkdirSync(pDir, { recursive: true });
            writeFileSync(path.join(pDir, 'manifest.json'), JSON.stringify(manifest512));
          } else if (label === 'Pixal3D WebGPU generation') {
            const repIdx = argv.indexOf('--report');
            const repFile = argv[repIdx + 1];
            mkdirSync(path.dirname(repFile), { recursive: true });
            writeFileSync(repFile, JSON.stringify(nativeReport));
          } else if (label === 'Pixal3D mesh finishing') {
            const outIdx = argv.indexOf('--output');
            const outFile = argv[outIdx + 1];
            mkdirSync(path.dirname(outFile), { recursive: true });
            writeFileSync(outFile, finGlbBytes);
            writeFileSync(
              path.join(path.dirname(outFile), 'report.json'),
              JSON.stringify({
                ...finReport,
                assetArtifact: {
                  path: outFile,
                  sha256: sha(finGlbBytes),
                  byteLength: finGlbBytes.length,
                },
              }),
            );
          }
        },
      }),
    },
  );
  assert.equal(cliResult.ok, true, cliResult.error?.message);
  assert.equal(cliResult.status, 'succeeded');
  assert.equal(cliCommands.length, 3);
  assert.ok(cliResult.browser?.args.includes('--use-mock-keychain'));
  assert.ok(cliResult.browser?.args.includes('--password-store=basic'));
  assert.equal(existsSync(cliOutGlb), true);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

console.log('witness-and-finishing-contracts.mjs: PASS');
