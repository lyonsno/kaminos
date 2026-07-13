import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const packageJson = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));

assert.equal(
  packageJson.scripts['test:live:sam31-two-frame-tracker-webgpu'],
  'node tools/sam31-two-frame-tracker-browser-parity-smoke.mjs',
  'the two-frame decoder-memory-attention-decoder episode must be directly runnable',
);

const exporter = readFileSync(new URL('tools/sam31-two-frame-tracker-meta-packet.py', root), 'utf8');
for (const token of [
  'VideoTrackingMultiplex._encode_new_memory',
  'VideoTrackingMultiplex._prepare_memory_conditioned_features',
  'MultiplexMaskDecoder',
  'frame-0-memory-input-masks',
  'frame-0-object-scores',
  'frame-0-object-pointers',
  'frame-0-memory-features',
  'frame-1-memory-conditioned-features',
  'frame-1-selected-masks',
  'frame-1-object-pointers',
  'NO_OBJ_SCORE',
]) {
  assert.match(exporter, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `official two-frame packet must bind ${token}`);
}

const browser = readFileSync(new URL('smokes/sam31-two-frame-tracker-parity.js', root), 'utf8');
for (const token of [
  'runSam31MultiplexMaskDecoderPhaseProgramRoute',
  'runSam31MemoryEncoderPhaseProgramRoute',
  'runSam31TemporalMemoryBankPhaseProgramRoute',
  'runSam31MemoryAttentionPhaseProgramRoute',
  'frame0DecoderResult.receipt',
  'frame0MemoryResult.receipt',
  'suppressAbsentMasks',
  'suppressedAbsentMaskCount',
  'frame1AttentionResult.receipt',
  'frame1DecoderResult.receipt',
  'numObjPtrTokens: 16',
  'memoryTokens: 20',
  'routeChainPassed',
  'stateTransitionPassed',
  'parityPassed',
  'packetAuthorityPassed',
]) {
  assert.match(browser, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `browser episode must make ${token} load-bearing`);
}

const driver = readFileSync(new URL('tools/sam31-two-frame-tracker-browser-parity-smoke.mjs', root), 'utf8');
for (const token of [
  'kaminos.sam31-two-frame-tracker.browser-parity-smoke.v0',
  'failure_phase',
  'primary_output_written',
  'packetAuthority',
  'verifyPacketAuthority',
  'tensorManifestSha256',
  'effectiveRouteIds',
  'routeChainPassed',
  'stateTransitionPassed',
  'parityPassed',
  'pixelCheck',
]) {
  assert.match(driver, new RegExp(token), `terminal witness must preserve ${token}`);
}

console.log('sam3.1 two-frame tracker composition contracts passed');
