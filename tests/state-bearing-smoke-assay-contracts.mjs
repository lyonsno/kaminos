import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const moduleUrl = new URL('../state-bearing-smoke-assay.mjs', import.meta.url);
const assayModule = await import(moduleUrl);

assert.equal(
  typeof assayModule.validateStateBearingSmokeAssay,
  'function',
  'the held-viewer lineage must expose a standalone state-bearing common-source validator',
);

const {
  STATE_BEARING_SMOKE_ASSAY_SCHEMA,
  validateStateBearingSmokeAssay,
  writeStateBearingSmokeAssayReport,
} = assayModule;

const sha = character => character.repeat(64);
const camera = {
  position: [-4.24, 2.14, 8.18],
  target: [0, 0.02, 0],
  matrixWorldInverse: [
    0.88, 0.10, -0.44, 0,
    0, 0.97, 0.22, 0,
    0.45, -0.19, 0.86, 0,
    0, -0.01, -9.46, 1,
  ],
};

function cell(id, representation, overrides = {}) {
  return {
    id,
    status: 'captured',
    sourceIdentity: 'operator-evolved-basin:124ef843',
    camera,
    route: {
      requested: 'native-3d-compute-fluid-raymarch-v0',
      effective: 'native-3d-compute-fluid-raymarch-v0',
      fallbackReason: null,
      backend: 'WebGPU:apple',
    },
    temporal: {
      authority: 'held-current-state-only-v0',
      sourceSteps: [179290],
      historyDepth: 1,
    },
    product: {
      requestedRepresentation: representation,
      effectiveRepresentation: representation,
      fallbackReason: null,
      producerAuthority: `${id}-producer-v0`,
      compilerIdentity: `${id}-compiler-v0`,
      requestedActiveCount: id === 'D' ? 0 : 72000,
      activeCount: id === 'D' ? 0 : 72000,
      capacity: id === 'D' ? 1 : 72000,
      outputWasTruncated: false,
      overflowCount: 0,
      drawAuthority: id === 'D' ? 'raymarch-no-splat-draw-v0' : 'cpu-active-count-direct-v0',
    },
    output: {
      status: 'captured',
      path: `/tmp/${id}.png`,
      sha256: sha(id.toLowerCase()),
      byteLength: 4096,
      pixelStats: {
        pixelCount: 65536,
        nonUniformPixelCount: 12000,
        nonBlackPixelCount: 9000,
      },
    },
    timing: {
      routeLocalMs: { sampleCount: 32, mean: 1.25, p95: 1.8 },
      wholeFrameMs: { sampleCount: 32, mean: 4.5, p95: 5.4 },
    },
    ...overrides,
  };
}

function validAssay() {
  return {
    schema: 'kaminos.state-bearing-smoke-assay.v0',
    status: 'captured',
    identity: 'held-operator-basin-a-b-d-v0',
    source: {
      identity: 'operator-evolved-basin:124ef843',
      authority: 'checksum-bound-held-evolved-field-v0',
      captureManifest: {
        path: '/tmp/operator-basin.manifest.json',
        sha256: sha('a'),
      },
      importManifest: {
        path: '/tmp/operator-basin.import.json',
        sha256: sha('b'),
        captureManifestSha256: sha('a'),
      },
      simulation: {
        grid: 160,
        simStep: 179290,
        fieldCoverage: 'complete',
      },
      artifacts: [
        { kind: 'fluid', path: '/tmp/fluid.f32', sha256: sha('c'), byteLength: 262144000 },
        { kind: 'front', path: '/tmp/front.f32', sha256: sha('d'), byteLength: 16384000 },
      ],
      camera,
    },
    requiredCells: ['A', 'B', 'C', 'D'],
    cells: [
      cell('A', 'analytical-adaptive-smoke-v0'),
      cell('B', 'bounded-learned-smoke-product-v0'),
      cell('C', 'neural-history-smoke-decoder-v0'),
      cell('D', 'raymarched-smoke-control-v0'),
    ],
  };
}

