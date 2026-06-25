import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const root = new URL('..', import.meta.url).pathname;
const matrixPath = join(root, 'orb-inner-engine-prompt-matrix.mjs');

assert.ok(existsSync(matrixPath), 'orb-inner-engine-prompt-matrix.mjs must define the Ideogram prompt/safety matrix harness');

const source = readFileSync(matrixPath, 'utf8');
assert.match(source, /orb-inner-engine-prompt-matrix-v0/, 'prompt matrix names a stable identity');
assert.match(source, /createOrbInnerEnginePromptMatrix/, 'prompt matrix exports deterministic matrix construction');
assert.match(source, /writeOrbInnerEnginePromptMatrixBundle/, 'prompt matrix exports caller-rooted bundle writing');
assert.match(source, /createGeminiReviewPacket/, 'prompt matrix exports a VLM/Gemini review packet');
assert.match(source, /provider-blocked-output/, 'prompt matrix preserves blocked-output as a first-class result');
assert.match(source, /reactor-insert/, 'prompt matrix includes a reactor-insert prompt family');
assert.match(source, /mechanical-iris/, 'prompt matrix includes a mechanical-iris prompt family');
assert.match(source, /turbine-stator/, 'prompt matrix includes a turbine-stator prompt family');
assert.match(source, /furnace-core/, 'prompt matrix includes a furnace-core prompt family');
assert.match(source, /decompositionLayer/, 'prompt matrix preserves decomposed generation layer metadata');
assert.match(source, /mechanical-substrate/, 'prompt matrix includes a cold mechanical substrate slice');
assert.match(source, /bounded-energy/, 'prompt matrix includes a separate bounded energy slice');
assert.doesNotMatch(source, /\/tmp\/kaminos-orb-inner-engine-prompt-matrix/, 'prompt matrix must not hardcode its output root');

const {
  ORB_INNER_ENGINE_PROMPT_MATRIX_IDENTITY,
  createOrbInnerEnginePromptMatrix,
  createGeminiReviewPacket,
  writeOrbInnerEnginePromptMatrixBundle,
} = await import(`${matrixPath}?contract=${Date.now()}`);

assert.equal(ORB_INNER_ENGINE_PROMPT_MATRIX_IDENTITY, 'orb-inner-engine-prompt-matrix-v0');

const matrix = createOrbInnerEnginePromptMatrix({
  coreSeed: 'molten-heartfucker-core-contract',
  matrixSeed: 'ideogram-contract',
  providerId: 'local-image.ideogram4',
});

assert.equal(matrix.identity, 'orb-inner-engine-prompt-matrix-v0');
assert.equal(matrix.coreSeed, 'molten-heartfucker-core-contract');
assert.equal(matrix.matrixSeed, 'ideogram-contract');
assert.equal(matrix.providerId, 'local-image.ideogram4');
assert.ok(matrix.strategy.promptVsDistributionRule.includes('adjacent prompt families'), 'matrix encodes prompt-vs-distribution decision rule');
assert.ok(matrix.strategy.ideogramNotes.some(note => note.includes('negative phrasing')), 'matrix records Ideogram negative-phrasing guidance');
assert.ok(matrix.strategy.ideogramNotes.some(note => note.includes('json_prompt')), 'matrix records Ideogram V4 text/json prompt route distinction');
assert.equal(matrix.strategy.decompositionPlan.status, 'active');
assert.deepEqual(matrix.strategy.decompositionPlan.layers, ['mechanical-substrate', 'bounded-energy', 'composite-reference']);
assert.ok(matrix.strategy.decompositionPlan.hypothesis.includes('composite'), 'matrix names the compositing hypothesis');
assert.ok(matrix.priorObservations.some(observation => observation.status === 'provider-blocked-output'), 'matrix preserves blocked Ideogram card observation');
assert.ok(matrix.priorObservations.some(observation => observation.status === 'complete-but-weak'), 'matrix preserves sanitized weak-output observation');
assert.ok(matrix.safetyAxes.some(axis => axis.triggerCandidate === 'evil'), 'matrix includes evil-token safety probe');
assert.ok(matrix.safetyAxes.some(axis => axis.triggerCandidate === 'white-hot'), 'matrix includes white-hot-token safety probe');
assert.ok(matrix.safetyAxes.some(axis => axis.triggerCandidate === 'safety-filter-card'), 'matrix includes negative-prompt safety-card probe');

const families = new Set(matrix.items.map(item => item.promptFamily));
assert.ok(families.has('reactor-insert'));
assert.ok(families.has('mechanical-iris'));
assert.ok(families.has('turbine-stator'));
assert.ok(families.has('furnace-core'));
assert.ok(families.has('arcane-jewel'));
assert.ok(families.has('aperture-contained-machine'));
assert.ok(families.has('black-ceramic-clockwork-insert'));
assert.ok(families.has('segmented-energy-inlay'));
assert.ok(families.has('mechanical-energy-composite-reference'));
assert.ok(matrix.items.length >= families.size * 3, 'matrix crosses each family with clean and safety-ablation variants');

