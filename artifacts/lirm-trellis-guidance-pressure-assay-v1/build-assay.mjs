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
const sourcePath = '/Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-lirm-beta01-gestalt4-flux2-multiref-20260715/cells/prior-shape-0066-preserve-gestalt-clay-depth-normal/output.png';
const denseRoot = '/Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-lirm-0066-shape-guidance-pressure-20260715';
const sparseRoot = '/Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-lirm-0066-sparse-guidance-pressure-20260715';
const runner = '/Users/noahlyons/dev/trellis2mlx/.venv/bin/python -u generate.py';
const fixed = {
  seed: 42,
  steps: 6,
  resolution: 512,
  targetFaces: 200000,
  textureSize: 1024,
  cascade: false,
  simplifyFirst: true,
};

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const fileRecord = path => {
  const bytes = readFileSync(path);
  return { path, sha256: sha256(bytes), bytes: bytes.length };
};
const readJobFile = (jobId, name) => {
  const path = join(greenroomRoot, 'done', jobId, name);
  const bytes = readFileSync(path);
  return { path, bytes, sha256: sha256(bytes), value: JSON.parse(bytes) };
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
const parseGenerationRoute = (route, stage) => {
  if (!route.startsWith(`${runner} `)) throw new Error(`unexpected Trellis runner: ${route}`);
  const prefix = stage === 'dense-shape' ? 'shape' : 'sparse';
  const noCascadeCount = routeTokenCount(route, 'no-cascade');
  const cascadeCount = routeTokenCount(route, 'cascade');
  if (noCascadeCount + cascadeCount !== 1) {
    throw new Error(`effective route must contain exactly one cascade mode; found no-cascade=${noCascadeCount}, cascade=${cascadeCount}`);
  }
  const simplifyFirstCount = routeTokenCount(route, 'simplify-first');
  if (simplifyFirstCount !== 1) {
    throw new Error(`effective route must contain --simplify-first exactly once; found ${simplifyFirstCount}`);
  }
  const guidance = routeGuidance(route, prefix);
  return {
    inputPath: routeFlag(route, 'image'),
    outputPath: routeFlag(route, 'output'),
    seed: Number(routeFlag(route, 'seed')),
    resolution: Number(routeFlag(route, 'resolution')),
    steps: Number(routeFlag(route, 'steps')),
    targetFaces: Number(routeFlag(route, 'target-faces')),
    textureSize: Number(routeFlag(route, 'texture-size')),
    cascade: cascadeCount === 1,
    simplifyFirst: true,
    ...guidance,
    ...(stage === 'sparse-structure'
      ? { downstreamShapeGuidance: routeGuidance(route, 'shape') }
      : {}),
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

const generationSpecs = [
  ['dense-shape', 'low-3p0', '3b9a7ce7660e', denseRoot, 3.0],
  ['dense-shape', 'default-7p5', '1e02139d2c69', denseRoot, 7.5],
  ['dense-shape', 'high-12p0', 'a4bcdf4e527c', denseRoot, 12.0],
  ['sparse-structure', 'prior-hybrid-0p0', 'a17b0b73a3c0', sparseRoot, 0.0],
  ['sparse-structure', 'hybrid-0p25', 'dbbbe8f6890a', sparseRoot, 0.25],
  ['sparse-structure', 'hybrid-0p50', '9080f9cfb67c', sparseRoot, 0.5],
  ['sparse-structure', 'hybrid-0p75', '24ae28425c8b', sparseRoot, 0.75],
  ['sparse-structure', 'conditioned-1p0', '921254b99ea0', sparseRoot, 1.0],
  ['sparse-structure', 'low-3p0', 'c26feaf2ce7a', sparseRoot, 3.0],
  ['sparse-structure', 'default-7p5', '5f88a30fe45e', sparseRoot, 7.5],
  ['sparse-structure', 'high-12p0', 'f8c43cd68393', sparseRoot, 12.0],
];

const witnessSpecs = [
  ['dense-shape', 'low-3p0', ['f1be411749dd', '686ecdb13a14', 'f6ab8f8a361d', 'c4a92f118570']],
  ['dense-shape', 'default-7p5', ['a32d94e47618', 'c255d0709bc6', 'fd11f6bb215d', '735303bef266']],
  ['dense-shape', 'high-12p0', ['d86ea1b706ff', '58768e47a6a8', '0bbfcae8244e', 'e05a6e576c7e']],
  ['sparse-structure', 'prior-hybrid-0p0', ['96548f5a749d', '1d044df7d7b7', '99a3b7b9d370', 'ba9609316b9f']],
  ['sparse-structure', 'hybrid-0p25', ['82340abf6cce', '4bee2d5e8c7a', 'd13a6fa81cde', '222985a85d52']],
  ['sparse-structure', 'hybrid-0p50', ['5c6a4dfeb4c9', '127e7454dd31', 'f34c42b526c2', '1c1344c06c1c']],
  ['sparse-structure', 'hybrid-0p75', ['11f4a33bb21b', 'faf51625d954', 'f8d97b42e2e1', '424069e9191a']],
  ['sparse-structure', 'conditioned-1p0', ['b57e5b6249c5', 'fa162d8cfe8a', '59ff5d96fed8', '8813ae509bb4']],
  ['sparse-structure', 'low-3p0', ['070735766c75', '8df1ab1e098a', '687b428d2783', 'a39acb5e639a']],
  ['sparse-structure', 'default-7p5', ['1043aca5e51b', '7a03322b5d22', '212fc954c59e', '53747a9988f8']],
  ['sparse-structure', 'high-12p0', ['54b3192bc6a0', 'eedaf9703787', '4818186f33d4', '2c120bddfa8c']],
];
const views = ['left', 'front', 'right', 'rear'];

const parseMetrics = log => {
  const sparse = log.match(/([\d,]+) sparse voxels at/);
  const decoded = log.match(/Decoded: [^(]+\(([\d,]+) voxels\)/);
  const raw = log.match(/([\d,]+) vertices, ([\d,]+) faces/);
  const final = log.match(/Cleanup: .*?([\d,]+)F\s*$/m);
  const duplicates = log.match(/Removed ([\d,]+) duplicate faces/);
  const nonManifold = log.match(/Removed ([\d,]+) non-manifold faces/);
  const holes = log.match(/Filled ([\d,]+) holes \(([\d,]+) too large/);
  if (![sparse, decoded, raw, final, duplicates, nonManifold, holes].every(Boolean)) {
    throw new Error('generation log did not contain the expected geometry metrics');
  }
  return {
    sparseVoxels: integer(sparse[1]),
    denseVoxels: integer(decoded[1]),
    rawVertices: integer(raw[1]),
    rawTriangles: integer(raw[2]),
    finalTriangles: integer(final[1]),
    duplicateFacesRemoved: integer(duplicates[1]),
    nonManifoldFacesRemoved: integer(nonManifold[1]),
    holesFilled: integer(holes[1]),
    holesTooLarge: integer(holes[2]),
  };
};

const generationJobs = generationSpecs.map(([stage, pressure, jobId, outputRoot, strength]) => {
  const receiptFile = readJobFile(jobId, 'receipt.json');
  const requestFile = readJobFile(jobId, 'request.json');
  const log = readFileSync(join(greenroomRoot, 'done', jobId, 'stdout.log'), 'utf8');
  const field = stage === 'dense-shape' ? 'shape_guidance_strength' : 'sparse_guidance_strength';
  const rescale = stage === 'dense-shape' ? 0.5 : 0.7;
  const requested = {
    ...fixed,
    inputPath: requestFile.value.input_path,
    outputPath: join(requestFile.value.output_dir, 'output.glb'),
    strength,
    rescale,
    interval: [0.6, 1.0],
    ...(stage === 'sparse-structure'
      ? {
          downstreamShapeGuidance: {
            strength: 7.5,
            rescale: 0.5,
            interval: [0.6, 1.0],
          },
        }
      : {}),
  };
  const effective = parseGenerationRoute(receiptFile.value.effective_route, stage);
  assertSame(`${jobId} request id`, requestFile.value.job_id, jobId);
  assertSame(`${jobId} receipt id`, receiptFile.value.job_id, jobId);
  assertSame(`${jobId} request input`, requestFile.value.input_path, sourcePath);
  assertSame(`${jobId} receipt input`, receiptFile.value.input_path, sourcePath);
  assertSame(`${jobId} expected output cell`, requestFile.value.output_dir, join(outputRoot, pressure));
  assertSame(`${jobId} receipt output cell`, receiptFile.value.output_dir, requestFile.value.output_dir);
  assertSame(`${jobId} requested stage strength`, Number(requestFile.value.params[field]), strength);
  for (const key of Object.keys(requested)) assertSame(`${jobId} effective ${key}`, effective[key], requested[key]);
  return {
    stage,
    pressure,
    receipt: receiptFile.value,
    request: requestFile.value,
    receiptSha256: receiptFile.sha256,
    requestSha256: requestFile.sha256,
    input: fileRecord(receiptFile.value.input_path),
    output: fileRecord(effective.outputPath),
    requested,
    effective,
    metrics: parseMetrics(log),
  };
});

const witnessJobs = witnessSpecs.flatMap(([stage, pressure, jobIds]) => jobIds.map((jobId, index) => {
  const receiptFile = readJobFile(jobId, 'receipt.json');
  const requestFile = readJobFile(jobId, 'request.json');
  const effectiveCamera = parseWitnessRoute(receiptFile.value.effective_route);
  const generation = generationJobs.find(job => job.stage === stage && job.pressure === pressure);
  if (!generation) throw new Error(`missing generation for witness ${stage}/${pressure}`);
  assertSame(`${jobId} request id`, requestFile.value.job_id, jobId);
  assertSame(`${jobId} receipt id`, receiptFile.value.job_id, jobId);
  assertSame(`${jobId} witness input`, effectiveCamera.inputPath, generation.output.path);
  assertSame(`${jobId} receipt input`, receiptFile.value.input_path, effectiveCamera.inputPath);
  assertSame(`${jobId} request input`, requestFile.value.input_path, effectiveCamera.inputPath);
  assertSame(`${jobId} witness output`, effectiveCamera.outputPath, join(receiptFile.value.output_dir, 'render.png'));
  assertSame(`${jobId} request output dir`, requestFile.value.output_dir, receiptFile.value.output_dir);
  assertSame(`${jobId} yaw`, effectiveCamera.yaw, Number(requestFile.value.params.yaw));
  assertSame(`${jobId} pitch`, effectiveCamera.pitch, Number(requestFile.value.params.pitch));
  const output = fileRecord(effectiveCamera.outputPath);
  return {
    stage,
    pressure,
    view: views[index],
    receipt: receiptFile.value,
    request: requestFile.value,
    receiptSha256: receiptFile.sha256,
    requestSha256: requestFile.sha256,
    input: fileRecord(receiptFile.value.input_path),
    output,
    effectiveCamera,
  };
}));

const contactSheetCells = stage => witnessJobs
  .filter(job => job.stage === stage)
  .map(job => ({
    stage: job.stage,
    pressure: job.pressure,
    view: job.view,
    sourceJobId: job.receipt.job_id,
    sourcePath: job.output.path,
    sourceSha256: job.output.sha256,
    yaw: job.effectiveCamera.yaw,
    pitch: job.effectiveCamera.pitch,
  }));

const buildContactSheet = ({ stage, outputPath, title }) => {
  const cells = contactSheetCells(stage);
  const manifestPath = `${outputPath}.inputs.json`;
  const manifest = {
    width: 2048,
    cellWidth: 512,
    cellHeight: 556,
    imageHeight: 419,
    imageOffsetY: 46,
    headerHeight: 91,
    cells: cells.map(cell => ({
      sourcePath: cell.sourcePath,
      title: title(cell),
      viewLabel: `${cell.view.toUpperCase()} yaw ${cell.yaw}`,
    })),
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  try {
    const result = spawnSync('/usr/bin/swift', [
      join(artifactRoot, 'assemble-contact-sheet.swift'),
      manifestPath,
      outputPath,
    ], { encoding: 'utf8' });
    if (result.status !== 0) {
      throw new Error(`contact sheet assembly failed: ${result.stderr || result.stdout}`);
    }
  } finally {
    unlinkSync(manifestPath);
  }
  return {
    ...fileRecord(outputPath),
    path: outputPath.split('/').at(-1),
    rows: cells.length / 4,
    height: (cells.length / 4) * 556,
    cells,
    assemblySha256: sha256(Buffer.from(JSON.stringify(cells))),
  };
};

const receipts = {
  schema: 'kaminos.lirm-trellis-guidance-pressure-route-receipts.v1',
  allDoneExitZero: [...generationJobs, ...witnessJobs].every(job =>
    job.receipt.status === 'done' && job.receipt.exit_code === 0 && job.receipt.failure_phase === null),
  generationJobs,
  witnessJobs,
};

mkdirSync(artifactRoot, { recursive: true });
const denseSheetPath = join(artifactRoot, 'dense-shape-guidance-pressure-contact-sheet.png');
const sparseSheetPath = join(artifactRoot, 'sparse-structure-guidance-pressure-contact-sheet.png');
const denseSheet = buildContactSheet({
  stage: 'dense-shape',
  outputPath: denseSheetPath,
  title: cell => `DENSE CFG ${generationJobs.find(job => job.stage === cell.stage && job.pressure === cell.pressure).effective.strength.toFixed(2)}`,
});
const sparseSheet = buildContactSheet({
  stage: 'sparse-structure',
  outputPath: sparseSheetPath,
  title: cell => `SPARSE CFG ${generationJobs.find(job => job.stage === cell.stage && job.pressure === cell.pressure).effective.strength.toFixed(2)}`,
});

const receiptPath = join(artifactRoot, 'route-receipts.json');
writeFileSync(receiptPath, `${JSON.stringify(receipts, null, 2)}\n`);

const experiment = {
  schema: 'kaminos.lirm-trellis-guidance-pressure-assay.v1',
  source: fileRecord(sourcePath),
  fixed,
  routeCommits: {
    denseShapeGuidance: 'c3cea40',
    sparseStructureGuidance: 'ee75fdb',
  },
  routeIdentity: {
    knownGoodLocalRunnerChecked: true,
    runner,
    effectiveBackend: 'MLX on Apple Silicon through gpu-greenroom strict FIFO',
    firstReceiptProvesRoute: true,
    heavyRunAcceptedBeforeProof: false,
  },
  rejectedWitnessSubmissions: {
    reason: 'Repeated -p groups retained only pitch, leaving every yaw at the route default 0.0.',
    admittedToAssay: false,
    replacementEvidence: 'witness-valid tree with one -p group containing yaw and pitch',
  },
  contactSheets: {
    denseShape: {
      ...denseSheet,
      layout: '3 rows x 4 columns: low 3.0, default 7.5, high 12.0 by left/front/right/rear',
    },
    sparseStructure: {
      ...sparseSheet,
      layout: '8 rows x 4 columns: sparse CFG 0.0, 0.25, 0.5, 0.75, 1.0, 3.0, 7.5, 12.0 by left/front/right/rear',
    },
  },
  routeReceiptManifest: fileRecord(receiptPath),
};

writeFileSync(join(artifactRoot, 'experiment.json'), `${JSON.stringify(experiment, null, 2)}\n`);
console.log(JSON.stringify({
  artifactRoot,
  generationJobs: generationJobs.length,
  witnessJobs: witnessJobs.length,
  denseSheetSha256: experiment.contactSheets.denseShape.sha256,
  sparseSheetSha256: experiment.contactSheets.sparseStructure.sha256,
  receiptSha256: experiment.routeReceiptManifest.sha256,
}, null, 2));
