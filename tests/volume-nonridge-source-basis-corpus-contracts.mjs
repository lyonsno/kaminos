import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(new URL('..', import.meta.url).pathname);
const tool = join(root, 'volume-nonridge-source-basis-corpus.py');
const current16 = [
  'sidecar.support', 'sidecar.coverage', 'sidecar.ridge', 'sidecar.footprint',
  'material.density', 'material.heat', 'material.fuel', 'material.detail',
  'fire.energy', 'fire.temperature', 'fire.emission', 'fire.detail',
  'micro.x', 'micro.y', 'micro.z', 'micro.w',
];
const augmented = [
  ...current16,
  'front.topology',
  'velocity.x',
  'velocity.y',
  'velocity.z',
  'support.reaction',
  'support.interface',
  'flow.curlMagnitude',
  'flow.divergence',
];
const targets = [
  'candidate.nonRidgeMembership',
  'nonRidge.emission.r',
  'nonRidge.emission.g',
  'nonRidge.emission.b',
  'nonRidge.extinction',
];
const causalControls = [
  'support.thermal', 'support.reaction', 'support.front', 'support.interface',
  'boundary.gradientGain', 'boundary.cut', 'boundary.softness', 'boundary.coreRejection',
  'topology.gain', 'curl.gain', 'divergence.gain',
  'ridge.gain', 'ridge.cut', 'tip.breakup', 'topology.erosion',
];

function xorshift32(value) {
  let state = value >>> 0;
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  return state >>> 0;
}

