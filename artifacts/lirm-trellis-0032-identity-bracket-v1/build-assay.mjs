import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertCleanJob,
  assertUsefulPngEvidence,
  inspectPngEvidence,
} from '../lirm-trellis-multisource-sparse-guidance-v1/evidence-admission.mjs';

const artifactRoot = dirname(fileURLToPath(import.meta.url));
const failurePath = join(artifactRoot, 'assembly-failure.json');
let lastTrustworthyEvidence = 'source input and fixed route contract';
let primaryArtifactWritten = false;
rmSync(failurePath, { force: true });
process.on('uncaughtException', error => {
  writeFileSync(failurePath, `${JSON.stringify({
    schema: 'kaminos.visual-evidence-assembly-failure.v1',
    phase: 'route-evidence-admission',
    error: error.stack ?? String(error),
    lastTrustworthyEvidence,
    primaryArtifactWritten,
    recordedAt: new Date().toISOString(),
  }, null, 2)}\n`);
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exitCode = 1;
});
const greenroomRoot = '/Users/noahlyons/.local/state/gpu-greenroom';
const source = {
  id: '0032',
  path: '/Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-lirm-beta01-gestalt4-flux2-multiref-20260715/cells/prior-shape-0032-prior-forward-clay-normal/output.png',
};
const runner = '/Users/noahlyons/dev/trellis2mlx/.venv/bin/python -u generate.py';
const routeIdentity = {
  generationJobType: 'trellis2mlx_molten_sparse_pressure_ee75fdb',
  generationEffectiveCwd: '/private/tmp/trellis2mlx-molten-shape-guidance-pressure-0715',
  witnessJobType: 'kaminos_blender_glb_witness_molten_0715',
  witnessEffectiveCwd: '/private/tmp/kaminos-molten-lirm-speciation-armature-recovery-0714',
  runner,
  effectiveBackend: 'MLX on Apple Silicon through gpu-greenroom strict FIFO',
};
const fixed = {
  seed: 42,
  steps: 6,
  resolution: 512,
  targetFaces: 200000,
  textureSize: 1024,
  cascade: false,
  simplifyFirst: true,
  sparseGuidanceRescale: 0.7,
  sparseGuidanceInterval: [0.6, 1.0],
  downstreamShapeGuidance: { strength: 7.5, rescale: 0.5, interval: [0.6, 1.0] },
};
const views = [
  { id: 'left', yaw: -0.85 },
  { id: 'front', yaw: 0 },
  { id: 'right', yaw: 0.85 },
  { id: 'rear', yaw: 3.141593 },
];
const rows = [
  {
    id: 'cfg-1p00', strength: 1, generationJobId: '408143730b5e',
    outputDir: '/Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-lirm-0032-sparse-recovery-20260715/cfg-1p0',
    witnessJobIds: ['ac7a8c0d8661', 'e73934f413af', '4ab3a2afc1ee', 'b40b8f9ee145'],
  },
  {
    id: 'cfg-2p00', strength: 2, generationJobId: '3d0232193272',
    outputDir: '/Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-lirm-0032-identity-bracket-20260715/cfg-2p0',
    witnessJobIds: [process.env.KAMINOS_0032_CFG2_LEFT_JOB_ID ?? '19bea65b5bc7', 'be85a5eaf53a', 'fc55e3cca11e', '4d6a11890281'],
  },
  {
    id: 'cfg-4p00', strength: 4, generationJobId: 'e9c52ec7687b',
    outputDir: '/Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-lirm-0032-identity-bracket-20260715/cfg-4p0',
    witnessJobIds: ['24723c1686bf', '74de4b1eeed6', '9b9a6d64009d', '0354022cc1b4'],
  },
];
const excludedWitnessJobs = [{
  jobId: '7846c3d4b3a3',
  duplicatesAdmittedJobId: '19bea65b5bc7',
  cell: 'cfg-2p00/left',
  reason: 'redundant submission excluded before evidence assembly',
}];

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const fileRecord = path => {
  const bytes = readFileSync(path);
  return { path, sha256: sha256(bytes), bytes: bytes.length };
};
const readJobFile = (jobId, name) => {
  const path = join(greenroomRoot, 'done', jobId, name);
  const bytes = readFileSync(path);
  return { path, sha256: sha256(bytes), value: JSON.parse(bytes) };
};
const same = (label, actual, expected) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};
const routeMatches = (route, name) => [...route.matchAll(new RegExp(`(?:^| )--${name} ([^ ]+)`, 'g'))];
const routeFlag = (route, name) => {
  const matches = routeMatches(route, name);
  if (matches.length !== 1) throw new Error(`effective route must contain --${name} exactly once; found ${matches.length}`);
  return matches[0][1];
};
const routeTokenCount = (route, name) => [...route.matchAll(new RegExp(`(?:^| )--${name}(?= |$)`, 'g'))].length;
const guidance = (route, prefix) => ({
  strength: Number(routeFlag(route, `${prefix}-guidance-strength`)),
  rescale: Number(routeFlag(route, `${prefix}-guidance-rescale`)),
  interval: [Number(routeFlag(route, `${prefix}-guidance-low`)), Number(routeFlag(route, `${prefix}-guidance-high`))],
});
const parseGenerationRoute = route => {
  if (!route.startsWith(`${runner} `)) throw new Error(`unexpected Trellis runner: ${route}`);
  const noCascade = routeTokenCount(route, 'no-cascade');
  const cascade = routeTokenCount(route, 'cascade');
  if (noCascade + cascade !== 1) throw new Error(`effective route must contain exactly one cascade mode`);
  if (routeTokenCount(route, 'simplify-first') !== 1) throw new Error('effective route must contain --simplify-first exactly once');
  return {
    inputPath: routeFlag(route, 'image'),
    outputPath: routeFlag(route, 'output'),
    seed: Number(routeFlag(route, 'seed')),
    steps: Number(routeFlag(route, 'steps')),
    resolution: Number(routeFlag(route, 'resolution')),
    targetFaces: Number(routeFlag(route, 'target-faces')),
    textureSize: Number(routeFlag(route, 'texture-size')),
    cascade: cascade === 1,
    simplifyFirst: true,
    ...guidance(route, 'sparse'),
    downstreamShapeGuidance: guidance(route, 'shape'),
  };
};
const parseWitnessRoute = route => {
  const split = route.split(' -- ');
  if (split.length !== 2) throw new Error(`witness route lacks one argument delimiter: ${route}`);
  const args = split[1].split(' ');
  if (args.length !== 4) throw new Error(`witness route must end in input output yaw pitch: ${route}`);
  return { inputPath: args[0], outputPath: args[1], yaw: Number(args[2]), pitch: Number(args[3]) };
};
const integer = value => Number(value.replaceAll(',', ''));
const parseMetrics = log => {
  const sparse = log.match(/([\d,]+) sparse voxels at/);
  const decoded = log.match(/Decoded: [^(]+\(([\d,]+) voxels\)/);
  const raw = log.match(/([\d,]+) vertices, ([\d,]+) faces/);
  const final = log.match(/Cleanup: .*?([\d,]+)F\s*$/m);
  const duplicates = log.match(/Removed ([\d,]+) duplicate faces/);
  const nonManifold = log.match(/Removed ([\d,]+) non-manifold faces/);
  const holes = log.match(/Filled ([\d,]+) holes \(([\d,]+) too large/);
  if (![sparse, decoded, raw, final, nonManifold, holes].every(Boolean)) throw new Error('generation log lacks geometry metrics');
  return {
    sparseVoxels: integer(sparse[1]), denseVoxels: integer(decoded[1]),
    rawVertices: integer(raw[1]), rawTriangles: integer(raw[2]), finalTriangles: integer(final[1]),
    duplicateFacesRemoved: duplicates ? integer(duplicates[1]) : 0,
    nonManifoldFacesRemoved: integer(nonManifold[1]), holesFilled: integer(holes[1]), holesTooLarge: integer(holes[2]),
  };
};

const generationJobs = rows.map(row => {
  const receiptFile = readJobFile(row.generationJobId, 'receipt.json');
  const requestFile = readJobFile(row.generationJobId, 'request.json');
  assertCleanJob(receiptFile.value, {
    jobType: routeIdentity.generationJobType,
    effectiveCwd: routeIdentity.generationEffectiveCwd,
  }, row.generationJobId);
  const effective = parseGenerationRoute(receiptFile.value.effective_route);
  const requested = {
    inputPath: source.path, outputPath: join(row.outputDir, 'output.glb'),
    seed: fixed.seed, steps: fixed.steps, resolution: fixed.resolution,
    targetFaces: fixed.targetFaces, textureSize: fixed.textureSize,
    cascade: fixed.cascade, simplifyFirst: fixed.simplifyFirst,
    strength: row.strength, rescale: fixed.sparseGuidanceRescale,
    interval: fixed.sparseGuidanceInterval, downstreamShapeGuidance: fixed.downstreamShapeGuidance,
  };
  same(`${row.id} effective route`, effective, requested);
  same(`${row.id} request id`, requestFile.value.job_id, row.generationJobId);
  same(`${row.id} request input`, requestFile.value.input_path, source.path);
  same(`${row.id} request output`, requestFile.value.output_dir, row.outputDir);
  return {
    row: row.id, receipt: receiptFile.value, request: requestFile.value,
    receiptSha256: receiptFile.sha256, requestSha256: requestFile.sha256,
    input: fileRecord(source.path), output: fileRecord(effective.outputPath), requested, effective,
    metrics: parseMetrics(readFileSync(join(greenroomRoot, 'done', row.generationJobId, 'stdout.log'), 'utf8')),
  };
});
lastTrustworthyEvidence = 'three completed generation routes with admitted geometry metrics';

let admittedWitnessCount = 0;
const witnessJobs = rows.flatMap((row, rowIndex) => row.witnessJobIds.map((jobId, viewIndex) => {
  const generation = generationJobs[rowIndex];
  const view = views[viewIndex];
  const receiptFile = readJobFile(jobId, 'receipt.json');
  const requestFile = readJobFile(jobId, 'request.json');
  assertCleanJob(receiptFile.value, {
    jobType: routeIdentity.witnessJobType,
    effectiveCwd: routeIdentity.witnessEffectiveCwd,
  }, jobId);
  const effectiveCamera = parseWitnessRoute(receiptFile.value.effective_route);
  same(`${jobId} request id`, requestFile.value.job_id, jobId);
  same(`${jobId} witness input`, effectiveCamera.inputPath, generation.output.path);
  same(`${jobId} receipt input`, receiptFile.value.input_path, generation.output.path);
  same(`${jobId} request input`, requestFile.value.input_path, generation.output.path);
  same(`${jobId} request output`, requestFile.value.output_dir, receiptFile.value.output_dir);
  same(`${jobId} yaw`, effectiveCamera.yaw, view.yaw);
  same(`${jobId} pitch`, effectiveCamera.pitch, 0.2);
  const output = fileRecord(effectiveCamera.outputPath);
  const visualEvidence = inspectPngEvidence(readFileSync(effectiveCamera.outputPath));
  assertUsefulPngEvidence(visualEvidence, {}, jobId);
  admittedWitnessCount += 1;
  lastTrustworthyEvidence = admittedWitnessCount === 4
    ? 'CFG 1.00 generation and four admitted camera witnesses'
    : `${admittedWitnessCount} admitted camera witnesses`;
  return {
    row: row.id, strength: row.strength, view: view.id,
    receipt: receiptFile.value, request: requestFile.value,
    receiptSha256: receiptFile.sha256, requestSha256: requestFile.sha256,
    input: fileRecord(generation.output.path), output, visualEvidence, effectiveCamera,
  };
}));

const cells = witnessJobs.map(job => ({
  strength: job.strength, row: job.row, view: job.view,
  sourceJobId: job.receipt.job_id, sourcePath: job.output.path, sourceSha256: job.output.sha256,
  yaw: job.effectiveCamera.yaw, pitch: job.effectiveCamera.pitch,
}));
const sheetPath = join(artifactRoot, '0032-identity-bracket-contact-sheet.png');
const sheetTempPath = `${sheetPath}.tmp-${process.pid}.png`;
const manifestPath = `${sheetPath}.inputs.json`;
mkdirSync(artifactRoot, { recursive: true });
writeFileSync(manifestPath, `${JSON.stringify({
  width: 2048, cellWidth: 512, cellHeight: 556, imageHeight: 419, imageOffsetY: 46, headerHeight: 91,
  cells: cells.map(cell => ({
    sourcePath: cell.sourcePath,
    title: `SRC 0032 / SPARSE CFG ${cell.strength.toFixed(2)}`,
    viewLabel: `${cell.view.toUpperCase()} yaw ${cell.yaw}`,
  })),
}, null, 2)}\n`);
let sheetVisualEvidence;
try {
  const result = spawnSync('/usr/bin/swift', [
    join(artifactRoot, '..', 'lirm-trellis-guidance-pressure-assay-v1', 'assemble-contact-sheet.swift'),
    manifestPath, sheetTempPath,
  ], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`contact sheet assembly failed: ${result.stderr || result.stdout}`);
  sheetVisualEvidence = inspectPngEvidence(readFileSync(sheetTempPath));
  assertUsefulPngEvidence(sheetVisualEvidence, { minWidth: 2048, minHeight: 1668 }, '0032 identity bracket contact sheet');
  renameSync(sheetTempPath, sheetPath);
  primaryArtifactWritten = true;
  lastTrustworthyEvidence = 'route-bound 3x4 contact sheet admitted by PNG evidence checks';
} finally {
  unlinkSync(manifestPath);
  rmSync(sheetTempPath, { force: true });
}

const receipts = {
  schema: 'kaminos.lirm-trellis-0032-identity-bracket-route-receipts.v1',
  allDoneExitZero: true, generationJobs, witnessJobs, excludedWitnessJobs,
};
const receiptPath = join(artifactRoot, 'route-receipts.json');
writeFileSync(receiptPath, `${JSON.stringify(receipts, null, 2)}\n`);
const sheet = {
  ...fileRecord(sheetPath), path: sheetPath.split('/').at(-1), rows: rows.length, cells,
  visualEvidence: sheetVisualEvidence,
  assemblySha256: sha256(Buffer.from(JSON.stringify(cells))),
  layout: 'three sparse CFG rows x left/front/right/rear views',
};
const experiment = {
  schema: 'kaminos.lirm-trellis-0032-identity-bracket.v1',
  source: { ...source, ...fileRecord(source.path) },
  pressures: rows.map(row => row.strength), fixed, routeCommit: 'ee75fdb', routeIdentity,
  contactSheet: sheet, routeReceiptManifest: fileRecord(receiptPath),
};
writeFileSync(join(artifactRoot, 'experiment.json'), `${JSON.stringify(experiment, null, 2)}\n`);
console.log(JSON.stringify({
  artifactRoot, generationJobs: generationJobs.length, witnessJobs: witnessJobs.length,
  sheetSha256: sheet.sha256, receiptSha256: experiment.routeReceiptManifest.sha256,
}, null, 2));
