// Deterministic native consumer of the production hybrid mount; no simulation.
export async function solidCubeCadenceNative(){
 const T=await import('/lib/three.webgpu.js');
 const {mountDistributedSceneRadiance}=await import('/scene-hybrid-radiance.mjs');
 const {createFireLightFieldShadow}=await import('/fire-light-field-shadow.mjs');
 const renderer=new T.WebGPURenderer({antialias:false});renderer.setSize(128,128);await renderer.init();
 if(!renderer.backend.isWebGPUBackend)throw Error('native WebGPU required');
 const device=renderer.backend.device,raw=renderer.backend.adapter?.info??device.adapterInfo;
 const info={vendor:raw?.vendor,architecture:raw?.architecture,description:raw?.description};
 if(!info.vendor||/swiftshader/i.test(JSON.stringify(info)))throw Error('native adapter identity missing or fallback');
 const errors=[];device.addEventListener('uncapturederror',e=>errors.push(e.error.message));device.pushErrorScope('validation');
 const texture=device.createTexture({size:[4,8,4],dimension:'3d',format:'rgba32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
 const scene=new T.Scene(),geometries=[],materials=[],shadows=[];
 const box=new T.Mesh(new T.BoxGeometry(.4,1,.5),new T.MeshStandardMaterial({color:0xd2c3ad}));box.position.set(.3,.2,.2);box.castShadow=true;scene.add(box);
 const floor=new T.Mesh(new T.PlaneGeometry(8,8),new T.MeshStandardMaterial({color:0xb2a593}));floor.rotation.x=-Math.PI/2;floor.position.y=-1.2;floor.castShadow=true;scene.add(floor);
 for(const mesh of [box,floor]){geometries.push(mesh.geometry);materials.push(mesh.material);}
 const camera=new T.PerspectiveCamera(45,1,.1,100);camera.position.set(4,4,6);camera.lookAt(0,0,0);
 let consume,frame=null;
 const source={status:'encoded',texture,dimensions:[4,8,4],generation:1,frame:0};
 const prototype={setSceneMediumSource(){},setSceneSourceFrameConsumer(f){consume=f;},setSceneDistributedLightFrame(f){frame=f;},sceneVolumeSourceField:()=>source};
 const mount=mountDistributedSceneRadiance({renderer,scene,prototype,device,volumeGrid:2,directions:8,smokeRefinement:1,pointCount:6,shadowCaptureBudget:2,shadowResolution:16,blockerSamples:1,filterSamples:1,nearBox:{enabled:false},createShadow:options=>{const s=createFireLightFieldShadow(options);shadows.push(s);return s;}});
 const rows=[];
 const readCubes=async()=>{
  const buffers=shadows.map(()=>device.createBuffer({size:256*16*6,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST}));
  try{
   const encoder=device.createCommandEncoder();
   shadows.forEach((s,i)=>{const resource=s.resource();if(!resource.effective||!resource.texture)throw Error('solid cube missing');encoder.copyTextureToBuffer({texture:resource.texture},{buffer:buffers[i],bytesPerRow:256,rowsPerImage:16},[16,16,6]);});
   device.queue.submit([encoder.finish()]);
   return await Promise.all(buffers.map(async b=>{await b.mapAsync(GPUMapMode.READ);return Array.from(new Uint16Array(b.getMappedRange()));}));
  }finally{for(const b of buffers)b.destroy();}
 };
 const advance=async phase=>{
  const values=new Float32Array(4*8*4*4);
  for(let z=0;z<4;z++)for(let y=0;y<8;y++)for(let x=0;x<4;x++)values.set([.03*(1+phase)*(1+x*(phase+1)),.02*(1+y*(phase+1)),.01*(1+z*(phase+1)),0],4*(x+4*(y+8*z)));
  device.queue.writeTexture({texture},values,{bytesPerRow:64,rowsPerImage:8},[4,8,4]);source.frame++;
  consume({source});if(!mount.canRender())throw Error('hybrid bank unavailable');
  await renderer.renderAsync(scene,camera);
  const row={phase,state:mount.debugState(),origins:await mount.readShadowCaptureOrigins(),points:await mount.readPointRegions(),cubes:await readCubes()};rows.push(row);return row;
 };
 try{
  await advance(0);await advance(1);await advance(2);await advance(3);
  mount.setShadowCaptureBudget(0);await advance(4);
  const validation=(await device.popErrorScope())?.message??null;
  return {info,errors,validation,rows,outputFrame:frame!==null};
 }finally{mount.dispose();texture.destroy();for(const g of geometries)g.dispose();for(const m of materials)m.dispose();renderer.dispose();}
}
