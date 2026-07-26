#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  contactStateAtUnitPhase,
  runTerrainSupportPersistenceAssay,
  SUPPORT_IDS,
  TERRAIN_SUPPORT_PERSISTENCE_ASSAY_ROUTE,
} from './lirm-terrain-support-persistence-assay-core.mjs';

const EXACT_SOURCE_COMMIT = '7474a954e0f4063c8db290da0a9989119c3d7768';
const SUPPORT_RADIUS = 0.053741624848543126;
const SAMPLE_COUNT = 48;
const TRANSLATION_BUDGET = 0.12;
const ROTATION_BUDGET = 0.5;
const EXPECTED_HASHES = {
  source: 'sha256:8fed20d958ef48797c14ad1d3846a50eae05d43e6ae67f8805060b02f1abde8e',
  samples: 'sha256:017ef8037447494a4f1c17293b9d3b55f105109ebed16635ffbda15a9c31200a',
  atlas: 'sha256:e3007a55f930d709ac8a7bf684ff32ad862e7d55186343220edb3e2ad3635b78',
  phaseReport: 'sha256:97abeb1cdacb802ecf26e2aba6e27ae9d96508e6f85836853b9c3bdd993583ff',
  fittedRegistration: 'sha256:a63fa02ffa7a144234eef3b9902ac9d349fd413d93a19c87ee1464b0b61ca7f9',
  axialRegistration: 'sha256:cb519913ad863441e88555b3d9fbd588ffef03650475de07c29ee1c71f500ff6',
  hillPacket: 'sha256:ab9900438d60ca3356327e700617c65fd65e75e4b2707d8e03da0e2f3dd8e9e2',
  hillData: 'sha256:bd29f0464aecffdd35d79496b744b6d04175b1c2b8a80934fa3c88ed34874fd7',
  stationaryFixture: 'sha256:a84bfcae1ad03f71961bcfc4c9040980648f4c579b1bccc3ba15d82a25a6210a',
};

const EPSILON = 1e-10;

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, path);
}

async function admitFile(path, expectedHash, label) {
  if (!path || !existsSync(path)) throw new Error(`${label} does not exist`);
  const bytes = await readFile(path);
  if (bytes.length === 0) throw new Error(`${label} is blank`);
  const actualHash = sha256(bytes);
  if (actualHash !== expectedHash) {
    throw new Error(`${label} hash mismatch: ${actualHash} != ${expectedHash}`);
  }
  return { bytes, sha256: actualHash };
}

