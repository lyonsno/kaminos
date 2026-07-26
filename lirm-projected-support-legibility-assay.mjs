import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildLirmBauplanStagedElaborationPlan,
} from './lirm-bauplan-staged-elaboration-core.mjs';
import {
  createLirmSpeciationArmatureImplicitBodyBundle,
} from './lirm-speciation-armature-core.js';

export const LIRM_PROJECTED_SUPPORT_LEGIBILITY_SCHEMA =
  'kaminos.lirm-projected-support-legibility-preflight.v0';
export const LIRM_PROJECTED_SUPPORT_LEGIBILITY_ROUTE =
  'kaminos/lirm-projected-support-legibility/preflight-v0';

const moduleDir = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT_DIR = join(
  moduleDir,
  'artifacts/lirm-projected-support-legibility-preflight-v0',
);
const MAP_KINDS = Object.freeze(['clay', 'depth', 'normal', 'mask', 'semantic']);
const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;

const MASS_LEVELS = Object.freeze([
  { code: 'B0', id: 'bauplan-only' },
  { code: 'B1', id: 'bauplan-heavy' },
]);
const LIMB_LEVELS = Object.freeze([
  { code: 'L0', id: 'centerline' },
  { code: 'L1', id: 'bilateral-sidecar' },
]);
const CONTACT_LEVELS = Object.freeze([
  { code: 'C0', id: 'body-sdf' },
  { code: 'C1', id: 'semantic-only' },
]);
const VIEW_LEVELS = Object.freeze([
  { code: 'V0', id: 'legacy-yaw-0.42' },
  { code: 'V1', id: 'pairing-legible-yaw-pi-over-4' },
]);

const hashBytes = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

async function evidence(path) {
  const bytes = await readFile(path);
  return {
    byteSize: bytes.length,
    sha256: hashBytes(bytes),
  };
}

async function atomicWriteJson(path, value) {
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, path);
}

function rasterizeSvg(svgPath, pngPath) {
  const result = spawnSync('sips', ['-s', 'format', 'png', svgPath, '--out', pngPath], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(
      `projected support rasterization failed for ${svgPath}: ${
        (result.stderr || result.stdout || '').trim()
      }`,
    );
  }
}

function gitText(repoRoot, args, label) {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`could not resolve projected support ${label}: ${result.stderr}`);
  }
  return result.stdout.trim();
}

async function collectSourceState(repoRoot) {
  const sourcePaths = [
    'lirm-speciation-armature-core.js',
    'lirm-projected-support-legibility-assay.mjs',
  ];
  const status = gitText(
    repoRoot,
    ['status', '--porcelain=v1', '--untracked-files=all'],
    'working tree status',
  );
  return {
    commit: gitText(repoRoot, ['rev-parse', 'HEAD'], 'source commit'),
    dirty: status.length > 0,
    statusLines: status ? status.split('\n') : [],
    sourceFiles: await Promise.all(sourcePaths.map(async path => ({
      path,
      ...(await evidence(join(repoRoot, path))),
    }))),
  };
}

export function buildProjectedSupportAssayCells() {
  const cells = [];
  for (const mass of MASS_LEVELS) {
    for (const limb of LIMB_LEVELS) {
      for (const contact of CONTACT_LEVELS) {
        for (const view of VIEW_LEVELS) {
          cells.push({
            cellId: `${mass.code}-${limb.code}-${contact.code}-${view.code}`,
            mass: mass.id,
            controlFactors: {
              limbEmission: limb.id,
              contactGeometry: contact.id,
              projection: view.id,
            },
          });
        }
      }
    }
  }
  return cells;
}

function requireEvidence(value, label) {
  if (!value || !Number.isInteger(value.byteSize) || value.byteSize <= 0) {
    throw new Error(`${label} lacks positive byte evidence`);
  }
  if (!HASH_PATTERN.test(value.sha256 || '')) {
    throw new Error(`${label} lacks SHA-256 evidence`);
  }
}

