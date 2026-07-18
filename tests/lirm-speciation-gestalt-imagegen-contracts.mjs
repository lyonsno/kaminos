import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const {
  buildGestaltImagegenMatrix,
  buildGestaltImagegenContactSheetManifest,
  buildGreenroomSubmitArgs,
  buildGestaltTrellisPromotionPlan,
  buildGreenroomTrellisSubmitArgs,
  buildGestaltTrellisWitnessPlan,
  buildGreenroomWitnessSubmitArgs,
  parseGreenroomCliOutput,
  validateGestaltImagegenCompletion,
  validateGestaltTrellisCompletion,
  validateGestaltWitnessCompletion,
} = await import('../lirm-speciation-gestalt-imagegen-core.mjs');

const root = await mkdtemp(join(tmpdir(), 'lirm-gestalt-imagegen-'));
const sourceRoot = join(root, 'witness');
const promptRoot = join(root, 'prompts');
const outputRoot = join(root, 'outputs');
await import('node:fs/promises').then(({ mkdir }) => Promise.all([
  mkdir(sourceRoot, { recursive: true }),
  mkdir(promptRoot, { recursive: true }),
]));

for (const generationId of [
  'basin-03-s3p00-n00',
  'basin-10-s3p00-n00',
  'basin-15-s3p00-n00',
  'basin-22-s1p50-n00',
]) {
  const compositeId = `lirm-armature-22__${generationId}-p046`;
  await import('node:fs/promises').then(({ mkdir }) => mkdir(join(sourceRoot, compositeId), { recursive: true }));
  await writeFile(join(sourceRoot, compositeId, 'trellis-source.png'), `png:${generationId}`);
}
await writeFile(join(promptRoot, 'preserve-gestalt.txt'), 'preserve gestalt');
await writeFile(join(promptRoot, 'lineage-seed.txt'), 'hallucinate descendant');

const receipt = {
  schema: 'kaminos.lirm-speciation-armature-gestalt-composite-witness.v0',
  status: 'complete',
  route: 'smooth-sdf-metaball-silhouette-morph',
  bundles: [3, 10, 15, 22].map((basin, index) => {
    const generationId = basin === 22 ? 'basin-22-s1p50-n00' : `basin-${String(basin).padStart(2, '0')}-s3p00-n00`;
    return {
      compositeId: `lirm-armature-22__${generationId}-p046`,
      candidateId: 'lirm-armature-22',
      fieldModel: {
        kind: 'smooth-sdf-metaball-silhouette-morph',
        actual3dStructure: true,
        gestaltPressure: 0.46,
      },
      gestaltEnvelope: {
        id: `${generationId}-p046`,
        pressure: 0.46,
        lineage: {
          generationId,
          sourceBasinIndex: basin,
          posteriorStrength: basin === 22 ? 1.5 : 3,
          acceptedForDownstream: true,
        },
      },
      dualLineage: {
        armature: { candidateId: 'lirm-armature-22', candidateSeed: `fixture:${index}` },
        silhouette: { generationId, sourceBasinIndex: basin },
      },
      trellisSource: {
        rasterPath: `${generationId}/trellis-source.png`,
      },
    };
  }),
};

// Use the real composite directory convention rather than the fixture-relative receipt path.
for (const bundle of receipt.bundles) {
  bundle.trellisSource.rasterPath = `${bundle.compositeId}/trellis-source.png`;
}

const plan = await buildGestaltImagegenMatrix({
  compositeReceipt: receipt,
  sourceRoot,
  promptRoot,
  outputRoot,
  seed: 717046,
});

assert.equal(plan.schema, 'kaminos.lirm-speciation-gestalt-imagegen-plan.v0');
assert.equal(plan.cells.length, 8);
assert.deepEqual([...new Set(plan.cells.map(cell => cell.sourceBasinIndex))], [3, 10, 15, 22]);
assert.deepEqual([...new Set(plan.cells.map(cell => cell.stance))], ['preserve-gestalt', 'lineage-seed']);
assert.ok(plan.cells.every(cell => cell.gestaltPressure === 0.46));
assert.ok(plan.cells.every(cell => cell.input.sha256.startsWith('sha256:')));
assert.ok(plan.cells.every(cell => cell.prompt.sha256.startsWith('sha256:')));

