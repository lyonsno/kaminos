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
const greenroomRoot = '/Users/noahlyons/.local/state/gpu-greenroom';
const identityRoot = join(artifactRoot, '..', 'lirm-trellis-0032-identity-bracket-v1');
let lastTrustworthyEvidence = 'reviewed CFG 2/4 identity-bracket artifact';
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

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const fileRecord = path => {
  const bytes = readFileSync(path);
  return { path, sha256: sha256(bytes), bytes: bytes.length };
};
const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
const readJob = jobId => {
  const root = join(greenroomRoot, 'done', jobId);
  return {
    receipt: readJson(join(root, 'receipt.json')),
    request: readJson(join(root, 'request.json')),
    receiptRecord: fileRecord(join(root, 'receipt.json')),
    requestRecord: fileRecord(join(root, 'request.json')),
  };
};
const same = (label, actual, expected) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

const upstreamExperimentPath = join(identityRoot, 'experiment.json');
const upstreamReceiptsPath = join(identityRoot, 'route-receipts.json');
const upstreamExperiment = readJson(upstreamExperimentPath);
const upstreamReceipts = readJson(upstreamReceiptsPath);
const source = upstreamExperiment.source;
const fixed = upstreamExperiment.fixed;
const routeIdentity = upstreamExperiment.routeIdentity;
const expectedYaw = new Map([
  ['left', -0.85],
  ['front', 0],
  ['right', 0.85],
  ['rear', 3.141593],
]);
const views = [...expectedYaw].map(([id, yaw]) => ({ id, yaw, pitch: 0.2 }));

const upstreamRows = new Map(upstreamReceipts.generationJobs.map(job => [job.row, job]));
const upstreamWitnesses = new Map(upstreamReceipts.witnessJobs.map(job => [`${job.row}/${job.view}`, job]));
const generationRows = [
  { id: 'cfg-2p00', strength: 2, source: 'upstream' },
  {
    id: 'cfg-3p00',
    strength: 3,
    source: 'greenroom',
    jobId: '595078505e92',
    outputDir: '/Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-lirm-0032-identity-midpoint-20260715/cfg-3p0',
  },
  { id: 'cfg-4p00', strength: 4, source: 'upstream' },
];

const generationJobs = generationRows.map(row => {
  if (row.source === 'upstream') {
    const upstream = upstreamRows.get(row.id);
    if (!upstream) throw new Error(`reviewed bracket lacks ${row.id}`);
    assertCleanJob(upstream.receipt, {
      jobType: routeIdentity.generationJobType,
      effectiveCwd: routeIdentity.generationEffectiveCwd,
      effectiveRouteIncludes: [` --sparse-guidance-strength ${row.strength}.0 `],
    }, `${row.id} reviewed generation`);
    same(`${row.id} effective strength`, upstream.effective.strength, row.strength);
    return { ...upstream, evidenceSource: 'reviewed identity bracket' };
  }

  const job = readJob(row.jobId);
  assertCleanJob(job.receipt, {
    jobType: routeIdentity.generationJobType,
    effectiveCwd: routeIdentity.generationEffectiveCwd,
    effectiveRouteIncludes: [
      ` --image ${source.path} `,
      ` --output ${join(row.outputDir, 'output.glb')} `,
      ' --seed 42 ',
      ' --resolution 512 ',
      ' --steps 6 ',
      ' --no-cascade ',
      ' --target-faces 200000 ',
      ' --texture-size 1024 ',
      ' --simplify-first ',
      ' --sparse-guidance-strength 3 ',
      ' --sparse-guidance-rescale 0.7 ',
      ' --sparse-guidance-low 0.6 ',
      ' --sparse-guidance-high 1.0 ',
      ' --shape-guidance-strength 7.5 ',
      ' --shape-guidance-rescale 0.5 ',
      ' --shape-guidance-low 0.6 ',
      ' --shape-guidance-high 1.0',
    ],
  }, row.jobId);
  same(`${row.id} request id`, job.request.job_id, row.jobId);
  same(`${row.id} request input`, job.request.input_path, source.path);
  same(`${row.id} request output`, job.request.output_dir, row.outputDir);
  same(`${row.id} request pressure`, Number(job.request.params.sparse_guidance_strength), row.strength);
  return {
    row: row.id,
    strength: row.strength,
    evidenceSource: 'canonical Greenroom job',
    receipt: job.receipt,
    request: job.request,
    receiptSha256: job.receiptRecord.sha256,
    requestSha256: job.requestRecord.sha256,
    input: fileRecord(source.path),
    output: fileRecord(join(row.outputDir, 'output.glb')),
  };
});
lastTrustworthyEvidence = 'three admitted CFG 2/3/4 generation routes';