const cleanItems = matrix.items.filter(item => item.batchLane === 'quality-baseline');
const safetyItems = matrix.items.filter(item => item.batchLane === 'safety-ablation');
assert.ok(cleanItems.length >= families.size, 'each family has at least one clean quality baseline item');
assert.ok(safetyItems.length >= 6, 'matrix includes enough safety-ablation items to map the filter');

const decomposedItems = matrix.items.filter(item => item.batchLane === 'decomposed-quality');
assert.ok(decomposedItems.length >= 6, 'matrix includes a small decomposed quality slice');
assert.ok(decomposedItems.some(item => item.decompositionLayer === 'mechanical-substrate'), 'decomposed slice has cold mechanical substrate items');
assert.ok(decomposedItems.some(item => item.decompositionLayer === 'bounded-energy'), 'decomposed slice has separate bounded energy items');
assert.ok(decomposedItems.some(item => item.decompositionLayer === 'composite-reference'), 'decomposed slice keeps a small composite reference control');
assert.ok(decomposedItems.every(item => item.compositionRole), 'decomposed items name composition role');
assert.ok(decomposedItems.every(item => item.executionPolicy.isolateFromQualityRun), 'decomposed slice is isolated from legacy quality batches');
assert.ok(decomposedItems.every(item => item.executionPolicy.greenroomRequired), 'decomposed live runs require greenroom custody');
assert.ok(decomposedItems.every(item => item.downstreamRoutes.includes('shader.composite')), 'decomposed outputs can feed shader/composite experiments');

const mechanicalDecomposed = decomposedItems.filter(item => item.decompositionLayer === 'mechanical-substrate');
assert.ok(mechanicalDecomposed.length >= 2);
for (const item of mechanicalDecomposed) {
  assert.doesNotMatch(item.positive, /\bengine\b|\bfurnace\b|\bturbine\b|\bflame\b|\bfire\b|\bmolten\b|\borb\b/i, 'mechanical substrate prompts avoid overloaded engine/fire/orb vocabulary');
  assert.ok(item.qualityHypothesis.mustRead.includes('hard occluder geometry'));
  assert.ok(item.qualityHypothesis.rejectRead.includes('clean camera lens'));
}

const energyDecomposed = decomposedItems.filter(item => item.decompositionLayer === 'bounded-energy');
assert.ok(energyDecomposed.length >= 2);
for (const item of energyDecomposed) {
  assert.match(item.positive, /red-orange|emissive|channel|inlay/i, 'energy prompts ask for bounded red-orange emissive channel material');
  assert.ok(item.qualityHypothesis.mustRead.includes('bounded emissive channels'));
  assert.ok(item.qualityHypothesis.rejectRead.includes('full fireball'));
}

for (const item of matrix.items) {
  assert.match(item.id, /^orb-inner-engine-prompt-[0-9]{2}$/);
  assert.equal(item.providerId, 'local-image.ideogram4');
  assert.equal(item.status, 'queued');
  assert.equal(item.seed, createOrbInnerEnginePromptMatrix({
    coreSeed: 'molten-heartfucker-core-contract',
    matrixSeed: 'ideogram-contract',
    providerId: 'local-image.ideogram4',
  }).items.find(other => other.id === item.id).seed, 'matrix seeds are deterministic');
  assert.ok(item.positive.length > 80, 'positive prompt is concrete enough to be useful');
  assert.ok(item.positive.length < 900, 'positive prompt stays under Ideogram prompt-length guidance');
  if (item.decompositionLayer !== 'bounded-energy') {
    assert.ok(item.qualityHypothesis.mustRead.includes('radial ribs'));
    assert.ok(item.qualityHypothesis.mustRead.includes('nested rings'));
  }
  assert.ok(item.qualityHypothesis.rejectRead.includes('flat orange disk'));
  assert.ok(item.qualityHypothesis.rejectRead.includes('clean camera lens'));
  assert.ok(Array.isArray(item.safetyHypothesis.triggerTokens));
  assert.ok(item.safetyHypothesis.expectedOutcome, 'each item names expected safety outcome');
  if (item.batchLane === 'quality-baseline') {
    assert.equal(item.safetyHypothesis.expectedOutcome, 'should-complete');
    assert.doesNotMatch(item.positive, /\bevil\b|white-hot|safety filter|blocked card/i, 'quality baselines avoid known risky terms');
    assert.equal(item.negative, '', 'quality baselines use affirmative prompting instead of negative-prompt traps');
  }
  if (item.batchLane === 'safety-ablation') {
    assert.ok(item.safetyHypothesis.triggerTokens.length > 0, 'safety probes name their trigger tokens');
    assert.ok(item.executionPolicy.isolateFromQualityRun, 'safety probes must not silently mix into the quality run');
  }
}

