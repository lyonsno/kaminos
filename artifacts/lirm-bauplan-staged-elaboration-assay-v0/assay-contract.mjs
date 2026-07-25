import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildLirmBauplanStagedElaborationPlan,
} from '../../lirm-bauplan-staged-elaboration-core.mjs';
import {
  LIRM_SPECIATION_ARMATURE_IMPLICIT_BODY_ROUTE,
  writeLirmSpeciationArmatureImplicitBodyWitness,
} from '../../lirm-speciation-armature-core.js';

const artifactRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(artifactRoot, '../..');
const loopOneArtifactRoot = join(
  repoRoot,
  'artifacts/lirm-bauplan-mass-authority-loop-one-v0',
);
const hashBytes = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const atomicWriteJson = async (path, value) => {
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, path);
};

const COMPARATOR_ID = 'cleft-crown-x-lateral-sail-f1-crown-dominant';
const COMPARATOR_ROOT = join(
  repoRoot,
  'artifacts/lirm-heritable-hybrid-cross-v0/candidates',
  COMPARATOR_ID,
  COMPARATOR_ID,
);
const MAP_SOURCE_NAMES = Object.freeze({
  clay: 'clay-implicit.png',
  depth: 'depth-implicit.png',
  normal: 'normal-implicit.png',
});
export const LIRM_BAUPLAN_STAGED_ELABORATION_CONTROL_RECEIPT =
  'control-generation-receipt.json';

async function evidence(path) {
  const bytes = await readFile(path);
  return { byteSize: bytes.length, sha256: hashBytes(bytes) };
}

export async function resolveComparatorMapSources({
  localRoot,
  legacyRoot,
}) {
  await mkdir(localRoot, { recursive: true });
  const maps = {};
  for (const [kind, legacyName] of Object.entries(MAP_SOURCE_NAMES)) {
    const localPath = join(localRoot, `${kind}.png`);
    let imported = false;
    try {
      await readFile(localPath);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await copyFile(join(legacyRoot, legacyName), localPath);
      imported = true;
    }
    maps[kind] = {
      path: localPath,
      imported,
      legacyPath: join(legacyRoot, legacyName),
    };
  }
  return maps;
}

async function copyComparator() {
  const targetRoot = join(artifactRoot, 'controls', 'annular-comparator');
  const sources = await resolveComparatorMapSources({
    localRoot: targetRoot,
    legacyRoot: COMPARATOR_ROOT,
  });
  const maps = {};
  for (const [kind, source] of Object.entries(sources)) {
    maps[kind] = {
      path: relative(artifactRoot, source.path),
      historicalSourcePath: relative(repoRoot, source.legacyPath),
      resolvedFrom: source.imported ? 'legacy-import' : 'committed-local',
      ...(await evidence(source.path)),
    };
  }
  return maps;
}

async function renderStagedControls(plan) {
  const outDir = join(artifactRoot, 'controls', 'staged-lineage');
  const witness = {
    ...plan.sourceWitness,
    candidates: plan.stages.map(stage => stage.candidate),
  };
  const candidateIds = plan.stages.map(stage => stage.candidate.id);
  const result = await writeLirmSpeciationArmatureImplicitBodyWitness({
    outDir,
    seed: plan.sourceSeed,
    witness,
    candidateIds,
  });
  const receipt = JSON.parse(await readFile(result.receiptPath, 'utf8'));
  const outputs = [];
  for (const stage of plan.stages) {
    const inventory = receipt.outputInventory.bundles.find(item => item.candidateId === stage.id);
    if (!inventory) throw new Error(`staged control inventory missing: ${stage.id}`);
    const maps = {};
    for (const kind of ['clay', 'depth', 'normal']) {
      const item = inventory.maps.find(map => map.kind === kind);
      const path = join(outDir, item.rasterPath);
      maps[kind] = {
        path: relative(artifactRoot, path),
        ...(await evidence(path)),
      };
    }
    outputs.push({
      id: stage.id,
      lineageId: stage.lineageId,
      parentId: stage.parentId,
      generation: stage.generation,
      stageKind: stage.stageKind,
      developmentalModules: stage.developmentalModules,
      bauplanContract: stage.bauplanContract,
      maps,
    });
  }
  return {
    requestedRoute: LIRM_SPECIATION_ARMATURE_IMPLICIT_BODY_ROUTE,
    effectiveRoute: result.route,
    receiptPath: relative(artifactRoot, result.receiptPath),
    outputs,
  };
}

