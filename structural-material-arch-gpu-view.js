import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createElement, Pause, Play, RotateCcw, ZoomIn, ZoomOut } from 'lucide';
import { createNativeGpuRenderer } from './dist/structural-material-arch-gpu-engine.js';
import { createGpuArchCollapse, coarsenGpuArchProfile, ARCH_GPU_ROUTE } from './structural-material-arch-gpu.js';
import { loadStoneAssets, fitStoneGeometry, structuralFaceAt } from './structural-material-arch-stones.js';

const profilePath='./artifacts/structural-material-3d/stone-arch-source-pair-2026-09-24/arch-proxy-witness/intact-profile.json';
const params=new URLSearchParams(location.search),status=document.querySelector('#status'),receipt=document.querySelector('#receipt'),errorNode=document.querySelector('#error');
let phase='loading',failure=null,model,paused=params.get('smoke')==='1',failurePaused=null,mode='shear',grab=null,contactPointer=null,lastPick=null,latestStepCost=0,identity=null;
let operations=Promise.resolve(),busy=false,lastTime=performance.now(),simulationRate=1;
const failures=[];
function fail(operation,error){if(failurePaused===null)failurePaused=paused;paused=true;phase='failed';failure={operation,message:error.message??String(error),stack:error.stack,step:model?.snapshot().step??null,at:new Date().toISOString()};failures.push(failure);status.textContent=`${operation} failed`;errorNode.textContent=failure.message;console.error(error);}
const act=(operation,callback)=>(...args)=>{if(phase!=='interactive')return;try{const result=callback(...args);result?.catch?.(error=>fail(operation,error));return result;}catch(error){fail(operation,error);}};
function serialize(operation,callback){const work=operations.then(async()=>{busy=true;try{return await callback();}catch(error){fail(operation,error);throw error;}finally{busy=false;}});operations=work.catch(()=>{});return work;}
try {
  const canvas=document.createElement('canvas');document.querySelector('#viewport').append(canvas);
  const native=await createNativeGpuRenderer(canvas),{renderer,device}=native;identity=native.identity;
  device.addEventListener('uncapturederror',event=>fail('GPU validation',event.error));
  device.lost.then(info=>{if(info.reason!=='destroyed')fail('GPU device loss',new Error(info.message));});
  document.querySelector('#device').textContent=`WebGPU AVBD · ${identity.description||identity.architecture||identity.vendor||'native adapter'}`;
  renderer.setPixelRatio(devicePixelRatio);renderer.setSize(innerWidth,innerHeight);
  const scene=new THREE.Scene();scene.background=new THREE.Color('#101717');
  const camera=new THREE.PerspectiveCamera(38,innerWidth/innerHeight,.03,100);camera.position.set(5.4,3.2,8.3);camera.position.multiplyScalar(Math.max(1,.85/camera.aspect));
  const controls=new OrbitControls(camera,canvas);controls.target.set(0,-.25,0);controls.enableDamping=false;controls.update();
  scene.add(new THREE.HemisphereLight(0xe1f7ea,0x263334,2));const light=new THREE.DirectionalLight(0xffedcf,3);light.position.set(-4,8,5);scene.add(light);
  const materials=[0xc0c5c4,0xb0b8b7,0xaebfba,0x98a6a4,0xc8cdca,0xa5b0ac].map(color=>new THREE.MeshStandardMaterial({color,roughness:.94}));
  const pinnedMaterial=new THREE.MeshStandardMaterial({color:0x687c88,roughness:.9}),crackMaterial=new THREE.MeshStandardMaterial({color:0xbc4b32,roughness:1}),outlineMaterial=new THREE.LineBasicMaterial({color:0xeebc67});
  const grip=new THREE.Mesh(new THREE.SphereGeometry(.045,16,12),new THREE.MeshBasicMaterial({color:0xff8759,depthTest:false}));grip.renderOrder=10;grip.visible=false;scene.add(grip);
  const tether=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3()]),new THREE.LineBasicMaterial({color:0xe1b567,depthTest:false}));tether.renderOrder=9;tether.visible=false;scene.add(tether);
  const useStones=params.get('stones')==='1',stoneAssets=useStones?await loadStoneAssets():[];
  let meshes=[],geometry,edges,floor,source,profile,stoneGeometries=[];
  const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2(),toThree=value=>new THREE.Vector3(value.x,value.y,value.z);
  function icon(node,definition){node.replaceChildren(createElement(definition));}
  function pauseIcon(){const button=document.querySelector('#pause');icon(button,paused?Play:Pause);button.title=button.ariaLabel=paused?'Resume':'Pause';}
  function strength(){const input=document.querySelector('#strength'),value=Number(input.value);input.setCustomValidity('');if(!input.value.trim()||!Number.isFinite(value)||value<=0||!input.validity.valid){input.setCustomValidity('Cohesion must be positive and finite.');input.setAttribute('aria-invalid','true');errorNode.textContent=`Invalid cohesion; effective value remains ${model?.snapshot().config.strength??'unset'}.`;return null;}input.removeAttribute('aria-invalid');if(!failure)errorNode.textContent='';return value;}
  function synchronize(){if(!model)return;const state=model.snapshot();
    state.bodies.forEach(body=>{const mesh=meshes[body.index];mesh.position.copy(body.position);mesh.quaternion.copy(body.quaternion);if(!useStones&&!body.pinned)mesh.material=[...materials];mesh.userData.outline.visible=Boolean(grab?.indices.includes(body.index));});
    if(!useStones)for(const bond of state.bonds)if(!bond.alive){const face=(bond.normal.x?0:bond.normal.y?1:2)*2;if(!state.bodies[bond.a].pinned)meshes[bond.a].material[face]=crackMaterial;if(!state.bodies[bond.b].pinned)meshes[bond.b].material[face+1]=crackMaterial;}
    scene.updateMatrixWorld(true);grip.visible=tether.visible=Boolean(grab);if(grab){const world=meshes[grab.index].localToWorld(grab.local.clone());grip.position.copy(world);const positions=tether.geometry.attributes.position;positions.setXYZ(0,world.x,world.y,world.z);positions.setXYZ(1,grab.target.x,grab.target.y,grab.target.z);positions.needsUpdate=true;}
    const bound=state.events.filter(event=>event.kind==='bind').length;status.textContent=`${state.broken} broken · ${bound} bound`;
    receipt.textContent=`${state.bodies.length} blocks · ${grab?`${grab.indices.length}-block grip`:'surface contact'} · ${paused?'paused':`live ${simulationRate.toFixed(2)}x`} · ${latestStepCost.toFixed(1)} ms/step+copy`;
    scene.updateMatrixWorld(true);renderer.render(scene,camera);
  }
  async function rebuild(){const value=strength();if(value===null)return false;const solverOptions=Object.fromEntries(['solverIterations','stiffness','initialJointPenalty','gravityRampSeconds','substeps'].filter(key=>params.has(key)).map(key=>[key,Number(params.get(key))]));if(params.has('preventPenetratingNormalDropout')){const requested=params.get('preventPenetratingNormalDropout');if(!['true','false'].includes(requested))throw new Error('preventPenetratingNormalDropout must be true or false');solverOptions.preventPenetratingNormalDropout=requested==='true';}
    let next,nextGeometry,nextEdges,nextMeshes,nextStoneGeometries=[];
    try {
      next=await createGpuArchCollapse(profile,renderer,{strength:value,...solverOptions});
      const {dx,dy,dz}=next.snapshot().dimensions;nextGeometry=new THREE.BoxGeometry(dx*.98,dy*.98,dz*.98);nextEdges=new THREE.EdgesGeometry(nextGeometry);
      for(const asset of stoneAssets)nextStoneGeometries.push(fitStoneGeometry(asset.geometry,{dx,dy,dz}));
      nextMeshes=next.cells.map(cell=>{const variant=cell.index%stoneAssets.length;const mesh=useStones?new THREE.Mesh(nextStoneGeometries[variant],stoneAssets[variant].material):new THREE.Mesh(nextGeometry,cell.pinned?Array(6).fill(pinnedMaterial):[...materials]);mesh.userData.index=cell.index;mesh.userData.asset=useStones?stoneAssets[variant].id:null;const outline=new THREE.LineSegments(nextEdges,outlineMaterial);outline.visible=false;mesh.add(outline);mesh.userData.outline=outline;return mesh;});
    }catch(error){next?.dispose();nextGeometry?.dispose();nextEdges?.dispose();for(const item of nextStoneGeometries)item.dispose();throw error;}
    model?.dispose();for(const mesh of meshes)scene.remove(mesh);geometry?.dispose();edges?.dispose();for(const item of stoneGeometries)item.dispose();stoneGeometries=nextStoneGeometries;model=next;geometry=nextGeometry;edges=nextEdges;meshes=nextMeshes;scene.add(...meshes);
    if(!floor){floor=new THREE.Mesh(new THREE.PlaneGeometry(22,18),new THREE.MeshStandardMaterial({color:0x33393b,roughness:1}));floor.rotation.x=-Math.PI/2;floor.position.y=model.snapshot().floorY-.003;scene.add(floor);}
    grab=null;contactPointer=null;controls.enabled=true;lastTime=performance.now();if(failurePaused!==null)paused=failurePaused;phase='interactive';failure=null;failurePaused=null;errorNode.textContent='';pauseIcon();synchronize();return true;
  }
  async function advance(count){if(!Number.isInteger(count)||count<0)throw new Error('Advance count must be a nonnegative integer');for(let i=0;i<count;i++){const start=performance.now();if(grab&&mode==='bind')model.bind(grab.index);await model.step();latestStepCost=performance.now()-start;}synchronize();}
  function ray(event){camera.updateMatrixWorld(true);const rect=canvas.getBoundingClientRect();pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);raycaster.setFromCamera(pointer,camera);return raycaster.ray;}
  canvas.addEventListener('pointerdown',act('Grab',event=>{if(event.button!==0)return;ray(event);const hit=raycaster.intersectObjects(meshes,false)[0];lastPick=hit?{index:hit.object.userData.index,point:hit.point.toArray(),screen:{x:event.clientX,y:event.clientY}}:{hit:false,screen:{x:event.clientX,y:event.clientY}};if(!hit)return;
    const cell=model.cells[hit.object.userData.index],local=model.worldToLocalPoint(cell.index,hit.point),faceNormal=useStones?structuralFaceAt(local,cell.half):hit.face.normal;lastPick.eligibility=cell.pinned?'anchored':model.isExposedFace(cell.index,faceNormal)?'surface':'connected-interior';lastPick.asset=hit.object.userData.asset;lastPick.local={x:local.x,y:local.y,z:local.z};lastPick.structuralNormal=faceNormal.toArray();
    event.stopImmediatePropagation();event.preventDefault();controls.enabled=false;canvas.setPointerCapture(event.pointerId);contactPointer=event.pointerId;
    if(lastPick.eligibility!=='surface'){synchronize();return;}
    const normal=new THREE.Vector3();camera.getWorldDirection(normal);
    model.setSurfaceHand(cell.index,hit.point,local,faceNormal);grab={index:cell.index,local,target:hit.point.clone(),plane:new THREE.Plane().setFromNormalAndCoplanarPoint(normal,hit.point),pointerId:event.pointerId,indices:model.snapshot().hand.indices};synchronize();
  }),true);
  canvas.addEventListener('pointermove',act('Drag',event=>{if(!grab||event.pointerId!==grab.pointerId)return;const target=ray(event).intersectPlane(grab.plane,new THREE.Vector3());if(!target)return;grab.target.copy(target);model.moveHand(target);event.stopImmediatePropagation();event.preventDefault();synchronize();}),true);
  function release(event){if(contactPointer===null||event&&event.pointerId!==contactPointer)return;if(grab)model.release();grab=null;contactPointer=null;controls.enabled=true;synchronize();}
  for(const event of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(event,act('Release',release),true);
  for(const name of ['shear','bind'])document.querySelector(`#${name}`).onclick=act('Mode',()=>{release();mode=name;for(const other of ['shear','bind'])document.querySelector(`#${other}`).setAttribute('aria-pressed',String(other===mode));});
  icon(document.querySelector('#reset'),RotateCcw);icon(document.querySelector('#zoom-in'),ZoomIn);icon(document.querySelector('#zoom-out'),ZoomOut);pauseIcon();
  document.querySelector('#pause').onclick=act('Pause',()=>{paused=!paused;lastTime=performance.now();pauseIcon();synchronize();});
  document.querySelector('#reset').onclick=()=>serialize('Reset',rebuild);
  document.querySelector('#strength').onchange=act('Cohesion',()=>{const value=strength();if(value!==null){model.setStrength(value);synchronize();}});
  function zoom(factor){camera.position.sub(controls.target).multiplyScalar(factor).add(controls.target);controls.update();synchronize();}
  document.querySelector('#zoom-in').onclick=act('Zoom',()=>zoom(1/1.2));document.querySelector('#zoom-out').onclick=act('Zoom',()=>zoom(1.2));
  addEventListener('resize',act('Resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);synchronize();}));
  async function frame(now){try{const elapsed=(now-lastTime)/1000;lastTime=now;if(phase==='interactive'){if(!paused&&!document.hidden&&!busy){simulationRate=elapsed>0?model.snapshot().config.timeStep/elapsed:1;await serialize('Simulation',()=>advance(1));}controls.update();synchronize();}}catch{}finally{requestAnimationFrame(frame);}}
  const response=await fetch(profilePath);if(!response.ok)throw new Error(`Profile HTTP ${response.status}`);source=await response.json();profile=coarsenGpuArchProfile(source);
  if(params.has('strength'))document.querySelector('#strength').value=params.get('strength');if(!await rebuild())throw new Error('Initial cohesion is invalid');
  const project=point=>{const p=toThree(point).project(camera);return{x:(p.x+1)*innerWidth/2,y:(1-p.y)*innerHeight/2};};
  function targets(){const result=[];for(const cell of model.cells){if(cell.pinned)continue;for(const normal of [new THREE.Vector3(1,0,0),new THREE.Vector3(-1,0,0),new THREE.Vector3(0,1,0),new THREE.Vector3(0,-1,0),new THREE.Vector3(0,0,1),new THREE.Vector3(0,0,-1)]){if(!model.isExposedFace(cell.index,normal))continue;const point=meshes[cell.index].localToWorld(new THREE.Vector3(normal.x*cell.half.x,normal.y*cell.half.y,normal.z*cell.half.z)),screen=project(point);raycaster.setFromCamera(new THREE.Vector2(screen.x/innerWidth*2-1,1-screen.y/innerHeight*2),camera);const hit=raycaster.intersectObjects(meshes,false)[0];const same=hit?.object.userData.index===cell.index;const face=same&&useStones?structuralFaceAt(model.worldToLocalPoint(cell.index,hit.point),cell.half):null;const visible=same&&(useStones?face.distanceTo(normal)<1e-8:hit.point.distanceTo(point)<.001);const contact=visible?hit.point:point;result.push({index:cell.index,id:cell.id,column:cell.column,row:cell.row,layer:cell.layer,normal:normal.toArray(),world:{x:contact.x,y:contact.y,z:contact.z},screen,visible});}}return result;}
  async function pixels(){
    synchronize();const texture=renderer.backend.context.getCurrentTexture(),width=canvas.width,height=canvas.height,bytesPerRow=Math.ceil(width*4/256)*256;
    const buffer=device.createBuffer({label:'Actual arch presentation pixels',size:bytesPerRow*height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
    try{
      const encoder=device.createCommandEncoder();encoder.copyTextureToBuffer({texture},{buffer,bytesPerRow,rowsPerImage:height},{width,height});device.queue.submit([encoder.finish()]);await buffer.mapAsync(GPUMapMode.READ);
      const bytes=new Uint8Array(buffer.getMappedRange());let bright=0;for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=y*bytesPerRow+x*4;if((bytes[i]+bytes[i+1]+bytes[i+2])/3>110)bright++;}
      return{bright,total:width*height,fraction:bright/(width*height),source:'actual-webgpu-presentation-texture',format:texture.format};
    }finally{buffer.destroy();}
  }
  window.__archCollapse={rendererLifetime:()=>({source:'three-0.183.0-renderer-compute-cache',computePipelines:[...renderer._pipelines.caches.values()].filter(pipeline=>pipeline.isComputePipeline).length,computePrograms:renderer._pipelines.programs.compute.size}),advance:count=>serialize('Advance',()=>advance(count)),reset:()=>serialize('Reset',rebuild),release:()=>{release();model.release();synchronize();},projectWorld:project,bind:index=>model.bind(index),
    witness:()=>{const surfaces=targets();return{phase,failure,failures:[...failures],identity,route:ARCH_GPU_ROUTE,effectiveUrl:location.href,profilePath,constructionSource:profile.constructionSource,source:source.source,visual:{route:useStones?'handy-weathered-stone-v1':'box-baseline',assets:stoneAssets.map(({id,sha256,bytes,triangles})=>({id,sha256,bytes,triangles})),bodies:meshes.map(mesh=>({index:mesh.userData.index,asset:mesh.userData.asset})),triangles:meshes.reduce((sum,mesh)=>sum+(mesh.geometry.index?.count??mesh.geometry.attributes.position.count)/3,0)},viewport:{width:innerWidth,height:innerHeight},paused,mode,lastPick,contactPointer,camera:{position:camera.position.toArray(),quaternion:camera.quaternion.toArray()},state:model.snapshot(),rendererPoses:meshes.map(mesh=>({index:mesh.userData.index,position:mesh.position.toArray(),quaternion:mesh.quaternion.toArray()})),surfaceTargets:surfaces,pickTargets:surfaces.filter(item=>item.layer===2&&item.normal[2]===1)};},pixels};
  requestAnimationFrame(frame);
}catch(error){fail('Startup',error);window.__archCollapse={witness:()=>({phase,failure,failures:[...failures],route:ARCH_GPU_ROUTE,effectiveUrl:location.href,identity,state:model?.snapshot()??null})};}
