import * as THREE from './lib/three.webgpu.js';
import {texture,vec3,vec4,float,Fn,agxToneMapping,positionView,uniform} from './lib/three.tsl.js';
import {createSceneEmissiveCamera,applySceneEmissiveCamera} from './scene-emissive-camera.mjs';
import {createMlsJuiceSolver} from './mls-juice-solver.mjs';
import {createMlsJuiceRenderer} from './mls-juice-renderer.mjs';
import {MLS_ROUTE,MLS_SOURCE} from './mls-juice-contract.mjs';
import {buildFrozenHillGeometry} from './mls-hill-terrain.mjs';

export async function createMlsJuiceHost({renderer,scene,camera,pipeline,device,setup,liveInletPacket,isCurrent=()=>true}){
  if(!device||renderer.backend.device!==device)throw Error('MLS requires the actual host WebGPU device');
  let solver,surface;
  try{
    solver=await createMlsJuiceSolver({device,setup,packet:liveInletPacket});
    surface=await createMlsJuiceRenderer({device,solver});
  }catch(error){solver?.dispose();throw error;}
  if(!isCurrent()){surface.dispose();solver.dispose();return null;}
  const group=new THREE.Group();group.name='MLS Finger Juice tray';
  const material=new THREE.MeshStandardMaterial({color:0x707d7a,roughness:.55,metalness:.1});
  const c=solver.config,extentX=(c.dimensions[0]-5)*c.cell,extentZ=(c.dimensions[2]-5)*c.cell;
  const centerX=(c.bounds.min[0]+c.bounds.max[0])/2,centerZ=(c.bounds.min[2]+c.bounds.max[2])/2;
  const floor=new THREE.Mesh(new THREE.BoxGeometry(extentX,.08,extentZ),material);floor.position.set(centerX,-.04,centerZ);group.add(floor);
  for(const [x,z,sx,sz] of [[c.bounds.min[0],centerZ,.06,extentZ],[c.bounds.max[0],centerZ,.06,extentZ],[centerX,c.bounds.min[2],extentX,.06],[centerX,c.bounds.max[2],extentX,.06]]){
    const wall=new THREE.Mesh(new THREE.BoxGeometry(sx,.18,sz),material);wall.position.set(x,.09,z);group.add(wall);
  }
  let hillMaterial;
  if(c.terrain){
    const data=buildFrozenHillGeometry(c.terrain),geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.BufferAttribute(data.positions,3));
    const colors=new Float32Array(data.colors.length),color=new THREE.Color();
    for(let i=0;i<colors.length;i+=3)color.setRGB(data.colors[i],data.colors[i+1],data.colors[i+2],THREE.SRGBColorSpace).toArray(colors,i);
    geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));
    geometry.setIndex(new THREE.BufferAttribute(data.indices,1));geometry.computeVertexNormals();
    hillMaterial=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.95});
    const hill=new THREE.Mesh(geometry,hillMaterial);hill.name='Hill of Hills — frozen source';
    hill.userData.source=c.terrain.source;hill.userData.transform=c.terrain.transform;group.add(hill);
    group.name='Finger Juice on Hill of Hills';
  }else{
    const sphere=new THREE.Mesh(new THREE.SphereGeometry(c.obstacle.radius,24,16),material);
    sphere.position.fromArray(c.obstacle.center);group.add(sphere);
  }
  scene.add(group);
  const options={type:THREE.HalfFloatType,depthBuffer:false,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter};
  const color=new THREE.RenderTarget(1,1,options),output=new THREE.RenderTarget(1,1,options);
  const depth=new THREE.RenderTarget(1,1,{type:THREE.FloatType,format:THREE.RedFormat,depthBuffer:true,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter});
  const depthMaterial=new THREE.NodeMaterial();depthMaterial.fragmentNode=vec4(positionView.z.negate(),0,0,1);
  depthMaterial.blending=THREE.NoBlending;depthMaterial.toneMapped=false;
  const linear=texture(output.texture),display=createSceneEmissiveCamera(linear,{TSL:{uniform,vec3,vec4,float,Fn,agxToneMapping},THREE});
  const presentation=new THREE.RenderPipeline(renderer,linear),originalOutputTransform=pipeline.outputColorTransform;
  pipeline.outputColorTransform=false;pipeline.needsUpdate=true;
  let frameCount=0,paused=false,disposed=false,failure=null,lastFrame=null;
  const gpuError=event=>{failure=event.error?.message??'MLS GPU error';};device.addEventListener('uncapturederror',gpuError);
  device.lost.then(info=>{if(!disposed)failure=info.message||'MLS device lost';});
  const native=target=>renderer.backend.get(target.texture).texture.createView();
  return {group,supportsVolumeTransport:false,get paused(){return paused;},get presentation(){return 'full';},
    setPresentation(mode){if(mode!=='full')throw Error('MLS only supports full presentation');return mode;},
    setSceneCamera(requested,physical){const state=display.update(requested,physical);applySceneEmissiveCamera(presentation,linear,display.outputNode,state.effective);return state;},
    setPaused(value){paused=Boolean(value);solver.setPaused(paused);return paused;},
    setLiveInletPacket:packet=>solver.setPacket(packet),
    interfaceRecordDescriptor:()=>null,
    async snapshot(){return solver.snapshot();},
    render({advance=true,volumeTransport=null}={}){
      if(disposed||failure)throw Error(failure||'MLS host disposed');
      if(volumeTransport)throw Error('MLS volume transport is not implemented');
      const target=renderer.getRenderTarget(),override=scene.overrideMaterial,background=scene.background;
      const renderObject=renderer.getRenderObjectFunction(),clear=renderer.getClearColor(new THREE.Color()),alpha=renderer.getClearAlpha();
      try{
        const size=renderer.getDrawingBufferSize(new THREE.Vector2());
        for(const t of [color,output,depth])t.setSize(size.x,size.y);renderer.initRenderTarget(output);
        if(advance)solver.advance();
        if(pipeline.outputColorTransform){pipeline.outputColorTransform=false;pipeline.needsUpdate=true;}
        renderer.setRenderTarget(color);pipeline.render();
        scene.overrideMaterial=depthMaterial;scene.background=null;
        renderer.setRenderObjectFunction((...args)=>{
          if(args[4].depthWrite===false)return;
          for(let o=args[0];o;o=o.parent)if(o.userData?.kaminosEditorHelper||o.userData?.kaminosEditorOnly)return;
          depthMaterial.side=args[4].side;renderer.renderObject(...args);
        });
        renderer.setClearColor(new THREE.Color(camera.far,0,0),1);renderer.setRenderTarget(depth);renderer.render(scene,camera);
        scene.overrideMaterial=override;scene.background=background;renderer.setRenderObjectFunction(renderObject);renderer.setClearColor(clear,alpha);
        const encoder=device.createCommandEncoder({label:'MLS host frame'});
        surface.encode({encoder,hostCamera:camera,sceneColor:native(color),sceneDepth:native(depth),target:native(output),width:size.x,height:size.y});
        device.queue.submit([encoder.finish()]);renderer.setRenderTarget(target);presentation.render();frameCount++;
        lastFrame={frameCount,width:size.x,height:size.y,route:MLS_ROUTE,camera:camera.uuid,sharedDevice:true};
      }catch(error){failure=String(error);throw error;}
      finally{scene.overrideMaterial=override;scene.background=background;renderer.setRenderObjectFunction(renderObject);renderer.setClearColor(clear,alpha);renderer.setRenderTarget(target);}
    },
    state:()=>({requestedRoute:MLS_ROUTE,effectiveRoute:frameCount&&!failure?MLS_ROUTE:null,source:MLS_SOURCE,
      registered:true,mounted:!disposed,frameCount,paused,presentation:'full',failure,lastFrame,
      clock:{...solver.read().clock,paused},setup:structuredClone(setup),solver:solver.read(),surface:surface.read(),
      scope:c.terrain?'frozen_source_hill_contact; no_terrain_evolution_or_two_way_response':'provisional_finger_juice; prescribed_tray_sphere; no_two_way_or_fire_transport'}),
    dispose(){if(disposed)return;disposed=true;device.removeEventListener('uncapturederror',gpuError);surface.dispose();solver.dispose();scene.remove(group);
      group.traverse(o=>o.geometry?.dispose());material.dispose();hillMaterial?.dispose();depthMaterial.dispose();for(const t of [color,output,depth])t.dispose();presentation.dispose();
      pipeline.outputColorTransform=originalOutputTransform;pipeline.needsUpdate=true;}
  };
}