async function renderLoopOneControls(plan) {
  const outDir = join(loopOneArtifactRoot, 'controls');
  const candidateIds = plan.massAuthority.assayContract.candidateIds;
  const candidates = [
    plan.stages.find(stage => stage.id === candidateIds[0])?.candidate,
    plan.massAuthority.variant.candidate,
  ];
  if (candidates.some(candidate => !candidate)) {
    throw new Error(`Loop One candidates missing: ${candidateIds.join(', ')}`);
  }
  const result = await writeLirmSpeciationArmatureImplicitBodyWitness({
    outDir,
    seed: plan.sourceSeed,
    witness: {
      ...plan.sourceWitness,
      candidates,
    },
    candidateIds,
  });
  const receipt = JSON.parse(await readFile(result.receiptPath, 'utf8'));
  const outputs = [];
  for (const candidateId of candidateIds) {
    const inventory = receipt.outputInventory.bundles.find(
      item => item.candidateId === candidateId,
    );
    if (!inventory) throw new Error(`Loop One control inventory missing: ${candidateId}`);
    const bundlePath = join(outDir, inventory.bundle);
    const bundle = JSON.parse(await readFile(bundlePath, 'utf8'));
    const maps = {};
    for (const kind of ['clay', 'depth', 'normal']) {
      const item = inventory.maps.find(map => map.kind === kind);
      if (!item) throw new Error(`Loop One ${candidateId} control map missing: ${kind}`);
      const path = join(outDir, item.rasterPath);
      maps[kind] = {
        path: relative(loopOneArtifactRoot, path),
        ...(await evidence(path)),
      };
    }
    outputs.push({
      cellSourceId: candidateId,
      bundlePath: relative(loopOneArtifactRoot, bundlePath),
      bundleSha256: (await evidence(bundlePath)).sha256,
      camera: bundle.camera,
      maps,
    });
  }
  if (JSON.stringify(outputs[0].camera) !== JSON.stringify(outputs[1].camera)) {
    throw new Error('Loop One controls did not preserve one exact camera');
  }
  return {
    requestedRoute: plan.massAuthority.assayContract.controlProjection.requestedRoute,
    effectiveRoute: result.route,
    receiptPath: relative(loopOneArtifactRoot, result.receiptPath),
    outputs,
  };
}

function loopOneControlSheetManifest(outputs) {
  const cells = [];
  for (const kind of ['clay', 'depth', 'normal']) {
    for (const output of outputs) {
      cells.push({
        sourcePath: join(loopOneArtifactRoot, output.maps[kind].path),
        title: output.cellSourceId,
        viewLabel: kind,
      });
    }
  }
  return {
    schema: 'kaminos.lirm-bauplan-mass-authority-loop-one-control-sheet.v0',
    columns: 2,
    rows: 3,
    width: 1024,
    cellWidth: 512,
    cellHeight: 432,
    imageHeight: 384,
    imageOffsetY: 0,
    cells,
  };
}

export async function writeLirmBauplanMassAuthorityLoopOneControls() {
  await mkdir(loopOneArtifactRoot, { recursive: true });
  const receiptPath = join(loopOneArtifactRoot, 'control-generation-receipt.json');
  const initialized = {
    schema: 'kaminos.lirm-bauplan-mass-authority-loop-one-control-receipt.v0',
    status: 'running',
    phase: 'initialized',
    requestedRoute: LIRM_SPECIATION_ARMATURE_IMPLICIT_BODY_ROUTE,
    effectiveRoute: null,
    researchVisibility: 'agent_only',
    operatorExposure: 'prohibited_pending_independent_safe_and_happy',
    lastTrustworthyEvidence: 'invocation recorded; no control accepted',
  };
  await atomicWriteJson(receiptPath, initialized);
  try {
    const plan = buildLirmBauplanStagedElaborationPlan();
    const contract = plan.massAuthority.assayContract;
    const promptPath = join(loopOneArtifactRoot, 'neutral-completion-prompt.txt');
    const contractPath = join(loopOneArtifactRoot, 'assay-contract.json');
    await writeFile(promptPath, `${contract.imagegen.prompt}\n`);
    await atomicWriteJson(contractPath, {
      ...contract,
      sourceCandidateId: plan.sourceCandidateId,
      sourceSeed: plan.sourceSeed,
      parentStageId: plan.massAuthority.parentStageId,
      changed: plan.massAuthority.changed,
      preserved: plan.massAuthority.preserved,
    });
    const controls = await renderLoopOneControls(plan);
    const manifest = loopOneControlSheetManifest(controls.outputs);
    const manifestPath = join(loopOneArtifactRoot, 'control-sheet-manifest.json');
    const sheetPath = join(loopOneArtifactRoot, 'control-sheet.png');
    await atomicWriteJson(manifestPath, manifest);
    const assembler = join(
      repoRoot,
      'artifacts/lirm-rare-gestalt-pressure-ladder-v1/assemble-imagegen-contact-sheet.swift',
    );
    const assembled = spawnSync('swift', [assembler, manifestPath, sheetPath], {
      encoding: 'utf8',
    });
    if (assembled.status !== 0) {
      throw new Error(`Loop One control sheet assembly failed: ${assembled.stderr || assembled.stdout}`);
    }
    const completed = {
      ...initialized,
      status: 'controls-complete-uninspected',
      phase: 'control-sheet-written',
      effectiveRoute: controls.effectiveRoute,
      sourceCandidateId: plan.sourceCandidateId,
      sourceSeed: plan.sourceSeed,
      assayContractPath: relative(loopOneArtifactRoot, contractPath),
      assayContractSha256: (await evidence(contractPath)).sha256,
      promptPath: relative(loopOneArtifactRoot, promptPath),
      promptSha256: (await evidence(promptPath)).sha256,
      controls,
      controlSheet: {
        path: relative(loopOneArtifactRoot, sheetPath),
        ...(await evidence(sheetPath)),
      },
      lastTrustworthyEvidence:
        'explicit-module-free parent and heavy sibling rendered under one effective route and one camera; visual inspection pending',
    };
    await atomicWriteJson(receiptPath, completed);
    return completed;
  } catch (error) {
    await atomicWriteJson(receiptPath, {
      ...initialized,
      status: 'failed',
      phase: 'control-generation-failed',
      errorMessage: error.message,
      lastTrustworthyEvidence:
        'invocation and initialized receipt recorded; one or more controls untrusted',
    });
    throw error;
  }
}

