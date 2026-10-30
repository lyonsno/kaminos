import assert from 'node:assert/strict';
export function validateCast(r,q){
 for(const key of ['sourceSha256','preparedSha256','seed'])assert.equal(r[key],q[key],key);
 assert.equal(r.pipelineType,'512');assert.equal(r.samplingSteps,8);assert.equal(r.meshResolution,512);
 assert.equal(r.decoderActivationStorage,'f16');assert.equal(r.route,'trellis2.image-generation.webgpu.v0');assert.equal(r.appHost,true);
 assert.equal(r.receiptValidation?.ok,true);for(const c of ['route-released','glb-magic'])assert.ok(r.receiptValidation?.checks?.includes(c));
 assert.equal(r.postprocess?.requestedMode,'mlx-surface-preserving');assert.equal(r.postprocess?.effectiveRoute,'Trellis2MLX/surface-preserving/browser-port-of-fast-simplify-first');
 assert.ok(r.raw?.vertices>0&&r.raw?.triangles>0);assert.ok(r.output?.bytes>=12);assert.equal(r.output?.glbMagic,0x46546c67);
 assert.ok(r.noiseSeeds?.length>=3);assert.ok(r.noiseSeeds.every(s=>s===q.seed));
}
