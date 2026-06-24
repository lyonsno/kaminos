#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ORB_INNER_ENGINE_IDENTITY, createOrbInnerEngineCore } from './orb-inner-engine-core.js';

export const ORB_INNER_ENGINE_CONCEPT_LOOP_IDENTITY = 'orb-inner-engine-concept-loop-v0';

const TAU = Math.PI * 2;

function hashString(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, places = 3) {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

function jsonWrite(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

function jsonRead(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function sha256Text(text) {
  return createHash('sha256').update(text).digest('hex');
}

function makeRoutes() {
  return [
    {
      id: 'local-image.ideogram4',
      status: 'unconfigured',
      role: 'concept-raster-generator',
      consumes: ['structured prompt', 'seed', 'aspect ratio'],
      produces: ['source concept image'],
      liveGeneratorInvoked: false,
      notes: 'Local image route is described here but not executed by this manifest-only loop.',
    },
    {
      id: 'sharp.splat',
      status: 'planned',
      role: 'hero-splat-from-concept-image',
      consumes: ['source concept image', 'source view camera', 'view-bank request'],
      produces: ['1M-ish Gaussian splat scene', 'view-bank candidate'],
      liveGeneratorInvoked: false,
      notes: 'SHARP is a fast splat route with baked coherence near the authored view; the loop records view-cone risk explicitly.',
    },
    {
      id: 'trellis2mlx.mesh-pbr',
      status: 'planned',
      role: 'mesh-pbr-candidate',
      consumes: ['source concept image', 'asset scale hints'],
      produces: ['textured mesh candidate', 'PBR material draft'],
      liveGeneratorInvoked: false,
      notes: 'Trellis2 MLX is a slower mesh route with useful upside and finicky output quality.',
    },
    {
      id: 'pixal3d.mesh-pbr',
      status: 'planned',
      role: 'higher-ceiling-mesh-pbr-candidate',
      consumes: ['source concept image', 'asset scale hints'],
      produces: ['textured mesh candidate', 'PBR material draft'],
      liveGeneratorInvoked: false,
      notes: 'Pixal3D is recorded as a higher-ceiling, higher-latency route with ugly-specificity failure risk.',
    },
    {
      id: 'beaming.volume-accent',
      status: 'planned',
      role: 'optional-accent',
      consumes: ['engine heat cadence', 'bounded core volume', 'future collision primitives'],
      produces: ['fuel/fire/smoke/steam accent pass'],
      requiredForBaseRead: false,
      liveGeneratorInvoked: false,
      notes: 'The contained core must read without this; Beaming can later supply physical fire/smoke vocabulary as an accent or close-shot pass.',
    },
  ];
}

function makePrompt({ coreSeed, conceptSeed, index, random }) {
  const temperature = ['white-hot center', 'molten orange core', 'amber furnace iris'][index % 3];
  const machinery = ['dark radial occluders', 'nested turbine rings', 'segmented mechanical ribs'][Math.floor(random() * 3)];
  const containment = ['trapped behind shell matter', 'visible through apertures', 'bounded inside a core socket'][Math.floor(random() * 3)];
  return {
    generatorRoute: 'local-image.ideogram4',
    seed: `${conceptSeed}:${index}`,
    positive: [
      'contained radial molten engine core',
      temperature,
      'nested rings',
      'mechanical ribs',
      machinery,
      'bounded orange emission channels',
      'dark occluded outer machinery rim',
      containment,
      'Kaminos Evil Orb inner engine only',
      `core seed ${coreSeed}`,
    ].join(', '),
    negative: [
      'flat orange disk',
      'generic fireball',
      'unbounded bloom ball',
      'new outer shell geometry',
      'decorative magic aura pasted on top',
      'soft featureless glow',
      'clean sci-fi lens flare',
    ].join(', '),
    framing: {
      view: 'front-biased hero core source view',
      background: 'transparent or dark neutral',
      crop: 'socket-centered circle with machinery readable to the rim',
      aspectRatio: '1:1',
    },
  };
}

function makeSharpCandidate({ index, random }) {
  const azimuth = round((random() - 0.5) * 18, 2);
  const elevation = round((random() - 0.5) * 14, 2);
  const viewConeDegrees = [12, 20, 30, 45][index % 4];
  return {
    route: 'sharp.splat',
    status: 'planned',
    technique: 'starcraft-view-bank',
    sourceView: {
      azimuth,
      elevation,
      roll: 0,
      radius: 1,
    },
    viewConeDegrees,
    splatCountBudget: 1000000 + index * 250000,
    relightingStatus: 'renderer-relight-pending',
    cameraSelectionPolicy: 'nearest-authored-view-with-shader-fallback',
    purpose: 'Hero/near-camera splat asset that can swap authored views like old 2.5D unit renderers while the shader fallback carries distance.',
    failureModes: [
      'sharp-view-cone-limit',
      'lost-containment',
      'flat-glow',
      'stale-baked-lighting-before-relight',
    ],
    fallbackRoute: 'shader-baked-emissive-field',
  };
}

function makeMeshCandidate({ route, index }) {
  const highCeiling = route === 'pixal3d.mesh-pbr';
  return {
    route,
    status: 'planned',
    technique: highCeiling ? 'slow-high-ceiling-image-to-pbr-mesh' : 'mlx-image-to-pbr-mesh',
    estimatedLatencyMinutes: highCeiling ? [12, 40] : [5, 20],
    requiredForBaseRead: false,
    purpose: 'Optional hero geometry candidate for mechanical ribs, nested rings, and occluder silhouettes.',
    risk: highCeiling ? 'ugly-specificity-from-over-realized-miss' : 'finicky-mesh-pbr-coherence',
    fallbackRoute: 'procedural-core-geometry-and-shader',
    candidateIndex: index,
  };
}

function makeVolumeAffordance(core, index) {
  return {
    route: 'beaming.volume-accent',
    status: 'planned',
    required: false,
    heatCadenceHz: core.volumetric.heatCadenceHz,
    containedPressure: core.volumetric.containedPressure,
    requestLanguage: 'accent only: localized fuel/fire/smoke/steam behavior inside the socket, clipped by shell occlusion and aperture masks; never the primary read.',
    cheapFallback: {
      route: 'shader-baked-emissive-field',
      cadenceHz: round(core.volumetric.heatCadenceHz + index * 0.031, 3),
      turbulence: round(core.volumetric.turbulentEnergy, 3),
    },
  };
}

function makeConcept({ core, coreSeed, conceptSeed, index }) {
  const random = mulberry32(hashString(`${coreSeed}:${conceptSeed}:${index}`));
  const phase = round((random() + index * 0.137) % 1, 3);
  const ribBias = round(0.55 + random() * 0.3, 3);
  const apertureBias = round(clamp(0.42 + random() * 0.34, 0.25, 0.86), 3);
  const sourceAngle = round((phase * TAU) * 180 / Math.PI, 2);
  return {
    id: `orb-inner-engine-concept-${String(index + 1).padStart(2, '0')}`,
    status: 'queued',
    coreIdentity: core.identity,
    coreSeed,
    conceptSeed: `${conceptSeed}:${index}`,
    coreSocket: {
      space: core.socket.transform.space,
      radius: core.socket.radius,
      transform: core.socket.transform,
    },
    prompt: makePrompt({ coreSeed, conceptSeed, index, random }),
    artDirection: {
      sourceAngle,
      apertureBias,
      ribBias,
      primaryRead: 'contained radial engine visible behind Lamellar apertures',
      structureMustRead: ['hot center', 'nested rings', 'mechanical ribs', 'inner occluders', 'dark outer machinery', 'bounded orange channels'],
      forbiddenRead: ['generic fire', 'bloom ball', 'flat glow disk', 'new shell design'],
    },
    assetCandidates: [
      makeSharpCandidate({ index, random }),
      makeMeshCandidate({ route: 'trellis2mlx.mesh-pbr', index }),
      makeMeshCandidate({ route: 'pixal3d.mesh-pbr', index }),
    ],
    volumeAffordance: makeVolumeAffordance(core, index),
    fallbacks: [
      {
        route: 'shader-baked-emissive-field',
        requiredForBaseRead: true,
        carries: ['hot center', 'rings', 'ribs', 'occlusion', 'bounded orange channels', 'heat cadence'],
      },
      {
        route: 'software-witness-raster',
        requiredForBaseRead: true,
        carries: ['visual acceptance witness', 'aperture proxy', 'route-independent receipt'],
      },
    ],
  };
}

function makePromptQueue(manifest) {
  return {
    identity: 'orb-inner-engine-prompt-queue-v0',
    parentIdentity: manifest.identity,
    coreSeed: manifest.coreSeed,
    items: manifest.concepts.map(concept => ({
      id: concept.id,
      status: manifest.routes.find(route => route.id === 'local-image.ideogram4')?.status || 'unconfigured',
      generatorRoute: 'local-image.ideogram4',
      seed: concept.prompt.seed,
      positive: concept.prompt.positive,
      negative: concept.prompt.negative,
      framing: concept.prompt.framing,
      downstreamRoutes: concept.assetCandidates.map(candidate => candidate.route),
    })),
  };
}

function makeRouteRecords(manifest) {
  const records = [];
  for (const route of manifest.routes) {
    records.push({
      route: route.id,
      status: route.status,
      role: route.role,
      liveGeneratorInvoked: false,
      requiredForBaseRead: route.requiredForBaseRead === true,
    });
  }
  for (const concept of manifest.concepts) {
    for (const candidate of concept.assetCandidates) {
      records.push({
        conceptId: concept.id,
        route: candidate.route,
        status: candidate.status,
        technique: candidate.technique,
        liveGeneratorInvoked: false,
        requiredForBaseRead: false,
        failureModes: candidate.failureModes || [candidate.risk],
      });
    }
    records.push({
      conceptId: concept.id,
      route: concept.volumeAffordance.route,
      status: concept.volumeAffordance.status,
      technique: 'optional-contained-volume-accent',
      liveGeneratorInvoked: false,
      requiredForBaseRead: concept.volumeAffordance.required,
      failureModes: ['volume-dependency-too-high', 'lost-containment'],
    });
  }
  return {
    identity: 'orb-inner-engine-route-records-v0',
    parentIdentity: manifest.identity,
    records,
  };
}

export function createOrbInnerEngineConceptManifest({
  coreSeed = 'molten-heartfucker-core-v0',
  conceptSeed = 'molten-heartfucker-concept-loop-v0',
  target = 'evil-orb-inner-engine',
  conceptCount = 4,
  socketRadius = 1,
  animationPhase = 0.375,
} = {}) {
  const boundedConceptCount = clamp(Number(conceptCount) || 1, 1, 24);
  const core = createOrbInnerEngineCore({ seed: coreSeed, socketRadius, animationPhase });
  const concepts = Array.from({ length: boundedConceptCount }, (_, index) => (
    makeConcept({ core, coreSeed, conceptSeed, index })
  ));
  return {
    identity: ORB_INNER_ENGINE_CONCEPT_LOOP_IDENTITY,
    coreIdentity: ORB_INNER_ENGINE_IDENTITY,
    coreSeed,
    conceptSeed,
    target,
    createdBy: 'molten-heartfucker',
    contract: {
      owns: [
        'contained radial core vocabulary',
        'orange emissive engine channels',
        'inner occlusion and dark rim model',
        'future volumetric accent language',
        'generated asset route records for core-only concepts',
      ],
      consumesFromLamellar: [
        'core socket transform/radius',
        'aperture masks and frames',
        'rim/lip proximity',
        'shell occlusion',
        'inner exposure',
        'animation/opening parameters',
      ],
      nonGoals: [
        'redesign-shell-geometry',
        'solve-avatar-status-semantics',
        'claim-outer-body-convergence',
        'publish-public-assets',
      ],
      baseEffectMustWorkWithoutVolumetrics: true,
      baseEffectMustWorkWithoutGeneratedAssets: true,
    },
    routes: makeRoutes(),
    failureTaxonomy: [
      'flat-glow',
      'generic-fireball',
      'lost-containment',
      'shell-geometry-takeover',
      'sharp-view-cone-limit',
      'mesh-pbr-ugly-specificity',
      'stale-baked-lighting-before-relight',
      'generator-unconfigured',
      'volume-dependency-too-high',
    ],
    viewBankPolicy: {
      technique: 'starcraft-view-bank',
      description: 'Generate or author multiple front-biased high-quality views and select the nearest view by camera angle, letting shader/baked fallback carry distance and out-of-cone cases.',
      minimumUsefulConeDegrees: 10,
      exploratoryConeDegrees: [12, 20, 30, 45],
      selection: 'nearest-authored-view-with-shader-fallback',
      honestyBoundary: 'SHARP splats are view-coherent hero affordances, not view-independent relit geometry until the renderer relight path carries them.',
    },
    concepts,
  };
}

export function writeOrbInnerEngineConceptBundle({
  outDir,
  coreSeed = 'molten-heartfucker-core-v0',
  conceptSeed = 'molten-heartfucker-concept-loop-v0',
  target = 'evil-orb-inner-engine',
  conceptCount = 4,
  socketRadius = 1,
  animationPhase = 0.375,
} = {}) {
  if (!outDir) {
    throw new Error('writeOrbInnerEngineConceptBundle requires caller-provided outDir');
  }
  const bundleRoot = resolve(outDir, ORB_INNER_ENGINE_CONCEPT_LOOP_IDENTITY);
  mkdirSync(bundleRoot, { recursive: true });

  const manifest = createOrbInnerEngineConceptManifest({
    coreSeed,
    conceptSeed,
    target,
    conceptCount,
    socketRadius,
    animationPhase,
  });
  const promptQueue = makePromptQueue(manifest);
  const routeRecords = makeRouteRecords(manifest);

  const manifestPath = join(bundleRoot, 'manifest.json');
  const promptQueuePath = join(bundleRoot, 'prompt-queue.json');
  const routeRecordsPath = join(bundleRoot, 'route-records.json');
  const receiptPath = join(bundleRoot, 'receipt.json');

  jsonWrite(manifestPath, manifest);
  jsonWrite(promptQueuePath, promptQueue);
  jsonWrite(routeRecordsPath, routeRecords);

  const receipt = {
    ok: true,
    identity: ORB_INNER_ENGINE_CONCEPT_LOOP_IDENTITY,
    coreIdentity: ORB_INNER_ENGINE_IDENTITY,
    coreSeed,
    conceptSeed,
    target,
    outputs: {
      bundleRoot,
      manifestPath,
      promptQueuePath,
      routeRecordsPath,
      receiptPath,
    },
    honesty: {
      liveGeneratorsInvoked: false,
      status: 'manifest-only-no-live-generation',
      boundary: 'This receipt records prompt and route intent only. No concept image, splat, mesh, or volumetric simulation was executed.',
    },
  };
  jsonWrite(receiptPath, receipt);

  return {
    ok: true,
    identity: ORB_INNER_ENGINE_CONCEPT_LOOP_IDENTITY,
    bundleRoot,
    manifestPath,
    promptQueuePath,
    routeRecordsPath,
    receiptPath,
  };
}

function replaceArgTokens(value, context) {
  return String(value)
    .replaceAll('{prompt}', context.prompt)
    .replaceAll('{negative}', context.negative)
    .replaceAll('{seed}', context.seed)
    .replaceAll('{output}', context.outputImagePath)
    .replaceAll('{conceptId}', context.conceptId)
    .replaceAll('{route}', context.route);
}

function imageOutputComplete(path) {
  return existsSync(path) && statSync(path).size > 0;
}

function makeUnconfiguredImageRecords({ bundleRoot, promptQueue, route, recordsPath }) {
  return {
    ok: false,
    identity: 'orb-inner-engine-image-route-records-v0',
    parentIdentity: promptQueue.parentIdentity,
    route,
    bundleRoot,
    status: 'unconfigured',
    effectiveCommand: null,
    recordsPath,
    records: promptQueue.items.map(item => ({
      conceptId: item.id,
      route,
      status: 'unconfigured',
      failurePhase: 'configuration',
      failureReason: 'No image command supplied for this route.',
      liveGeneratorInvoked: false,
      seed: item.seed,
      promptSha256: sha256Text(JSON.stringify({
        positive: item.positive,
        negative: item.negative,
        framing: item.framing,
      })),
      outputImagePath: null,
      stdout: '',
      stderr: '',
      exitCode: null,
      argv: [],
    })),
  };
}

export function runOrbInnerEngineImageRoute({
  bundleRoot,
  route = 'local-image.ideogram4',
  command = null,
  args = [],
  cwd = null,
  env = {},
  timeoutMs = 120000,
} = {}) {
  if (!bundleRoot) {
    throw new Error('runOrbInnerEngineImageRoute requires bundleRoot');
  }
  const resolvedBundleRoot = resolve(bundleRoot);
  const promptQueuePath = join(resolvedBundleRoot, 'prompt-queue.json');
  const recordsPath = join(resolvedBundleRoot, 'image-route-records.json');
  const imageRoot = join(resolvedBundleRoot, 'images', route);
  const promptQueue = jsonRead(promptQueuePath);
  mkdirSync(imageRoot, { recursive: true });

  if (!command) {
    const unconfigured = makeUnconfiguredImageRecords({
      bundleRoot: resolvedBundleRoot,
      promptQueue,
      route,
      recordsPath,
    });
    jsonWrite(recordsPath, unconfigured);
    return {
      ok: false,
      status: 'unconfigured',
      route,
      bundleRoot: resolvedBundleRoot,
      imageRouteRecordsPath: recordsPath,
    };
  }

  const effectiveCommand = {
    command,
    args,
    cwd: cwd ? resolve(cwd) : resolvedBundleRoot,
    timeoutMs,
    shell: false,
  };
  const records = [];

  for (const item of promptQueue.items) {
    const outputImagePath = join(imageRoot, `${item.id}.png`);
    const promptPayload = {
      positive: item.positive,
      negative: item.negative,
      framing: item.framing,
    };
    const context = {
      prompt: item.positive,
      negative: item.negative,
      seed: item.seed,
      outputImagePath,
      conceptId: item.id,
      route,
    };
    const argv = args.map(arg => replaceArgTokens(arg, context));
    const spawned = spawnSync(command, argv, {
      cwd: effectiveCommand.cwd,
      env: { ...process.env, ...env },
      encoding: 'utf8',
      shell: false,
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024 * 8,
    });

    let status = 'complete';
    let failurePhase = null;
    let failureReason = null;
    if (spawned.error) {
      status = 'failed';
      failurePhase = spawned.error.code === 'ETIMEDOUT' ? 'timeout' : 'spawn';
      failureReason = spawned.error.message;
    } else if (spawned.status !== 0) {
      status = 'failed';
      failurePhase = 'command-exit';
      failureReason = `Command exited with status ${spawned.status}`;
    } else if (!imageOutputComplete(outputImagePath)) {
      status = 'failed';
      failurePhase = 'missing-output';
      failureReason = 'Command completed without writing a non-empty output image.';
    }

    records.push({
      conceptId: item.id,
      route,
      status,
      failurePhase,
      failureReason,
      liveGeneratorInvoked: true,
      seed: item.seed,
      promptSha256: sha256Text(JSON.stringify(promptPayload)),
      outputImagePath,
      stdout: spawned.stdout || '',
      stderr: spawned.stderr || '',
      exitCode: spawned.status ?? null,
      signal: spawned.signal ?? null,
      argv,
    });
  }

  const complete = records.every(record => record.status === 'complete');
  const imageRouteRecords = {
    ok: complete,
    identity: 'orb-inner-engine-image-route-records-v0',
    parentIdentity: promptQueue.parentIdentity,
    route,
    bundleRoot: resolvedBundleRoot,
    status: complete ? 'complete' : 'failed',
    effectiveCommand,
    recordsPath,
    records,
  };
  jsonWrite(recordsPath, imageRouteRecords);

  return {
    ok: complete,
    status: imageRouteRecords.status,
    route,
    bundleRoot: resolvedBundleRoot,
    imageRouteRecordsPath: recordsPath,
  };
}

function parseArgs(argv) {
  const values = new Map();
  for (let i = 2; i < argv.length; i++) {
    const key = argv[i];
    if (!key.startsWith('--')) continue;
    const consumesDashedValue = key === '--image-arg';
    const hasValue = argv[i + 1] !== undefined && (consumesDashedValue || !argv[i + 1].startsWith('--'));
    const value = hasValue ? argv[++i] : 'true';
    const existing = values.get(key) || [];
    existing.push(value);
    values.set(key, existing);
  }
  return {
    get(key) {
      const found = values.get(key);
      return found ? found[found.length - 1] : undefined;
    },
    all(key) {
      return values.get(key) || [];
    },
  };
}

const invokedAsScript = process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href;
if (invokedAsScript) {
  const args = parseArgs(process.argv);
  const outDir = args.get('--out-dir');
  const result = writeOrbInnerEngineConceptBundle({
    outDir,
    coreSeed: args.get('--core-seed') || 'molten-heartfucker-core-v0',
    conceptSeed: args.get('--concept-seed') || 'molten-heartfucker-concept-loop-v0',
    target: args.get('--target') || 'evil-orb-inner-engine',
    conceptCount: Number(args.get('--concept-count') || 4),
    socketRadius: Number(args.get('--socket-radius') || 1),
    animationPhase: Number(args.get('--phase') || 0.375),
  });
  const imageCommand = args.get('--image-command');
  if (imageCommand) {
    result.imageRoute = runOrbInnerEngineImageRoute({
      bundleRoot: result.bundleRoot,
      route: args.get('--image-route') || 'local-image.ideogram4',
      command: imageCommand,
      args: args.all('--image-arg'),
      cwd: args.get('--image-cwd') || null,
      timeoutMs: Number(args.get('--image-timeout-ms') || 120000),
    });
  }
  console.log(JSON.stringify(result, null, 2));
}