const args = buildGreenroomSubmitArgs(plan.cells[0]);
assert.equal(args.filter(value => value === '-p').length, 1, 'Greenroom params must follow one -p token');
assert.ok(args.includes('steps=8'));
assert.ok(args.includes('guidance=1.0'));
assert.ok(args.includes('mlx_cache_limit_gb=48'));
assert.deepEqual(parseGreenroomCliOutput('Submitted job b0477c32760d\n'), { job_id: 'b0477c32760d' });
assert.deepEqual(parseGreenroomCliOutput('Submitted job e15c1652b02c\n  Type: mflux_flux2_edit_promptfile\n  Input: fixture.png\n'), { job_id: 'e15c1652b02c' });
assert.deepEqual(parseGreenroomCliOutput('{"status":"done","job_id":"abc123"}\n'), { status: 'done', job_id: 'abc123' });
assert.throws(() => parseGreenroomCliOutput('submission wandered away\n'), /unrecognized Greenroom output/);

const cell = plan.cells[0];
await import('node:fs/promises').then(({ mkdir }) => mkdir(cell.outputDir, { recursive: true }));
await writeFile(cell.outputPath, 'generated-image');
const nowSeconds = Date.now() / 1000;
const status = {
  job_id: 'abc123',
  status: 'done',
  job_type: 'mflux_flux2_edit_promptfile',
  input_path: cell.input.path,
  output_dir: cell.outputDir,
  params: {
    prompt_file: cell.prompt.path,
    model: 'flux2-klein-9b',
    quantize: '4',
    width: '512',
    height: '512',
    steps: '8',
    guidance: '1.0',
    seed: '717046',
    mlx_cache_limit_gb: '48',
  },
  exit_code: 0,
  effective_route: `/Users/noahlyons/dev/mlx-openai-server/.venv/bin/mflux-generate-flux2-edit --image-paths ${cell.input.path} --prompt-file ${cell.prompt.path} --output ${cell.outputPath}`,
  submitted_at: nowSeconds - 6,
  started_at: nowSeconds - 5,
  finished_at: nowSeconds + 5,
  warnings: [],
};
const completion = await validateGestaltImagegenCompletion({ cell, status });
assert.equal(completion.status, 'accepted');
assert.ok(completion.output.sha256.startsWith('sha256:'));
await assert.rejects(
  () => validateGestaltImagegenCompletion({ cell, status: { ...status, job_type: 'fallback-route' } }),
  /job type/,
);
await assert.rejects(
  () => validateGestaltImagegenCompletion({ cell, status: { ...status, effective_route: 'fake-runner' } }),
  /route/,
);
await assert.rejects(
  () => validateGestaltImagegenCompletion({
    cell,
    status: { ...status, effective_route: `${cell.expectedRunner}-fallback --pretend` },
  }),
  /route/,
);
await assert.rejects(
  () => validateGestaltImagegenCompletion({
    cell: { ...cell, input: { ...cell.input, sha256: 'sha256:wrong-input' } },
    status,
  }),
  /input hash drift/,
);
await assert.rejects(
  () => validateGestaltImagegenCompletion({
    cell: { ...cell, prompt: { ...cell.prompt, sha256: 'sha256:wrong-prompt' } },
    status,
  }),
  /prompt hash drift/,
);
await assert.rejects(
  () => validateGestaltImagegenCompletion({ cell, status: { ...status, started_at: undefined } }),
  /timing/,
);
await assert.rejects(
  () => validateGestaltImagegenCompletion({ cell, status: { ...status, submitted_at: null } }),
  /timing/,
);
await assert.rejects(
  () => validateGestaltImagegenCompletion({ cell, status: { ...status, submitted_at: '' } }),
  /timing/,
);
await assert.rejects(
  () => validateGestaltImagegenCompletion({ cell, status: { ...status, submitted_at: String(status.submitted_at) } }),
  /timing/,
);
await assert.rejects(
  () => validateGestaltImagegenCompletion({ cell, status: { ...status, submitted_at: 0, started_at: 1, finished_at: 2 } }),
  /outside job window/,
);
await import('node:fs/promises').then(({ unlink }) => unlink(cell.outputPath));
await assert.rejects(
  () => validateGestaltImagegenCompletion({ cell, status }),
  /primary output/,
);

