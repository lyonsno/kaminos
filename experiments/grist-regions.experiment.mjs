import * as THREE from '../lib/three.webgpu.js';
import {makeRegionState,regionSummary} from '../earth-gpu/regions.mjs';
import {createRegionSolver} from '../earth-gpu/region-solver.mjs';
import {createPacketView} from '../earth-gpu/packet-view.mjs';
export default {id:'grist-regions',title:'Grist — two connected material regions',create:createGristRegions};

export async function createGristRegions({host,inputs={},record},{slab=false}={}){
 const size=slab?(inputs.slabSize??3):null;
 const state=makeRegionState({slabSize:size,notch:inputs.notch??true,
  samplesPerRegion:inputs.samplesPerRegion??1536,gritCount:inputs.gritCount??(slab?12*size**2:24)});
 const population={...regionSummary(state),grit:state.mineralCount};
 const source=slab?'grist-peel':'grist-regions';
 const width=state.width*100,depth=state.depth*100;
 const footprint=slab?Math.max(width,depth)/2.6:1;
 const session=await host.scene.open(),renderer=host.scene.renderer(),device=renderer.backend.device;
 let solver,view,stop,paused=inputs.paused??false,disposed=false,failure=null,ui,css,uiDocument,status,disposeDrag,frames=0;
 const root=new THREE.Group();root.name=slab?'Peelable material slab':'Two connected material regions';root.scale.setScalar(100);
 const tool=new THREE.Mesh(new THREE.SphereGeometry(.22,24,16),new THREE.MeshStandardMaterial({color:0x9abbb7,roughness:.3,transparent:true,opacity:.28,depthWrite:false}));tool.name='Forming tool — move to press and drag';tool.position.set(0,.94,.25);
 if(slab)tool.position.set(size*state.patchPitch[0]*40,1.05,-size*state.patchPitch[1]*39);
 const grip=new THREE.Group();grip.name='Right grip — move to pull the connection';grip.position.set(.75,.34,0);
 if(slab)grip.position.set(size*state.patchPitch[0]*50,.34,-(size-1)*state.patchPitch[1]*50);
 const jawMaterial=new THREE.MeshStandardMaterial({color:0x536961,metalness:.3,roughness:.5});
 for(const z of [-.39,.39]){const jaw=new THREE.Mesh(new THREE.BoxGeometry(.12,.22,.07),jawMaterial);jaw.position.z=z;grip.add(jaw);}const handle=new THREE.Mesh(new THREE.BoxGeometry(.12,.07,.85),jawMaterial);handle.position.y=.12;grip.add(handle);
 const gripStart=grip.position.clone(),tray=new THREE.Mesh(new THREE.BoxGeometry(width,.03,depth),new THREE.MeshStandardMaterial({color:0x47413a,roughness:.9}));tray.position.y=-.025;
 const hold=new THREE.Mesh(new THREE.BoxGeometry(.13,.13,slab?size*state.patchPitch[1]*100:.85),jawMaterial);hold.name='Fixed left edge';hold.position.set(slab?-size*state.patchPitch[0]*50:-.75,.03,0);
 let toolAsset,gripAsset;
 const toolPose=()=>{root.updateMatrixWorld(true);tool.updateMatrixWorld(true);const p=root.worldToLocal(tool.getWorldPosition(new THREE.Vector3())),s=tool.getWorldScale(new THREE.Vector3()).x/root.getWorldScale(new THREE.Vector3()).x;return {position:p.toArray(),radius:.22*s};};
 const gripDelta=()=>grip.position.clone().sub(gripStart).multiplyScalar(.01).toArray();
 const read=()=>({route:slab?'grist/peelable-slab':'grist/two-fixed-local-lattices',paused,failure,solver:solver?.read(),population,
  slabSize:size,notch:slab?state.notch:null,tool:toolPose(),gripDelta:gripDelta(),
  limits:slab?'Breakable patch boundaries; each patch retains its own material history.':'Fixed two-region yielding-lattice surrogate; fine particles have compliant local response.',
  adapter:renderer.backend.adapter?.info??device.adapterInfo??null});
 function update(){if(status)status.textContent=failure??(slab?'Move the corner grip to peel. The far edge is held.':'Left edge held · select the right grip to pull, or the translucent tool to press');}
 const ops={pause(value){if(typeof value!=='boolean')throw Error('Boolean pause required');paused=value;record({kind:'grist.pause',value});update();return read();},connection(value){solver.control({strength:value});record({kind:'grist.connection',value});return read();},tool({position,radius}={}){if(position){if(position.length!==3||!position.every(Number.isFinite))throw Error('Finite tool position required');tool.position.fromArray(position.map(x=>x*100));}if(radius!==undefined){if(!(radius>0&&Number.isFinite(radius)))throw Error('Positive radius required');tool.scale.setScalar(radius*100/.22);}host.scene.refreshPresentation(toolAsset);record({kind:'grist.tool',value:toolPose()});return read();},grip(value){if(value.length!==3||!value.every(Number.isFinite))throw Error('Finite grip displacement required');grip.position.copy(gripStart).add(new THREE.Vector3(...value).multiplyScalar(100));host.scene.refreshPresentation(gripAsset);record({kind:'grist.grip',value});return read();},async advance({steps=1}={}){await solver.wait();solver.control({gripDelta:gripDelta()});if(!solver.advance({steps,tool:toolPose()}))throw Error('Material step not admitted');await solver.wait();session.redraw();return read();},async snapshot(){const s=await solver.capture(),connections=await solver.connectionState();return {...s,floats:Array.from(s.floats),tets:Array.from(s.tets),triangles:Array.from(s.triangles),ties:Array.from(s.ties),linkWords:Array.from(s.linkWords),connections,solver:solver.read()};},frame(){session.setView({position:[2.5*footprint,1.9*footprint,3.1*footprint],target:[0,.22,0],fov:35});return read();}};
 try{
  view=createPacketView(renderer,{...state,grainCount:state.mineralCount,packetCount:state.sampleCount});root.add(view.group);
  solver=await createRegionSolver({device,state,bodyBuffer:view.bodyBuffer,iterations:6,dt:1/480});
  await session.attach(root,{owned:true,metadata:{label:root.name,source:'kaminos:'+source,type:'experiment'}});await session.attach(tray,{owned:true,metadata:{label:'Material tray',source:'kaminos:grist-tray',type:'experiment'}});await session.attach(hold,{owned:true,metadata:{label:hold.name,source:'kaminos:grist-hold',type:'experiment'}});
  toolAsset=await session.attach(tool,{owned:true,metadata:{label:tool.name,source:'kaminos:grist-forming-tool',type:'experiment'}});gripAsset=await session.attach(grip,{owned:true,metadata:{label:grip.name,source:'kaminos:grist-grip',type:'experiment'}});ops.frame();
  stop=session.onFrame(()=>{if(disposed)return;try{if(!paused){solver.control({gripDelta:gripDelta()});solver.advance({steps:2,tool:toolPose()});session.redraw();}if(++frames%15===0)update();const f=solver.read().failure;if(f){failure=f;paused=true;update();}}catch(e){failure=e.message;paused=true;update();}});
  return {read,operations:ops,mount({document}){uiDocument=document;css=document.createElement('style');css.textContent='body.grist-region-study{grid-template-columns:0 minmax(0,1fr) 316px!important}body.grist-region-study #experiment-instruments{display:none!important}.grist-region-tools{position:absolute;bottom:85px;left:18px;z-index:40;color:#eee;background:#24271fdc;padding:9px 12px;border-radius:9px;font:13px system-ui;max-width:600px}.grist-region-tools button{margin-right:12px;padding:5px 9px}.grist-region-tools input{width:64px;margin:0 8px}.grist-region-tools p{margin:7px 0 0;line-height:1.35}';document.head.append(css);document.body.classList.add('grist-region-study');ui=document.createElement('div');ui.className='grist-region-tools';const play=document.createElement('button');play.textContent=paused?'Play':'Pause';play.onclick=()=>{ops.pause(!paused);play.textContent=paused?'Play':'Pause';};ui.append(play);const reset=document.createElement('button');reset.textContent='Start again';reset.onclick=()=>{location.reload();};ui.append(reset);
  if(slab){
   const label=document.createElement('label');
   label.textContent='Slab ';
   const select=document.createElement('select');
   select.setAttribute('aria-label','Slab size');
   for(const n of new Set([3,5,10,20,size])){
    select.add(new Option(n+' × '+n,n,false,n===size));
   }
   select.onchange=()=>{
    const url=new URL(location.href);
    url.searchParams.set('experiment_inputs',JSON.stringify({...inputs,slabSize:Number(select.value),paused:true}));
    location.assign(url);
   };
   label.append(select);
   ui.append(label);
  }
  const label=document.createElement('label');label.textContent='Connection ';const input=document.createElement('input');input.type='number';input.min='0';input.max='1';input.step='.05';input.value='1';input.setAttribute('aria-label','Connection strength');input.oninput=()=>{const x=Number(input.value);if(Number.isFinite(x)&&x>=0&&x<=1)ops.connection(x);};label.append(input);ui.append(label);disposeDrag=host.controls.installNumberDrag?.({input,grip:label,step:.05});status=document.createElement('p');ui.append(status);document.getElementById('viewport').append(ui);update();},async dispose(){disposed=true;stop?.();disposeDrag?.dispose();ui?.remove();css?.remove();uiDocument?.body.classList.remove('grist-region-study');await solver?.wait();solver?.dispose();view?.dispose();tool.geometry.dispose();tool.material.dispose();tray.geometry.dispose();tray.material.dispose();jawMaterial.dispose();grip.traverse(o=>o.geometry?.dispose());hold.geometry.dispose();await session.dispose();}};
 }catch(e){disposed=true;stop?.();solver?.dispose();view?.dispose();await session.dispose();throw e;}
}
