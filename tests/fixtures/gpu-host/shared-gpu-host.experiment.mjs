import {BoxGeometry,Mesh,MeshStandardMaterial} from '../../../lib/three.core.js';
// A small host-conformance fixture. This is not a Stone simulation or SSGI test.
export default {
 id:'shared-gpu-host-fixture',title:'Shared GPU host fixture',
 async create({host}){
  const session=await host.scene.open(),gpu=session.gpu();
  const geometry=new BoxGeometry(.8,.8,.8),material=new MeshStandardMaterial({color:0x35aeb3,roughness:.3}),root=new Mesh(geometry,material);
  root.name='GPU producer body';root.position.y=.4;
  const buffer=gpu.device.createBuffer({label:'host-conformance-allocation',size:4,usage:GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST});
  let publications=0,finalizations=0,retirement=null;
  const asset=await session.attach(root,{owned:true,metadata:{label:root.name},finalize:()=>retirement??=(async()=>{
   await gpu.device.queue.onSubmittedWorkDone();geometry.dispose();material.dispose();buffer.destroy();++finalizations;
  })()});
  session.onBeforeRender(()=>{++publications;});
  session.setView({position:[2,1.5,3],target:[0,.3,0]});
  const read=()=>({id:asset.id,uuid:root.uuid,mounted:root.parent===gpu.scene,publications,finalizations,
   backend:gpu.backend,deviceMatches:gpu.renderer.backend.device===gpu.device,
   adapter:Object.fromEntries(['vendor','architecture','device','description','isFallbackAdapter'].map(key=>[key,gpu.adapter.info[key]??null]))});
  // Preserve the fixture's terminal state after the entry has been closed.
  globalThis.kaminosGpuHostFixture={read,retired:async()=>{await Promise.resolve();if(!retirement)throw Error('Producer retirement was not requested');await retirement;}};
  return {read,operations:{async queueRoundTrip(){
   const output=gpu.device.createBuffer({size:4,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
   try{gpu.device.queue.writeBuffer(buffer,0,new Uint32Array([0x12345678]));const encoder=gpu.device.createCommandEncoder();encoder.copyBufferToBuffer(buffer,0,output,0,4);gpu.device.queue.submit([encoder.finish()]);await output.mapAsync(GPUMapMode.READ);return new Uint32Array(output.getMappedRange())[0];}
   finally{output.destroy();}
  }},dispose:()=>session.dispose()};
 },
};