const accepted = [];
for (const matrixCell of plan.cells) {
  await import('node:fs/promises').then(({ mkdir }) => Promise.all([
    mkdir(matrixCell.outputDir, { recursive: true }),
    mkdir(join(sourceRoot, matrixCell.compositeId), { recursive: true }),
  ]));
  await writeFile(matrixCell.outputPath, `generated:${matrixCell.cellId}`);
  await writeFile(join(sourceRoot, matrixCell.compositeId, 'depth-composite.png'), `depth:${matrixCell.generationId}`);
  accepted.push(await validateGestaltImagegenCompletion({
    cell: matrixCell,
    status: {
      ...status,
      job_id: `job-${matrixCell.cellId}`,
      input_path: matrixCell.input.path,
      output_dir: matrixCell.outputDir,
      params: {
        ...status.params,
        prompt_file: matrixCell.prompt.path,
      },
      effective_route: `${matrixCell.expectedRunner} --image-paths ${matrixCell.input.path} --prompt-file ${matrixCell.prompt.path} --output ${matrixCell.outputPath}`,
    },
  }));
}
const contactSheet = await buildGestaltImagegenContactSheetManifest({
  plan,
  completion: {
    schema: 'kaminos.lirm-speciation-gestalt-imagegen-collection.v0',
    status: 'complete',
    accepted,
  },
  sourceRoot,
});
assert.equal(contactSheet.sheet.cells.length, 16);
assert.equal(contactSheet.evidence.length, 16);
await assert.rejects(
  () => buildGestaltImagegenContactSheetManifest({
    plan,
    completion: { schema: 'kaminos.lirm-speciation-gestalt-imagegen-collection.v0', status: 'waiting', accepted },
    sourceRoot,
  }),
  /not complete/,
);

