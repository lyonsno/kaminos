import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const artifactRoot = dirname(fileURLToPath(import.meta.url));
const greenroomRoot = '/Users/noahlyons/.local/state/gpu-greenroom';
const runner = '/Users/noahlyons/dev/trellis2mlx/.venv/bin/python -u generate.py';
const fixed = {
  seed: 42,
  steps: 6,
  resolution: 512,
  targetFaces: 200000,
  textureSize: 1024,
  cascade: false,
  simplifyFirst: true,
  downstreamShapeGuidance: {
    strength: 7.5,
    rescale: 0.5,
    interval: [0.6, 1.0],
  },
};
const pressures = [
  { id: 'prior-hybrid-0p0', strength: 0 },
  { id: 'hybrid-0p25', strength: 0.25 },
  { id: 'hybrid-0p50', strength: 0.5 },
];
const sources = [
  {
    id: '0066',
    path: '/Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-lirm-beta01-gestalt4-flux2-multiref-20260715/cells/prior-shape-0066-preserve-gestalt-clay-depth-normal/output.png',
    generations: {
      'prior-hybrid-0p0': { jobId: 'a17b0b73a3c0', outputDir: '/Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-lirm-0066-sparse-guidance-pressure-20260715/prior-hybrid-0p0' },
      'hybrid-0p25': { jobId: 'dbbbe8f6890a', outputDir: '/Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-lirm-0066-sparse-guidance-pressure-20260715/hybrid-0p25' },
      'hybrid-0p50': { jobId: '9080f9cfb67c', outputDir: '/Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-lirm-0066-sparse-guidance-pressure-20260715/hybrid-0p50' },
    },
  },
  {
    id: '0032',
    path: '/Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-lirm-beta01-gestalt4-flux2-multiref-20260715/cells/prior-shape-0032-prior-forward-clay-normal/output.png',
    generations: {
      'prior-hybrid-0p0': { jobId: '619722d00d51', outputDir: '/Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-lirm-multisource-sparse-guidance-20260715/source-0032/cfg-0p0' },
      'hybrid-0p25': { jobId: '05501f23a0af', outputDir: '/Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-lirm-multisource-sparse-guidance-20260715/source-0032/cfg-0p25' },
      'hybrid-0p50': { jobId: '5b3455019187', outputDir: '/Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-lirm-multisource-sparse-guidance-20260715/source-0032/cfg-0p5' },
    },
  },
  {
    id: '0087',
    path: '/Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-lirm-beta01-gestalt4-flux2-3stance-20260715/cells/prior-shape-0087-preserve-gestalt/output.png',
    generations: {
      'prior-hybrid-0p0': { jobId: 'f3df4494fa60', outputDir: '/Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-lirm-multisource-sparse-guidance-20260715/source-0087/cfg-0p0' },
      'hybrid-0p25': { jobId: '621ec0ff8e1a', outputDir: '/Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-lirm-multisource-sparse-guidance-20260715/source-0087/cfg-0p25' },
      'hybrid-0p50': { jobId: '791f61ee1225', outputDir: '/Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-lirm-multisource-sparse-guidance-20260715/source-0087/cfg-0p5' },
    },
  },
];
const views = ['left', 'front', 'right', 'rear'];

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
const integer = value => Number(value.replaceAll(',', ''));
const assertSame = (label, actual, expected) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};
const routeFlagMatches = (route, name) => [
  ...route.matchAll(new RegExp(`(?:^| )--${name} ([^ ]+)`, 'g')),
];
const routeFlag = (route, name) => {
  const matches = routeFlagMatches(route, name);
  if (matches.length !== 1) {
    throw new Error(`effective route must contain --${name} exactly once; found ${matches.length}`);
  }
  return matches[0][1];
};
const routeTokenCount = (route, name) => [
  ...route.matchAll(new RegExp(`(?:^| )--${name}(?= |$)`, 'g')),
].length;
const routeGuidance = (route, prefix) => ({
  strength: Number(routeFlag(route, `${prefix}-guidance-strength`)),
  rescale: Number(routeFlag(route, `${prefix}-guidance-rescale`)),
  interval: [
    Number(routeFlag(route, `${prefix}-guidance-low`)),
    Number(routeFlag(route, `${prefix}-guidance-high`)),
  ],
});
const parseGenerationRoute = route => {
  if (!route.startsWith(`${runner} `)) throw new Error(`unexpected Trellis runner: ${route}`);
  const noCascadeCount = routeTokenCount(route, 'no-cascade');
  const cascadeCount = routeTokenCount(route, 'cascade');
  if (noCascadeCount + cascadeCount !== 1) {
    throw new Error(`effective route must contain exactly one cascade mode; found no-cascade=${noCascadeCount}, cascade=${cascadeCount}`);
  }
  const simplifyFirstCount = routeTokenCount(route, 'simplify-first');
  if (simplifyFirstCount !== 1) {
    throw new Error(`effective route must contain --simplify-first exactly once; found ${simplifyFirstCount}`);
  }
  return {
    inputPath: routeFlag(route, 'image'),
    outputPath: routeFlag(route, 'output'),
    seed: Number(routeFlag(route, 'seed')),
    steps: Number(routeFlag(route, 'steps')),
    resolution: Number(routeFlag(route, 'resolution')),
    targetFaces: Number(routeFlag(route, 'target-faces')),
    textureSize: Number(routeFlag(route, 'texture-size')),
    cascade: cascadeCount === 1,
    simplifyFirst: true,
    ...routeGuidance(route, 'sparse'),
    downstreamShapeGuidance: routeGuidance(route, 'shape'),
  };
};
const parseWitnessRoute = route => {
  const split = route.split(' -- ');
  if (split.length !== 2) throw new Error(`witness route lacks one argument delimiter: ${route}`);
  const args = split[1].split(' ');
  if (args.length !== 4) throw new Error(`witness route must end in input output yaw pitch: ${route}`);
  return {
    inputPath: args[0],
    outputPath: args[1],
    yaw: Number(args[2]),
    pitch: Number(args[3]),
  };
};
const parseMetrics = log => {
  const sparse = log.match(/([\d,]+) sparse voxels at/);
  const decoded = log.match(/Decoded: [^(]+\(([\d,]+) voxels\)/);
  const raw = log.match(/([\d,]+) vertices, ([\d,]+) faces/);
  const final = log.match(/Cleanup: .*?([\d,]+)F\s*$/m);
  const duplicates = log.match(/Removed ([\d,]+) duplicate faces/);
  const nonManifold = log.match(/Removed ([\d,]+) non-manifold faces/);
  const holes = log.match(/Filled ([\d,]+) holes \(([\d,]+) too large/);
  if (![sparse, decoded, raw, final, nonManifold, holes].every(Boolean)) {
    throw new Error('generation log did not contain the expected geometry metrics');
  }
  return {
    sparseVoxels: integer(sparse[1]),
    denseVoxels: integer(decoded[1]),
    rawVertices: integer(raw[1]),
    rawTriangles: integer(raw[2]),
    finalTriangles: integer(final[1]),
    duplicateFacesRemoved: duplicates ? integer(duplicates[1]) : 0,
    nonManifoldFacesRemoved: integer(nonManifold[1]),
    holesFilled: integer(holes[1]),
    holesTooLarge: integer(holes[2]),
  };
};

const generationJobs = sources.flatMap(source => pressures.map(pressure => {
  const spec = source.generations[pressure.id];
  const receiptFile = readJobFile(spec.jobId, 'receipt.json');
  const requestFile = readJobFile(spec.jobId, 'request.json');
  const log = readFileSync(join(greenroomRoot, 'done', spec.jobId, 'stdout.log'), 'utf8');
  const requested = {
    inputPath: source.path,
    outputPath: join(spec.outputDir, 'output.glb'),
    seed: fixed.seed,
    steps: fixed.steps,
    resolution: fixed.resolution,
    targetFaces: fixed.targetFaces,
    textureSize: fixed.textureSize,
    cascade: fixed.cascade,
    simplifyFirst: fixed.simplifyFirst,
    strength: pressure.strength,
    rescale: 0.7,
    interval: [0.6, 1.0],
    downstreamShapeGuidance: fixed.downstreamShapeGuidance,
  };
  const effective = parseGenerationRoute(receiptFile.value.effective_route);
  assertSame(`${spec.jobId} request id`, requestFile.value.job_id, spec.jobId);
  assertSame(`${spec.jobId} receipt id`, receiptFile.value.job_id, spec.jobId);
  assertSame(`${spec.jobId} request input`, requestFile.value.input_path, source.path);
  assertSame(`${spec.jobId} receipt input`, receiptFile.value.input_path, source.path);
  assertSame(`${spec.jobId} request output`, requestFile.value.output_dir, spec.outputDir);
  assertSame(`${spec.jobId} receipt output`, receiptFile.value.output_dir, spec.outputDir);
  for (const key of Object.keys(requested)) {
    assertSame(`${spec.jobId} effective ${key}`, effective[key], requested[key]);
  }
  return {
    sourceId: source.id,
    pressure: pressure.id,
    receipt: receiptFile.value,
    request: requestFile.value,
    receiptSha256: receiptFile.sha256,
    requestSha256: requestFile.sha256,
    input: fileRecord(source.path),
    output: fileRecord(effective.outputPath),
    requested,
    effective,
    metrics: parseMetrics(log),
  };
}));

const witnessIds = JSON.parse(readFileSync(join(artifactRoot, 'witness-jobs.json'), 'utf8'));
const witnessJobs = generationJobs.flatMap(generation => {
  const key = `${generation.sourceId}/${generation.pressure}`;
  const jobIds = witnessIds[key];
  if (!Array.isArray(jobIds) || jobIds.length !== views.length) {
    throw new Error(`witness-jobs.json must provide four jobs for ${key}`);
  }
  return jobIds.map((jobId, index) => {
    const receiptFile = readJobFile(jobId, 'receipt.json');
    const requestFile = readJobFile(jobId, 'request.json');
    const effectiveCamera = parseWitnessRoute(receiptFile.value.effective_route);
    assertSame(`${jobId} request id`, requestFile.value.job_id, jobId);
    assertSame(`${jobId} receipt id`, receiptFile.value.job_id, jobId);
    assertSame(`${jobId} witness input`, effectiveCamera.inputPath, generation.output.path);
    assertSame(`${jobId} receipt input`, receiptFile.value.input_path, generation.output.path);
    assertSame(`${jobId} request input`, requestFile.value.input_path, generation.output.path);
    assertSame(`${jobId} witness output`, effectiveCamera.outputPath, join(receiptFile.value.output_dir, 'render.png'));
    assertSame(`${jobId} request output`, requestFile.value.output_dir, receiptFile.value.output_dir);
    assertSame(`${jobId} yaw`, effectiveCamera.yaw, Number(requestFile.value.params.yaw));
    assertSame(`${jobId} pitch`, effectiveCamera.pitch, Number(requestFile.value.params.pitch));
    return {
      sourceId: generation.sourceId,
      pressure: generation.pressure,
      view: views[index],
      receipt: receiptFile.value,
      request: requestFile.value,
      receiptSha256: receiptFile.sha256,
      requestSha256: requestFile.sha256,
      input: fileRecord(generation.output.path),
      output: fileRecord(effectiveCamera.outputPath),
      effectiveCamera,
    };
  });
});

const cells = witnessJobs.map(job => ({
  sourceId: job.sourceId,
  pressure: job.pressure,
  view: job.view,
  sourceJobId: job.receipt.job_id,
  sourcePath: job.output.path,
  sourceSha256: job.output.sha256,
  yaw: job.effectiveCamera.yaw,
  pitch: job.effectiveCamera.pitch,
}));
const sheetPath = join(artifactRoot, 'multisource-sparse-guidance-contact-sheet.png');
const manifestPath = `${sheetPath}.inputs.json`;
writeFileSync(manifestPath, `${JSON.stringify({
  width: 2048,
  cellWidth: 512,
  cellHeight: 556,
  imageHeight: 419,
  imageOffsetY: 46,
  headerHeight: 91,
  cells: cells.map(cell => ({
    sourcePath: cell.sourcePath,
    title: `SRC ${cell.sourceId} / CFG ${generationJobs.find(job => job.sourceId === cell.sourceId && job.pressure === cell.pressure).effective.strength.toFixed(2)}`,
    viewLabel: `${cell.view.toUpperCase()} yaw ${cell.yaw}`,
  })),
}, null, 2)}\n`);
try {
  const result = spawnSync('/usr/bin/swift', [
    join(artifactRoot, '..', 'lirm-trellis-guidance-pressure-assay-v1', 'assemble-contact-sheet.swift'),
    manifestPath,
    sheetPath,
  ], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`contact sheet assembly failed: ${result.stderr || result.stdout}`);
  }
} finally {
  unlinkSync(manifestPath);
}

const receipts = {
  schema: 'kaminos.lirm-trellis-multisource-sparse-guidance-route-receipts.v1',
  allDoneExitZero: [...generationJobs, ...witnessJobs].every(job =>
    job.receipt.status === 'done' && job.receipt.exit_code === 0 && job.receipt.failure_phase === null),
  generationJobs,
  witnessJobs,
};
mkdirSync(artifactRoot, { recursive: true });
const receiptPath = join(artifactRoot, 'route-receipts.json');
writeFileSync(receiptPath, `${JSON.stringify(receipts, null, 2)}\n`);

const sheet = {
  ...fileRecord(sheetPath),
  path: sheetPath.split('/').at(-1),
  rows: cells.length / 4,
  cells,
  assemblySha256: sha256(Buffer.from(JSON.stringify(cells))),
  layout: 'three source sections x three sparse CFG rows x left/front/right/rear views',
};
const experiment = {
  schema: 'kaminos.lirm-trellis-multisource-sparse-guidance.v1',
  sources: sources.map(source => ({ id: source.id, ...fileRecord(source.path) })),
  fixed,
  routeCommit: 'ee75fdb',
  routeIdentity: {
    knownGoodLocalRunnerChecked: true,
    runner,
    effectiveBackend: 'MLX on Apple Silicon through gpu-greenroom strict FIFO',
    firstReceiptProvesRoute: true,
    heavyRunAcceptedBeforeProof: false,
  },
  contactSheet: sheet,
  routeReceiptManifest: fileRecord(receiptPath),
};
writeFileSync(join(artifactRoot, 'experiment.json'), `${JSON.stringify(experiment, null, 2)}\n`);

console.log(JSON.stringify({
  artifactRoot,
  generationJobs: generationJobs.length,
  witnessJobs: witnessJobs.length,
  sheetSha256: sheet.sha256,
  receiptSha256: experiment.routeReceiptManifest.sha256,
}, null, 2));
