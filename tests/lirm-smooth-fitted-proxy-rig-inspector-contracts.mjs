import assert from 'node:assert/strict';
import { access, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const inspectorPath = path.join(root, 'lirm-smooth-fitted-proxy-rig-inspector.html');
const artifactRoot = path.join(root, 'artifacts', 'lirm-719024-smooth-fitted-proxy-rig-assay-v0');
const route = 'kaminos/fitted-proxy-rig/exact-glb-smooth-curve-stress-v0';
const sourceSha256 = 'sha256:8fed20d958ef48797c14ad1d3846a50eae05d43e6ae67f8805060b02f1abde8e';
const registrationSha256 = 'sha256:a63fa02ffa7a144234eef3b9902ac9d349fd413d93a19c87ee1464b0b61ca7f9';

const [inspector, report, visualInspection] = await Promise.all([
  readFile(inspectorPath, 'utf8'),
  readFile(path.join(artifactRoot, 'report.json'), 'utf8').then(JSON.parse),
  readFile(path.join(artifactRoot, 'visual-inspection.json'), 'utf8').then(JSON.parse),
]);

assert.match(inspector, /data-pose="rest"/, 'inspector must expose the exact rest pose');
assert.match(inspector, /data-pose="c"/, 'inspector must expose the smooth C bend');
assert.match(inspector, /data-pose="s"/, 'inspector must expose the smooth S bend');
assert.match(inspector, /data-pose="asym"/, 'inspector must expose the asymmetric bend');
assert.match(inspector, /data-pose="legacy"/, 'inspector must preserve the segmented falsifying control');
assert.match(inspector, /__LIRM_INSPECTOR_STATE__/, 'inspector must expose settled machine-readable state');
assert.match(inspector, /effective route mismatch/, 'inspector must fail loud when the effective route changes');
assert.match(inspector, /source hash mismatch/, 'inspector must fail loud when the exact cast changes');
assert.match(inspector, /registration hash mismatch/, 'inspector must fail loud when the fitted registration changes');
assert.match(inspector, new RegExp(registrationSha256.slice(7)), 'inspector must bind the exact fitted registration');
assert.match(inspector, /5\/5 poses mounted/, 'inspector must expose successful mount state');
assert.match(inspector, /registration/, 'inspector must expose registration identity');

assert.equal(report.requestedRoute, route);
assert.equal(report.effectiveRoute, route);
assert.equal(report.source.sha256, sourceSha256);
assert.equal(report.registration.sha256, registrationSha256);
assert.equal(report.effectiveConfig.parameterization, 'monotonic-axial-z');
assert.equal(report.maxRestError < 1e-12, true, 'rest reconstruction must remain exact');

assert.equal(visualInspection.status, 'agent-inspected-happy-with-bounded-residual');
assert.equal(visualInspection.effectiveRoute, route);
assert.equal(visualInspection.sourceSha256, sourceSha256);
assert.equal(visualInspection.registrationSha256, registrationSha256);
assert.equal(visualInspection.classification.operatorInspection, 'happy');

for (const output of Object.values(report.outputInventory)) {
  const outputPath = path.join(artifactRoot, path.basename(output.path));
  await access(outputPath);
  assert.equal((await stat(outputPath)).size > 8_000_000, true, `${outputPath} must contain the textured cast`);
}

for (const witness of visualInspection.witnesses) {
  const witnessPath = path.join(artifactRoot, witness);
  await access(witnessPath);
  assert.equal((await stat(witnessPath)).size > 100_000, true, `${witness} must be a nonblank settled render`);
}

console.log(JSON.stringify({
  status: 'passed',
  route,
  poses: ['rest', 'c', 's', 'asym', 'legacy'],
  witnessCount: visualInspection.witnesses.length,
}, null, 2));
