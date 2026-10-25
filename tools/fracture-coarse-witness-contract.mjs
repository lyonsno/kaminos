import assert from 'node:assert/strict';
export function assertCoarseWitnessSource({initial,runtime,commit,spec,digest}){
 assert.equal(initial.source,spec.source,'Effective source identity differs from the expected asset');
 assert.equal(runtime.config.source.commit,commit,'Wrong served revision');
 assert.equal(initial.prepared.receipt.sourceTriangles,spec.triangles,'Wrong source triangle count');
 assert.equal(initial.material.backend,'webgpu-avbd','Wrong effective solver');
 assert.equal(digest,spec.sha256,'Wrong source bytes');
}
