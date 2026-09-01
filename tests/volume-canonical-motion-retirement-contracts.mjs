#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as volumeCore from '../volume-core.js';

const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const cockpit = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const witness = readFileSync(new URL('../volume-witness.mjs', import.meta.url), 'utf8');

assert.equal(
  volumeCore.CANONICAL_ANALYTIC_MOTION_RETIREMENT_IDENTITY,
  'retired-analytic-canonical-motion-v0',
  'the removed Canonical analytic motion clock has one stable retirement identity',
);
assert.equal(
  typeof volumeCore.canonicalMotionCompatibilityReceipt,
  'function',
  'legacy animated/frozen requests resolve through an explicit compatibility receipt',
);
assert.equal(
  typeof volumeCore.canonicalSourceControlSignature,
  'function',
  'Canonical source reset authority is independently testable',
);

for (const requested of ['animated', 'frozen', 'garbage']) {
  const receipt = volumeCore.canonicalMotionCompatibilityReceipt(requested);
  assert.equal(receipt.identity, 'retired-analytic-canonical-motion-v0');
  assert.equal(receipt.effective, 'retired');
  assert.equal(receipt.uniformValue, 0);
  assert.equal(receipt.requested, requested === 'frozen' ? 'frozen' : 'animated');
}

const signatureControls = {
  volumeScene: 'canonical_plume',
  inputRadius: 0.08,
  flowRate: 1.9,
  canonicalSourceMode: 'buoyant_bottom',
  canonicalContentMode: 'smoke',
  canonicalSourceY: -0.82,
  canonicalSourceInjection: 0,
  canonicalBuoyancy: 1,
};
assert.equal(
  volumeCore.canonicalSourceControlSignature({ ...signatureControls, canonicalMotionMode: 'animated' }),
  volumeCore.canonicalSourceControlSignature({ ...signatureControls, canonicalMotionMode: 'frozen' }),
  'legacy Canonical motion requests cannot reset transported fluid state',
);

assert.doesNotMatch(
  core.match(/export function canonicalSourceControlSignature[\s\S]*?^}/m)?.[0] || '',
  /canonicalMotionMode|normalizeCanonicalMotionMode/,
  'Canonical source reset authority excludes the retired motion request',
);
assert.match(
  core,
  /uniforms\[73\]\s*=\s*CANONICAL_ANALYTIC_MOTION_RETIRED_UNIFORM_VALUE\s*;/,
  'the former motion uniform slot remains reserved at an explicit zero value',
);
assert.doesNotMatch(
  core,
  /canonical_render_motion_controls\.y/,
  'no shader stage may consume the retired Canonical motion slot',
);
assert.match(
  core,
  /motionRetirementIdentity:\s*canonicalMotionReceipt\.identity/,
  'runtime debug state reports the retirement identity',
);
assert.match(
  core,
  /requestedRetiredMotionMode:\s*canonicalMotionReceipt\.requested/,
  'runtime debug state labels the legacy value as a request, not effective motion',
);
assert.doesNotMatch(
  core,
  /\bmotionMode:\s*normalizeCanonicalMotionMode/,
  'runtime debug state cannot echo a legacy request as effective motion',
);

assert.match(
  cockpit,
  /volume-canonical-motion-mode-state">retired</,
  'the operator readout defaults to the honest retired state',
);
assert.match(
  cockpit,
  /motionStrategy\s*\|\|\s*'retired'/,
  'the operator readout consumes the retirement receipt rather than animated/frozen',
);
assert.doesNotMatch(
  cockpit,
  /volume-canonical-motion-mode-state'\)\.textContent\s*=\s*[^;]*motionMode/,
  'the operator readout cannot present the legacy request as effective motion',
);

assert.match(
  witness,
  /expectedCanonicalMotionRetirementIdentity/,
  'the live witness names the Canonical motion retirement contract',
);
assert.match(
  witness,
  /requestedRetiredMotionMode/,
  'the live witness verifies legacy request custody separately from effective state',
);
assert.doesNotMatch(
  witness,
  /canonicalPlumeControls\?\.motionMode/,
  'the witness cannot certify animated/frozen as an effective Canonical mode',
);

const restoredSignatureAuthority = core.replace(
  '    normalizeCanonicalContentMode(snapshot.canonicalContentMode),',
  '    normalizeCanonicalMotionMode(snapshot.canonicalMotionMode),\n    normalizeCanonicalContentMode(snapshot.canonicalContentMode),',
);
assert.notEqual(restoredSignatureAuthority, core, 'the reset-authority false-closure mutation must alter source');
assert.match(
  restoredSignatureAuthority.match(/export function canonicalSourceControlSignature[\s\S]*?^}/m)?.[0] || '',
  /canonicalMotionMode/,
  'the barrier detects a restored legacy motion reset dependency',
);

const nonzeroUniformAuthority = core.replace(
  'uniforms[73] = CANONICAL_ANALYTIC_MOTION_RETIRED_UNIFORM_VALUE;',
  'uniforms[73] = canonicalMotionModeValue(controlsSnapshot.canonicalMotionMode);',
);
assert.notEqual(nonzeroUniformAuthority, core, 'the uniform false-closure mutation must alter source');
assert.doesNotMatch(
  nonzeroUniformAuthority,
  /uniforms\[73\]\s*=\s*CANONICAL_ANALYTIC_MOTION_RETIRED_UNIFORM_VALUE\s*;/,
  'the barrier detects restored GPU authority in the reserved slot',
);

console.log('canonical analytic motion retirement contracts passed');
