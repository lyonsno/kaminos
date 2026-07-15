import { createHash } from 'node:crypto';
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const artifactRoot = dirname(fileURLToPath(import.meta.url));
const greenroomRoot = '/Users/noahlyons/.local/state/gpu-greenroom';
const sourcePath = '/Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-lirm-beta01-gestalt4-flux2-multiref-20260715/cells/prior-shape-0066-preserve-gestalt-clay-depth-normal/output.png';
const denseRoot = '/Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-lirm-0066-shape-guidance-pressure-20260715';
const sparseRoot = '/Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-lirm-0066-sparse-guidance-pressure-20260715';

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
  return {
    stage,
    pressure,
    receipt: receiptFile.value,
    request: requestFile.value,
    receiptSha256: receiptFile.sha256,
    requestSha256: requestFile.sha256,
    input: fileRecord(receiptFile.value.input_path),
    output: fileRecord(join(outputRoot, pressure, 'output.glb')),
    requested: { strength, rescale, interval: [0.6, 1.0] },
    effective: {
      strength: Number(receiptFile.value.effective_route.match(new RegExp(`--${field.replaceAll('_', '-')} ([^ ]+)`))[1]),
      rescale,
      interval: [0.6, 1.0],
    },
    metrics: parseMetrics(log),
  };
});

const witnessJobs = witnessSpecs.flatMap(([stage, pressure, jobIds]) => jobIds.map((jobId, index) => {
  const receiptFile = readJobFile(jobId, 'receipt.json');
  const requestFile = readJobFile(jobId, 'request.json');
  const output = fileRecord(join(receiptFile.value.output_dir, 'render.png'));
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
  };
}));

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
copyFileSync(join(denseRoot, 'shape-guidance-pressure-contact-sheet.png'), denseSheetPath);
copyFileSync(join(sparseRoot, 'sparse-guidance-pressure-contact-sheet.png'), sparseSheetPath);

const receiptPath = join(artifactRoot, 'route-receipts.json');
writeFileSync(receiptPath, `${JSON.stringify(receipts, null, 2)}\n`);

const experiment = {
  schema: 'kaminos.lirm-trellis-guidance-pressure-assay.v1',
  source: fileRecord(sourcePath),
  fixed: {
    seed: 42,
    steps: 6,
    resolution: 512,
    targetFaces: 200000,
    textureSize: 1024,
    cascade: false,
    simplifyFirst: true,
  },
  routeCommits: {
    denseShapeGuidance: 'c3cea40',
    sparseStructureGuidance: 'ee75fdb',
  },
  routeIdentity: {
    knownGoodLocalRunnerChecked: true,
    runner: '/Users/noahlyons/dev/trellis2mlx/.venv/bin/python -u generate.py',
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
      ...fileRecord(denseSheetPath),
      path: 'dense-shape-guidance-pressure-contact-sheet.png',
      height: 1668,
      layout: '3 rows x 4 columns: low 3.0, default 7.5, high 12.0 by left/front/right/rear',
    },
    sparseStructure: {
      ...fileRecord(sparseSheetPath),
      path: 'sparse-structure-guidance-pressure-contact-sheet.png',
      height: 4448,
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
