import {Group,MeshStandardMaterial,MeshBasicMaterial,Mesh,SphereGeometry,Vector3,Box3,Color} from '../lib/three.core.js';
import {shapeHierarchyView} from '../fracture-shape-partition.mjs';
import {collectFractureSurface,createCoarseSurfaceMesh} from '../fracture-coarse-surface.mjs';
import {createCoarseFractureDynamics} from '../fracture-coarse-dynamics.mjs';

export default {
 id:'fracture-coarse',title:'Fracture · coarse material',
 async create({host,inputs,record,updateInputs=()=>{}}){
  if(typeof inputs.source!=='string'||!inputs.source)throw Error('Choose a source mesh');
  const session=await host.scene.open(),workers=new Set(),workerCalls=new Map(),drags=[],owned=new Group(),tints=[];
  owned.name='Fracturable material';
  let disposed=false,model,prepared,surface,asset,view,meshes=[],busy=true,error='',running=true,stepping=false,stepFinished=Promise.resolve(),generation=0,workerId=0,unframe,undrag,grip=null,selectedCell=null,status,marker,playButton,strengthInput,separationInput,inspectInput,inspectParts=false,separation=0,strength=Number(inputs.strength??1000000),lastEpoch=-1;
  const capMaterial=new MeshStandardMaterial({color:0xa57850,roughness:1});
  function callWorker(file,data){return new Promise((resolve,reject)=>{const worker=new Worker(new URL(file,import.meta.url),{type:'module'}),id=++workerId;workers.add(worker);workerCalls.set(worker,reject);const finish=()=>{workers.delete(worker);workerCalls.delete(worker);worker.terminate();};worker.onmessage=({data})=>{finish();data.error?reject(Error(data.error)):resolve(data);};worker.onerror=e=>{finish();reject(Error(e.message));};worker.postMessage({id,...data});});}
  const event=(kind,value)=>record({kind:`fracture-coarse:${kind}`,value});
  const read=()=>({route:'kaminos.fracture.whole-object-direct-grab.v1',source:inputs.source,busy,error,running,strength,inspectParts,separation,selectedCell,
   parts:view?.parts.map(p=>({id:p.id,triangles:p.triangles,areaFraction:p.areaFraction})),
   prepared:prepared?{route:prepared.route,receipt:prepared.receipt,cells:prepared.cells.length,bonds:prepared.bonds.length,internalBonds:prepared.bonds.filter(b=>b.kind==='internal').length,attachmentBonds:prepared.bonds.filter(b=>b.kind!=='internal').length}:null,
   material:model?.snapshot()??null,visibleCapTriangles:meshes.reduce((s,m)=>s+(m.userData.visibleCapTriangles??0),0),setup:{...inputs,strength},
   claim:'Whole detected object with breakable coarse material and direct surface grabbing; detailed original exterior retained, approximate mass/inertia and floor collisions'});
  function sync(){if(status){const s=model?.snapshot();status.textContent=busy?'Preparing all material…':error||`${view.parts.length} detected parts · ${prepared.cells.length} live material cells\n${s.broken} broken connections · ${s.components.length} separate bodies\n${grip?'Dragging material':inspectParts?'Inspecting all detected parts':'Drag the surface to pull; release to let go.'}`;}
   if(playButton)playButton.textContent=running?'Pause':'Play';if(inspectInput)inspectInput.checked=inspectParts;
   for(const [input,value]of [[strengthInput,strength],[separationInput,separation]])if(input&&input.ownerDocument.activeElement!==input)input.value=String(value);
  }
  function draw(){if(!model||disposed)return;const state=model.snapshot(),alive=new Map(state.bonds.map(b=>[b.id,b.alive]));
   const interfaceAlive=new Map();for(const b of prepared.bonds)if(b.interfaceId!==null)interfaceAlive.set(b.interfaceId,(interfaceAlive.get(b.interfaceId)??false)||alive.get(b.id));
   for(let i=0;i<meshes.length;i++){
    const b=state.bodies[i],m=meshes[i],piece=prepared.pieces[i];m.position.set(b.position.x,b.position.y,b.position.z);m.quaternion.set(b.quaternion.x,b.quaternion.y,b.quaternion.z,b.quaternion.w);
    if(inspectParts){const p=view.parts.find(p=>p.id===piece.part),offset=new Vector3(...p.center).sub(objectCenter);if(offset.lengthSq()<1e-12)offset.set(0,1,0);m.position.addScaledVector(offset,separation*2);}
    m.material=inspectParts?m.userData.tinted:m.userData.original;
    if(lastEpoch!==state.connectivityEpoch){const indices=[],materials=[],source=piece.arrays;let visibleCaps=0;
     for(let f=0;f<piece.faceInterfaces.length;f++){const id=Math.abs(piece.faceInterfaces[f]);if(id&&state.bonds[piece.faceBonds[f]]?.alive!==false)continue;if(id)visibleCaps++;indices.push(...source.indices.subarray(f*3,f*3+3));materials.push(source.faceMaterial[f]);}
     m.geometry.setIndex(indices);m.geometry.clearGroups();let previous=-1,start=0;for(let f=0;f<=materials.length;f++){const current=f<materials.length?materials[f]:-1;if(current!==previous){if(previous>=0)m.geometry.addGroup(start*3,(f-start)*3,previous);start=f;previous=current;}}
     m.userData.visibleCapTriangles=visibleCaps;
    }
   }
   lastEpoch=state.connectivityEpoch;marker.visible=Boolean(grip);if(grip)marker.position.copy(new Vector3(...grip.local).applyQuaternion(meshes[grip.index].quaternion).add(meshes[grip.index].position));
   owned.updateMatrixWorld(true);session.redraw();sync();
  }
  function release(){model?.release();grip=null;draw();event('release',null);}
  async function advance(count=1){if(!Number.isSafeInteger(count)||count<1)throw Error('Positive physical step count required');if(busy||stepping||!model)throw Error('Material is busy');stepping=true;let finish;stepFinished=new Promise(r=>{finish=r;});try{for(let i=0;i<count;i++){if(disposed)break;await model.step();}draw();return read();}catch(e){running=false;error=e.message;sync();throw e;}finally{stepping=false;finish();}}
  function grab({index,point,normal=[0,1,0]}){
   if(busy||!model||inspectParts)return false;if(!Number.isInteger(index)||!meshes[index])throw Error('Grab requires a current material cell');
   const s=model.snapshot();if(s.bodies[index].pinned)return false;
   const target=new Vector3(...point),local=model.worldToLocalPoint(index,target);model.setSurfaceHand(index,target,local,new Vector3(...normal),'embedded-visual');
   grip={index,local:local.toArray()};selectedCell=index;running=true;draw();event('grab',{index,point,normal});return true;
  }
  function move(point){model.moveHand(new Vector3(...point));draw();event('drag',point);return read();}
  const clearMeshes=()=>{for(const m of meshes){owned.remove(m);m.geometry.dispose();}meshes=[];for(const m of tints)m.dispose();tints.length=0;};
  async function reset(){const token=++generation;busy=true;running=false;release();sync();try{await stepFinished;const candidate=await createCoarseFractureDynamics({...prepared,config:{...prepared.config,strength}},host.scene.renderer());if(disposed||token!==generation){candidate.dispose();return read();}model?.dispose();model=candidate;clearMeshes();
    const materials=[...surface.materials];materials[prepared.capMaterial]=capMaterial;
    meshes=prepared.pieces.map((p,index)=>{const m=createCoarseSurfaceMesh(p.arrays,materials,p.center);m.name=`Material ${index+1} · part ${p.part+1}`;m.userData.materialCell=index;m.userData.original=materials;
     const color=new Color().setHSL((p.part*.61803398875)%1,.5,.6),tinted=materials.map(material=>{const tint=material.clone();tint.color?.multiply(color);tints.push(tint);return tint;});tinted[prepared.capMaterial]=capMaterial;m.userData.tinted=tinted;owned.add(m);return m;});
    lastEpoch=-1;grip=null;selectedCell=null;busy=false;running=false;error='';draw();event('reset',{cells:prepared.cells.length,bonds:prepared.bonds.length});return read();
   }catch(e){busy=false;error=e.message;sync();throw e;}}
  let objectCenter;
  try{
   asset=await session.loadAsset({url:inputs.source,normalize:false,metadata:{label:'Fracturable object',source:inputs.source}});surface=collectFractureSurface(asset.root);asset.root.add(owned);
   const result=await callWorker('../fracture-shape-partition.worker.mjs',{geometry:{positions:surface.arrays.positions,indices:surface.arrays.indices},settings:{method:'geodesic-neck',minReachFraction:inputs.minReachFraction??.001,minAreaFraction:inputs.minAreaFraction??.0001,cleanupAreaFraction:inputs.cleanupAreaFraction??.0001,maxCutRatio:4,fixedCuts:inputs.fixedCuts??[]}});
   view=shapeHierarchyView(result.result,inputs.detailLevel??1,inputs.localDetail??{});
   prepared=(await callWorker('../fracture-whole.worker.mjs',{arrays:surface.arrays,view,options:{strength,cellExtent:inputs.cellExtent,gravity:inputs.gravity??9.81}})).prepared;
   surface.meshes.forEach(m=>{m.visible=false;});const bounds=new Box3().setFromArray(surface.arrays.positions);objectCenter=bounds.getCenter(new Vector3());const size=bounds.getSize(new Vector3()).length();
   marker=new Mesh(new SphereGeometry(size*.006,12,8),new MeshBasicMaterial({color:0xe59b3a,depthTest:false}));marker.name='Hand contact';marker.renderOrder=10;marker.visible=false;owned.add(marker);
   asset.root.position.y+=(host.scene.ground?.().height??0)-prepared.floorY;await reset();
   const frame=()=>{owned.updateWorldMatrix(true,true);const b=new Box3().setFromObject(owned),c=b.getCenter(new Vector3()),r=b.getSize(new Vector3()).length();return session.setView({position:c.clone().add(new Vector3(1,.65,1.4).normalize().multiplyScalar(r*1.5)).toArray(),target:c.toArray()});};frame();
   undrag=session.onSurfaceDrag(hit=>{
    if(disposed||busy)return false;const index=hit.object.userData.materialCell;if(!Number.isInteger(index))return false;
    if(hit.phase==='start'){const p=asset.root.worldToLocal(new Vector3(...hit.point));return grab({index,point:p.toArray(),normal:hit.normal});}
    if(hit.phase==='move'&&grip){move(asset.root.worldToLocal(new Vector3(...hit.point)).toArray());return true;}
    if(hit.phase==='end'||hit.phase==='cancel'){release();return true;}return false;
   });
   unframe=session.onFrame(()=>{if(running&&!inspectParts&&!busy&&!stepping&&!disposed)void advance().catch(()=>{});});
   const operations={reset,advance,pause:async()=>{running=false;await stepFinished;sync();return read();},play:()=>{inspectParts=false;running=true;sync();return read();},grab,move,release:()=>{release();return read();},
    strength:value=>{if(!(value>0&&Number.isFinite(value)))throw Error('Positive finite cohesion required');model.setStrength(value);strength=value;updateInputs({...inputs,strength});sync();return read();},
    inspect:value=>{release();inspectParts=Boolean(value);running=!inspectParts;draw();return read();},separation:value=>{if(!Number.isFinite(value)||value<0)throw Error('Nonnegative separation required');separation=value;inspectParts=value>0;running=!inspectParts;release();draw();return read();},frame,
    view:()=>session.readView(),contacts:()=>meshes.flatMap((mesh,index)=>{const a=prepared.pieces[index].arrays,candidates=[];for(let f=0;f<a.indices.length/3;f++){if(prepared.pieces[index].faceInterfaces[f])continue;const ids=Array.from(a.indices.subarray(f*3,f*3+3)),points=ids.map(i=>new Vector3(...a.positions.subarray(i*3,i*3+3))),normal=points[1].clone().sub(points[0]).cross(points[2].clone().sub(points[0])),area=normal.length()/2;const local=points[0].clone().add(points[1]).add(points[2]).multiplyScalar(1/3).sub(new Vector3(...prepared.pieces[index].center));candidates.push({index,area,point:mesh.localToWorld(local).toArray(),normal:normal.normalize().toArray()});}return candidates.sort((a,b)=>b.area-a.area);}),
    export:()=>({...read(),preparation:prepared})};
   return {read,operations,mount({root,document,invoke}){
    const p=document.createElement('p');p.textContent='Grab the surface and drag to pull material apart. Release to let go, then grab another piece to keep breaking it. The base is held.';root.append(p);
    const run=(name,value)=>invoke(name,value).catch(e=>{error=e.message;sync();});
    function label(title,element){const l=document.createElement('label'),s=document.createElement('span');s.textContent=title;l.style.cssText='display:grid;gap:6px;margin:12px 0';l.append(s,element);root.append(l);return s;}
    function number(title,value,min,step,operation){const input=document.createElement('input');Object.assign(input,{type:'number',className:'transform-input',value:String(value),step:'any',min:String(min)});input.setAttribute('aria-label',title);const grip=label(title,input);drags.push(host.controls.installNumberDrag({input,grip,step,dragStep:step}));input.addEventListener('input',()=>{const n=Number(input.value);if(input.value.trim()&&Number.isFinite(n)&&n>=min)run(operation,n);});input.addEventListener('blur',sync);return input;}
    strengthInput=number('Cohesion',strength,Number.MIN_VALUE,1000,'strength');
    inspectInput=document.createElement('input');inspectInput.type='checkbox';inspectInput.addEventListener('change',()=>run('inspect',inspectInput.checked));label('Show detected parts',inspectInput);
    separationInput=number('Separate parts for inspection',0,0,.01,'separation');
    function button(text,operation){const b=document.createElement('button');b.textContent=text;b.addEventListener('click',()=>run(typeof operation==='function'?operation():operation));root.append(b);return b;}
    playButton=button('Pause',()=>running?'pause':'play');button('Reset fracture','reset');button('Frame object','frame');status=document.createElement('p');status.setAttribute('role','status');status.style.whiteSpace='pre-line';root.append(status);sync();
   },async dispose(){if(disposed)return;running=false;generation++;undrag?.();disposed=true;unframe?.();for(const w of workers){w.terminate();workerCalls.get(w)?.(Error('Fracture closed'));}workers.clear();drags.forEach(d=>d.dispose());await stepFinished;model?.dispose();clearMeshes();owned.remove(marker);marker.geometry.dispose();marker.material.dispose();capMaterial.dispose();await session.dispose();}};
  }catch(e){disposed=true;workers.forEach(w=>w.terminate());model?.dispose();clearMeshes();capMaterial.dispose();await session.dispose();throw e;}
 },
};