function parseJson(bytes, label) {
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

function requireFinite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be finite`);
  return number;
}

function requireVector3(value, label) {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new Error(`${label} must be a finite vec3`);
  }
  return value.map((component, index) => requireFinite(component, `${label}[${index}]`));
}

function add3(left, right) {
  return left.map((value, index) => value + right[index]);
}

function subtract3(left, right) {
  return left.map((value, index) => value - right[index]);
}

function scale3(vector, scalar) {
  return vector.map(value => value * scalar);
}

function dot3(left, right) {
  return left.reduce((sum, value, index) => sum + value * right[index], 0);
}

function cross3(left, right) {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function normalize3(vector, label) {
  const magnitude = Math.hypot(...vector);
  if (!(magnitude > EPSILON)) throw new Error(`${label} must have non-zero length`);
  return scale3(vector, 1 / magnitude);
}

function fnv1a32(bytes) {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function decodeHeightfield(data) {
  const columns = Number(data?.grid?.columns);
  const rows = Number(data?.grid?.rows);
  const sampleCount = Number(data?.grid?.sampleCount);
  if (!Number.isInteger(columns) || !Number.isInteger(rows)
      || columns < 2 || rows < 2 || sampleCount !== columns * rows) {
    throw new Error('Hill heightfield grid is incomplete');
  }
  const encoded = data.channels?.height;
  if (encoded?.encoding !== 'base64-f32-le'
      || JSON.stringify(encoded.shape) !== JSON.stringify([sampleCount])) {
    throw new Error('Hill height channel encoding or shape mismatch');
  }
  const bytes = Uint8Array.from(Buffer.from(String(encoded.data || ''), 'base64'));
  if (bytes.byteLength !== sampleCount * 4
      || Number(encoded.byteLength) !== bytes.byteLength) {
    throw new Error('Hill height channel byte length mismatch');
  }
  if (fnv1a32(bytes) !== String(encoded.checksum || '')) {
    throw new Error('Hill height channel checksum mismatch');
  }
  const heights = new Float32Array(sampleCount);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let index = 0; index < sampleCount; index += 1) {
    heights[index] = view.getFloat32(index * 4, true);
    if (!Number.isFinite(heights[index])) {
      throw new Error(`Hill height channel sample ${index} is non-finite`);
    }
  }
  const worldBounds = structuredClone(data.worldBounds);
  const xMin = Number(worldBounds?.x?.min);
  const xMax = Number(worldBounds?.x?.max);
  const zMin = Number(worldBounds?.z?.min);
  const zMax = Number(worldBounds?.z?.max);
  const spacingX = Number(data.grid.spacing?.x);
  const spacingZ = Number(data.grid.spacing?.z);
  if (![xMin, xMax, zMin, zMax, spacingX, spacingZ].every(Number.isFinite)
      || xMax <= xMin || zMax <= zMin || spacingX <= 0 || spacingZ <= 0
      || Math.abs(spacingX - (xMax - xMin) / (columns - 1)) > EPSILON
      || Math.abs(spacingZ - (zMax - zMin) / (rows - 1)) > EPSILON) {
    throw new Error('Hill heightfield bounds and spacing disagree');
  }
  return {
    columns,
    rows,
    sampleCount,
    heights,
    worldBounds,
  };
}

function createTerrainSampler(heightfield) {
  const { columns, rows, heights, worldBounds } = heightfield;
  const xMin = worldBounds.x.min;
  const xMax = worldBounds.x.max;
  const zMin = worldBounds.z.min;
  const zMax = worldBounds.z.max;
  const cellWidth = (xMax - xMin) / (columns - 1);
  const cellDepth = (zMax - zMin) / (rows - 1);
  const at = (column, row) => heights[row * columns + column];
  return (worldXInput, worldZInput) => {
    const worldX = requireFinite(worldXInput, 'terrain sample x');
    const worldZ = requireFinite(worldZInput, 'terrain sample z');
    const gridX = (worldX - xMin) / (xMax - xMin) * (columns - 1);
    const gridZ = (worldZ - zMin) / (zMax - zMin) * (rows - 1);
    const clampedX = Math.max(0, Math.min(columns - 1, gridX));
    const clampedZ = Math.max(0, Math.min(rows - 1, gridZ));
    const column0 = Math.min(columns - 2, Math.floor(clampedX));
    const row0 = Math.min(rows - 2, Math.floor(clampedZ));
    const column1 = column0 + 1;
    const row1 = row0 + 1;
    const tx = clampedX - column0;
    const tz = clampedZ - row0;
    const near = at(column0, row0) + (at(column1, row0) - at(column0, row0)) * tx;
    const far = at(column0, row1) + (at(column1, row1) - at(column0, row1)) * tx;
    const height = near + (far - near) * tz;
    const dhdx = (
      (at(column1, row0) - at(column0, row0)) * (1 - tz)
      + (at(column1, row1) - at(column0, row1)) * tz
    ) / cellWidth;
    const dhdz = (
      (at(column0, row1) - at(column0, row0)) * (1 - tx)
      + (at(column1, row1) - at(column1, row0)) * tx
    ) / cellDepth;
    return {
      world: [worldX, height, worldZ],
      normal: normalize3([-dhdx, 1, -dhdz], 'terrain normal'),
      grid: [clampedX, clampedZ],
      inBounds: gridX >= 0 && gridX <= columns - 1 && gridZ >= 0 && gridZ <= rows - 1,
    };
  };
}

function assertExactInputs({
  samples,
  atlas,
  phaseReport,
  fittedRegistration,
  axialRegistration,
  hillPacket,
  hillData,
  stationaryFixture,
}) {
  if (samples.schema !== 'kaminos.lirm-smooth-fitted-flat-support-probe-samples.v0'
      || samples.samples?.length !== SAMPLE_COUNT + 1) {
    throw new Error('probe sample packet schema or sample count mismatch');
  }
  if (atlas.schema !== 'kaminos.creature-contact-atlas.v0'
      || atlas.castHash !== EXPECTED_HASHES.source.slice('sha256:'.length)
      || atlas.registrationHash !== EXPECTED_HASHES.axialRegistration.slice('sha256:'.length)
      || atlas.patches?.length !== SUPPORT_IDS.length) {
    throw new Error('contact atlas identity or shape mismatch');
  }
  if (phaseReport.schema !== 'kaminos.lirm-smooth-fitted-phase-exercise.v0'
      || phaseReport.requestedRoute
        !== 'kaminos/fitted-proxy-rig/arbitrary-phase-flat-support-exercise-v0'
      || phaseReport.effectiveRoute !== phaseReport.requestedRoute
      || phaseReport.effectiveConfig?.sampleCount !== SAMPLE_COUNT + 1) {
    throw new Error('phase report route or effective configuration mismatch');
  }
  if (fittedRegistration.schema !== 'kaminos.lirm-fitted-proxy-rig-registration.v0'
      || fittedRegistration.donorSha256 !== EXPECTED_HASHES.source) {
    throw new Error('fitted registration does not bind the exact source');
  }
  if (axialRegistration.schema !== 'kaminos.axial-crawler-registration.v0'
      || JSON.stringify(axialRegistration.localForwardAxis) !== JSON.stringify([0, 0, -1])
      || JSON.stringify(axialRegistration.localUpAxis) !== JSON.stringify([0, 1, 0])
      || !Number.isFinite(Number(axialRegistration.contactPlaneY))) {
    throw new Error('axial registration frame mismatch');
  }
  if (hillPacket.schema !== 'lerms.hill-of-hills.motion-affordance-packet.v0'
      || hillPacket.ok !== true
      || hillPacket.status !== 'fresh-live-motion-affordance'
      || hillPacket.route !== 'lerms/hill-of-hills/motion-affordance-packet-file'
      || hillPacket.source?.sourceRef
        !== 'lerms:cc/hill-of-hills-live-terrain-server-0702@81c5348'
      || hillPacket.source?.backend !== 'deterministic-cpu-heightfield'
      || hillPacket.source?.configId !== 'hill-of-hills-motion-affordance-packet-v0') {
    throw new Error('Hill packet route or source identity mismatch');
  }
  if (hillData.schema !== 'lerms.hill-of-hills.motion-affordance-data.v0'
      || hillData.sourceTruth?.authority !== 'live_simulation'
      || hillData.sourceTruth?.frameId !== hillPacket.frameId
      || hillData.sourceTruth?.backend !== hillPacket.source.backend
      || hillData.sourceTruth?.configId !== hillPacket.source.configId
      || JSON.stringify(hillPacket.motionAffordanceData?.checksums)
        !== JSON.stringify(hillData.checksums)) {
    throw new Error('Hill packet and data source truth disagree');
  }
  if (stationaryFixture.schema !== 'kaminos.motion-contact-probe-handshake-fixture.v0'
      || stationaryFixture.effectiveRoute
        !== 'kaminos/fitted-proxy-rig/motion-contact-probe-adapter-v0'
      || stationaryFixture.prepass?.supportSurface?.sourceRef !== hillPacket.source.sourceRef
      || stationaryFixture.prepass?.supportSurface?.revision !== '81c5348'
      || stationaryFixture.prepass?.body?.scale !== 1.14
      || stationaryFixture.request?.contactAtlas?.sha256 !== EXPECTED_HASHES.atlas) {
    throw new Error('stationary fixture route or exact source identity mismatch');
  }
  for (const [key, expected] of Object.entries({
    castSha256: EXPECTED_HASHES.source,
    fittedRegistrationSha256: EXPECTED_HASHES.fittedRegistration,
    contactAtlasSha256: EXPECTED_HASHES.atlas,
  })) {
    if (samples.source?.[key] !== expected) {
      throw new Error(`probe sample source ${key} mismatch`);
    }
  }
  const first = samples.samples[0];
  const closure = samples.samples[SAMPLE_COUNT];
  if (first.requestedPhase !== 0 || closure.requestedPhase !== 1
      || first.phase !== 0 || closure.phase !== 0
      || JSON.stringify({ ...first, requestedPhase: 1 })
        !== JSON.stringify({ ...closure, requestedPhase: 1 })) {
    throw new Error('probe samples do not contain one exact periodic closure frame');
  }
  for (let index = 0; index < SAMPLE_COUNT; index += 1) {
    const sample = samples.samples[index];
    if (Math.abs(sample.requestedPhase - index / SAMPLE_COUNT) > EPSILON
        || sample.probes?.length !== SUPPORT_IDS.length) {
      throw new Error(`probe sample ${index} cadence or support shape mismatch`);
    }
    for (const supportId of SUPPORT_IDS) {
      const probe = sample.probes.find(candidate => candidate.id === supportId);
      const patch = atlas.patches.find(candidate => candidate.id === supportId);
      if (!probe || !patch || probe.phaseOffset !== patch.phaseOffset) {
        throw new Error(`probe sample ${index} support ${supportId} identity mismatch`);
      }
    }
  }
}

function createRootFrame(stationaryFixture, axialRegistration) {
  const prepass = stationaryFixture.prepass;
  const rootSurface = requireVector3(prepass.rootSurface, 'root surface');
  const up = normalize3(requireVector3(prepass.frame?.up, 'frame up'), 'frame up');
  const forward = normalize3(
    requireVector3(prepass.frame?.forward, 'frame forward'),
    'frame forward',
  );
  const right = normalize3(requireVector3(prepass.frame?.right, 'frame right'), 'frame right');
  const bodyScale = requireFinite(prepass.body?.scale, 'body scale');
  const rootLift = requireFinite(prepass.support?.rootLift, 'root lift');
  const contactPlaneY = requireFinite(axialRegistration.contactPlaneY, 'contact plane y');
  return {
    origin: add3(rootSurface, scale3(up, rootLift - contactPlaneY * bodyScale)),
    lateral: right,
    normal: up,
    tangent: scale3(forward, -1),
    forward,
    bodyScale,
  };
}

function transformBodyPoint(bodyPoint, frame) {
  const local = requireVector3(bodyPoint, 'body point');
  return add3(frame.origin, scale3(add3(
    add3(scale3(frame.lateral, local[0]), scale3(frame.normal, local[1])),
    scale3(frame.tangent, local[2]),
  ), frame.bodyScale));
}

function buildExactAssayInputs({ samples, atlas, stationaryFixture, axialRegistration, terrainSampler }) {
  const rootFrame = createRootFrame(stationaryFixture, axialRegistration);
  const uniqueSamples = samples.samples.slice(0, SAMPLE_COUNT).map((sample, index) => ({
    sampleId: `sample-${String(index).padStart(2, '0')}`,
    phase: index / SAMPLE_COUNT,
    probes: SUPPORT_IDS.map(id => {
      const probe = sample.probes.find(candidate => candidate.id === id);
      return {
        id,
        phaseOffset: probe.phaseOffset,
        worldPosition: transformBodyPoint(probe.bodyPosition, rootFrame),
      };
    }),
  }));
  const plantTargets = Object.fromEntries(SUPPORT_IDS.map(id => {
    const patch = atlas.patches.find(candidate => candidate.id === id);
    const plantIndex = patch.phaseOffset === 0 ? 0 : SAMPLE_COUNT / 2;
    const releaseIndex = plantIndex + SAMPLE_COUNT / 2;
    const plantSample = uniqueSamples[plantIndex];
    const plantProbe = plantSample.probes.find(probe => probe.id === id);
    if (contactStateAtUnitPhase(plantSample.phase, plantProbe.phaseOffset).state !== 'stance') {
      throw new Error(`${id} declared plant sample is not stance`);
    }
    const terrain = terrainSampler(plantProbe.worldPosition[0], plantProbe.worldPosition[2]);
    if (terrain.inBounds !== true) throw new Error(`${id} plant point is outside the Hill packet`);
    const normal = normalize3(terrain.normal, `${id} terrain normal`);
    const tangentProjection = subtract3(rootFrame.forward, scale3(
      normal,
      dot3(rootFrame.forward, normal),
    ));
    const tangent = normalize3(tangentProjection, `${id} terrain tangent`);
    const bitangent = normalize3(cross3(normal, tangent), `${id} terrain bitangent`);
    return [id, {
      schema: 'kaminos.static-hill-event-support.v0',
      eventId: `${id}:cycle-0`,
      supportId: id,
      supportRegionId: id,
      hillSourceRef: stationaryFixture.prepass.supportSurface.sourceRef,
      hillRevision: stationaryFixture.prepass.supportSurface.revision,
      plantSampleId: plantSample.sampleId,
      releaseSampleId: `sample-${String(releaseIndex).padStart(2, '0')}`,
      plantPhase: plantSample.phase,
      releasePhase: releaseIndex / SAMPLE_COUNT,
      terrainLocalPoint: [terrain.grid[0], terrain.world[1], terrain.grid[1]],
      worldPoint: terrain.world,
      normal,
      tangent,
      bitangent,
      routeProgressAtPlant: 0,
      sourcePhaseAtPlant: plantSample.phase,
      nearestCellDiagnostic: terrain.grid.map(Math.floor),
      transportAuthority: 'none-static-hill-exact-point',
    }];
  }));
  return { rootFrame, uniqueSamples, plantTargets };
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) throw new Error(`unexpected argument: ${key}`);
    const value = argv[++index];
    if (value === undefined) throw new Error(`missing value for ${key}`);
    options[key.slice(2)] = value;
  }
  return options;
}

export async function runExactTerrainSupportPersistenceAssay({
  sourcePath,
  samplesPath,
  atlasPath,
  phaseReportPath,
  fittedRegistrationPath,
  axialRegistrationPath,
  hillPacketPath,
  hillDataPath,
  stationaryFixturePath,
  outDir,
} = {}) {
  const outputRoot = resolve(outDir);
  const reportPath = resolve(outputRoot, 'report.json');
  const startedAt = Date.now();
  const requestedConfig = {
    exactSourceCommit: EXACT_SOURCE_COMMIT,
    sampleCount: SAMPLE_COUNT,
    uniqueCycleOnly: true,
    supportRadius: SUPPORT_RADIUS,
    translationBudget: TRANSLATION_BUDGET,
    rotationBudget: ROTATION_BUDGET,
    rootDegreesOfFreedom: 'translation-plus-small-angle-rotation-vector',
    supportTarget: 'event-frozen-static-hill-exact-point',
    transientFitTarget: 'current-nearest-heightfield-point-fit-samples-only',
    absentSupportConstraints: true,
    permutationFamily: 'exhaustive-4-factorial-support-identity-permutations',
    holdouts: [
      'leave-one-support-out-same-sample-solve',
      'alternating-time-both-parities',
    ],
    heldoutRootReconstruction:
      'immediate-periodic-neighbor-linear-translation-and-small-angle-vector',
    heldoutReconstructionExclusions: [
      'smoothing',
      'fitted-temporal-basis',
      'extrapolation',
      'realization-specific-regularization',
      'post-reconstruction-cap',
    ],
    effectSizeFloorR: 1,
    permutationPercentileGate: 0.05,
    carrier: 'disabled',
    deformation: 'disabled',
    routeProgress: 'frozen',
    sourcePhase: 'frozen',
  };
  const paths = {
    source: sourcePath,
    samples: samplesPath,
    atlas: atlasPath,
    phaseReport: phaseReportPath,
    fittedRegistration: fittedRegistrationPath,
    axialRegistration: axialRegistrationPath,
    hillPacket: hillPacketPath,
    hillData: hillDataPath,
    stationaryFixture: stationaryFixturePath,
  };
  const report = {
    schema: 'kaminos.lirm-terrain-support-persistence-assay.v0',
    status: 'running',
    failurePhase: null,
    requestedRoute: TERRAIN_SUPPORT_PERSISTENCE_ASSAY_ROUTE,
    effectiveRoute: null,
    requestedConfig,
    effectiveConfig: null,
    inputs: Object.fromEntries(Object.entries(paths).map(([id, path]) => [
      id,
      { path: path ? relative(outputRoot, resolve(path)) : null, sha256: null },
    ])),
    sourceTruth: null,
    rootFrame: null,
    supportObjects: null,
    assay: null,
    result: null,
    timing: {
      startedAt: new Date(startedAt).toISOString(),
      finishedAt: null,
      durationSeconds: null,
    },
    lastTrustworthyEvidence: 'invocation recorded; inputs not admitted',
  };
  await writeJsonAtomic(reportPath, report);
  let phase = 'input-admission';
  try {
    const admitted = {};
    for (const [id, path] of Object.entries(paths)) {
      admitted[id] = await admitFile(path, EXPECTED_HASHES[id], id);
      report.inputs[id].sha256 = admitted[id].sha256;
    }
    const parsed = {
      samples: parseJson(admitted.samples.bytes, 'samples'),
      atlas: parseJson(admitted.atlas.bytes, 'atlas'),
      phaseReport: parseJson(admitted.phaseReport.bytes, 'phase report'),
      fittedRegistration: parseJson(
        admitted.fittedRegistration.bytes,
        'fitted registration',
      ),
      axialRegistration: parseJson(admitted.axialRegistration.bytes, 'axial registration'),
      hillPacket: parseJson(admitted.hillPacket.bytes, 'Hill packet'),
      hillData: parseJson(admitted.hillData.bytes, 'Hill data'),
      stationaryFixture: parseJson(admitted.stationaryFixture.bytes, 'stationary fixture'),
    };
    assertExactInputs(parsed);
    report.lastTrustworthyEvidence =
      'all nine exact source hashes, source identities, routes, cadence, and closure admitted';
    await writeJsonAtomic(reportPath, report);

    phase = 'static-hill-support-object-construction';
    const heightfield = decodeHeightfield(parsed.hillData);
    const terrainSampler = createTerrainSampler(heightfield);
    const exactInputs = buildExactAssayInputs({
      ...parsed,
      terrainSampler,
    });
    report.sourceTruth = {
      exactSourceCommit: EXACT_SOURCE_COMMIT,
      castSha256: EXPECTED_HASHES.source,
      hillSourceRef: parsed.hillPacket.source.sourceRef,
      hillRevision: parsed.hillPacket.source.sourceRefDetail.commit,
      hillBackend: parsed.hillPacket.source.backend,
      hillConfigId: parsed.hillPacket.source.configId,
      hillFrameId: parsed.hillPacket.frameId,
    };
    report.rootFrame = exactInputs.rootFrame;
    report.supportObjects = exactInputs.plantTargets;
    report.lastTrustworthyEvidence =
      'four event-scoped exact static-Hill plant points constructed from declared stance starts';
    await writeJsonAtomic(reportPath, report);

    phase = 'exhaustive-holdout-measurement';
    const assay = runTerrainSupportPersistenceAssay({
      samples: exactInputs.uniqueSamples,
      plantTargets: exactInputs.plantTargets,
      terrainSampler,
      supportRadius: SUPPORT_RADIUS,
      translationBudget: TRANSLATION_BUDGET,
      rotationBudget: ROTATION_BUDGET,
    });
    report.effectiveConfig = {
      ...requestedConfig,
      effectiveSampleCount: exactInputs.uniqueSamples.length,
      duplicateClosureExcluded: true,
      supportObjectCount: SUPPORT_IDS.length,
      permutationCount: assay.permutations.length,
      supportHoldoutFoldCount: assay.supportHoldouts.persistent.length,
      timeHoldoutFoldCount: assay.timeHoldouts.persistent.length,
      hillGrid: {
        columns: heightfield.columns,
        rows: heightfield.rows,
        sampleCount: heightfield.sampleCount,
        worldBounds: heightfield.worldBounds,
      },
    };
    report.assay = assay;
    report.result = assay.result;
    report.effectiveRoute = TERRAIN_SUPPORT_PERSISTENCE_ASSAY_ROUTE;
    report.status = 'measured';
    report.lastTrustworthyEvidence =
      'all support folds, time folds, and 24 support-identity permutations measured';
  } catch (error) {
    report.status = 'failed';
    report.failurePhase = phase;
    report.error = { name: error.name, message: error.message };
    report.lastTrustworthyEvidence = `${report.lastTrustworthyEvidence}; failed during ${phase}`;
    throw error;
  } finally {
    const finishedAt = Date.now();
    report.timing.finishedAt = new Date(finishedAt).toISOString();
    report.timing.durationSeconds = (finishedAt - startedAt) / 1000;
    await writeJsonAtomic(reportPath, report);
  }
  return report;
}

const root = dirname(fileURLToPath(import.meta.url));
const defaults = {
  source: resolve(root, 'artifacts/motion-ready-719024/creature.glb'),
  samples: resolve(
    root,
    'artifacts/lirm-719024-smooth-fitted-phase-exercise-v0/flat-support-probe-samples.json',
  ),
  atlas: resolve(
    root,
    'artifacts/lirm-719024-smooth-fitted-phase-exercise-v0/admitted-contact-atlas.json',
  ),
  'phase-report': resolve(
    root,
    'artifacts/lirm-719024-smooth-fitted-phase-exercise-v0/report.json',
  ),
  'fitted-registration': resolve(
    root,
    'artifacts/lirm-719024-fitted-proxy-rig-mechanism-witness-v1/registration.json',
  ),
  'axial-registration': resolve(root, 'artifacts/motion-ready-719024/registration.json'),
  'hill-packet': resolve(
    root,
    'artifacts/motion-ready-719024/hill/motion-affordance-packet.json',
  ),
  'hill-data': resolve(
    root,
    'artifacts/motion-ready-719024/hill/motion-affordance-data.json',
  ),
  'stationary-fixture': resolve(
    root,
    'artifacts/motion-ready-719024/stationary-contact-constraints/producer-fixture.json',
  ),
  out: resolve(root, 'artifacts/lirm-719024-terrain-support-persistence-assay-v0'),
};

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const args = { ...defaults, ...parseArgs(process.argv.slice(2)) };
  runExactTerrainSupportPersistenceAssay({
    sourcePath: args.source,
    samplesPath: args.samples,
    atlasPath: args.atlas,
    phaseReportPath: args['phase-report'],
    fittedRegistrationPath: args['fitted-registration'],
    axialRegistrationPath: args['axial-registration'],
    hillPacketPath: args['hill-packet'],
    hillDataPath: args['hill-data'],
    stationaryFixturePath: args['stationary-fixture'],
    outDir: args.out,
  }).then(report => {
    console.log(JSON.stringify({
      status: report.status,
      classification: report.result.classification,
      dynamicWitnessEarned: report.result.dynamicWitnessEarned,
      criteria: report.result.criteria,
      medianHeldoutTangentialSlipReductionR:
        report.result.medianHeldoutTangentialSlipReductionR,
      permutationFifthPercentileR: report.result.permutationFifthPercentileR,
    }, null, 2));
  }).catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
