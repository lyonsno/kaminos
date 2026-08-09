#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  castRegistrationReceiptIdentity,
  parseGlbGeometry,
  validateCastRegistrationReceipt,
} from '../cast-registration-core.mjs';
import { parseGlbNodeGeometries, applyChain } from '../bone-containment-probe-core.mjs';
import {
  frameLinkReceiptIdentity,
  validateFrameLinkReceipt,
} from '../frame-link-core.mjs';
import {
  assertProxyRigArtifactHash,
  assertM31AuthoredSupportProximity,
  bindCastToEnvelope,
  bindEnvelopeToSkeleton,
  createM31LiveOverlay,
  createProxyRigPackage,
  validateM31SourceRegistration,
} from '../proxy-rig-core.mjs';
import {
  assertM31CompactFixtureMatchesHistorical,
  M31_HISTORICAL_SOURCE_REF,
} from '../m31-live-source-fixture-core.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultOutput = 'artifacts/cast-correspondence-v0/rig-packages/cast-sf3d-skin-baseline.proxy-rig.json';

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const outputPath = resolve(repoRoot, option('--output', defaultOutput));
const artifactRoot = resolve(repoRoot, option('--artifact-root', 'artifacts/cast-correspondence-v0'));
const loadBytes = relative => readFile(resolve(artifactRoot, relative));
const loadJson = async relative => JSON.parse(await readFile(resolve(artifactRoot, relative), 'utf8'));

const [skeletonBytes, manifestBytes, frameLink, registration, envelopeBytes, castBytes, m31SourceFixture, m31SourceRegistration] = await Promise.all([
  loadBytes('frozen/skeleton-authored.glb'),
  loadBytes('frozen/region-manifest-golden-provisional.json'),
  loadJson('receipts/frame-link--skeleton--envelope-baseline.json'),
  loadJson('receipts/envelope-baseline--cast-sf3d-skin-baseline.json'),
  loadBytes('frozen/envelope-baseline.glb'),
  loadBytes('frozen/cast-sf3d-skin-baseline.glb'),
  loadJson('frozen/m31-authenticated-source.compact.json'),
  loadJson('receipts/m31-source-blend--skeleton-authored.json'),
]);
const manifest = JSON.parse(manifestBytes.toString('utf8'));
const m31HistoricalSourceBytes = execFileSync(
  'git', ['show', M31_HISTORICAL_SOURCE_REF], { cwd: repoRoot },
);
assertM31CompactFixtureMatchesHistorical(m31SourceFixture, m31HistoricalSourceBytes);

validateFrameLinkReceipt(frameLink);
const frameLinkReceiptSha256 = frameLinkReceiptIdentity(frameLink);
if (frameLinkReceiptSha256 !== frameLink.receiptSha256) {
  throw new Error(`Proxy rig frame-link receipt identity mismatch: ${frameLinkReceiptSha256} != ${frameLink.receiptSha256}`);
}
validateCastRegistrationReceipt(registration);
const registrationReceiptSha256 = castRegistrationReceiptIdentity(registration);
if (registrationReceiptSha256 !== registration.receiptSha256) {
  throw new Error(`Proxy rig registration receipt identity mismatch: ${registrationReceiptSha256} != ${registration.receiptSha256}`);
}

const skeletonSha256 = assertProxyRigArtifactHash(skeletonBytes, frameLink.inputs.sourceSha256, 'skeleton');
validateM31SourceRegistration(m31SourceRegistration, {
  sourceFixture: m31SourceFixture,
  skeletonSha256,
});
if (manifest.source_glb_sha256 !== skeletonSha256) {
  throw new Error(`Proxy rig manifest skeleton identity mismatch: ${manifest.source_glb_sha256} != ${skeletonSha256}`);
}
const manifestSha256 = createHash('sha256').update(manifestBytes).digest('hex');
const envelopeSha256 = assertProxyRigArtifactHash(envelopeBytes, registration.inputs.sourceSha256, 'envelope');
assertProxyRigArtifactHash(envelopeBytes, frameLink.inputs.envelopeSha256, 'envelope frame-link');
const castSha256 = assertProxyRigArtifactHash(castBytes, registration.inputs.targetSha256, 'cast');