assert.equal(STATE_BEARING_SMOKE_ASSAY_SCHEMA, 'kaminos.state-bearing-smoke-assay.v0');
assert.equal(validateStateBearingSmokeAssay(validAssay()).status, 'captured');

const controlOnly = validAssay();
controlOnly.source.artifacts = [];
assert.throws(
  () => validateStateBearingSmokeAssay(controlOnly),
  /complete evolved field.*fluid.*front/i,
  'controls without checksum-bound field artifacts cannot impersonate source-state replay',
);

const sourceSubstitution = validAssay();
sourceSubstitution.source.importManifest.captureManifestSha256 = sha('e');
assert.throws(
  () => validateStateBearingSmokeAssay(sourceSubstitution),
  /capture manifest sha256/i,
  'the import receipt must bind the exact capture manifest',
);

const fallback = validAssay();
fallback.cells[0].route.effective = 'fallback-canvas-smoke-v0';
assert.throws(
  () => validateStateBearingSmokeAssay(fallback),
  /requested.*effective route/i,
  'a fallback route cannot enter the common-source comparison table',
);

const staleCell = validAssay();
staleCell.cells[1].temporal.sourceSteps = [179289];
assert.throws(
  () => validateStateBearingSmokeAssay(staleCell),
  /source step.*179290/i,
  'a stale product cannot inherit the current evolved-field identity',
);

const missingHistory = validAssay();
missingHistory.cells[1].temporal = {
  authority: 'phase-offset-history-v0',
  sourceSteps: [179290],
  historyDepth: 1,
};
assert.throws(
  () => validateStateBearingSmokeAssay(missingHistory),
  /phase-offset.*consecutive history/i,
  'current state cannot impersonate phase-offset history',
);

const capped = validAssay();
capped.cells[0].product.requestedActiveCount = 188013;
assert.throws(
  () => validateStateBearingSmokeAssay(capped),
  /requested active count.*active count/i,
  'a hidden product cap cannot present as a complete smoke product',
);

const blank = validAssay();
blank.cells[2].output.pixelStats.nonUniformPixelCount = 0;
blank.cells[2].output.pixelStats.nonBlackPixelCount = 0;
assert.throws(
  () => validateStateBearingSmokeAssay(blank),
  /blank or uniform output/i,
  'a route-correct blank capture is not visual evidence',
);

const partial = validAssay();
partial.cells = partial.cells.filter(entry => entry.id !== 'B');
assert.throws(
  () => validateStateBearingSmokeAssay(partial),
  /required cell B/i,
  'a partial A/B/D table must remain visibly incomplete',
);

const narrowedMatrix = validAssay();
narrowedMatrix.requiredCells = ['A', 'D'];
narrowedMatrix.cells = narrowedMatrix.cells.filter(entry => entry.id !== 'B');
assert.throws(
  () => validateStateBearingSmokeAssay(narrowedMatrix),
  /canonical A\/B\/C\/D|required cell B/i,
  'the producer cannot redefine the canonical comparison matrix around a missing B cell',
);

const abdOnly = validAssay();
abdOnly.requiredCells = ['A', 'B', 'D'];
abdOnly.cells = abdOnly.cells.filter(entry => entry.id !== 'C');
assert.throws(
  () => validateStateBearingSmokeAssay(abdOnly),
  /canonical A\/B\/C\/D|required cell C/i,
  'route C cannot disappear from the source-authorized comparison table',
);

const openC = validAssay();
openC.status = 'incomplete';
openC.cells[2] = {
  id: 'C',
  status: 'open',
  sourceIdentity: openC.source.identity,
  blocker: {
    class: 'abi',
    detail: 'oracle Gaussian product has no production smoke GPU product adapter yet',
  },
};
assert.equal(
  validateStateBearingSmokeAssay(openC).status,
  'incomplete',
  'the first table may preserve C as an exact open cell without rejecting the completed routes',
);

const missingCBlocker = structuredClone(openC);
missingCBlocker.cells[2].blocker.detail = '';
assert.throws(
  () => validateStateBearingSmokeAssay(missingCBlocker),
  /open cell C.*blocker|blocker detail/i,
  'an open C cell must name its exact blocker rather than acting as a decorative placeholder',
);

