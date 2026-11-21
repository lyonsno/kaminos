// kaminos-test: node
import assert from 'node:assert/strict';
import test from 'node:test';
import {createGpuTestContext,withGpuErrorScopes} from '../tools/shader-herder.mjs';
import {createVolumeGather} from '../scene-volume-gather.mjs';
import {buildTriangleVisibility} from '../scene-light-visibility.mjs';
const identity=new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
function wall(count){
 const g=buildTriangleVisibility(Array.from({length:count},(_,i)=>i%2?{a:[0,-3,-3],b:[0,3,3],c:[0,-3,3]}:{a:[0,-3,-3],b:[0,3,-3],c:[0,3,3]})).packGpu();
 g.matrices=identity;g.owners=new Uint32Array(Math.max(1,g.nodeCount+g.triangleCount));return g;
}
test('production retained lighting sees changed solid topology on Metal without compiling or allocating new volumes',async()=>{
 const ctx=await createGpuTestContext();const owned=[];let gather;
 const counts={pipelines:0,textures:0};
 const device=new Proxy(ctx.device,{get(target,key){const value=Reflect.get(target,key,target);if(typeof value!=='function')return value;return(...args)=>{if(key==='createComputePipeline')counts.pipelines++;if(key==='createTexture')counts.textures++;return value.apply(target,args);};}});
 try{
  await withGpuErrorScopes(ctx.device,'retained topology numerical execution',async()=>{
   const texture=device.createTexture({dimension:'3d',size:[2,2,2],format:'rgba32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});owned.push(texture);
   const values=new Float32Array(32);for(let i=0;i<8;i++)values[i*4]=1;
   device.queue.writeTexture({texture},values,{bytesPerRow:32,rowsPerImage:2},[2,2,2]);
   const read=device.createBuffer({size:1024,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});owned.push(read);
   gather=createVolumeGather(device,{geometry:wall(0),receivers:[],volumeGrid:2,sourceDimensions:[2,2,2],smokeRefinement:1,directions:2,worldGeometry:true});
   const source={status:'encoded',texture,dimensions:[2,2,2],generation:1,frame:0};
   const outputs=[];let warm=null;
   for(const triangles of [0,20,2,0]){
    if(source.frame)gather.setGeometry(wall(triangles));
    const frame=gather.encode({...source,frame:++source.frame,sourceSoftness:1});assert.equal(frame.geometryTriangles,triangles);
    const encoder=device.createCommandEncoder();encoder.copyTextureToBuffer({texture:gather.smoke},{buffer:read,bytesPerRow:256,rowsPerImage:2},[2,2,2]);device.queue.submit([encoder.finish()]);
    await read.mapAsync(GPUMapMode.READ);const data=new Float32Array(read.getMappedRange()),red=[];for(let row=0;row<4;row++)for(let x=0;x<2;x++)red.push(data[row*64+x*4]);read.unmap();outputs.push(red);
    if(!warm)warm={...counts};else assert.deepEqual(counts,warm,'edited topology must reuse the compiled pipelines and volume textures');
   }
   for(const row of outputs)assert.ok(row.every(x=>Number.isFinite(x)&&x>=0));
   assert.ok(outputs[0].some((x,i)=>x>outputs[1][i]+.05),'the new wall must actually occlude emitted light');
   for(let i=0;i<8;i++){
    assert.ok(Math.abs(outputs[0][i]-outputs[3][i])<1e-5,'clearing topology restores unoccluded transport');
    assert.ok(Math.abs(outputs[1][i]-outputs[2][i])<1e-5,'shrinking the same wall preserves its optical effect');
   }
   console.log('retained-lighting-numerics: '+JSON.stringify({route:'native Metal',adapter:ctx.adapterInfo,counts,outputs}));
  });
 }finally{gather?.destroy();for(const r of owned)r.destroy();ctx.destroy();}
});
