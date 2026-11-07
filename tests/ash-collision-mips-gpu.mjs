// kaminos-test: node
import assert from 'node:assert/strict';
import {withKaminosGpu,withGpuErrorScopes} from '../tools/shader-herder.mjs';
import {encodeOccupancyMips,occupancyMipLevels} from '../ash/collision-mips.mjs';
await withKaminosGpu(async({device,GPUBufferUsage:U})=>withGpuErrorScopes(device,'odd collider min/max bounds',async()=>{
 const grid=5,texture=device.createTexture({size:[grid,grid,grid],dimension:'3d',format:'r32uint',mipLevelCount:occupancyMipLevels(grid),usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.COPY_SRC|GPUTextureUsage.STORAGE_BINDING});
 const read=device.createBuffer({size:256,usage:U.COPY_DST|U.MAP_READ});
 try{for(const full of [false,true]){
  const data=new Uint32Array(grid**3);if(full)data.fill(1);else data[data.length-1]=1;
  device.queue.writeTexture({texture},data,{bytesPerRow:grid*4,rowsPerImage:grid},[grid,grid,grid]);
  const e=device.createCommandEncoder();encodeOccupancyMips(device,e,texture,grid);e.copyTextureToBuffer({texture,mipLevel:occupancyMipLevels(grid)-1},{buffer:read,bytesPerRow:256},[1,1,1]);device.queue.submit([e.finish()]);await read.mapAsync(GPUMapMode.READ);
  assert.equal(new Uint32Array(read.getMappedRange())[0],full?0x80000001:1,'mixed boundary and fully occupied bounds must remain distinguishable, including odd tail texels');read.unmap();
 }}finally{read.destroy();texture.destroy();}
}));