function deterministicControlDesign(seed, settingCount) {
  const columns = causalControls.map((_, controlIndex) => {
    const permutation = Array.from({ length: settingCount }, (_, index) => index);
    let state = (seed ^ Math.imul(controlIndex + 1, 0x9e3779b9)) >>> 0;
    if (state === 0) state = 0x6d2b79f5;
    for (let index = settingCount - 1; index > 0; index -= 1) {
      state = xorshift32(state);
      const swapIndex = state % (index + 1);
      [permutation[index], permutation[swapIndex]] = [permutation[swapIndex], permutation[index]];
    }
    return permutation.map(level => level / (settingCount - 1));
  });
  const design = Array.from({ length: settingCount }, (_, settingIndex) => Object.fromEntries(
    causalControls.map((name, controlIndex) => [name, columns[controlIndex][settingIndex]]),
  ));
  [design[2]['boundary.gradientGain'], design[12]['boundary.gradientGain']] = [
    design[12]['boundary.gradientGain'], design[2]['boundary.gradientGain'],
  ];
  return design;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function writeF32(path, values, semanticRole) {
  const floats = Float32Array.from(values);
  const bytes = Buffer.from(floats.buffer, floats.byteOffset, floats.byteLength);
  await writeFile(path, bytes);
  return { path, bytes: bytes.length, sha256: sha256(bytes), dtype: 'float32-le', semanticRole };
}

function runTool(captureManifest, outDir, heldOutSetting = 'setting-p') {
  return spawnSync('python3', [
    tool,
    '--captures-manifest', captureManifest,
    '--out-dir', outDir,
    '--held-out-setting', heldOutSetting,
  ], { cwd: root, encoding: 'utf8' });
}

async function readFailure(outDir) {
  return JSON.parse(await readFile(join(outDir, 'failure-report.json'), 'utf8'));
}

async function assertMissing(path, message) {
  await assert.rejects(access(path), message);
}

const fixtureRoot = await mkdtemp(join(tmpdir(), 'kaminos-nonridge-source-basis-'));
try {
  const artifactsDir = join(fixtureRoot, 'artifacts');
  await mkdir(artifactsDir);
  const rowCount = 4;
  const worldPosition = await writeF32(
    join(artifactsDir, 'frozen-world-position.f32'),
    [0.5, 0.5, 0.5, 1.5, 0.5, 0.5, 0.5, 1.5, 0.5, 1.5, 1.5, 0.5],
    'grid-cell-center-world-position',
  );
  worldPosition.shape = [rowCount, 3];
  const frozenStateBytes = Buffer.from(JSON.stringify({ state: 'fixture', generation: 7, simStepCount: 144 }));
  const frozenStatePath = join(artifactsDir, 'frozen-simulator-state.bin');
  await writeFile(frozenStatePath, frozenStateBytes);
  const frozenStateArtifact = {
    path: frozenStatePath,
    bytes: frozenStateBytes.length,
    sha256: sha256(frozenStateBytes),
    semanticRole: 'frozen-simulator-state',
  };
  const generationHash = sha256(Buffer.from(canonicalJson({
    stateHash: frozenStateArtifact.sha256,
    generation: 7,
  })));
  const simStepHash = sha256(Buffer.from(canonicalJson({ generationHash, simStepCount: 144 })));
  const frozenAuthority = {
    presetId: 'vsp-fixture',
    stateIdentity: 'frozen-filament-rich-state-v0',
    stateHash: frozenStateArtifact.sha256,
    generation: 7,
    generationHash,
    simStepCount: 144,
    simStepHash,
    gridShape: [2, 2, 1],
    gridHash: worldPosition.sha256,
    gridOrigin: [0, 0, 0],
    gridSpacing: [1, 1, 1],
    gridAxisOrder: 'x-fastest-y-then-z-v0',
    cameraIdentity: 'fixed-camera-v0',
    viewportIdentity: '640x640@1-v0',
    smokeState: 'disabled',
    requestedRaySteps: 160,
    effectiveRaySteps: 160,
    adaptiveIdentity: 'adaptive-rays-disabled-v0',
    temporalIdentity: 'temporal-disabled-v0',
    requestedRoute: 'nonridge-source-fixture',
    effectiveRoute: 'nonridge-source-fixture',
    backend: 'WebGPU:fixture',
    rendererIdentity: 'native-3d-compute-fluid-raymarch-v0',
    splatRadius: 0.017,
    splatSharpness: 1.25,
    covarianceIdentity: 'isotropic-fixed-v0',
    depthPolicy: 'front-to-back-v0',
    fallbackReason: null,
  };
  const settings = [];
  const seed = 7162026;
  const generatedControls = deterministicControlDesign(seed, causalControls.length + 2);
  for (let settingIndex = 0; settingIndex < causalControls.length + 2; settingIndex += 1) {
    const settingId = `setting-${String.fromCharCode(97 + settingIndex)}`;
    const effectiveControls = generatedControls[settingIndex];
    const currentValues = Array.from(
      { length: rowCount * current16.length },
      (_, index) => (settingIndex + 1) * 0.01 + index / 10000,
    );
    const sourceCompleteValues = [];
    const sourceBasisValues = Object.fromEntries(augmented.slice(current16.length).map(channel => [channel, []]));
    for (let row = 0; row < rowCount; row += 1) {
      const extraValues = Array.from(
        { length: augmented.length - current16.length },
        (_, channel) => 0.25 + settingIndex / 100 + row / 1000 + channel / 10000,
      );
      sourceCompleteValues.push(
        ...currentValues.slice(row * current16.length, (row + 1) * current16.length),
        ...extraValues,
      );
      for (const [channelIndex, channel] of augmented.slice(current16.length).entries()) {
        sourceBasisValues[channel].push(extraValues[channelIndex]);
      }
    }
    const current = await writeF32(
      join(artifactsDir, `${settingId}-current16.f32`),
      currentValues,
      'candidate-features-current16',
    );
    const sourceComplete = await writeF32(
      join(artifactsDir, `${settingId}-source-complete.f32`),
      sourceCompleteValues,
      'candidate-features-source-complete',
    );
    const sourceBasis = {};
    for (const [channel, values] of Object.entries(sourceBasisValues)) {
      const artifact = await writeF32(
        join(artifactsDir, `${settingId}-${channel.replaceAll('.', '-')}.f32`),
        values,
        `candidate-source-field:${channel}`,
      );
      sourceBasis[channel] = { ...artifact, shape: [rowCount, 1] };
    }
    const isNegative = settingId === 'setting-q';
    const targetValues = Array.from({ length: rowCount }, (_, row) => (
      isNegative || row === 0 ? [0, 0, 0, 0, 0] : [1, 0.3 + row / 100, 0.2, 0.1, 0.4]
    )).flat();
    const target = await writeF32(
      join(artifactsDir, `${settingId}-targets.f32`),
      targetValues,
      'supervision-targets-positive-nonridge',
    );
    settings.push({
      id: settingId,
      requestedControls: { ...effectiveControls },
      effectiveControls,
      negativeControl: isNegative,
      negativeControlPredicate: isNegative ? 'all-targets-zero-v0' : null,
      source: {
        ...frozenAuthority,
        controlsHash: sha256(Buffer.from(canonicalJson(effectiveControls))),
      },
      rows: {
        count: rowCount,
        worldPosition,
        current16: { ...current, shape: [rowCount, current16.length] },
        sourceComplete: { ...sourceComplete, shape: [rowCount, augmented.length] },
        sourceBasis,
        targets: { ...target, shape: [rowCount, targets.length] },
      },
    });
  }

  const captureManifest = {
    schema: 'kaminos.volume.nonridge-source-setting-captures.v0',
    authority: 'integration-positive-nonridge-randomized-source-captures-v0',
    positivePartitionIdentity: 'nonnegative-ridge-owned-plus-non-ridge-complete-flame-v0',
    completeFlameIdentity: 'smoke-off-complete-flame-local-emission-extinction-v0',
    nonRidgeTargetIdentity: 'positive-nonridge-local-emission-extinction-v0',
    cohort: 'full-grid',
    worldPositionIdentity: 'grid-cell-center-world-position-v0',
    frozenAuthority,
    frozenStateArtifact,
    featureViews: {
      current16: {
        order: current16,
        provenance: Object.fromEntries(current16.map(channel => [channel, 'candidate-source-current16'])),
      },
      sourceComplete: {
        sourceBasisIdentity: 'nonridge-minimal-independent-source-basis-v0',
        order: augmented,
        provenance: Object.fromEntries(augmented.map(channel => [
          channel,
          current16.includes(channel) ? 'candidate-source-current16' : 'candidate-source-independent',
        ])),
      },
    },
    targets: { order: targets },
    design: {
      identity: 'deterministic-space-filling-randomized-controls-v0',
      generatorIdentity: 'deterministic-latin-hypercube-boundary-v0',
      seed,
      sampledControls: causalControls,
      controlRanges: Object.fromEntries(causalControls.map(name => [name, [0, 1]])),
      expectedSettingIds: settings.map(setting => setting.id),
      admittedSettingIds: settings.map(setting => setting.id),
      rejectedSettings: [],
      retentionPolicy: 'retain-all-admitted-settings-and-rows-uncapped-v0',
      negativeControlPolicy: 'exactly-one-measured-all-target-zero-control-v0',
      designCorrection: {
        identity: 'single-axis-setting-transposition-v0',
        control: 'boundary.gradientGain',
        settingAIndex: 2,
        settingBIndex: 12,
        settingA: 'setting-c',
        settingB: 'setting-m',
        reason: 'replace-redundant-all-target-zero-setting-m-while-preserving-latin-levels-v0',
      },
      campaignStatus: 'capture-tranche-complete-awaiting-verdict-v0',
    },
    settings,
  };
  const capturePath = join(fixtureRoot, 'captures.json');
  await writeFile(capturePath, JSON.stringify(captureManifest, null, 2));

  const outDir = join(fixtureRoot, 'corpus');
  const result = runTool(capturePath, outDir);
  assert.equal(result.status, 0, `source-basis packer failed:\n${result.stdout}\n${result.stderr}`);
  const corpus = JSON.parse(await readFile(join(outDir, 'corpus-manifest.json'), 'utf8'));
  assert.equal(corpus.schema, 'kaminos.volume.nonridge-source-basis-corpus.v0');
  assert.equal(corpus.status, 'complete');
  assert.equal(corpus.assayStatus, 'capture-tranche-complete-awaiting-verdict-v0');
  assert.equal(corpus.failurePhase, null);
  assert.equal(corpus.cohort.identity, 'full-grid');
  assert.equal(corpus.cohort.totalRows, 68, 'all admitted rows must survive without an implicit cap');
  assert.equal(corpus.cohort.retainedSettingCount, 17, 'blank negative settings must not be silently resampled');
  assert.equal(corpus.cohort.negativeControlSettingCount, 1);
  assert.equal(corpus.cohort.droppedRowCount, 0);
  assert.equal(corpus.design.computed.rank, 16);
  assert.equal(corpus.design.computed.requiredRank, 16);
  assert.ok(Object.values(corpus.design.computed.coverage).every(entry => entry.boundary && entry.interior));
  assert.deepEqual(corpus.featureViews.current16.order, current16);
  assert.deepEqual(corpus.featureViews.sourceComplete.order, augmented);
  assert.deepEqual(corpus.targets.order, targets);
  assert.deepEqual(corpus.ablations.map(entry => entry.channel), augmented.slice(current16.length));
  assert.ok(corpus.settings.every(setting => setting.rows.current16.sha256 && setting.rows.sourceComplete.sha256 && setting.rows.targets.sha256));
  assert.deepEqual(corpus.splits.heldOut.settingIds, ['setting-p']);
  assert.equal(corpus.splits.train.settingIds.length, 16);
  assert.equal(new Set([...corpus.splits.train.settingIds, ...corpus.splits.heldOut.settingIds]).size, 17);
  assert.match(corpus.identity, /^sha256:[a-f0-9]{64}$/);

  const redundantBlackControl = structuredClone(captureManifest);
  const redundantBlackTargets = await writeF32(
    join(artifactsDir, 'redundant-black-control-targets.f32'),
    Array.from({ length: rowCount * targets.length }, () => 0),
    'supervision-targets-positive-nonridge',
  );
  redundantBlackControl.settings[0].negativeControl = true;
  redundantBlackControl.settings[0].negativeControlPredicate = 'all-targets-zero-v0';
  redundantBlackControl.settings[0].rows.targets = {
    ...redundantBlackTargets,
    shape: [rowCount, targets.length],
  };
  const redundantBlackPath = join(fixtureRoot, 'redundant-black-control.json');
  await writeFile(redundantBlackPath, JSON.stringify(redundantBlackControl, null, 2));
  const redundantBlackOut = join(fixtureRoot, 'redundant-black-control-corpus');
  assert.notEqual(
    runTool(redundantBlackPath, redundantBlackOut).status,
    0,
    'the first learner slate must retain exactly one measured all-target-zero control',
  );
  assert.equal((await readFailure(redundantBlackOut)).failurePhase, 'negative-control-policy');

  const allNegativeHoldoutOut = join(fixtureRoot, 'all-negative-holdout-corpus');
  assert.notEqual(
    runTool(capturePath, allNegativeHoldoutOut, 'setting-q').status,
    0,
    'whole-setting holdout must contain positive and negative support plus positive optical evidence',
  );
  assert.equal((await readFailure(allNegativeHoldoutOut)).failurePhase, 'split-validation');

  const duplicateWorldManifest = structuredClone(captureManifest);
  const duplicateWorld = await writeF32(
    join(artifactsDir, 'duplicate-world-position.f32'),
    Array.from({ length: rowCount }, () => [0.5, 0.5, 0.5]).flat(),
    'grid-cell-center-world-position',
  );
  duplicateWorld.shape = [rowCount, 3];
  duplicateWorldManifest.frozenAuthority.gridHash = duplicateWorld.sha256;
  for (const setting of duplicateWorldManifest.settings) {
    setting.source.gridHash = duplicateWorld.sha256;
    setting.rows.worldPosition = duplicateWorld;
  }
  const duplicateWorldPath = join(fixtureRoot, 'duplicate-world-position.json');
  await writeFile(duplicateWorldPath, JSON.stringify(duplicateWorldManifest, null, 2));
  const duplicateWorldOut = join(fixtureRoot, 'duplicate-world-position-corpus');
  assert.notEqual(runTool(duplicateWorldPath, duplicateWorldOut).status, 0, 'full-grid cohort must contain each declared cell center exactly once');
  assert.equal((await readFailure(duplicateWorldOut)).failurePhase, 'spatial-cohort-validation');

  const copiedManifest = structuredClone(captureManifest);
  function makeArtifactPathsRelative(value) {
    if (!value || typeof value !== 'object') return;
    if ('path' in value) value.path = join('artifacts', basename(value.path));
    for (const child of Object.values(value)) makeArtifactPathsRelative(child);
  }
  makeArtifactPathsRelative(copiedManifest.frozenStateArtifact);
  for (const setting of copiedManifest.settings) {
    makeArtifactPathsRelative(setting.rows);
  }
  const copiedCapturePath = join(fixtureRoot, 'same-captures-relative-artifact-paths.json');
  await writeFile(copiedCapturePath, JSON.stringify(copiedManifest, null, 2));
  const copiedOut = join(fixtureRoot, 'copied-corpus');
  const copied = runTool(copiedCapturePath, copiedOut);
  assert.equal(copied.status, 0, copied.stderr);
  const copiedCorpus = JSON.parse(await readFile(join(copiedOut, 'corpus-manifest.json'), 'utf8'));
  assert.equal(copiedCorpus.identity, corpus.identity, 'corpus identity must bind content rather than checkout or manifest path');

  const prefixMismatch = structuredClone(captureManifest);
  const sourceCompleteBytes = await readFile(prefixMismatch.settings[0].rows.sourceComplete.path);
  const mismatchedValues = Array.from(new Float32Array(
    sourceCompleteBytes.buffer,
    sourceCompleteBytes.byteOffset,
    sourceCompleteBytes.byteLength / Float32Array.BYTES_PER_ELEMENT,
  ));
  mismatchedValues[0] += 0.5;
  const mismatchArtifact = await writeF32(
    join(artifactsDir, 'prefix-mismatch.f32'), mismatchedValues, 'candidate-features-source-complete',
  );
  prefixMismatch.settings[0].rows.sourceComplete = { ...mismatchArtifact, shape: [rowCount, augmented.length] };
  const prefixPath = join(fixtureRoot, 'prefix-mismatch.json');
  await writeFile(prefixPath, JSON.stringify(prefixMismatch, null, 2));
  const prefixOut = join(fixtureRoot, 'prefix-mismatch-corpus');
  assert.notEqual(runTool(prefixPath, prefixOut).status, 0, 'feature views with different Current-16 evidence must fail');
  assert.equal((await readFailure(prefixOut)).failurePhase, 'feature-parity-validation');

  const duplicateControls = structuredClone(captureManifest);
  duplicateControls.settings.at(-1).effectiveControls = { ...duplicateControls.settings.at(-2).effectiveControls };
  duplicateControls.settings.at(-1).requestedControls = { ...duplicateControls.settings.at(-2).requestedControls };
  duplicateControls.settings.at(-1).effectiveControls.captureNonce = 2;
  duplicateControls.settings.at(-1).requestedControls.captureNonce = 2;
  duplicateControls.settings.at(-1).source.controlsHash = duplicateControls.settings.at(-2).source.controlsHash;
  duplicateControls.settings.at(-1).source.controlsHash = sha256(Buffer.from(canonicalJson(duplicateControls.settings.at(-1).effectiveControls)));
  const duplicatePath = join(fixtureRoot, 'duplicate-controls.json');
  await writeFile(duplicatePath, JSON.stringify(duplicateControls, null, 2));
  const duplicateOut = join(fixtureRoot, 'duplicate-controls-corpus');
  assert.notEqual(runTool(duplicatePath, duplicateOut).status, 0, 'duplicate effective settings must not cross split roles');
  assert.equal((await readFailure(duplicateOut)).failurePhase, 'split-validation');

  const unfrozen = structuredClone(captureManifest);
  unfrozen.settings[1].source.stateIdentity = 'different-state-that-can-confound-controls';
  const unfrozenPath = join(fixtureRoot, 'unfrozen.json');
  await writeFile(unfrozenPath, JSON.stringify(unfrozen, null, 2));
  const unfrozenOut = join(fixtureRoot, 'unfrozen-corpus');
  assert.notEqual(runTool(unfrozenPath, unfrozenOut).status, 0, 'control sweep must use one frozen source authority');
  assert.equal((await readFailure(unfrozenOut)).failurePhase, 'source-authority-validation');

  const rankDeficient = structuredClone(captureManifest);
  for (const [index, setting] of rankDeficient.settings.entries()) {
    setting.effectiveControls = Object.fromEntries(causalControls.map((name, controlIndex) => [
      name, controlIndex === 0 ? index / rankDeficient.settings.length : 0.5,
    ]));
    setting.requestedControls = { ...setting.effectiveControls };
    setting.source.controlsHash = sha256(Buffer.from(canonicalJson(setting.effectiveControls)));
  }
  const rankPath = join(fixtureRoot, 'rank-deficient.json');
  await writeFile(rankPath, JSON.stringify(rankDeficient, null, 2));
  const rankOut = join(fixtureRoot, 'rank-deficient-corpus');
  assert.notEqual(runTool(rankPath, rankOut).status, 0, 'self-reported randomized design must not substitute for computed rank');
  assert.equal((await readFailure(rankOut)).failurePhase, 'design-validation');

  const generatorMismatch = structuredClone(captureManifest);
  generatorMismatch.settings[0].requestedControls['support.thermal'] += 0.01;
  const generatorPath = join(fixtureRoot, 'generator-mismatch.json');
  await writeFile(generatorPath, JSON.stringify(generatorMismatch, null, 2));
  const generatorOut = join(fixtureRoot, 'generator-mismatch-corpus');
  assert.notEqual(runTool(generatorPath, generatorOut).status, 0, 'setting sequence must replay from the declared seed and generator');
  assert.equal((await readFailure(generatorOut)).failurePhase, 'design-validation');

  const curatedRejection = structuredClone(captureManifest);
  curatedRejection.design.expectedSettingIds.push('setting-r');
  curatedRejection.design.rejectedSettings.push({ id: 'setting-r', reason: 'unattractive' });
  const rejectedPath = join(fixtureRoot, 'curated-rejection.json');
  await writeFile(rejectedPath, JSON.stringify(curatedRejection, null, 2));
  const rejectedOut = join(fixtureRoot, 'curated-rejection-corpus');
  assert.notEqual(runTool(rejectedPath, rejectedOut).status, 0, 'legal randomized samples cannot be beauty-filtered');
  assert.equal((await readFailure(rejectedOut)).failurePhase, 'design-validation');

  const leakyManifest = structuredClone(captureManifest);
  leakyManifest.featureViews.sourceComplete.provenance['front.topology'] = 'renderer-target-derived';
  const leakyPath = join(fixtureRoot, 'leaky-captures.json');
  await writeFile(leakyPath, JSON.stringify(leakyManifest, null, 2));
  const leakyOut = join(fixtureRoot, 'leaky-corpus');
  assert.notEqual(runTool(leakyPath, leakyOut).status, 0, 'renderer target provenance must fail even under an innocent channel name');
  assert.equal((await readFailure(leakyOut)).failurePhase, 'feature-leakage-validation');

  const disguisedRendererTarget = structuredClone(captureManifest);
  disguisedRendererTarget.featureViews.sourceComplete.order[current16.length] = 'renderer.nonRidgeEmission.r';
  delete disguisedRendererTarget.featureViews.sourceComplete.provenance['front.topology'];
  disguisedRendererTarget.featureViews.sourceComplete.provenance['renderer.nonRidgeEmission.r'] = 'candidate-source-independent';
  const disguisedPath = join(fixtureRoot, 'disguised-renderer-target.json');
  await writeFile(disguisedPath, JSON.stringify(disguisedRendererTarget, null, 2));
  const disguisedOut = join(fixtureRoot, 'disguised-renderer-target-corpus');
  assert.notEqual(runTool(disguisedPath, disguisedOut).status, 0, 'source basis must be allowlisted beyond producer provenance labels');
  assert.equal((await readFailure(disguisedOut)).failurePhase, 'feature-leakage-validation');

  const mismatchedBasis = structuredClone(captureManifest);
  const basisValues = Array.from({ length: rowCount }, () => 0.99);
  const mismatchedBasisArtifact = await writeF32(
    join(artifactsDir, 'mismatched-source-basis.f32'),
    basisValues,
    'candidate-source-field:front.topology',
  );
  mismatchedBasis.settings[0].rows.sourceBasis['front.topology'] = {
    ...mismatchedBasisArtifact,
    shape: [rowCount, 1],
  };
  const mismatchedBasisPath = join(fixtureRoot, 'mismatched-source-basis.json');
  await writeFile(mismatchedBasisPath, JSON.stringify(mismatchedBasis, null, 2));
  const mismatchedBasisOut = join(fixtureRoot, 'mismatched-source-basis-corpus');
  assert.notEqual(runTool(mismatchedBasisPath, mismatchedBasisOut).status, 0, 'assembled source-complete columns must bind independent source artifacts');
  assert.equal((await readFailure(mismatchedBasisOut)).failurePhase, 'feature-parity-validation');

  const badHash = structuredClone(captureManifest);
  badHash.settings[0].source.controlsHash = sha256(Buffer.from('fabricated-controls-identity'));
  const badHashPath = join(fixtureRoot, 'bad-controls-hash.json');
  await writeFile(badHashPath, JSON.stringify(badHash, null, 2));
  const badHashOut = join(fixtureRoot, 'bad-controls-hash-corpus');
  assert.notEqual(runTool(badHashPath, badHashOut).status, 0, 'controls checksum must bind effective controls');
  assert.equal((await readFailure(badHashOut)).failurePhase, 'source-authority-validation');

  const staleState = structuredClone(captureManifest);
  staleState.frozenAuthority.stateHash = sha256(Buffer.from('unrelated-stale-state'));
  for (const setting of staleState.settings) setting.source.stateHash = staleState.frozenAuthority.stateHash;
  const staleStatePath = join(fixtureRoot, 'stale-state.json');
  await writeFile(staleStatePath, JSON.stringify(staleState, null, 2));
  const staleStateOut = join(fixtureRoot, 'stale-state-corpus');
  assert.notEqual(runTool(staleStatePath, staleStateOut).status, 0, 'state hash must bind a captured simulator-state artifact');
  assert.equal((await readFailure(staleStateOut)).failurePhase, 'source-authority-validation');

  const invalidTargets = structuredClone(captureManifest);
  const invalidTargetArtifact = await writeF32(
    join(artifactsDir, 'invalid-targets.f32'),
    Array.from({ length: rowCount }, () => [1.5, -1, 0, 0, -0.25]).flat(),
    'supervision-targets-positive-nonridge',
  );
  invalidTargets.settings[0].rows.targets = { ...invalidTargetArtifact, shape: [rowCount, targets.length] };
  const invalidTargetPath = join(fixtureRoot, 'invalid-targets.json');
  await writeFile(invalidTargetPath, JSON.stringify(invalidTargets, null, 2));
  const invalidTargetOut = join(fixtureRoot, 'invalid-targets-corpus');
  assert.notEqual(runTool(invalidTargetPath, invalidTargetOut).status, 0, 'invalid membership and optical targets must fail');
  assert.equal((await readFailure(invalidTargetOut)).failurePhase, 'target-semantics-validation');

  const staleOut = join(fixtureRoot, 'rerun-corpus');
  assert.equal(runTool(capturePath, staleOut).status, 0);
  assert.notEqual(runTool(leakyPath, staleOut).status, 0);
  await assertMissing(join(staleOut, 'corpus-manifest.json'), 'failed rerun must invalidate stale success');
  assert.equal(runTool(capturePath, staleOut).status, 0);
  await assertMissing(join(staleOut, 'failure-report.json'), 'successful rerun must clear stale failure');
} finally {
  await rm(fixtureRoot, { recursive: true, force: true });
}

console.log('nonridge source basis corpus contracts passed');
