import * as THREE from '../lib/three.webgpu.js';
import {makeEarthState,packMaterial,refineMaterial} from '../earth-gpu/material.mjs';
import {createEarthGpuSolver} from '../earth-gpu/solver.mjs';
import {createEarthGpuView} from '../earth-gpu/view.mjs';
export default {id:'earth-gpu',title:'Live grains and yielding earth',async create({host,inputs={},record}){
 const session=await host.scene.open(),renderer=host.scene.renderer(),device=renderer.backend.device;
 let state=makeEarthState({count:inputs.count??32768,clods:inputs.clods??4,materialLevels:inputs.materialLevels??1}),view,solver,paused=inputs.paused??false,disposed=false,busy=false,failure=null,frames=0,buttons,status,stop;
 const root=new THREE.Group();root.name='Live granular earth';root.scale.setScalar(100);let asset,toolAsset;
 const tray=new THREE.Mesh(new THREE.BoxGeometry(state.width,.0003,state.depth),new THREE.MeshStandardMaterial({color:0x39352f,roughness:.85}));tray.position.y=-.00015;root.add(tray);
 const tool=new THREE.Mesh(new THREE.SphereGeometry(.23,32,24),new THREE.MeshStandardMaterial({color:0x93b5bb,roughness:.2,transparent:true,opacity:.3,depthWrite:false}));tool.name='Earth forming tool';tool.position.set(.42,.85,.32);
 const physicalTool=()=>{root.updateMatrixWorld(true);tool.updateMatrixWorld(true);const center=root.worldToLocal(tool.getWorldPosition(new THREE.Vector3()));const scale=tool.getWorldScale(new THREE.Vector3()).x/root.getWorldScale(new THREE.Vector3()).x;return {position:center.toArray(),radius:.23*scale};};
 async function build(next){let v,s;try{v=createEarthGpuView(renderer,next);s=await createEarthGpuSolver({device,state:next,bodyBuffer:v.bodyBuffer,iterations:inputs.iterations??6,dt:inputs.dt??1/480});}catch(e){s?.dispose();v?.dispose();throw e;}const oldV=view,oldS=solver;state=next;view=v;solver=s;root.add(view.group);oldS?.dispose();oldV?.dispose();}
 const read=()=>({schema:'kaminos.live-earth.v1',source:'live GPU physical state',objectId:asset?.id,toolId:toolAsset?.id,paused,busy,failure,frames,solver:solver?.read(),surface:view?.read(),limits:'Exploratory isochoric yielding element network, not calibrated clay, crust formation or a completed soil generator.',displayUnitsPerMetre:100,tool:physicalTool(),view:session.readView()});
 function update(){if(!status)return;const s=solver?.read();status.textContent=failure?failure:busy?'Refining worked material…':`${s.grains.toLocaleString()} rigid grains · ${s.materialPoints.toLocaleString()} material points · ${s.tetrahedra.toLocaleString()} elements · ${s.steps} steps${paused?' · paused':''}`;buttons.pause.textContent=paused?'Play':'Pause';buttons.refine.disabled=busy;}
 const operations={
  pause(value){if(typeof value!=='boolean')throw Error('Boolean pause state required');paused=value;update();record({kind:'earth.pause',value});return read();},
  tool({position,radius}={}){if(position&&(!Array.isArray(position)||position.length!==3||!position.every(Number.isFinite)))throw Error('Finite tool position in specimen metres required');if(radius!==undefined&&!(radius>0&&Number.isFinite(radius)))throw Error('Positive tool radius required');if(position){root.updateMatrixWorld(true);tool.position.copy(root.localToWorld(new THREE.Vector3(...position)));}if(radius!==undefined)tool.scale.setScalar(radius*100/.23);host.scene.refreshPresentation(toolAsset);record({kind:'earth.tool',effective:physicalTool()});return read();},
  async advance({steps=1}={}){if(busy)throw Error('Refinement in progress');await solver.wait();if(!solver.advance({steps,tool:physicalTool()}))throw Error('Earth solver has pending physical work');await solver.wait();session.redraw();update();return read();},
  async snapshot(){const current=await solver.capture();return {schema:'kaminos.live-earth.snapshot.v1',...current,floats:Array.from(current.floats),tets:Array.from(current.tets),triangles:Array.from(current.triangles),ties:Array.from(current.ties),solver:solver.read()};},
  async refine({group,all=false}={}){
   if(busy)throw Error('Refinement already in progress');busy=true;update();const wasPaused=paused;paused=true;
   try{const current=await solver.capture(),t=physicalTool(),selected=new Set();for(const [i,tet]of current.material.tets.entries()){const center=[0,1,2].map(k=>tet.ids.reduce((s,id)=>s+current.material.nodes[id].p[k],0)/4);if(all||group!==undefined&&tet.group===group||group===undefined&&Math.hypot(...center.map((v,k)=>v-t.position[k]))<t.radius*2)selected.add(i);}
    if(!selected.size)throw Error('Move the forming tool close to a clay-rich body before refining it');
    current.material=refineMaterial(current.material,selected);const next=packMaterial(current);await build(next);host.scene.refreshPresentation(asset);record({kind:'earth.refine',selectedTetrahedra:selected.size,generation:next.material.generation,materialPoints:next.material.nodes.length});session.redraw();
   }finally{paused=wasPaused;busy=false;update();}return read();
  },
  frame(){session.setView({position:[2.4,2.2,2.8],target:[0,.12,0],fov:38});return read();}
 };
 try{
  await build(state);asset=await session.attach(root,{owned:true,metadata:{label:root.name,source:'kaminos:live-gpu-earth',type:'experiment'}});toolAsset=await session.attach(tool,{owned:true,metadata:{label:tool.name,source:'kaminos:earth-forming-tool',type:'experiment'}});operations.frame();
  stop=session.onFrame(()=>{if(disposed||busy)return;try{if(!paused)solver.advance({steps:2,tool:physicalTool()});frames++;if(frames%12===0)update();session.redraw();}catch(e){failure=e.message;paused=true;update();}});
  return {read,operations,mount({document}){
   const css=document.createElement('style');css.textContent='body.earth-gpu-study{grid-template-columns:0 minmax(0,1fr) 316px!important}body.earth-gpu-study #experiment-instruments{display:none!important}.earth-gpu-tools{position:absolute;bottom:58px;left:20px;z-index:40;color:#eee;background:#24271fe8;padding:12px 15px;border-radius:9px;max-width:650px;font:13px system-ui}.earth-gpu-tools button{margin:0 8px 8px 0;padding:7px 14px}.earth-gpu-tools p{margin:5px 0}';document.head.append(css);document.body.classList.add('earth-gpu-study');
   const layer=document.createElement('div');layer.className='earth-gpu-tools';buttons={};for(const [key,label,action]of [['pause','Pause',()=>operations.pause(!paused)],['refine','Refine near tool',()=>operations.refine()]]){const b=document.createElement('button');b.textContent=label;b.onclick=()=>Promise.resolve().then(action).catch(e=>{status.textContent=e.message;});buttons[key]=b;layer.append(b);}status=document.createElement('p');const hint=document.createElement('p');hint.textContent='Select the translucent forming tool and move it with the native gizmo. Refinement preserves the worked material.';layer.append(status,hint);document.getElementById('viewport').append(layer);update();this.cleanupUI=()=>{layer.remove();css.remove();document.body.classList.remove('earth-gpu-study');};
  },async dispose(){disposed=true;stop?.();this.cleanupUI?.();await device.queue.onSubmittedWorkDone();solver?.dispose();view?.dispose();tray.geometry.dispose();tray.material.dispose();tool.geometry.dispose();tool.material.dispose();await session.dispose();}};
 }catch(e){disposed=true;stop?.();solver?.dispose();view?.dispose();await session.dispose();throw e;}
}};
