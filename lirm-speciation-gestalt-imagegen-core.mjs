import { createHash } from 'node:crypto';
import { stat, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export const GESTALT_IMAGEGEN_PLAN_SCHEMA = 'kaminos.lirm-speciation-gestalt-imagegen-plan.v0';
export const GESTALT_IMAGEGEN_COMPLETION_SCHEMA = 'kaminos.lirm-speciation-gestalt-imagegen-completion.v0';
export const GESTALT_IMAGEGEN_JOB_TYPE = 'mflux_flux2_edit_promptfile';
export const GESTALT_IMAGEGEN_JOB_TYPE_2REF = 'mflux_flux2_edit_promptfile_2ref';
export const GESTALT_IMAGEGEN_JOB_TYPE_3REF = 'mflux_flux2_edit_promptfile_3ref';
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

export function assertExactIdCoverage({ plannedIds, observedIds, label = 'item' }) {
  if (!Array.isArray(plannedIds) || !Array.isArray(observedIds)) {
    throw new TypeError(`${label} ID coverage requires plannedIds and observedIds arrays`);
  }
  const normalize = (ids, side) => {
    const seen = new Set();
    for (const id of ids) {
      if (typeof id !== 'string' || id.length === 0) {
        throw new TypeError(`${side} ${label} ID must be a non-empty string`);
      }
      if (seen.has(id)) {
        const error = new Error(`duplicate ${side} ${label} ID: ${id}`);
        error.code = 'ERR_EXACT_ID_COVERAGE';
        throw error;
      }
      seen.add(id);
    }
    return seen;
  };
  const planned = normalize(plannedIds, 'planned');
  const observed = normalize(observedIds, 'observed');
  for (const id of planned) {
    if (!observed.has(id)) {
      const error = new Error(`missing ${label} ID: ${id}`);
      error.code = 'ERR_EXACT_ID_COVERAGE';
      throw error;
    }
  }
  for (const id of observed) {
    if (!planned.has(id)) {
      const error = new Error(`unexpected ${label} ID: ${id}`);
      error.code = 'ERR_EXACT_ID_COVERAGE';
      throw error;
    }
  }
}

function validateFactorialComparisonContract(contract, cells) {
  const allowedKeys = new Set([
    'kind',
    'fixedSilhouetteLineage',
    'factorialSeed',
    'armatures',
    'promptStances',
    'seedProbe',
  ]);
  for (const key of Object.keys(contract)) {
    if (!allowedKeys.has(key)) throw new Error(`comparison contract has unsupported field: ${key}`);
  }
  if (contract.kind !== 'armature-prompt-pressure-factorial-plus-seed-probe') {
    throw new Error(`unsupported comparison contract kind: ${contract.kind}`);
  }
  if (typeof contract.fixedSilhouetteLineage !== 'string' || contract.fixedSilhouetteLineage.length === 0) {
    throw new Error('comparison contract requires fixedSilhouetteLineage');
  }
  if (!Number.isSafeInteger(contract.factorialSeed)) {
    throw new Error('comparison contract requires a safe integer factorialSeed');
  }
  for (const [field, values] of [
    ['armatures', contract.armatures],
    ['promptStances', contract.promptStances],
  ]) {
    if (!Array.isArray(values) || values.length === 0) {
      throw new Error(`comparison contract requires non-empty ${field}`);
    }
    assertExactIdCoverage({ plannedIds: values, observedIds: values, label: `comparison contract ${field}` });
  }
  const probe = contract.seedProbe;
  if (!probe || typeof probe !== 'object' || Array.isArray(probe)
    || typeof probe.candidateId !== 'string' || probe.candidateId.length === 0
    || typeof probe.stance !== 'string' || probe.stance.length === 0
    || !Number.isSafeInteger(probe.seed)) {
    throw new Error('comparison contract requires an exact seedProbe');
  }
  if (probe.seed === contract.factorialSeed) {
    throw new Error('comparison contract seed probe must use a different seed from the factorial');
  }
  const lineageIds = [...new Set(cells.map(cell => cell.generationId))];
  if (lineageIds.length !== 1 || lineageIds[0] !== contract.fixedSilhouetteLineage) {
    throw new Error(`comparison contract fixed silhouette lineage mismatch: ${lineageIds.join(',')}`);
  }
  const factorialCells = cells.filter(cell => cell.imagegenSeed === contract.factorialSeed);
  const expectedFactorialIds = contract.armatures.flatMap(candidateId => (
    contract.promptStances.map(stance => `${candidateId}\u0000${stance}`)
  ));
  const observedFactorialIds = factorialCells.map(cell => `${cell.candidateId}\u0000${cell.stance}`);
  try {
    assertExactIdCoverage({
      plannedIds: expectedFactorialIds,
      observedIds: observedFactorialIds,
      label: 'comparison contract factorial cell',
    });
  } catch (error) {
    throw new Error(`comparison contract factorial mismatch: ${error.message}`, { cause: error });
  }
  const probeCells = cells.filter(cell => (
    cell.candidateId === probe.candidateId
    && cell.stance === probe.stance
    && cell.imagegenSeed === probe.seed
  ));
  if (probeCells.length !== 1) {
    throw new Error(`comparison contract seed probe mismatch: found ${probeCells.length} matching cells`);
  }
  const describedIds = new Set([...factorialCells, ...probeCells].map(cell => cell.cellId));
  if (describedIds.size !== cells.length || cells.some(cell => !describedIds.has(cell.cellId))) {
    throw new Error('comparison contract does not account for every promoted cell');
  }
}

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
  seeds = null,
  generationIds = DEFAULT_GENERATIONS,
  selections = null,
  stances = STANCES,
}) {
  assertCompositeReceipt(compositeReceipt);
  const requestedSelections = selections ?? generationIds.map(generationId => ({
    candidateId: 'lirm-armature-22',
    generationId,
  }));
  if (!Array.isArray(requestedSelections) || requestedSelections.length === 0) {
    throw new Error('imagegen matrix requires at least one composite selection');
  }
  const selectionKeys = new Set();
  for (const selection of requestedSelections) {
    if (!selection?.candidateId || !selection?.generationId) {
      throw new Error('composite selection requires candidateId and generationId');
    }
    const key = `${selection.candidateId}\u0000${selection.generationId}`;
    if (selectionKeys.has(key)) {
      throw new Error(`duplicate requested composite selection: ${selection.candidateId} / ${selection.generationId}`);
    }
    selectionKeys.add(key);
  }

  const bundles = requestedSelections.map((selection) => {
    const pairMatches = compositeReceipt.bundles.filter(bundle => (
      bundle.candidateId === selection.candidateId
      && bundle.gestaltEnvelope?.lineage?.generationId === selection.generationId
    ));
    if (pairMatches.length === 0) {
      throw new Error(`missing requested composite selection: ${selection.candidateId} / ${selection.generationId}`);
    }
    const pressureMatches = pairMatches.filter(bundle => bundle.fieldModel?.gestaltPressure === 0.46);
    if (pressureMatches.length === 0) {
      throw new Error(`requested composite is not an accepted true-3D p0.46 bundle: ${selection.candidateId} / ${selection.generationId}`);
    }
    if (pressureMatches.length > 1) {
      throw new Error(`duplicate p0.46 composite bundles: ${selection.candidateId} / ${selection.generationId}`);
    }
    const bundle = pressureMatches[0];
    if (bundle.fieldModel?.actual3dStructure !== true
      || bundle.fieldModel?.kind !== 'smooth-sdf-metaball-silhouette-morph'
      || bundle.gestaltEnvelope?.lineage?.acceptedForDownstream !== true) {
      throw new Error(`requested composite is not an accepted true-3D p0.46 bundle: ${selection.candidateId} / ${selection.generationId}`);
    }
    return bundle;
  });

  if (!Array.isArray(stances) || stances.length === 0) {
    throw new Error('imagegen matrix requires at least one prompt stance');
  }
  const stanceIds = new Set();
  for (const stance of stances) {
    if (!stance?.id || !stance?.file) throw new Error('prompt stance requires id and file');
    if (stanceIds.has(stance.id)) throw new Error(`duplicate prompt stance: ${stance.id}`);
    stanceIds.add(stance.id);
  }

  const prompts = new Map();
  for (const stance of stances) {
    prompts.set(stance.id, await fileEvidence(resolve(promptRoot, stance.file)));
  }

  const requestedSeeds = seeds ?? [seed];
  if (!Array.isArray(requestedSeeds) || requestedSeeds.length === 0) {
    throw new Error('imagegen matrix requires at least one seed');
  }
  const uniqueSeeds = new Set();
  for (const requestedSeed of requestedSeeds) {
    if (!Number.isSafeInteger(requestedSeed) || requestedSeed < 0) {
      throw new Error(`invalid imagegen seed: ${requestedSeed}`);
    }
    if (uniqueSeeds.has(requestedSeed)) throw new Error(`duplicate imagegen seed: ${requestedSeed}`);
    uniqueSeeds.add(requestedSeed);
  }

  const cells = [];
  for (const bundle of bundles) {
    const generationId = bundle.gestaltEnvelope.lineage.generationId;
    const input = await fileEvidence(resolve(sourceRoot, bundle.trellisSource.rasterPath));
    for (const requestedSeed of requestedSeeds) {
      for (const stance of stances) {
        const cellId = `${bundle.compositeId}-${stance.id}-seed${requestedSeed}`;
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
          seed: requestedSeed,
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
  }

  const candidateIds = [...new Set(requestedSelections.map(selection => selection.candidateId))];
  const selectedGenerationIds = [...new Set(requestedSelections.map(selection => selection.generationId))];
  const comparisonContract = {
    fixedGestaltPressure: 0.46,
    variedPromptStances: stances.map(stance => stance.id),
  };
  if (requestedSeeds.length === 1) comparisonContract.fixedSeed = requestedSeeds[0];
  else comparisonContract.variedSeeds = requestedSeeds;
  if (candidateIds.length === 1) comparisonContract.fixedCandidate = candidateIds[0];
  else comparisonContract.variedCandidates = candidateIds;
  if (selectedGenerationIds.length === 1) comparisonContract.fixedSourceBasins = selectedGenerationIds;
  else comparisonContract.variedSourceBasins = selectedGenerationIds;

  return {
    schema: GESTALT_IMAGEGEN_PLAN_SCHEMA,
    createdAt: new Date().toISOString(),
    purpose: 'Test whether true-3D silhouette-bounded armatures invoke distinct creature priors while preserving dual lineage.',
    requestedRoute: `gpu-greenroom/${GESTALT_IMAGEGEN_JOB_TYPE}`,
    expectedRunner: GESTALT_IMAGEGEN_RUNNER,
    comparisonContract,
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
  const referenceCounts = new Map([
    [GESTALT_IMAGEGEN_JOB_TYPE, 0],
    [GESTALT_IMAGEGEN_JOB_TYPE_2REF, 1],
    [GESTALT_IMAGEGEN_JOB_TYPE_3REF, 2],
  ]);
  if (!referenceCounts.has(cell?.jobType)) throw new Error(`unsupported job type: ${cell?.jobType}`);
  const references = cell.references ?? [];
  const expectedReferenceCount = referenceCounts.get(cell.jobType);
  if (!Array.isArray(references) || references.length !== expectedReferenceCount) {
    throw new Error(`${cell.jobType} requires exactly ${expectedReferenceCount} secondary reference(s)`);
  }
  for (const [index, reference] of references.entries()) {
    if (!reference?.path || !reference?.role || !reference?.sha256) {
      throw new Error(`secondary reference ${index + 2} requires role, path, and hash evidence`);
    }
  }
  const settings = cell.settings;
  const params = [
    ...references.map((reference, index) => `reference_path_${index + 2}=${reference.path}`),
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
  return [
    cell.jobType,
    cell.input.path,
    cell.outputDir,
    '-p',
    ...params,
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
    ...(cell.references ?? []).reduce((params, reference, index) => ({
      ...params,
      [`reference_path_${index + 2}`]: reference.path,
    }), {}),
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
  const references = [];
  for (const reference of cell.references ?? []) {
    const observed = await fileEvidence(reference.path);
    if (observed.sha256 !== reference.sha256) {
      throw new Error(`imagegen secondary reference hash drift (${reference.role}): ${cell.cellId}`);
    }
    references.push({ ...observed, role: reference.role });
  }
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
    references,
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

export async function buildGestaltAdherenceContactSheetManifest({ plan, completion, sourceRoot }) {
  if (plan?.schema !== GESTALT_IMAGEGEN_PLAN_SCHEMA) throw new Error(`unexpected plan schema: ${plan?.schema}`);
  if (completion?.schema !== 'kaminos.lirm-speciation-gestalt-imagegen-collection.v0') {
    throw new Error(`unexpected completion schema: ${completion?.schema}`);
  }
  if (completion.status !== 'complete') throw new Error(`imagegen collection is not complete: ${completion.status}`);
  if (!Array.isArray(completion.accepted) || completion.accepted.length !== plan.cells.length) {
    throw new Error('accepted output count does not match plan');
  }
  const accepted = new Map(completion.accepted.map(entry => [entry.cellId, entry]));
  if (accepted.size !== plan.cells.length) throw new Error('accepted output count does not match plan');
  const showSeed = Array.isArray(plan.comparisonContract?.variedSeeds);

  const cells = [];
  const evidence = [];
  for (const cell of plan.cells) {
    const source = await fileEvidence(cell.input.path);
    if (source.sha256 !== cell.input.sha256) throw new Error(`source input hash drift for ${cell.cellId}`);
    const depth = await fileEvidence(resolve(sourceRoot, cell.compositeId, 'depth-composite.png'));
    const normal = await fileEvidence(resolve(sourceRoot, cell.compositeId, 'normal-composite.png'));
    const acceptedOutput = accepted.get(cell.cellId);
    if (!acceptedOutput) throw new Error(`missing accepted output for ${cell.cellId}`);
    const output = await fileEvidence(cell.outputPath);
    if (output.sha256 !== acceptedOutput.output.sha256) throw new Error(`generated output hash drift for ${cell.cellId}`);
    evidence.push(source, depth, normal, output);
    const title = showSeed ? `${cell.candidateId} / seed ${cell.seed}` : cell.candidateId;
    const stanceLabel = cell.stance.replaceAll('-', ' ').toUpperCase();
    cells.push(
      { sourcePath: source.path, title, viewLabel: '3D SCAFFOLD' },
      { sourcePath: depth.path, title, viewLabel: 'DEPTH' },
      { sourcePath: normal.path, title, viewLabel: 'NORMAL' },
      { sourcePath: output.path, title, viewLabel: stanceLabel },
    );
  }
  return {
    schema: 'kaminos.lirm-speciation-gestalt-adherence-contact-sheet-manifest.v0',
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
  comparisonContract = null,
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
      candidateId: sourceCell.candidateId,
      generationId: sourceCell.generationId,
      sourceBasinIndex: sourceCell.sourceBasinIndex,
      stance: sourceCell.stance,
      imagegenSeed: sourceCell.seed,
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
  let effectiveComparisonContract;
  if (comparisonContract === null) {
    const lineageBasins = cells.filter(cell => cell.stance === 'lineage-seed').map(cell => cell.sourceBasinIndex);
    const basin03Stances = cells.filter(cell => cell.sourceBasinIndex === 3).map(cell => cell.stance).sort();
    if (JSON.stringify(lineageBasins) !== JSON.stringify([3, 10, 15, 22])) {
      throw new Error(`promotion must compare lineage basins 3,10,15,22; got ${lineageBasins.join(',')}`);
    }
    if (JSON.stringify(basin03Stances) !== JSON.stringify(['lineage-seed', 'preserve-gestalt'])) {
      throw new Error('promotion must compare both prompt stances in basin 03');
    }
    effectiveComparisonContract = {
      lineageBasins: [3, 10, 15, 22],
      withinBasinPromptPair: { sourceBasinIndex: 3, stances: ['preserve-gestalt', 'lineage-seed'] },
      fixedSettings: cells[0].settings,
    };
  } else {
    if (typeof comparisonContract !== 'object' || Array.isArray(comparisonContract)
      || typeof comparisonContract.kind !== 'string' || comparisonContract.kind.length === 0) {
      throw new Error('explicit Trellis comparison contract requires a non-empty kind');
    }
    validateFactorialComparisonContract(comparisonContract, cells);
    effectiveComparisonContract = { ...comparisonContract, fixedSettings: cells[0].settings };
  }
  return {
    schema: GESTALT_TRELLIS_PLAN_SCHEMA,
    status: 'planned',
    comparisonContract: effectiveComparisonContract,
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
    candidateId: cell.candidateId,
    imagegenSeed: cell.imagegenSeed,
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
        candidateId: sourceCell.candidateId,
        imagegenSeed: sourceCell.imagegenSeed,
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
    candidateId: cell.candidateId,
    imagegenSeed: cell.imagegenSeed,
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