const bones = parseGlbNodeGeometries(skeletonBytes);
const envelope = parseGlbGeometry(envelopeBytes);
const cast = parseGlbGeometry(castBytes);
const stageATransform = registration.registration.transform;
const envelopeInCastFrame = {
  positions: new Float64Array(envelope.positions.length),
  triangles: envelope.triangles,
};
for (let i = 0; i < envelope.positions.length; i += 3) {
  const point = applyChain(
    [envelope.positions[i], envelope.positions[i + 1], envelope.positions[i + 2]],
    [stageATransform],
  );
  envelopeInCastFrame.positions.set(point, i);
}

const chainTransforms = [{ scale: 1, ...frameLink.link.transform }, stageATransform];
const m31Overlay = createM31LiveOverlay({
  sourceFixture: m31SourceFixture,
  sourceRegistration: m31SourceRegistration,
  chainTransforms,
});
const m31MovingSupport = bones.find(bone => (
  bone.name === m31Overlay.muscle.supportMapping.movingSource
));
const m31AuthoredSupportProximity = assertM31AuthoredSupportProximity({
  pivot: m31Overlay.supportRefinement.pivot,
  supportBone: m31MovingSupport,
  chainTransforms: [],
});
const skinBinding = bindEnvelopeToSkeleton({
  envelope: envelopeInCastFrame,
  bones,
  manifest,
  chainTransforms,
  supportRefinements: [m31Overlay.supportRefinement],
});
const castBinding = bindCastToEnvelope({ cast, envelopeInCastFrame });
const packageData = createProxyRigPackage({
  envelopeInCastFrame,
  cast,
  skinBinding,
  castBinding,
  muscles: [m31Overlay.muscle],
  source: {
    cast: 'artifacts/cast-correspondence-v0/frozen/cast-sf3d-skin-baseline.glb',
    castSha256,
    envelope: 'artifacts/cast-correspondence-v0/frozen/envelope-baseline.glb',
    envelopeSha256,
    skeleton: 'artifacts/cast-correspondence-v0/frozen/skeleton-authored.glb',
    skeletonSha256,
    manifest: 'artifacts/cast-correspondence-v0/frozen/region-manifest-golden-provisional.json',
    manifestSha256,
    frameLinkReceipt: 'artifacts/cast-correspondence-v0/receipts/frame-link--skeleton--envelope-baseline.json',
    frameLinkReceiptSha256,
    registrationReceipt: 'artifacts/cast-correspondence-v0/receipts/envelope-baseline--cast-sf3d-skin-baseline.json',
    registrationReceiptSha256,
    m31SourceRegistrationReceipt: 'artifacts/cast-correspondence-v0/receipts/m31-source-blend--skeleton-authored.json',
    m31SourceRegistrationReceiptSha256: m31SourceRegistration.receiptSha256,
    m31AuthoredSupportProximity,
    effectiveRoute: 'proxy-rig-core.mjs manifest-backed hierarchy + authenticated M31 two-support overlay + bindEnvelopeToSkeleton + bindCastToEnvelope',
    hierarchyDerivation: 'hindlimb-right proximodistal chain plus M31 Cube.002 -> Cube.003 left-hindlimb support split',
  },
});

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(packageData)}\n`);
process.stdout.write(`${JSON.stringify({
  status: 'written',
  outputPath,
  schema: packageData.schema,
  runtimeSchema: packageData.runtimeSchema,
  packageId: packageData.packageId,
  controls: packageData.skinBinding.groups.map(group => group.name),
  envelopeVertices: packageData.envelope.positions.length / 3,
  castVertices: packageData.cast.positions.length / 3,
  muscles: packageData.muscles.map(muscle => muscle.relationId),
})}\n`);
