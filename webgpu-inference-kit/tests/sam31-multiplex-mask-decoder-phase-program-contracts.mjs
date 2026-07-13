import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const indexSource = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
const packageSource = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
const decoderSource = readFileSync(new URL('../src/sam31-multiplex-mask-decoder-phase-program.js', import.meta.url), 'utf8');
const browserSource = readFileSync(new URL('../smokes/sam31-multiplex-mask-decoder-parity.js', import.meta.url), 'utf8');
const runnerSource = readFileSync(new URL('../tools/sam31-multiplex-mask-decoder-browser-parity-smoke.mjs', import.meta.url), 'utf8');

for (const token of [
  'SAM31_MULTIPLEX_MASK_DECODER_PHASE_PROGRAM_ROUTE_ID',
  'createSam31MultiplexMaskDecoderPhaseProgramCpuOracle',
  'createSam31MultiplexMaskDecoderPhaseProgramRouteDefinition',
  'runSam31MultiplexMaskDecoderPhaseProgramRoute',
]) assert.match(indexSource, new RegExp(token), `public package surface must expose ${token}`);

assert.match(packageSource, /sam31-multiplex-mask-decoder-phase-program-contracts\.mjs/, 'the full suite must execute multiplex decoder contracts');
assert.match(packageSource, /test:live:sam31-multiplex-decoder-webgpu/, 'the package must expose the live multiplex decoder witness');
assert.match(decoderSource, /stage\.uploadTensor\(gpu\.keyA, imageEmbedding\)/, 'the live transformer key stream must begin from the official image embedding');
for (const token of ['verifySam31PacketFloat32Bytes', 'runSam31MultiplexMaskDecoderPhaseProgramRoute', 'layer0Queries', 'objectPointers', 'mappedTensorCount === 133']) assert.match(browserSource, new RegExp(token), `browser witness must make ${token} load-bearing`);
for (const token of ['generate_official_packet', 'wait_browser_parity', 'primary_output_written', 'viewportLayout', 'nonBlackFraction', 'borderSignalFraction']) assert.match(runnerSource, new RegExp(token), `terminal witness must preserve ${token}`);

console.log('sam3.1 multiplex mask decoder phase-program contracts passed');