const reviewPacket = createGeminiReviewPacket(matrix);
assert.equal(reviewPacket.identity, 'orb-inner-engine-gemini-review-packet-v0');
assert.equal(reviewPacket.parentIdentity, 'orb-inner-engine-prompt-matrix-v0');
assert.ok(reviewPacket.rubric.rejectIf.includes('safety filter card'));
assert.ok(reviewPacket.rubric.rejectIf.includes('flat orange disk'));
assert.ok(reviewPacket.rubric.scoreFields.includes('radial rib structure'));
assert.ok(reviewPacket.rubric.scoreFields.includes('aperture-contained emission'));
assert.ok(reviewPacket.rubric.scoreFields.includes('decomposed layer usability'));
assert.equal(reviewPacket.items.length, matrix.items.length);
assert.ok(reviewPacket.items.every(item => item.expectedImagePath.endsWith('.png')));
assert.ok(reviewPacket.items.some(item => item.decompositionLayer === 'mechanical-substrate'));
assert.ok(reviewPacket.items.some(item => item.decompositionLayer === 'bounded-energy'));

const outDir = mkdtempSync(join(tmpdir(), 'kaminos-orb-inner-engine-prompt-matrix-'));
try {
  const result = writeOrbInnerEnginePromptMatrixBundle({
    outDir,
    coreSeed: 'molten-heartfucker-core-contract',
    matrixSeed: 'ideogram-contract',
    providerId: 'local-image.ideogram4',
  });
  assert.equal(result.ok, true);
  assert.ok(result.bundleRoot.startsWith(outDir), 'bundle writer must use caller-provided output root');
  assert.ok(existsSync(result.matrixPath), 'bundle writer emits prompt-matrix.json');
  assert.ok(existsSync(result.promptQueuePath), 'bundle writer emits prompt-queue.json');
  assert.ok(existsSync(result.geminiReviewPacketPath), 'bundle writer emits gemini-review-packet.json');
  assert.ok(existsSync(result.receiptPath), 'bundle writer emits receipt.json');

  const writtenMatrix = JSON.parse(readFileSync(result.matrixPath, 'utf8'));
  const promptQueue = JSON.parse(readFileSync(result.promptQueuePath, 'utf8'));
  const geminiPacket = JSON.parse(readFileSync(result.geminiReviewPacketPath, 'utf8'));
  const receipt = JSON.parse(readFileSync(result.receiptPath, 'utf8'));
  assert.equal(writtenMatrix.identity, 'orb-inner-engine-prompt-matrix-v0');
  assert.equal(promptQueue.identity, 'orb-inner-engine-prompt-matrix-queue-v0');
  assert.equal(promptQueue.items.length, writtenMatrix.items.length);
  assert.ok(promptQueue.items.every(item => item.generatorRoute === 'local-image.ideogram4'));
  assert.ok(promptQueue.items.every(item => item.status === 'queued'));
  assert.ok(promptQueue.items.some(item => item.batchLane === 'safety-ablation'));
  assert.ok(promptQueue.items.some(item => item.decompositionLayer === 'mechanical-substrate'));
  assert.ok(promptQueue.items.some(item => item.decompositionLayer === 'bounded-energy'));
  assert.ok(promptQueue.items.every(item => item.compositionRole !== undefined));
  assert.equal(geminiPacket.items.length, writtenMatrix.items.length);
  assert.ok(geminiPacket.items.some(item => item.decompositionLayer === 'composite-reference'));
  assert.equal(receipt.honesty.liveGeneratorsInvoked, false);
  assert.equal(receipt.honesty.status, 'matrix-only-no-live-generation');
  assert.equal(receipt.decomposedQualityCount, writtenMatrix.items.filter(item => item.batchLane === 'decomposed-quality').length);

  execFileSync('node', [
    matrixPath,
    '--out-dir', outDir,
    '--core-seed', 'molten-heartfucker-core-contract-cli',
    '--matrix-seed', 'ideogram-contract-cli',
    '--provider-id', 'local-image.ideogram4',
  ], { cwd: root, stdio: 'pipe' });

  const cliReceiptPath = join(outDir, 'orb-inner-engine-prompt-matrix-v0', 'receipt.json');
  const cliReceipt = JSON.parse(readFileSync(cliReceiptPath, 'utf8'));
  assert.equal(cliReceipt.ok, true);
  assert.equal(cliReceipt.coreSeed, 'molten-heartfucker-core-contract-cli');
  assert.equal(cliReceipt.matrixSeed, 'ideogram-contract-cli');
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
