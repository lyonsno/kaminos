import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildCranialYieldingRouteHumanWitness,
  writeCranialYieldingRouteHumanWitness,
} from '../orb-shell-cranial-xray-human-witness.mjs';
import {
  createTargetOrbShellCompositionFixture,
} from '../orb-shell-composition-core.js';

const fixture = createTargetOrbShellCompositionFixture({
  variantId: 'wide-cup',
  variationSeed: 6,
  variationLeafCount: 11,
});

const witness = buildCranialYieldingRouteHumanWitness(fixture.proceduralArchitectureInventory);

assert.equal(witness.schema, 'CranialYieldingRouteHumanWitness');
assert.equal(witness.mode, 'operator-legible-cranial-yielding-route-xray-v0');
assert.equal(witness.sourceXrayId, 'cranial-depth-enema-yielding-route-xray');
assert.equal(witness.title, 'Cranial Yielding Route X-Ray');
assert.equal(witness.summary.verdict, 'usable-yielding-substrate-not-geometry-progress');
assert.equal(witness.summary.operatorRead, 'Cranial landed a real cooperative WebGPU phase-program yielding route; Lamellar has not consumed it for shell geometry yet.');
assert.equal(witness.routeIdentity.package, '@kaminos/webgpu-inference-kit');
assert.equal(witness.routeIdentity.packageVersion, '0.1.9');
assert.equal(witness.routeIdentity.sharpRouteId, 'sharp.image-to-splat.webgpu-local.v0');
assert.equal(witness.proves.length >= 4, true);
assert.ok(
  witness.proves.some(line => line.includes('phase-program route identity is visible')),
  'human witness names route identity as proven',
);
assert.ok(
  witness.doesNotProve.some(line => line.includes('Lamellar shell geometry')),
  'human witness refuses to claim Lamellar visual or geometry progress',
);
assert.ok(
  witness.doesNotProve.some(line => line.includes('contended post-SPN')),
  'human witness keeps contention boundary visible',
);
assert.equal(witness.lamellarImpact.currentUse, 'xray-route-identity-before-consumption');
assert.equal(witness.lamellarImpact.geometryImpact, 'diagnostic-substrate-only');
assert.equal(witness.positiveEvidence.gaussianCount, 1179648);
assert.equal(witness.positiveEvidence.schedulerVerificationState, 'verified');
assert.equal(witness.boundaries.contentionPastGaussianPostSpn, 'not-proven');
assert.deepEqual(witness.sourceReceipts, [
  'webgpu-kit-phase-program-019-landed-2026-07-05',
  'cranial-webgpu-kit-phase-program-landing-2026-07-05',
  'cranial-sharp-vit-block-chunking-2026-07-05',
  'cranial-sharp-vit2-positive-smoke-rerun-2026-07-05',
  'cranial-sharp-vit2-contention-failure-2026-07-05',
]);

const outDir = mkdtempSync(join(tmpdir(), 'kaminos-cranial-xray-human-witness-'));
const htmlPath = join(outDir, 'cranial-xray.html');
const jsonPath = join(outDir, 'cranial-xray.json');
const writeResult = writeCranialYieldingRouteHumanWitness({
  inventory: fixture.proceduralArchitectureInventory,
  htmlPath,
  jsonPath,
});

assert.equal(writeResult.htmlPath, htmlPath);
assert.equal(writeResult.jsonPath, jsonPath);
assert.equal(writeResult.witness.summary.verdict, 'usable-yielding-substrate-not-geometry-progress');

const html = readFileSync(htmlPath, 'utf8');
const json = JSON.parse(readFileSync(jsonPath, 'utf8'));

assert.match(html, /<title>Cranial Yielding Route X-Ray<\/title>/);
assert.match(html, /What This Proves/);
assert.match(html, /What This Does Not Prove/);
assert.match(html, /Lamellar Impact/);
assert.match(html, /Phase Program Schema/);
assert.match(html, /Lamellar Geometry Impact/);
assert.match(html, /diagnostic-substrate-only/);
assert.match(html, /contended post-SPN path remains unproven/);
assert.match(html, /sharp\.image-to-splat\.webgpu-local\.v0/);
assert.match(html, /1,179,648/);
assert.doesNotMatch(html, /phaseProgramSchema/);
assert.doesNotMatch(html, /geometry convergence/i);
assert.equal(json.schema, 'CranialYieldingRouteHumanWitness');
assert.equal(json.summary.verdict, 'usable-yielding-substrate-not-geometry-progress');

assert.throws(
  () => buildCranialYieldingRouteHumanWitness({ externalRouteXrays: [] }),
  /Cranial yielding route x-ray missing/,
  'human witness must fail loud instead of rendering a fallback report when the x-ray is missing',
);
assert.throws(
  () => buildCranialYieldingRouteHumanWitness({
    externalRouteXrays: [{
      ...fixture.proceduralArchitectureInventory.externalRouteXrays[0],
      routeIdentity: {},
    }],
  }),
  /missing route identity/,
  'human witness must fail loud instead of rendering a report with partial route identity',
);