function requireProjectionEvidence(value, cell, expectedYaw) {
  const malformed = reason => {
    throw new Error(`${cell.cellId} has malformed projection evidence: ${reason}`);
  };
  if (!value || value.schema !== 'kaminos.projected-support-identity-evidence.v0') {
    malformed('schema mismatch');
  }
  if (
    !Number.isInteger(value.pixelGrid?.width)
    || value.pixelGrid.width <= 0
    || !Number.isInteger(value.pixelGrid?.height)
    || value.pixelGrid.height <= 0
  ) {
    malformed('invalid pixel grid');
  }
  if (value.cameraYawRadians !== expectedYaw) {
    malformed('camera yaw mismatch');
  }
  for (const field of [
    'organismalMaskPixelCount',
    'projectedContactMarkerOccupancy',
    'projectedSupportGeometryOccupancy',
  ]) {
    if (!Number.isInteger(value[field]) || value[field] < 0) {
      malformed(`${field} must be a non-negative integer`);
    }
  }
  if (!Array.isArray(value.primitiveVisibility) || value.primitiveVisibility.length === 0) {
    malformed('primitive visibility is missing');
  }
  for (const primitive of value.primitiveVisibility) {
    if (
      typeof primitive?.id !== 'string'
      || primitive.id.length === 0
      || !Number.isInteger(primitive.index)
      || typeof primitive.role !== 'string'
      || primitive.role.length === 0
      || !Number.isInteger(primitive.visiblePixelCount)
      || primitive.visiblePixelCount < 0
    ) {
      malformed('primitive visibility entry is invalid');
    }
    if (primitive.visiblePixelCount === 0) {
      if (primitive.projectedCentroid !== null) {
        malformed(`${primitive.id} has a centroid without visible pixels`);
      }
      continue;
    }
    const centroid = primitive.projectedCentroid;
    if (
      !Number.isFinite(centroid?.x)
      || centroid.x < 0
      || centroid.x >= value.pixelGrid.width
      || !Number.isFinite(centroid?.y)
      || centroid.y < 0
      || centroid.y >= value.pixelGrid.height
      || !Number.isFinite(centroid?.depth01)
      || centroid.depth01 < 0
      || centroid.depth01 > 1
    ) {
      malformed(`${primitive.id} has an invalid projected centroid`);
    }
  }
  const occupancyFor = role => value.primitiveVisibility
    .filter(primitive => primitive.role === role)
    .reduce((sum, primitive) => sum + primitive.visiblePixelCount, 0);
  const organismalOccupancy = value.primitiveVisibility
    .reduce((sum, primitive) => sum + primitive.visiblePixelCount, 0);
  if (value.organismalMaskPixelCount !== organismalOccupancy) {
    malformed('organismal occupancy does not match primitive visibility');
  }
  if (value.projectedContactMarkerOccupancy !== occupancyFor('contact_point')) {
    malformed('contact occupancy does not match primitive visibility');
  }
  if (value.projectedSupportGeometryOccupancy !== occupancyFor('limb_bud')) {
    malformed('support occupancy does not match primitive visibility');
  }
}