const openCClaimedComplete = structuredClone(openC);
openCClaimedComplete.status = 'captured';
assert.throws(
  () => validateStateBearingSmokeAssay(openCClaimedComplete),
  /captured.*open|incomplete/i,
  'an open route keeps the top-level assay explicitly incomplete',
);

const representationFallback = validAssay();
representationFallback.cells[1].product.fallbackReason = 'representation downgraded';
assert.throws(
  () => validateStateBearingSmokeAssay(representationFallback),
  /product.*fallback|representation.*fallback/i,
  'null route fallback cannot launder a product-level representation downgrade',
);

for (const malformed of [null, false, '0']) {
  const coercedNumeric = validAssay();
  coercedNumeric.cells[2].product.activeCount = malformed;
  coercedNumeric.cells[2].product.requestedActiveCount = malformed;
  coercedNumeric.cells[2].product.overflowCount = malformed;
  coercedNumeric.cells[2].timing.routeLocalMs.mean = malformed;
  assert.throws(
    () => validateStateBearingSmokeAssay(coercedNumeric),
    /must be (?:a )?(?:finite|nonnegative).*number|numeric evidence/i,
    `coercible ${JSON.stringify(malformed)} values cannot enter exact numeric evidence`,
  );
}

const outDir = await mkdtemp(join(tmpdir(), 'kaminos-state-bearing-assay-'));
const reportPath = join(outDir, 'report.json');
const invalid = validAssay();
invalid.cells[0].route.fallbackReason = 'requested product unavailable';
await assert.rejects(
  writeStateBearingSmokeAssayReport(invalid, reportPath),
  /fallback/i,
  'invalid evidence must reject the caller even after preserving a failure report',
);
const failedReport = JSON.parse(await readFile(reportPath, 'utf8'));
assert.equal(failedReport.status, 'failed');
assert.equal(failedReport.failurePhase, 'validation');
assert.equal(failedReport.lastTrustworthyEvidence.sourceIdentity, invalid.source.identity);
assert.equal(failedReport.lastTrustworthyEvidence.receivedCellIds.length, 4);
assert.equal(
  Array.isArray(failedReport.lastTrustworthyEvidence.cells),
  true,
  'failed reports preserve compact per-cell last-trustworthy evidence',
);
assert.equal(failedReport.lastTrustworthyEvidence.cells.length, 4);
assert.deepEqual(failedReport.lastTrustworthyEvidence.cells[0].route, invalid.cells[0].route);
assert.equal(
  failedReport.lastTrustworthyEvidence.cells[0].representation.requested,
  invalid.cells[0].product.requestedRepresentation,
);
assert.equal(
  failedReport.lastTrustworthyEvidence.cells[0].representation.effective,
  invalid.cells[0].product.effectiveRepresentation,
);
assert.equal(failedReport.lastTrustworthyEvidence.cells[0].representation.fallbackReason, null);
assert.equal(
  failedReport.lastTrustworthyEvidence.cells[0].representation.compilerIdentity,
  invalid.cells[0].product.compilerIdentity,
);
assert.deepEqual(failedReport.lastTrustworthyEvidence.cells[0].counts, {
  requestedActiveCount: invalid.cells[0].product.requestedActiveCount,
  activeCount: invalid.cells[0].product.activeCount,
  capacity: invalid.cells[0].product.capacity,
  overflowCount: invalid.cells[0].product.overflowCount,
  outputWasTruncated: invalid.cells[0].product.outputWasTruncated,
});
assert.equal(failedReport.lastTrustworthyEvidence.cells[0].output.sha256, invalid.cells[0].output.sha256);
assert.equal(failedReport.lastTrustworthyEvidence.cells[0].timing.routeLocalPresent, true);
assert.equal(failedReport.lastTrustworthyEvidence.cells[0].timing.wholeFramePresent, true);
assert.match(failedReport.error.message, /fallback/i);
await rm(outDir, { recursive: true, force: true });

console.log('state-bearing smoke assay contracts passed');
