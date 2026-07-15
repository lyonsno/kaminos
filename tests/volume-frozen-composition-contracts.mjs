import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const core = readFileSync(join(import.meta.dirname, '..', 'volume-core.js'), 'utf8');
const frozen = core.match(/async function renderFrozenScaleToCanvas\(options = \{\}\) \{[\s\S]*?\n  \}\n\n  async function sampleDeterministicReplayFrame/)?.[0] || '';

assert.match(frozen, /selectiveHeadLiveRenderCompositionRequest\(boundarySplatCompositionRequestedRaw\)/, 'frozen render resolves public composition identities through the live authority table');
assert.match(frozen, /compositionDefinition\.raymarch[\s\S]*encodeDraw\(encoder,\s*currentTexture\.createView\(\)/, 'frozen render encodes raymarch only when requested');
assert.match(frozen, /compositionDefinition\.splat[\s\S]*encodeBoundarySplatDraw\([\s\S]*loadOp:\s*raymarchEncoded\s*\?\s*'load'\s*:\s*'clear'/, 'frozen render composites requested splats over any requested raymarch pass');
assert.match(frozen, /compositionAuthority[\s\S]*raymarchFireAuthority/, 'frozen render reports smoke-only versus full-fire raymarch authority');
assert.match(frozen, /compositionRequest\.fallbackReason[\s\S]*unsupported-boundary-splat-composition/, 'unsupported identities fail before any pass is encoded');

console.log('volume frozen composition contracts: ok');