export function validateProjectedSupportAssayReceipt(receipt) {
  if (receipt?.schema !== LIRM_PROJECTED_SUPPORT_LEGIBILITY_SCHEMA) {
    throw new Error('projected support receipt schema mismatch');
  }
  if (
    receipt.requestedRoute !== LIRM_PROJECTED_SUPPORT_LEGIBILITY_ROUTE
    || receipt.effectiveRoute !== receipt.requestedRoute
  ) {
    throw new Error('projected support receipt lost requested and effective route identity');
  }
  if (!Array.isArray(receipt.cells) || receipt.cells.length !== 16) {
    throw new Error('projected support receipt requires exactly sixteen cells');
  }
  const expectedCells = buildProjectedSupportAssayCells();
  if (
    new Set(receipt.cells.map(cell => cell.cellId)).size !== 16
    || expectedCells.some(expected => !receipt.cells.some(cell => cell.cellId === expected.cellId))
  ) {
    throw new Error('projected support receipt cell identity is incomplete or duplicated');
  }
  for (const expected of expectedCells) {
    const actual = receipt.cells.find(cell => cell.cellId === expected.cellId);
    if (
      actual.mass !== expected.mass
      || JSON.stringify(actual.controlFactors) !== JSON.stringify(expected.controlFactors)
      || JSON.stringify(actual.requestedControlFactors) !== JSON.stringify(expected.controlFactors)
    ) {
      throw new Error(`${expected.cellId} has cell identity drift`);
    }
  }
  for (const cell of receipt.cells) {
    const requested = JSON.stringify(cell.requestedControlFactors);
    const effective = JSON.stringify({
      limbEmission: cell.effectiveControlFactors?.limbEmission,
      contactGeometry: cell.effectiveControlFactors?.contactGeometry,
      projection: cell.effectiveControlFactors?.projection,
    });
    if (requested !== effective) {
      throw new Error(`${cell.cellId} lost requested and effective factor identity`);
    }
    const expectedYaw = cell.controlFactors.projection === 'legacy-yaw-0.42'
      ? 0.42
      : Math.PI / 4;
    if (cell.effectiveControlFactors?.cameraYawRadians !== expectedYaw) {
      throw new Error(`${cell.cellId} has camera identity drift`);
    }
    if (!HASH_PATTERN.test(cell.bundleSha256 || '')) {
      throw new Error(`${cell.cellId} bundle lacks SHA-256 evidence`);
    }
    if (!cell.projectionEvidence) {
      throw new Error(`${cell.cellId} is missing projection evidence`);
    }
    requireProjectionEvidence(cell.projectionEvidence, cell, expectedYaw);
    if (
      cell.controlFactors.limbEmission === 'bilateral-sidecar'
      && cell.projectionEvidence.projectedSupportGeometryOccupancy !== 0
    ) {
      throw new Error(`${cell.cellId} projected repeated support geometry`);
    }
    if (
      cell.controlFactors.contactGeometry === 'semantic-only'
      && cell.projectionEvidence.projectedContactMarkerOccupancy !== 0
    ) {
      throw new Error(`${cell.cellId} projected semantic-only contact geometry`);
    }
    for (const kind of MAP_KINDS) {
      if (!cell.maps?.[kind]) throw new Error(`${cell.cellId} missing ${kind} evidence`);
      requireEvidence(cell.maps[kind], `${cell.cellId} ${kind}`);
      requireEvidence(cell.maps[kind].svgEvidence, `${cell.cellId} ${kind} SVG`);
    }
  }
  requireEvidence(receipt.controlSheet, 'projected support control sheet');
  requireEvidence(receipt.repairedSheet, 'projected support repaired sheet');
  if (
    !receipt.sourceState
    || !/^[a-f0-9]{40}$/.test(receipt.sourceState.commit || '')
    || typeof receipt.sourceState.dirty !== 'boolean'
    || !Array.isArray(receipt.sourceState.statusLines)
    || !Array.isArray(receipt.sourceState.sourceFiles)
    || receipt.sourceState.sourceFiles.length !== 2
  ) {
    throw new Error('projected support receipt lacks exact source state');
  }
  if (receipt.sourceCommit !== receipt.sourceState.commit) {
    throw new Error('projected support receipt has source commit drift');
  }
  if (receipt.sourceState.dirty && receipt.sourceState.statusLines.length === 0) {
    throw new Error('projected support dirty source state lacks status lines');
  }
  if (!receipt.sourceState.dirty && receipt.sourceState.statusLines.length > 0) {
    throw new Error('projected support clean source state carries dirty status lines');
  }
  const sourcePaths = receipt.sourceState.sourceFiles.map(source => source.path).sort();
  if (JSON.stringify(sourcePaths) !== JSON.stringify([
    'lirm-projected-support-legibility-assay.mjs',
    'lirm-speciation-armature-core.js',
  ])) {
    throw new Error('projected support receipt source state has file identity drift');
  }
  for (const source of receipt.sourceState.sourceFiles) {
    requireEvidence(source, `projected support source ${source.path || 'unknown'}`);
  }
  return true;
}

