import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const smoke = readFileSync(new URL('../smokes/sam31-temporal-memory-attention-parity.js', import.meta.url), 'utf8');
const runner = readFileSync(new URL('../tools/sam31-temporal-memory-attention-browser-parity-smoke.mjs', import.meta.url), 'utf8');
const packetArtifact = readFileSync(new URL('../src/sam31-packet-artifact.js', import.meta.url), 'utf8');

for (const token of [
  'runSam31TemporalMemoryBankPhaseProgramRoute',
  'runSam31MemoryAttentionPhaseProgramRoute',
  'createSam31TemporalMemoryBankPlan',
  'assembled-memory-image',
  'expected-memory-conditioned-features',
  'assemblyMaxAbsDiff',
  'conditionedFeaturesMaxAbsDiff',
  'requestedTemporalRouteId',
  'effectiveTemporalRouteId',
  'requestedAttentionRouteId',
  'effectiveAttentionRouteId',
  'uncapturedErrors',
  'verifySam31PacketFloat32Bytes',
  'packetManifest: manifest',
]) assert.match(smoke, new RegExp(token), `browser smoke must make ${token} load-bearing`);
assert.match(packetArtifact, /crypto\.subtle\.digest/, 'packet verifier must hash fetched tensor bytes');
assert.match(packetArtifact, /tensor byte hash mismatch/, 'packet verifier must reject fetched bytes that disagree with the manifest');
assert.match(smoke, /adapterInfo\.isFallbackAdapter === false/, 'unknown/fallback adapter evidence must fail');
assert.match(smoke, /temporalResult\.receipt\.status === 'real'/, 'temporal route must require a real receipt');
assert.match(smoke, /attentionResult\.receipt\.status === 'real'/, 'attention route must require a real receipt');

for (const token of [
  "phase = 'generate_official_packet'",
  "phase = 'launch_chrome'",
  "phase = 'wait_browser_parity'",
  "phase = 'capture_screenshot'",
  'primary_output_written',
  'screenshotPixelCheck',
  'viewportLayout',
  'layoutPassed',
  'borderSignalFraction',
  'nonBlackFraction >= 0.05',
  'maximumChannel > 24',
  "chromeProcess.once('error'",
  'lastState',
]) assert.match(runner, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `terminal witness must preserve ${token}`);
assert.match(runner, /writeReport\(\{ ok: false, failure_phase: phase/, 'pre-primary failures must still write a phased report');
assert.match(runner, /requestedTemporalRouteId/, 'terminal report must preserve temporal requested route identity');
assert.match(runner, /effectiveAttentionRouteId/, 'terminal report must preserve attention effective route identity');
assert.match(runner, /packetManifest: lastState\?\.packetManifest/, 'durable report must preserve the complete packet manifest');

console.log('sam3.1 temporal memory-attention browser evidence contracts passed');