const midpointWitnessIds = new Map([
  ['left', 'd3ece88fcb12'],
  ['front', 'c9bf6adf51f2'],
  ['right', '4c4fdb3b934e'],
  ['rear', '54daeabe16ad'],
]);
const witnessJobs = generationRows.flatMap(row => views.map(view => {
  if (row.source === 'upstream') {
    const upstream = upstreamWitnesses.get(`${row.id}/${view.id}`);
    if (!upstream) throw new Error(`reviewed bracket lacks ${row.id}/${view.id}`);
    assertCleanJob(upstream.receipt, {
      jobType: routeIdentity.witnessJobType,
      effectiveCwd: routeIdentity.witnessEffectiveCwd,
      effectiveRouteIncludes: [` ${view.yaw} ${view.pitch}`],
    }, `${row.id}/${view.id} reviewed witness`);
    same(`${row.id}/${view.id} effective camera`, upstream.effectiveCamera, {
      inputPath: upstream.input.path,
      outputPath: upstream.output.path,
      yaw: view.yaw,
      pitch: view.pitch,
    });
    return { ...upstream, evidenceSource: 'reviewed identity bracket' };
  }

  const jobId = midpointWitnessIds.get(view.id);
  const job = readJob(jobId);
  const outputPath = join(job.receipt.output_dir, 'render.png');
  const generation = generationJobs.find(candidate => candidate.row === row.id);
  assertCleanJob(job.receipt, {
    jobType: routeIdentity.witnessJobType,
    effectiveCwd: routeIdentity.witnessEffectiveCwd,
    effectiveRouteIncludes: [
      ` -- ${generation.output.path} ${outputPath} ${view.yaw} ${view.pitch}`,
    ],
  }, jobId);
  same(`${jobId} request id`, job.request.job_id, jobId);
  same(`${jobId} request input`, job.request.input_path, generation.output.path);
  same(`${jobId} request yaw`, Number(job.request.params.yaw), view.yaw);
  same(`${jobId} request pitch`, Number(job.request.params.pitch), view.pitch);
  const output = fileRecord(outputPath);
  const visualEvidence = inspectPngEvidence(readFileSync(outputPath));
  assertUsefulPngEvidence(visualEvidence, {}, jobId);
  return {
    row: row.id,
    strength: row.strength,
    view: view.id,
    evidenceSource: 'canonical corrected Greenroom witness',
    receipt: job.receipt,
    request: job.request,
    receiptSha256: job.receiptRecord.sha256,
    requestSha256: job.requestRecord.sha256,
    input: generation.output,
    output,
    visualEvidence,
    effectiveCamera: {
      inputPath: generation.output.path,
      outputPath,
      yaw: view.yaw,
      pitch: view.pitch,
    },
  };
}));
lastTrustworthyEvidence = 'twelve admitted CFG 2/3/4 camera witnesses';

const excludedMidpointWitnesses = [
  ['left', -0.85, 'bfc1691e1509'],
  ['front', 0, 'fc7be0d4597a'],
  ['right', 0.85, '1ee0f8f4f0be'],
  ['rear', 3.141593, 'b7c2b7f1bbc1'],
].map(([view, requestedYaw, jobId]) => {
  const job = readJob(jobId);
  if (Object.hasOwn(job.request.params, 'yaw')) throw new Error(`${jobId}: excluded request unexpectedly carries yaw`);
  assertCleanJob(job.receipt, {
    jobType: routeIdentity.witnessJobType,
    effectiveCwd: routeIdentity.witnessEffectiveCwd,
    effectiveRouteIncludes: [' 0.0 0.2'],
  }, `${jobId} excluded default-camera witness`);
  return {
    jobId,
    labeledView: view,
    requestedYaw,
    effectiveYaw: 0,
    reason: 'submission omitted yaw and silently used the job-type default; excluded before evidence assembly',
    receiptSha256: job.receiptRecord.sha256,
    requestSha256: job.requestRecord.sha256,
  };
});

