import assert from 'node:assert/strict';
export function assertSurfaceSceneResult(r,{materialFixture=false,backend='webgpu'}={}){
 assert.equal(r.backend,backend);assert.equal(r.gi.mode,'combined');assert.ok(r.gi.frames>=3);assert.equal(r.gi.sourcePasses,1);assert.equal(r.gi.receivingPasses,1);
 assert.ok(r.bright[0]>r.dark[0]+.05,'SSGI beauty must retain physical lighting');assert.ok(r.normal[2]>.99&&Math.abs(r.normal[0])<.01,'source normal must describe the reconstructed surface');
 assert.equal(r.receipt.backend,'gpu');assert.equal(r.receipt.triangleCount,12);assert.equal(r.gpu.length,4096);assert.equal(r.cpu.length,4096);
 assert.ok(r.gpu.some(Boolean));assert.deepEqual(r.gpu,r.cpu,'GPU fluid occupancy must match source triangles');
 assert.equal(r.reference.length,12);assert.deepEqual(r.ashTriangles,r.reference,'ash must consume the same placed shape');assert.equal(r.independent,true);
 assert.equal(r.flame?.identity,'hybrid-distributed-smoke-point-surfaces-v0');assert.equal(r.flame.evaluatedPointCount,1);assert.equal(r.flame.capturedPointCount,1);assert.equal(r.flame.cached.mounted,true);assert.ok(r.flame.on[0]>r.flame.off[0]+.01,'live-source irradiance must illuminate splats through the SSGI cache');
 if(materialFixture){assert.equal(r.vertexMaterial?.schema,'vertex-metallic-roughness.v1');assert.equal(r.vertexMaterial.attribute.length,8);assert.ok(r.vertexMaterial.right[0]>r.vertexMaterial.left[0]+60,'spatial metalness must reach the production shader');assert.ok(r.vertexMaterial.right[1]>r.vertexMaterial.left[1]+40,'spatial roughness must reach the production shader');}
 assert.deepEqual(r.errors,[]);
}