const promotedCellIds = [
  'lirm-armature-22__basin-03-s3p00-n00-p046-preserve-gestalt-seed717046',
  'lirm-armature-22__basin-03-s3p00-n00-p046-lineage-seed-seed717046',
  'lirm-armature-22__basin-10-s3p00-n00-p046-lineage-seed-seed717046',
  'lirm-armature-22__basin-15-s3p00-n00-p046-lineage-seed-seed717046',
  'lirm-armature-22__basin-22-s1p50-n00-p046-lineage-seed-seed717046',
];
const trellisPlan = await buildGestaltTrellisPromotionPlan({
  imagegenPlan: plan,
  imagegenCompletion: {
    schema: 'kaminos.lirm-speciation-gestalt-imagegen-collection.v0',
    status: 'complete',
    accepted,
  },
  promotedCellIds,
  outputRoot: join(root, 'trellis'),
});
assert.equal(trellisPlan.cells.length, 5);
assert.deepEqual(trellisPlan.comparisonContract.lineageBasins, [3, 10, 15, 22]);
assert.equal(trellisPlan.evidencePredicate.spatialCoherenceRequiresRenderedWitness, true);
const trellisCell = trellisPlan.cells[0];
const trellisArgs = buildGreenroomTrellisSubmitArgs(trellisCell);
assert.equal(trellisArgs.filter(value => value === '-p').length, 1);
assert.ok(trellisArgs.includes('target_faces=200000'));
await import('node:fs/promises').then(({ mkdir }) => mkdir(trellisCell.outputDir, { recursive: true }));
await writeFile(trellisCell.outputPath, 'glTF-fixture');
const trellisStatus = {
  job_id: 'trellis123',
  status: 'done',
  job_type: 'trellis2mlx_fast',
  input_path: trellisCell.input.path,
  output_dir: trellisCell.outputDir,
  params: { seed: '42', steps: '6', target_faces: '200000', texture_size: '1024' },
  exit_code: 0,
  started_at: 100.25,
  finished_at: 187.75,
  submitted_at: 99.75,
  effective_route: `${trellisCell.expectedRunner} -u generate.py --image ${trellisCell.input.path} --output ${trellisCell.outputPath} --seed 42 --resolution 512 --steps 6 --no-cascade --target-faces 200000 --texture-size 1024 --simplify-first`,
  warnings: [],
};
// The fixture output is created now, so put the synthetic run window around its mtime.
trellisStatus.submitted_at = nowSeconds - 6;
trellisStatus.started_at = nowSeconds - 5;
trellisStatus.finished_at = nowSeconds + 5;
const trellisCompletion = await validateGestaltTrellisCompletion({ cell: trellisCell, status: trellisStatus });
assert.equal(trellisCompletion.spatialCoherence, 'unverified-pending-rendered-witness');
assert.equal(trellisCompletion.durationSeconds, 10);
assert.equal(trellisCompletion.startedAt, nowSeconds - 5);
assert.equal(trellisCompletion.finishedAt, nowSeconds + 5);
await assert.rejects(
  () => validateGestaltTrellisCompletion({ cell: trellisCell, status: { ...trellisStatus, job_type: 'fallback' } }),
  /job type/,
);
await assert.rejects(
  () => validateGestaltTrellisCompletion({
    cell: trellisCell,
    status: { ...trellisStatus, effective_route: `${trellisCell.expectedRunner}-fallback --pretend` },
  }),
  /Trellis route/,
);
await assert.rejects(
  () => validateGestaltTrellisCompletion({
    cell: trellisCell,
    status: { ...trellisStatus, effective_route: trellisStatus.effective_route.replace(' --no-cascade', '') },
  }),
  /no-cascade/,
);
await assert.rejects(
  () => validateGestaltTrellisCompletion({ cell: trellisCell, status: { ...trellisStatus, finished_at: undefined } }),
  /timing/,
);
const witnessScript = join(root, 'blender-witness.py');
await writeFile(witnessScript, 'print("witness")');
const witnessPlan = await buildGestaltTrellisWitnessPlan({
  trellisPlan: { ...trellisPlan, cells: [trellisCell] },
  trellisCompletion: {
    schema: 'kaminos.lirm-speciation-gestalt-trellis-collection.v0',
    status: 'complete-glbs-unwitnessed',
    accepted: [trellisCompletion],
  },
  outputRoot: join(root, 'witness'),
  witnessScript,
});
assert.equal(witnessPlan.cells.length, 4);
assert.deepEqual(witnessPlan.cells.map(entry => entry.view), ['left', 'front', 'right', 'opposite']);
assert.equal(witnessPlan.evidencePredicate.spatialClaimRequiresHumanVisualInspection, true);
const witnessCell = witnessPlan.cells[0];
const witnessArgs = buildGreenroomWitnessSubmitArgs(witnessCell);
assert.equal(witnessArgs.filter(value => value === '-p').length, 1);
await import('node:fs/promises').then(({ mkdir }) => mkdir(witnessCell.outputDir, { recursive: true }));
await writeFile(witnessCell.outputPath, 'png-fixture');
const witnessStatus = {
  job_id: 'witness123',
  status: 'done',
  job_type: witnessCell.jobType,
  input_path: witnessCell.input.path,
  output_dir: witnessCell.outputDir,
  params: { witness_script: witnessCell.witnessScript.path, yaw: String(witnessCell.yaw), pitch: String(witnessCell.pitch) },
  exit_code: 0,
  effective_route: `${witnessCell.expectedRunner} --background --python ${witnessCell.witnessScript.path}`,
  submitted_at: nowSeconds - 6,
  started_at: nowSeconds - 5,
  finished_at: nowSeconds + 5,
};
const witnessCompletion = await validateGestaltWitnessCompletion({ cell: witnessCell, status: witnessStatus });
assert.equal(witnessCompletion.visualInspectionClaim, 'not-yet-inspected');
await assert.rejects(
  () => validateGestaltWitnessCompletion({ cell: witnessCell, status: { ...witnessStatus, effective_route: 'fallback-renderer' } }),
  /witness route/,
);
await assert.rejects(
  () => validateGestaltWitnessCompletion({
    cell: witnessCell,
    status: { ...witnessStatus, effective_route: `${witnessCell.expectedRunner}-fallback --pretend` },
  }),
  /witness route/,
);
await assert.rejects(
  () => validateGestaltWitnessCompletion({
    cell: { ...witnessCell, witnessScript: { ...witnessCell.witnessScript, sha256: 'sha256:wrong-script' } },
    status: witnessStatus,
  }),
  /script hash drift/,
);
await assert.rejects(
  () => validateGestaltWitnessCompletion({ cell: witnessCell, status: { ...witnessStatus, started_at: null } }),
  /timing/,
);

console.log('lirm speciation gestalt imagegen contracts passed');