const cells = witnessJobs.map(job => ({
  strength: job.strength,
  row: job.row,
  view: job.view,
  sourceJobId: job.receipt.job_id,
  sourcePath: job.output.path,
  sourceSha256: job.output.sha256,
  yaw: job.effectiveCamera.yaw,
  pitch: job.effectiveCamera.pitch,
}));
const sheetPath = join(artifactRoot, '0032-identity-midpoint-contact-sheet.png');
const sheetTempPath = `${sheetPath}.tmp-${process.pid}.png`;
const manifestPath = `${sheetPath}.inputs.json`;
mkdirSync(artifactRoot, { recursive: true });
writeFileSync(manifestPath, `${JSON.stringify({
  width: 2048,
  cellWidth: 512,
  cellHeight: 556,
  imageHeight: 419,
  imageOffsetY: 46,
  headerHeight: 91,
  cells: cells.map(cell => ({
    sourcePath: cell.sourcePath,
    title: `SRC 0032 / SPARSE CFG ${cell.strength.toFixed(2)}`,
    viewLabel: `${cell.view.toUpperCase()} yaw ${cell.yaw}`,
  })),
}, null, 2)}\n`);
let sheetVisualEvidence;
try {
  const result = spawnSync('/usr/bin/swift', [
    join(identityRoot, '..', 'lirm-trellis-guidance-pressure-assay-v1', 'assemble-contact-sheet.swift'),
    manifestPath,
    sheetTempPath,
  ], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`contact sheet assembly failed: ${result.stderr || result.stdout}`);
  sheetVisualEvidence = inspectPngEvidence(readFileSync(sheetTempPath));
  assertUsefulPngEvidence(sheetVisualEvidence, { minWidth: 2048, minHeight: 1668 }, '0032 identity midpoint contact sheet');
  renameSync(sheetTempPath, sheetPath);
  primaryArtifactWritten = true;
  lastTrustworthyEvidence = 'route-bound CFG 2/3/4 contact sheet admitted by PNG evidence checks';
} finally {
  unlinkSync(manifestPath);
  rmSync(sheetTempPath, { force: true });
}

const receipts = {
  schema: 'kaminos.lirm-trellis-0032-identity-midpoint-route-receipts.v1',
  allDoneExitZero: true,
  upstreamIdentityBracket: fileRecord(upstreamReceiptsPath),
  generationJobs,
  witnessJobs,
  excludedMidpointWitnesses,
};
const receiptsPath = join(artifactRoot, 'route-receipts.json');
writeFileSync(receiptsPath, `${JSON.stringify(receipts, null, 2)}\n`);
const sheet = {
  ...fileRecord(sheetPath),
  path: sheetPath.split('/').at(-1),
  rows: generationRows.length,
  cells,
  visualEvidence: sheetVisualEvidence,
  assemblySha256: sha256(Buffer.from(JSON.stringify(cells))),
  layout: 'three sparse CFG rows x left/front/right/rear views',
};
const experiment = {
  schema: 'kaminos.lirm-trellis-0032-identity-midpoint.v1',
  source,
  pressures: generationRows.map(row => row.strength),
  fixed,
  routeCommit: upstreamExperiment.routeCommit,
  routeIdentity,
  reviewedIdentityBracket: fileRecord(upstreamExperimentPath),
  contactSheet: sheet,
  routeReceiptManifest: fileRecord(receiptsPath),
};
writeFileSync(join(artifactRoot, 'experiment.json'), `${JSON.stringify(experiment, null, 2)}\n`);
console.log(JSON.stringify({
  artifactRoot,
  generationJobs: generationJobs.length,
  witnessJobs: witnessJobs.length,
  excludedMidpointWitnesses: excludedMidpointWitnesses.length,
  sheetSha256: sheet.sha256,
  receiptSha256: experiment.routeReceiptManifest.sha256,
}, null, 2));
