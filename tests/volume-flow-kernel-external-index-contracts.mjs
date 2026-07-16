import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const exporter = readFileSync(new URL('../volume-full-grid-field-export.mjs', import.meta.url), 'utf8');

assert.match(exporter, /--flow-kernel-descriptor-index-bin/, 'frozen export accepts a caller-owned native-cell index artifact');
assert.match(exporter, /flow-kernel-descriptor-index-bin[\s\S]*--flow-kernel-descriptor-bin/, 'an index artifact requires a descriptor output artifact');
assert.match(
  exporter,
  /beginFlowKernelDescriptorIndexUpload[\s\S]*writeFlowKernelDescriptorIndexUploadChunk[\s\S]*finishFlowKernelDescriptorIndexUpload/,
  'the exporter uploads the index artifact through a session-bound chunk route',
);
assert.match(core, /@group\(0\) @binding\(9\) var<storage, read> flowKernelDescriptorCellIndices/, 'the evaluator consumes an explicit GPU native-cell index list');

const externalEntryStart = core.indexOf('fn evaluateFlowKernelDescriptorsForIndices(');
const externalEntryEnd = core.indexOf('\n}', externalEntryStart);
assert.ok(externalEntryStart >= 0 && externalEntryEnd > externalEntryStart, 'external descriptor entry point is inspectable');
const externalEntrySource = core.slice(externalEntryStart, externalEntryEnd);
assert.match(externalEntrySource, /flowKernelDescriptorCellIndices\[0u\]/, 'index buffer declares its effective row count');
assert.match(externalEntrySource, /writeFlowKernelDescriptor\(outputIndex, nativeCellIndex/, 'rows preserve caller order and native-cell identity');
assert.doesNotMatch(externalEntrySource, /structuralSignal|candidateIndex|atomicAdd/, 'external rows bypass compact-splat structural admission');

assert.match(core, /external-native-cell-index-list-v0/, 'external receipts name their population exactly');
assert.match(core, /structural-splat-candidates-v0/, 'compact-splat receipts name their narrower population exactly');
assert.match(core, /duplicatePolicy:\s*['"]forbidden['"]/, 'external index admission rejects duplicate identities');
assert.match(core, /orderIdentity:\s*['"]caller-ordered['"]/, 'external index admission preserves caller order');
assert.match(core, /indexSha256/, 'external receipts bind admission to the uploaded checksum');
assert.match(core, /nativeCellIndex >= gridSize \* gridSize \* gridSize/, 'host admission fails loud on out-of-grid indices');
assert.match(core, /dispatchWorkgroups\(Math\.ceil\(state\.flowKernelDescriptorIndexCount \/ 64\)\)/, 'dispatch is driven by requested row count, not splat count');
assert.match(core, /sampleBoundarySplatKernelDescriptorCapture\(state\.flowKernelDescriptorIndexCount/, 'capture drains exactly the requested row population');

console.log('flow kernel external index contracts passed');
