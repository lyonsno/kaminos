import {Scene,Mesh,PlaneGeometry,OrthographicCamera,DirectionalLight,RenderTarget,FloatType,RGBAFormat,LinearSRGBColorSpace} from './lib/three.webgpu.js';
export async function probeFilteredSurface(renderer,surface,{view=[0,0],light=[.5,.3]}={}){
 for(const d of [view,light])if(!Array.isArray(d)||d.length!==2||!d.every(Number.isFinite)||d[0]**2+d[1]**2>=1)throw Error('Probe requires upper-hemisphere directions');
 const world=new Scene(),geometry=new PlaneGeometry(2,2),plane=new Mesh(geometry,surface.material),camera=new OrthographicCamera(-.5,.5,.5,-.5,.01,10),lamp=new DirectionalLight(0xffffff,1),target=new RenderTarget(1,1,{type:FloatType,format:RGBAFormat,depthBuffer:false});target.texture.colorSpace=LinearSRGBColorSpace;
 const vz=Math.sqrt(1-view[0]**2-view[1]**2),lz=Math.sqrt(1-light[0]**2-light[1]**2);camera.position.set(-view[0]*2,-view[1]*2,vz*2);camera.lookAt(0,0,0);lamp.position.set(-light[0]*2,-light[1]*2,lz*2);world.add(plane,lamp,lamp.target);
 const oldTone=surface.material.toneMapped;surface.material.toneMapped=false;surface.material.needsUpdate=true;
 try{
  await renderer.compileAsync(world,camera);const previous=renderer.getRenderTarget();
  try{renderer.setRenderTarget(target);renderer.render(world,camera);}finally{renderer.setRenderTarget(previous);}
  const pixels=await renderer.readRenderTargetPixelsAsync(target,0,0,1,1),rgb=Array.from(pixels).slice(0,3),settings=surface.read(),expected=surface.evaluate([.5*settings.uvScale,.5*settings.uvScale],[...view,...light]).map(v=>v*lz*settings.gain);
  if(!rgb.every(Number.isFinite))throw Error('Nonfinite production material probe');
  return {view,light,uv:[.5,.5],rgb,expected,absoluteError:rgb.map((v,i)=>Math.abs(v-expected[i])),route:'Borrowed native renderer, actual material, linear float render target; CPU coefficients are an independent numerical reference'};
 }finally{surface.material.toneMapped=oldTone;surface.material.needsUpdate=true;geometry.dispose();target.dispose();}
}
