import fs from 'node:fs';
import assert from 'node:assert/strict';
import {inspectInteriorShardWitness} from '../structural-material-shard-evidence.mjs';
const [file]=process.argv.slice(2);if(!file)throw new Error('Observed damaged native report required');
const raw=JSON.parse(fs.readFileSync(file)),observed=raw.result.observed.witness;
const absent=structuredClone(observed);absent.identity.renderer='broken-renderer-fixture';absent.identity.surface='cpu-reference-only';absent.identity.surfaceState='absent';for(const p of absent.pieces)p.surfaceRoute='absent-gpu-surface-fixture';
assert.ok(inspectInteriorShardWitness(absent).some(e=>/GPU surface/.test(e)),'CPU picking references must not admit a substituted GPU surface');
const fixture=structuredClone(observed);fixture.identity.renderer='three-webgpu-visual-consumer';fixture.identity.surface='resident-vertex-transport';fixture.identity.surfaceState='published-gpu-copy';for(const p of fixture.pieces)p.surfaceRoute='kaminos.deformable-surface.resident-vertex-transport.webgpu.v0';fixture.surfaceObservation={source:'native-webgpu-transport-compute-readback',runId:fixture.runId,steps:fixture.state.steps,pieces:fixture.pieces.map(p=>({pieceId:p.id,route:p.surfaceRoute,runId:fixture.runId,step:fixture.state.steps,gpu:Array.from({length:p.renderedPositions.length/3},(_,i)=>p.renderedPositions.slice(i*3,i*3+3))}))};
assert.deepEqual(inspectInteriorShardWitness(fixture),[]);
for(const mutate of [w=>delete w.surfaceObservation,w=>w.surfaceObservation.runId='stale',w=>w.surfaceObservation.steps++,w=>w.surfaceObservation.pieces.pop(),w=>w.surfaceObservation.pieces[0].gpu=[],w=>w.surfaceObservation.pieces[0].gpu[0][0]+=.01,w=>w.pieces[0].surfaceRoute='substituted',w=>w.identity.surfaceState='cpu-copy']){const w=structuredClone(fixture);mutate(w);assert.ok(inspectInteriorShardWitness(w).some(e=>/GPU surface/.test(e)));}
console.log('Observed false-admission rejected; synthetic matching positions test schema only, not native GPU conformance.');