function sheetManifest(staged, comparator) {
  const cells = staged.outputs.map(output => ({
    sourcePath: join(artifactRoot, output.maps.clay.path),
    title: `G${output.generation} ${output.stageKind}`,
    viewLabel: output.developmentalModules.join(' + ') || 'bauplan only',
  }));
  cells.push({
    sourcePath: join(artifactRoot, comparator.clay.path),
    title: 'HOSTILE COMPARATOR',
    viewLabel: 'annular visible-locus control',
  });
  return {
    schema: 'kaminos.lirm-bauplan-staged-elaboration-control-sheet.v0',
    columns: 4,
    rows: 1,
    width: 1280,
    cellWidth: 320,
    cellHeight: 292,
    imageHeight: 240,
    imageOffsetY: 0,
    cells,
  };
}

export async function writeLirmBauplanStagedElaborationControls() {
  await mkdir(artifactRoot, { recursive: true });
  const receiptPath = join(
    artifactRoot,
    LIRM_BAUPLAN_STAGED_ELABORATION_CONTROL_RECEIPT,
  );
  const initialized = {
    schema: 'kaminos.lirm-bauplan-staged-elaboration-assay.v0',
    status: 'running',
    phase: 'initialized',
    requestedRoute: LIRM_SPECIATION_ARMATURE_IMPLICIT_BODY_ROUTE,
    effectiveRoute: null,
    lastTrustworthyEvidence: 'invocation recorded; no control accepted',
  };
  await atomicWriteJson(receiptPath, initialized);
  try {
    const plan = buildLirmBauplanStagedElaborationPlan();
    const staged = await renderStagedControls(plan);
    const comparator = await copyComparator();
    const manifest = sheetManifest(staged, comparator);
    const manifestPath = join(artifactRoot, 'control-contact-sheet-manifest.json');
    const sheetPath = join(artifactRoot, 'control-contact-sheet.png');
    await atomicWriteJson(manifestPath, manifest);
    const assembler = join(repoRoot, 'artifacts/lirm-rare-gestalt-pressure-ladder-v1/assemble-imagegen-contact-sheet.swift');
    const assembled = spawnSync('swift', [assembler, manifestPath, sheetPath], { encoding: 'utf8' });
    if (assembled.status !== 0) {
      throw new Error(`control sheet assembly failed: ${assembled.stderr || assembled.stdout}`);
    }
    const promptPath = join(artifactRoot, 'prompt.txt');
    const completed = {
      ...initialized,
      status: 'controls-complete-uninspected',
      phase: 'control-sheet-written',
      effectiveRoute: staged.effectiveRoute,
      sourceCandidateId: plan.sourceCandidateId,
      sourceSeed: plan.sourceSeed,
      staged,
      comparator: {
        id: COMPARATOR_ID,
        maps: comparator,
      },
      fixedImagegenRequest: {
        requestedRoute: 'gpu-greenroom/mflux_flux2_edit_promptfile_3ref',
        model: 'flux2-klein-9b',
        quantize: 4,
        width: 512,
        height: 512,
        steps: 8,
        guidance: 1,
        seed: 720401,
        promptPath: relative(artifactRoot, promptPath),
      },
      controlSheet: {
        path: relative(artifactRoot, sheetPath),
        ...(await evidence(sheetPath)),
      },
      falseClosureGuards: {
        controlRenderProvesImageBasin: false,
        friendlyOutputAloneProvesBauplanHypothesis: false,
        hostileComparatorMustUseSameImageRequest: true,
        trellisClaim: 'forbidden_until_still_image_inspection',
      },
      lastTrustworthyEvidence: 'three shared-bauplan descendants and one annular comparator rendered under one camera; imagegen not yet fired',
    };
    await atomicWriteJson(receiptPath, completed);
    return completed;
  } catch (error) {
    await atomicWriteJson(receiptPath, {
      ...initialized,
      status: 'failed',
      phase: 'failed',
      errorMessage: error.message,
      lastTrustworthyEvidence: 'invocation recorded; one or more control outputs untrusted',
    });
    throw error;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--loop-one')) {
    await writeLirmBauplanMassAuthorityLoopOneControls();
  } else {
    await writeLirmBauplanStagedElaborationControls();
  }
}
