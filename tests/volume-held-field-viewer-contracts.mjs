import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const viewer = readFileSync(join(root, 'volume-held-field-viewer.html'), 'utf8');

assert.match(viewer, /kaminos\.volume\.held-field-viewer\.v0/, 'viewer exposes a stable route identity');
assert.match(viewer, /params\.get\('manifest'\)/, 'viewer requires an explicit manifest route');
assert.match(viewer, /manifest-required/, 'missing manifest fails loud instead of loading a default field');
assert.match(viewer, /params\.get\('manifest_sha256'\)/, 'viewer requires the expected manifest digest in the route');
assert.match(viewer, /crypto\.subtle\.digest\('SHA-256'/, 'viewer hashes fetched manifest bytes before trusting paths');
assert.match(viewer, /manifest-sha256-mismatch/, 'stale or substituted manifests fail loud');
assert.match(viewer, /cache:\s*'no-store'/, 'viewer refuses cached manifest and field evidence');
assert.match(viewer, /kaminos\.volume\.operator-basin-replay\.v0/, 'viewer admits only the operator-basin replay schema');
assert.match(viewer, /parsed\.status\s*!==\s*'captured'/, 'viewer rejects non-captured manifests');
assert.match(viewer, /parsed\.failurePhase\s*!==\s*null/, 'viewer rejects manifests carrying a failure phase');
assert.match(viewer, /artifact\.byteLength/, 'viewer binds uploads to declared artifact byte lengths');
assert.match(viewer, /receivedBytes\s*!==\s*Number\(artifact\.byteLength\)/, 'partial field transfer fails before import completion');
assert.match(viewer, /beginDebugFullFieldImport/, 'viewer opens a session-bound full-field import');
assert.match(viewer, /writeDebugFullFieldImportChunk/, 'viewer streams fluid and front chunks into the import session');
assert.match(viewer, /finishDebugFullFieldImport/, 'viewer requires checksum-verified field import completion');
assert.match(viewer, /beginDebugBoundarySidecarOverride/, 'viewer explicitly imports the captured boundary sidecar');
assert.match(viewer, /finishDebugBoundarySidecarOverride/, 'viewer requires checksum-verified boundary completion');
assert.match(viewer, /advanceDebugImportedFieldSteps[\s\S]*steps:\s*0/, 'viewer holds imported state without simulation advance');
assert.match(viewer, /kaminosSetCameraDebugPose/, 'viewer applies the captured camera position and target');
assert.match(viewer, /renderFrozenScaleToCanvas/, 'viewer renders from the held import session');
assert.match(viewer, /compositionEffective\s*!==\s*compositionRequested/, 'viewer rejects silent composition substitution');
assert.match(viewer, /raymarchEncoded[\s\S]*raymarchApplied[\s\S]*splatEncoded[\s\S]*splatApplied/, 'viewer receipt exposes exact pass encoding and application');
assert.match(viewer, /compositionAuthority:\s*null[\s\S]*raymarchFireAuthority:\s*null/, 'viewer state exposes composition and raymarch fire authority independently from pass application');
assert.match(viewer, /state\.compositionAuthority\s*=\s*receipt\.compositionAuthority[\s\S]*state\.raymarchFireAuthority\s*=\s*receipt\.raymarchFireAuthority/, 'viewer records effective authority from the submitted frozen-render receipt');
assert.match(viewer, /window\.__kaminosHeldFieldViewer/, 'viewer exposes an operator-readable requested/effective debug receipt');
assert.match(viewer, /params\.get\('embed'\)/, 'viewer accepts an explicit embedded cockpit mode');
assert.match(viewer, /embedded[\s\S]*receipt-band/, 'embedded mode removes redundant viewer chrome from narrow comparison panels');

console.log('volume held-field viewer contracts: ok');