function sheetManifest(cells, outDir) {
  return {
    schema: 'kaminos.lirm-projected-support-legibility-control-sheet.v0',
    columns: 4,
    rows: 4,
    width: 1280,
    cellWidth: 320,
    cellHeight: 292,
    imageHeight: 240,
    imageOffsetY: 0,
    cells: cells.map(cell => ({
      sourcePath: join(outDir, cell.maps.clay.path),
      title: cell.cellId,
      viewLabel: `${cell.mass} | ${cell.requestedControlFactors.limbEmission} | ${
        cell.requestedControlFactors.contactGeometry
      } | ${cell.requestedControlFactors.projection}`,
    })),
  };
}

function repairedSheetManifest(cells, outDir) {
  const repaired = cells.filter(cell => (
    cell.requestedControlFactors.limbEmission === 'bilateral-sidecar'
    && cell.requestedControlFactors.contactGeometry === 'semantic-only'
  ));
  return {
    schema: 'kaminos.lirm-projected-support-legibility-repaired-sheet.v0',
    columns: 2,
    rows: 2,
    width: 640,
    cellWidth: 320,
    cellHeight: 292,
    imageHeight: 240,
    imageOffsetY: 0,
    cells: repaired.map(cell => ({
      sourcePath: join(outDir, cell.maps.clay.path),
      title: cell.cellId,
      viewLabel: `${cell.mass} | ${cell.requestedControlFactors.projection}`,
    })),
  };
}

function assembleSheet({ manifestPath, sheetPath, repoRoot }) {
  const assembler = join(
    repoRoot,
    'artifacts/lirm-rare-gestalt-pressure-ladder-v1/assemble-imagegen-contact-sheet.swift',
  );
  const result = spawnSync('swift', [assembler, manifestPath, sheetPath], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`projected support sheet assembly failed: ${result.stderr || result.stdout}`);
  }
}

