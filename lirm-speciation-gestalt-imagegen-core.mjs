import { createHash } from 'node:crypto';
import { stat, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export const GESTALT_IMAGEGEN_PLAN_SCHEMA = 'kaminos.lirm-speciation-gestalt-imagegen-plan.v0';
export const GESTALT_IMAGEGEN_COMPLETION_SCHEMA = 'kaminos.lirm-speciation-gestalt-imagegen-completion.v0';
export const GESTALT_IMAGEGEN_JOB_TYPE = 'mflux_flux2_edit_promptfile';
export const GESTALT_IMAGEGEN_RUNNER = '/Users/noahlyons/dev/mlx-openai-server/.venv/bin/mflux-generate-flux2-edit';
export const GESTALT_TRELLIS_PLAN_SCHEMA = 'kaminos.lirm-speciation-gestalt-trellis-plan.v0';
export const GESTALT_TRELLIS_COMPLETION_SCHEMA = 'kaminos.lirm-speciation-gestalt-trellis-completion.v0';
export const GESTALT_TRELLIS_JOB_TYPE = 'trellis2mlx_fast';
export const GESTALT_TRELLIS_RUNNER = '/Users/noahlyons/dev/trellis2mlx/.venv/bin/python';
export const GESTALT_WITNESS_JOB_TYPE = 'kaminos_blender_glb_witness_molten_0718';
export const GESTALT_WITNESS_RUNNER = '/Applications/Blender.app/Contents/MacOS/Blender';

const DEFAULT_GENERATIONS = [
  'basin-03-s3p00-n00',
  'basin-10-s3p00-n00',
  'basin-15-s3p00-n00',
  'basin-22-s1p50-n00',
];

const STANCES = [
  { id: 'preserve-gestalt', file: 'preserve-gestalt.txt' },
  { id: 'lineage-seed', file: 'lineage-seed.txt' },
];

async function fileEvidence(path) {
  const bytes = await readFile(path);
  if (bytes.length === 0) throw new Error(`empty evidence file: ${path}`);
  return {
    path: resolve(path),
    bytes: bytes.length,
    sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
  };
}

function assertEffectiveRunner(effectiveRoute, expectedRunner, label) {
  const route = String(effectiveRoute ?? '').trim();
  const executable = route.split(/\s+/, 1)[0];
  if (!route || executable !== expectedRunner) {
    throw new Error(`effective ${label} route did not use expected runner: ${effectiveRoute ?? 'missing'}`);
  }
  return route;
}

function assertCommandOption(effectiveRoute, option, expectedValue, label) {
  const tokens = String(effectiveRoute).trim().split(/\s+/);
  const indices = tokens.flatMap((token, index) => token === option ? [index] : []);
  if (expectedValue === true) {
    if (indices.length !== 1) throw new Error(`effective ${label} route must contain ${option} exactly once`);
    return;
  }
  if (expectedValue === false) {
    if (indices.length !== 0) throw new Error(`effective ${label} route must not contain ${option}`);
    return;
  }
  if (indices.length !== 1 || tokens[indices[0] + 1] !== String(expectedValue)) {
    throw new Error(`effective ${label} route mismatch for ${option}: expected ${expectedValue}`);
  }
}

function validateRunTiming(status, outputStat, label) {
  const timestamps = [status?.submitted_at, status?.started_at, status?.finished_at];
  if (!timestamps.every((value) => typeof value === 'number' && Number.isFinite(value))) {
    throw new Error(`${label} timing is incomplete`);
  }
  const [submittedAt, startedAt, finishedAt] = timestamps;
  if (submittedAt > startedAt || startedAt > finishedAt) {
    throw new Error(`${label} timing is not monotonic`);
  }
  const outputMtime = outputStat.mtimeMs / 1000;
  const timestampToleranceSeconds = 2;
  if (outputMtime < startedAt - timestampToleranceSeconds
    || outputMtime > finishedAt + timestampToleranceSeconds) {
    throw new Error(`${label} primary output mtime is outside job window`);
  }
  return {
    submittedAt,
    startedAt,
    finishedAt,
    durationSeconds: finishedAt - startedAt,
    outputMtime,
  };
}

function assertCompositeReceipt(receipt) {
  if (receipt?.schema !== 'kaminos.lirm-speciation-armature-gestalt-composite-witness.v0') {
    throw new Error(`unexpected composite receipt schema: ${receipt?.schema ?? 'missing'}`);
  }
  if (receipt.status !== 'complete') throw new Error(`composite witness is not complete: ${receipt.status}`);
  if (!Array.isArray(receipt.bundles) || receipt.bundles.length === 0) {
    throw new Error('composite witness has no bundles');
  }
}

export async function buildGestaltImagegenMatrix({
  compositeReceipt,
  sourceRoot,
  promptRoot,
  outputRoot,
  seed = 717046,
  generationIds = DEFAULT_GENERATIONS,
}) {
  assertCompositeReceipt(compositeReceipt);
  const wanted = new Set(generationIds);
  const bundles = compositeReceipt.bundles.filter(bundle => (
    bundle.candidateId === 'lirm-armature-22'
    && bundle.fieldModel?.actual3dStructure === true
    && bundle.fieldModel?.kind === 'smooth-sdf-metaball-silhouette-morph'
    && bundle.fieldModel?.gestaltPressure === 0.46
    && wanted.has(bundle.gestaltEnvelope?.lineage?.generationId)
    && bundle.gestaltEnvelope?.lineage?.acceptedForDownstream === true
  ));
  if (bundles.length !== generationIds.length) {
    throw new Error(`expected ${generationIds.length} distinct p0.46 composite bundles, found ${bundles.length}`);
  }
  const byGeneration = new Map(bundles.map(bundle => [bundle.gestaltEnvelope.lineage.generationId, bundle]));
  if (byGeneration.size !== generationIds.length) throw new Error('duplicate composite generation lineage');

  const prompts = new Map();
  for (const stance of STANCES) {
    prompts.set(stance.id, await fileEvidence(resolve(promptRoot, stance.file)));
  }

  const cells = [];
  for (const generationId of generationIds) {
    const bundle = byGeneration.get(generationId);
    if (!bundle) throw new Error(`missing requested composite generation: ${generationId}`);
    const input = await fileEvidence(resolve(sourceRoot, bundle.trellisSource.rasterPath));
    for (const stance of STANCES) {
      const cellId = `${bundle.compositeId}-${stance.id}-seed${seed}`;
      const cellOutputDir = resolve(outputRoot, 'cells', cellId);
      cells.push({
        cellId,
        jobType: GESTALT_IMAGEGEN_JOB_TYPE,
        requestedRoute: `gpu-greenroom/${GESTALT_IMAGEGEN_JOB_TYPE}`,
        expectedRunner: GESTALT_IMAGEGEN_RUNNER,
        candidateId: bundle.candidateId,
        compositeId: bundle.compositeId,
        generationId,
        sourceBasinIndex: bundle.gestaltEnvelope.lineage.sourceBasinIndex,
        posteriorStrength: bundle.gestaltEnvelope.lineage.posteriorStrength,
        gestaltPressure: bundle.fieldModel.gestaltPressure,
        dualLineage: bundle.dualLineage,
        stance: stance.id,
        seed,
        input,
        prompt: prompts.get(stance.id),
        outputDir: cellOutputDir,
        outputPath: resolve(cellOutputDir, 'output.png'),
        settings: {
          model: 'flux2-klein-9b',
          quantize: 4,
          width: 512,
          height: 512,
          steps: 8,
          guidance: 1.0,
          mlxCacheLimitGb: 48,
        },
      });
    }
  }

  return {
    schema: GESTALT_IMAGEGEN_PLAN_SCHEMA,
    createdAt: new Date().toISOString(),
    purpose: 'Test whether true-3D silhouette-bounded armatures invoke distinct creature priors while preserving dual lineage.',
    requestedRoute: `gpu-greenroom/${GESTALT_IMAGEGEN_JOB_TYPE}`,
    expectedRunner: GESTALT_IMAGEGEN_RUNNER,
    comparisonContract: {
      fixedCandidate: 'lirm-armature-22',
      fixedGestaltPressure: 0.46,
      fixedSeed: seed,
      variedSourceBasins: generationIds,
      variedPromptStances: STANCES.map(stance => stance.id),
    },
    falseClosureGuards: {
      directInferenceForbidden: true,
      fallbackRouteAccepted: false,
      missingOrEmptyPrimaryOutputAccepted: false,
      requestedRouteMustEqualEffectiveJobType: true,
      effectiveRunnerMustMatch: GESTALT_IMAGEGEN_RUNNER,
    },
    cells,
  };
}

export function buildGreenroomSubmitArgs(cell) {
  if (cell?.jobType !== GESTALT_IMAGEGEN_JOB_TYPE) throw new Error(`unsupported job type: ${cell?.jobType}`);
  const settings = cell.settings;
  return [
    cell.jobType,
    cell.input.path,
    cell.outputDir,
    '-p',
    `prompt_file=${cell.prompt.path}`,
    `model=${settings.model}`,
    `quantize=${settings.quantize}`,
    `width=${settings.width}`,
    `height=${settings.height}`,
    `steps=${settings.steps}`,
    `guidance=${Number(settings.guidance).toFixed(1)}`,
    `seed=${cell.seed}`,
    `mlx_cache_limit_gb=${settings.mlxCacheLimitGb}`,
  ];
}

export function parseGreenroomCliOutput(stdout) {
  const text = String(stdout ?? '').trim();
  if (!text) throw new Error('Greenroom returned empty output');
  try {
    return JSON.parse(text);
  } catch {
    const submitted = text.match(/^Submitted job ([a-z0-9]+)(?:\n|$)/i);
    if (submitted) return { job_id: submitted[1] };
    throw new Error(`unrecognized Greenroom output: ${text}`);
  }
}

export async function validateGestaltImagegenCompletion({ cell, status }) {
  if (status?.status !== 'done' || status.exit_code !== 0) {
    throw new Error(`job did not complete successfully: ${status?.status ?? 'missing'} exit=${status?.exit_code ?? 'missing'}`);
  }
  if (status.job_type !== cell.jobType) {
    throw new Error(`effective job type mismatch: ${status.job_type} != ${cell.jobType}`);
  }
  if (resolve(status.input_path) !== resolve(cell.input.path)) throw new Error('effective input path mismatch');
  if (resolve(status.output_dir) !== resolve(cell.outputDir)) throw new Error('effective output directory mismatch');
  assertEffectiveRunner(status.effective_route, cell.expectedRunner, 'imagegen');
  const expectedParams = {
    prompt_file: cell.prompt.path,
    model: cell.settings.model,
    quantize: String(cell.settings.quantize),
    width: String(cell.settings.width),
    height: String(cell.settings.height),
    steps: String(cell.settings.steps),
    guidance: Number(cell.settings.guidance).toFixed(1),
    seed: String(cell.seed),
    mlx_cache_limit_gb: String(cell.settings.mlxCacheLimitGb),
  };
  for (const [key, expected] of Object.entries(expectedParams)) {
    if (String(status.params?.[key]) !== expected) {
      throw new Error(`effective param mismatch for ${key}: ${status.params?.[key]} != ${expected}`);
    }
  }
  const input = await fileEvidence(cell.input.path);
  if (input.sha256 !== cell.input.sha256) throw new Error(`imagegen input hash drift: ${cell.cellId}`);
  const prompt = await fileEvidence(cell.prompt.path);
  if (prompt.sha256 !== cell.prompt.sha256) throw new Error(`imagegen prompt hash drift: ${cell.cellId}`);
  let outputStat;
  try {
    outputStat = await stat(cell.outputPath);
  } catch {
    throw new Error(`missing primary output: ${cell.outputPath}`);
  }
  if (!outputStat.isFile() || outputStat.size === 0) throw new Error(`empty primary output: ${cell.outputPath}`);
  const timing = validateRunTiming(status, outputStat, 'imagegen');
  const output = await fileEvidence(cell.outputPath);
  return {
    schema: GESTALT_IMAGEGEN_COMPLETION_SCHEMA,
    status: 'accepted',
    cellId: cell.cellId,
    jobId: status.job_id,
    requestedRoute: cell.requestedRoute,
    effectiveJobType: status.job_type,
    effectiveRoute: status.effective_route,
    effectiveParams: status.params,
    ...timing,
    warnings: status.warnings ?? [],
    input,
    prompt,
    output,
  };
}

export async function buildGestaltImagegenContactSheetManifest({ plan, completion, sourceRoot }) {
  if (plan?.schema !== GESTALT_IMAGEGEN_PLAN_SCHEMA) throw new Error(`unexpected plan schema: ${plan?.schema}`);
  if (completion?.schema !== 'kaminos.lirm-speciation-gestalt-imagegen-collection.v0') {
    throw new Error(`unexpected completion schema: ${completion?.schema}`);
  }
  if (completion.status !== 'complete') throw new Error(`imagegen collection is not complete: ${completion.status}`);
  const accepted = new Map(completion.accepted.map(entry => [entry.cellId, entry]));
  if (accepted.size !== plan.cells.length) throw new Error('accepted output count does not match plan');
  const cells = [];
  const evidence = [];
  const byGeneration = new Map();
  for (const cell of plan.cells) {
    if (!byGeneration.has(cell.generationId)) byGeneration.set(cell.generationId, []);
    byGeneration.get(cell.generationId).push(cell);
  }
  for (const [generationId, generationCells] of byGeneration) {
    const preserve = generationCells.find(cell => cell.stance === 'preserve-gestalt');
    const lineage = generationCells.find(cell => cell.stance === 'lineage-seed');
    if (!preserve || !lineage) throw new Error(`missing stance pair for ${generationId}`);
    const input = await fileEvidence(preserve.input.path);
    if (input.sha256 !== preserve.input.sha256 || input.sha256 !== lineage.input.sha256) {
      throw new Error(`source input hash drift for ${generationId}`);
    }
    const depth = await fileEvidence(resolve(sourceRoot, preserve.compositeId, 'depth-composite.png'));
    const preserveOutput = accepted.get(preserve.cellId);
    const lineageOutput = accepted.get(lineage.cellId);
    if (!preserveOutput || !lineageOutput) throw new Error(`missing accepted stance output for ${generationId}`);
    const livePreserve = await fileEvidence(preserve.outputPath);
    const liveLineage = await fileEvidence(lineage.outputPath);
    if (livePreserve.sha256 !== preserveOutput.output.sha256) throw new Error(`preserve output hash drift for ${generationId}`);
    if (liveLineage.sha256 !== lineageOutput.output.sha256) throw new Error(`lineage output hash drift for ${generationId}`);
    evidence.push(input, depth, livePreserve, liveLineage);
    cells.push(
      { sourcePath: input.path, title: generationId, viewLabel: '3D SCAFFOLD' },
      { sourcePath: depth.path, title: generationId, viewLabel: 'DEPTH' },
      { sourcePath: livePreserve.path, title: generationId, viewLabel: 'PRESERVE' },
      { sourcePath: liveLineage.path, title: generationId, viewLabel: 'LINEAGE' },
    );
  }
  return {
    schema: 'kaminos.lirm-speciation-gestalt-imagegen-contact-sheet-manifest.v0',
    sheet: {
      width: 2048,
      cellWidth: 512,
      cellHeight: 548,
      imageHeight: 512,
      imageOffsetY: 0,
      headerHeight: 36,
      cells,
    },
    evidence,
  };
}

export async function buildGestaltTrellisPromotionPlan({
  imagegenPlan,
  imagegenCompletion,
  promotedCellIds,
  outputRoot,
}) {
  if (imagegenPlan?.schema !== GESTALT_IMAGEGEN_PLAN_SCHEMA) {
    throw new Error(`unexpected imagegen plan schema: ${imagegenPlan?.schema}`);
  }
  if (imagegenCompletion?.schema !== 'kaminos.lirm-speciation-gestalt-imagegen-collection.v0'
    || imagegenCompletion.status !== 'complete') {
    throw new Error('imagegen collection is not complete');
  }
  if (!Array.isArray(promotedCellIds) || promotedCellIds.length === 0) throw new Error('no promoted cells');
  if (new Set(promotedCellIds).size !== promotedCellIds.length) throw new Error('duplicate promoted cell id');
  const planned = new Map(imagegenPlan.cells.map(cell => [cell.cellId, cell]));
  const accepted = new Map(imagegenCompletion.accepted.map(entry => [entry.cellId, entry]));
  const cells = [];
  for (const cellId of promotedCellIds) {
    const sourceCell = planned.get(cellId);
    const sourceCompletion = accepted.get(cellId);
    if (!sourceCell || !sourceCompletion) throw new Error(`promoted cell is not accepted: ${cellId}`);
    const input = await fileEvidence(sourceCompletion.output.path);
    if (input.sha256 !== sourceCompletion.output.sha256) throw new Error(`imagegen output hash drift: ${cellId}`);
    const cellOutputDir = resolve(outputRoot, cellId);
    cells.push({
      cellId,
      jobType: GESTALT_TRELLIS_JOB_TYPE,
      requestedRoute: `gpu-greenroom/${GESTALT_TRELLIS_JOB_TYPE}`,
      expectedRunner: GESTALT_TRELLIS_RUNNER,
      generationId: sourceCell.generationId,
      sourceBasinIndex: sourceCell.sourceBasinIndex,
      stance: sourceCell.stance,
      dualLineage: sourceCell.dualLineage,
      input,
      outputDir: cellOutputDir,
      outputPath: resolve(cellOutputDir, 'output.glb'),
      settings: {
        seed: 42,
        resolution: 512,
        steps: 6,
        cascade: false,
        targetFaces: 200000,
        textureSize: 1024,
        simplifyFirst: true,
      },
    });
  }
  const lineageBasins = cells.filter(cell => cell.stance === 'lineage-seed').map(cell => cell.sourceBasinIndex);
  const basin03Stances = cells.filter(cell => cell.sourceBasinIndex === 3).map(cell => cell.stance).sort();
  if (JSON.stringify(lineageBasins) !== JSON.stringify([3, 10, 15, 22])) {
    throw new Error(`promotion must compare lineage basins 3,10,15,22; got ${lineageBasins.join(',')}`);
  }
  if (JSON.stringify(basin03Stances) !== JSON.stringify(['lineage-seed', 'preserve-gestalt'])) {
    throw new Error('promotion must compare both prompt stances in basin 03');
  }
  return {
    schema: GESTALT_TRELLIS_PLAN_SCHEMA,
    status: 'planned',
    comparisonContract: {
      lineageBasins: [3, 10, 15, 22],
      withinBasinPromptPair: { sourceBasinIndex: 3, stances: ['preserve-gestalt', 'lineage-seed'] },
      fixedSettings: cells[0].settings,
    },
    evidencePredicate: {
      routeFallbackAllowed: false,
      missingGlbCountsAsSuccess: false,
      sourceHashDriftAllowed: false,
      spatialCoherenceRequiresRenderedWitness: true,
    },
    cells,
  };
}

export function buildGreenroomTrellisSubmitArgs(cell) {
  return [
    cell.jobType, cell.input.path, cell.outputDir, '-p',
    `seed=${cell.settings.seed}`,
    `steps=${cell.settings.steps}`,
    `target_faces=${cell.settings.targetFaces}`,
    `texture_size=${cell.settings.textureSize}`,
  ];
}

export async function validateGestaltTrellisCompletion({ cell, status }) {
  if (status?.status !== 'done' || status.exit_code !== 0) throw new Error(`Trellis job did not complete: ${status?.status}`);
  if (status.job_type !== cell.jobType) throw new Error(`effective job type mismatch: ${status.job_type}`);
  if (resolve(status.input_path) !== cell.input.path) throw new Error(`effective input mismatch: ${status.input_path}`);
  if (resolve(status.output_dir) !== cell.outputDir) throw new Error(`effective output directory mismatch: ${status.output_dir}`);
  const effectiveRoute = assertEffectiveRunner(status.effective_route, cell.expectedRunner, 'Trellis');
  const expectedParams = {
    seed: String(cell.settings.seed),
    steps: String(cell.settings.steps),
    target_faces: String(cell.settings.targetFaces),
    texture_size: String(cell.settings.textureSize),
  };
  for (const [key, expected] of Object.entries(expectedParams)) {
    if (String(status.params?.[key]) !== expected) {
      throw new Error(`effective Trellis param mismatch for ${key}: ${status.params?.[key]} != ${expected}`);
    }
  }
  assertCommandOption(effectiveRoute, '--resolution', cell.settings.resolution, 'Trellis');
  assertCommandOption(effectiveRoute, '--no-cascade', cell.settings.cascade === false, 'Trellis');
  assertCommandOption(effectiveRoute, '--simplify-first', cell.settings.simplifyFirst === true, 'Trellis');
  const input = await fileEvidence(cell.input.path);
  if (input.sha256 !== cell.input.sha256) throw new Error(`Trellis input hash drift: ${cell.cellId}`);
  const outputStat = await stat(cell.outputPath);
  const timing = validateRunTiming(status, outputStat, 'Trellis');
  const output = await fileEvidence(cell.outputPath);
  return {
    schema: GESTALT_TRELLIS_COMPLETION_SCHEMA,
    status: 'accepted',
    cellId: cell.cellId,
    generationId: cell.generationId,
    sourceBasinIndex: cell.sourceBasinIndex,
    stance: cell.stance,
    dualLineage: cell.dualLineage,
    jobId: status.job_id,
    requestedRoute: cell.requestedRoute,
    effectiveJobType: status.job_type,
    effectiveRoute: status.effective_route,
    effectiveParams: status.params,
    ...timing,
    warnings: status.warnings ?? [],
    input,
    output,
    spatialCoherence: 'unverified-pending-rendered-witness',
  };
}

const WITNESS_VIEWS = [
  { view: 'left', yaw: -0.85, pitch: 0.2 },
  { view: 'front', yaw: 0, pitch: 0.2 },
  { view: 'right', yaw: 0.85, pitch: 0.2 },
  { view: 'opposite', yaw: 3.141593, pitch: 0.2 },
];

export async function buildGestaltTrellisWitnessPlan({ trellisPlan, trellisCompletion, outputRoot, witnessScript }) {
  if (trellisPlan?.schema !== GESTALT_TRELLIS_PLAN_SCHEMA) throw new Error(`unexpected Trellis plan schema: ${trellisPlan?.schema}`);
  if (trellisCompletion?.schema !== 'kaminos.lirm-speciation-gestalt-trellis-collection.v0'
    || trellisCompletion.status !== 'complete-glbs-unwitnessed') {
    throw new Error(`Trellis collection is not witnessable: ${trellisCompletion?.status}`);
  }
  const accepted = new Map(trellisCompletion.accepted.map(entry => [entry.cellId, entry]));
  if (accepted.size !== trellisPlan.cells.length) throw new Error('accepted GLB count does not match plan');
  const script = await fileEvidence(witnessScript);
  const cells = [];
  for (const sourceCell of trellisPlan.cells) {
    const completion = accepted.get(sourceCell.cellId);
    if (!completion) throw new Error(`missing accepted GLB: ${sourceCell.cellId}`);
    const input = await fileEvidence(completion.output.path);
    if (input.sha256 !== completion.output.sha256) throw new Error(`GLB hash drift: ${sourceCell.cellId}`);
    for (const witnessView of WITNESS_VIEWS) {
      const outputDir = resolve(outputRoot, sourceCell.cellId, witnessView.view);
      cells.push({
        witnessId: `${sourceCell.cellId}-${witnessView.view}`,
        cellId: sourceCell.cellId,
        generationId: sourceCell.generationId,
        sourceBasinIndex: sourceCell.sourceBasinIndex,
        stance: sourceCell.stance,
        jobType: GESTALT_WITNESS_JOB_TYPE,
        expectedRunner: GESTALT_WITNESS_RUNNER,
        requestedRoute: `gpu-greenroom/${GESTALT_WITNESS_JOB_TYPE}`,
        input,
        witnessScript: script,
        outputDir,
        outputPath: resolve(outputDir, 'render.png'),
        ...witnessView,
      });
    }
  }
  return {
    schema: 'kaminos.lirm-speciation-gestalt-trellis-witness-plan.v0',
    status: 'planned',
    requiredViews: WITNESS_VIEWS,
    evidencePredicate: {
      expectedWitnessCount: trellisPlan.cells.length * WITNESS_VIEWS.length,
      blankOrMissingFrameCountsAsSuccess: false,
      routeFallbackAllowed: false,
      spatialClaimRequiresHumanVisualInspection: true,
    },
    cells,
  };
}

export function buildGreenroomWitnessSubmitArgs(cell) {
  return [
    cell.jobType, cell.input.path, cell.outputDir, '-p',
    `witness_script=${cell.witnessScript.path}`,
    `yaw=${cell.yaw}`,
    `pitch=${cell.pitch}`,
  ];
}

export async function validateGestaltWitnessCompletion({ cell, status }) {
  if (status?.status !== 'done' || status.exit_code !== 0) throw new Error(`witness job did not complete: ${status?.status}`);
  if (status.job_type !== cell.jobType) throw new Error(`effective witness job type mismatch: ${status.job_type}`);
  if (resolve(status.input_path) !== cell.input.path) throw new Error(`effective witness input mismatch: ${status.input_path}`);
  if (resolve(status.output_dir) !== cell.outputDir) throw new Error(`effective witness output directory mismatch: ${status.output_dir}`);
  assertEffectiveRunner(status.effective_route, cell.expectedRunner, 'witness');
  const expectedParams = {
    witness_script: cell.witnessScript.path,
    yaw: String(cell.yaw),
    pitch: String(cell.pitch),
  };
  for (const [key, expected] of Object.entries(expectedParams)) {
    if (String(status.params?.[key]) !== expected) {
      throw new Error(`effective witness param mismatch for ${key}: ${status.params?.[key]} != ${expected}`);
    }
  }
  const input = await fileEvidence(cell.input.path);
  if (input.sha256 !== cell.input.sha256) throw new Error(`witness GLB hash drift: ${cell.cellId}`);
  const witnessScript = await fileEvidence(cell.witnessScript.path);
  if (witnessScript.sha256 !== cell.witnessScript.sha256) throw new Error(`witness script hash drift: ${cell.witnessId}`);
  const outputStat = await stat(cell.outputPath);
  const timing = validateRunTiming(status, outputStat, 'witness');
  const output = await fileEvidence(cell.outputPath);
  return {
    schema: 'kaminos.lirm-speciation-gestalt-trellis-witness-completion.v0',
    status: 'accepted-frame-uninspected',
    witnessId: cell.witnessId,
    cellId: cell.cellId,
    generationId: cell.generationId,
    sourceBasinIndex: cell.sourceBasinIndex,
    stance: cell.stance,
    view: cell.view,
    yaw: cell.yaw,
    pitch: cell.pitch,
    jobId: status.job_id,
    requestedRoute: cell.requestedRoute,
    effectiveRoute: status.effective_route,
    effectiveParams: status.params,
    ...timing,
    input,
    witnessScript,
    output,
    visualInspectionClaim: 'not-yet-inspected',
  };
}
