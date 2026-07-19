import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const core = readFileSync(join(import.meta.dirname, '..', 'volume-core.js'), 'utf8');
const frozen = core.match(/async function renderFrozenScaleToCanvas\(options = \{\}\) \{[\s\S]*?\n  \}\n\n  async function sampleDeterministicReplayFrame/)?.[0] || '';

assert.match(frozen, /selectiveHeadLiveRenderCompositionRequest\(boundarySplatCompositionRequestedRaw\)/, 'frozen render resolves public composition identities through the live authority table');
assert.match(frozen, /compositionDefinition\.raymarch[\s\S]*encodeDraw\(encoder,\s*currentTexture\.createView\(\)/, 'frozen render encodes raymarch only when requested');
assert.match(frozen, /compositionDefinition\.splat[\s\S]*compositionDefinition\.raymarch[\s\S]*loadOp:\s*'load'[\s\S]*encodeBoundarySplatPbrScene[\s\S]*loadColor:\s*pbrSceneApplied/, 'frozen render composites hybrid splats over raymarch and preserves the PBR substrate for splat-only captures');
assert.match(frozen, /compositionAuthority[\s\S]*raymarchFireAuthority/, 'frozen render reports smoke-only versus full-fire raymarch authority');
assert.match(frozen, /compositionRequest\.fallbackReason[\s\S]*unsupported-boundary-splat-composition/, 'unsupported identities fail before any pass is encoded');
assert.match(frozen, /boundarySplatInitialOverflowCount/, 'frozen render preserves first-submit overflow evidence instead of laundering the truncated frame');
assert.match(frozen, /frozen-boundary-splat-capacity-retry/, 'frozen render retries after telemetry-driven capacity growth before presenting splat authority');
assert.match(frozen, /boundarySplatCapacityRetryCount/, 'frozen render reports whether capacity growth required a second complete submission');

console.log('volume frozen composition contracts: ok');