export async function writeLirmProjectedSupportLegibilityAssay({
  outDir = DEFAULT_OUT_DIR,
} = {}) {
  const repoRoot = moduleDir;
  const receiptPath = join(outDir, 'receipt.json');
  await mkdir(outDir, { recursive: true });
  const sourceState = await collectSourceState(repoRoot);
  const initialized = {
    schema: LIRM_PROJECTED_SUPPORT_LEGIBILITY_SCHEMA,
    status: 'running',
    phase: 'initialized',
    requestedRoute: LIRM_PROJECTED_SUPPORT_LEGIBILITY_ROUTE,
    effectiveRoute: null,
    sourceCommit: sourceState.commit,
    sourceState,
    operatorExposure: 'prohibited_pending_agent_visual_inspection',
    generatorFiring: 'not_started',
    lastTrustworthyEvidence: 'invocation and source commit recorded; no control accepted',
  };
  await atomicWriteJson(receiptPath, initialized);

  try {
    const plan = buildLirmBauplanStagedElaborationPlan();
    const candidates = new Map([
      ['bauplan-only', plan.stages.find(stage => stage.id === 'bauplan-only').candidate],
      ['bauplan-heavy', plan.massAuthority.variant.candidate],
    ]);
    const cells = [];
    for (const cell of buildProjectedSupportAssayCells()) {
      const candidate = candidates.get(cell.mass);
      if (!candidate) throw new Error(`projected support candidate missing: ${cell.mass}`);
      const bundle = createLirmSpeciationArmatureImplicitBodyBundle({
        witness: plan.sourceWitness,
        candidate,
        controlFactors: cell.controlFactors,
      });
      const cellDir = join(outDir, 'cells', cell.cellId);
      await mkdir(cellDir, { recursive: true });
      const maps = {};
      for (const map of bundle.renderMaps) {
        const svgPath = join(cellDir, `${map.kind}.svg`);
        const pngPath = join(cellDir, `${map.kind}.png`);
        await writeFile(svgPath, map.svg);
        rasterizeSvg(svgPath, pngPath);
        maps[map.kind] = {
          path: relative(outDir, pngPath),
          svgPath: relative(outDir, svgPath),
          ...(await evidence(pngPath)),
          svgEvidence: await evidence(svgPath),
        };
      }
      const bundlePath = join(cellDir, 'bundle.json');
      await atomicWriteJson(bundlePath, {
        ...bundle,
        renderMaps: bundle.renderMaps.map(map => ({ kind: map.kind, path: map.path })),
        trellisSource: {
          ...bundle.trellisSource,
          svg: undefined,
        },
      });
      cells.push({
        ...cell,
        candidateId: candidate.id,
        requestedControlFactors: bundle.controlFactors.requested,
        effectiveControlFactors: bundle.controlFactors.effective,
        sourceEquality: bundle.controlFactors.sourceEquality,
        camera: bundle.camera,
        primitiveInventory: bundle.implicitPrimitiveInventory,
        projectionEvidence: bundle.projectionEvidence,
        bundlePath: relative(outDir, bundlePath),
        bundleSha256: (await evidence(bundlePath)).sha256,
        maps,
      });
    }

    const manifestPath = join(outDir, 'control-sheet-manifest.json');
    const sheetPath = join(outDir, 'control-sheet.png');
    await atomicWriteJson(manifestPath, sheetManifest(cells, outDir));
    assembleSheet({ manifestPath, sheetPath, repoRoot });

    const repairedManifestPath = join(outDir, 'repaired-sheet-manifest.json');
    const repairedSheetPath = join(outDir, 'repaired-sheet.png');
    await atomicWriteJson(repairedManifestPath, repairedSheetManifest(cells, outDir));
    assembleSheet({ manifestPath: repairedManifestPath, sheetPath: repairedSheetPath, repoRoot });

    const completed = {
      ...initialized,
      status: 'controls-complete-uninspected',
      phase: 'control-sheets-written',
      effectiveRoute: LIRM_PROJECTED_SUPPORT_LEGIBILITY_ROUTE,
      sourceCandidateId: plan.sourceCandidateId,
      sourceSeed: plan.sourceSeed,
      factors: {
        mass: MASS_LEVELS.map(level => level.id),
        limbEmission: LIMB_LEVELS.map(level => level.id),
        contactGeometry: CONTACT_LEVELS.map(level => level.id),
        projection: VIEW_LEVELS.map(level => level.id),
      },
      cells,
      controlSheet: {
        path: relative(outDir, sheetPath),
        ...(await evidence(sheetPath)),
      },
      repairedSheet: {
        path: relative(outDir, repairedSheetPath),
        ...(await evidence(repairedSheetPath)),
      },
      falseClosureGuards: {
        controlRenderProvesImageCompletionCause: false,
        repairedGeometryProvesPositiveAesthetics: false,
        positiveStaticControlProvesTrellisSafety: false,
        generatorFiring: 'forbidden_until_agent_visual_inspection',
      },
      lastTrustworthyEvidence:
        'sixteen deterministic controls rendered with exact factor, primitive, camera, map, and projection receipts; visual inspection pending',
    };
    validateProjectedSupportAssayReceipt(completed);
    await atomicWriteJson(receiptPath, completed);
    return completed;
  } catch (error) {
    await atomicWriteJson(receiptPath, {
      ...initialized,
      status: 'failed',
      phase: 'control-generation-or-validation-failed',
      errorMessage: String(error?.message || error),
      lastTrustworthyEvidence:
        'initialized receipt and source commit only; partial controls are inadmissible',
    });
    throw error;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const outArg = process.argv.find(argument => argument.startsWith('--out-dir='));
  await writeLirmProjectedSupportLegibilityAssay({
    outDir: outArg ? resolve(outArg.slice('--out-dir='.length)) : DEFAULT_OUT_DIR,
  });
}
