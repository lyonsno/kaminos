import {Group,MeshStandardMaterial,Mesh,SphereGeometry,Vector3,Box3} from '../lib/three.core.js';
import {shapeHierarchyView} from '../fracture-shape-partition.mjs';
import {collectFractureSurface,createCoarseSurfaceMesh,coarseFixture} from '../fracture-coarse-surface.mjs';
import {createCoarseFractureDynamics} from '../fracture-coarse-dynamics.mjs';

export default {
 id:'fracture-coarse',title:'Fracture · coarse material',
 async create({host,inputs,record,updateInputs=()=>{}}){
  if(typeof inputs.source!=='string'||!inputs.source)throw Error('Choose a source mesh');
  const session=await host.scene.open(),workers=new Set(),drags=[],owned=new Group();owned.name='Coarse fracture';
  let disposed=false,model=null,prepared=null,preparedPart=null,selectedPart=0,busy=true,error='',running=false,stepping=false,stepFinished=Promise.resolve(),generation=0,workerId=0,partition,view,surface,asset,meshes=[],restMesh,partSelect,status,pullInput,strengthInput,playButton,prepareButton,marker,grip=null,pullPercent=0,strength=Number(inputs.strength??200),unpick,unframe;
  const capMaterial=new MeshStandardMaterial({color:0xa57850,roughness:1});
  const workerCalls=new Map();
  function callWorker(file,data){return new Promise((resolve,reject)=>{const worker=new Worker(new URL(file,import.meta.url),{type:'module'}),id=++workerId;workers.add(worker);workerCalls.set(worker,reject);const finish=()=>{workers.delete(worker);workerCalls.delete(worker);worker.terminate();};worker.onmessage=({data})=>{finish();data.error?reject(Error(data.error)):resolve(data);};worker.onerror=e=>{finish();reject(Error(e.message));};worker.postMessage({id,...data});});}
  const read=()=>({route:'kaminos.fracture.preserved-exterior-coarse-material.v1',source:inputs.source,busy,error,selectedPart,preparedPart,parts:view?.parts.map(p=>({id:p.id,triangles:p.triangles,areaFraction:p.areaFraction,nodeId:p.nodeId})),pullPercent,strength,running,prepared:prepared?{route:prepared.route,plane:prepared.plane,interface:prepared.interface,receipt:prepared.receipt,pieces:prepared.pieces.map(p=>({side:p.side,triangles:p.arrays.indices.length/3,capFaces:p.capFaces,volume:p.volume}))}:null,material:model?.snapshot()??null,visibleCapTriangles:prepared&&model?.snapshot().broken?prepared.pieces.reduce((s,p)=>s+p.capFaces,0):0,setup:{...inputs,strength},claim:'Supported pull on two coarse cohesive rigid chunks inside one detected part; original textured exterior retained, approximate section mass, no fragment collisions or calibrated material'});
  const event=(kind,value)=>{record({kind:`fracture-coarse:${kind}`,value});return read();};
  function sync(){if(status){const s=model?.snapshot();status.textContent=busy?'Preparing coarse material…':error||`${surface.arrays.indices.length/3} source triangles · ${view.parts.length} detected pieces\n${s?.broken?'Interface fractured; new interior exposed.':'Interface intact; one side supported.'}\n${s?.bonds[0]?.stress?.toFixed(2)??0} interface stress · ${s?.step??0} physical steps`;}
   if(partSelect)partSelect.value=String(selectedPart);if(prepareButton)prepareButton.disabled=busy;if(playButton)playButton.textContent=running?'Pause':'Play';if(pullInput)pullInput.disabled=busy||selectedPart!==preparedPart;
   for(const [input,value]of [[pullInput,pullPercent],[strengthInput,strength]])if(input&&input.ownerDocument.activeElement!==input)input.value=String(value);
  }
  function draw(){if(!model)return;const state=model.snapshot();for(let i=0;i<meshes.length;i++){const b=state.bodies[i],m=meshes[i];m.position.set(b.position.x,b.position.y,b.position.z);m.quaternion.set(b.quaternion.x,b.quaternion.y,b.quaternion.z,b.quaternion.w);m.geometry.setDrawRange(0,state.broken?Infinity:(prepared.pieces[i].arrays.indices.length-prepared.pieces[i].capFaces*3));}
   if(grip){const b=state.bodies[1],p=new Vector3(...grip.local).applyQuaternion(meshes[1].quaternion).add(meshes[1].position);marker.position.copy(p);marker.visible=true;}
   session.redraw();sync();
  }
  const clearMeshes=()=>{for(const m of [...meshes,restMesh].filter(Boolean)){owned.remove(m);m.geometry.dispose();}meshes=[];restMesh=null;};
  async function prepare(part=selectedPart,{reuse=false}={}){
   if(!Number.isInteger(part)||!view.parts[part])throw Error('Choose a visible detected piece');const token=++generation;running=false;busy=true;error='';sync();
   try{
    await stepFinished;
    const faces=Array.from(view.labels,(_,f)=>f).filter(f=>view.labels[f]===part),next=reuse&&part===preparedPart&&prepared?prepared:(await callWorker('../fracture-coarse.worker.mjs',{arrays:surface.arrays,faces,options:inputs.normal?{normal:inputs.normal}:undefined})).prepared;
    if(disposed||token!==generation)return read();
    const candidate=await createCoarseFractureDynamics(coarseFixture(next,{strength}),host.scene.renderer());
    if(disposed||token!==generation){candidate.dispose();return read();}
    model?.dispose();model=candidate;prepared=next;preparedPart=part;selectedPart=part;clearMeshes();
    const materials=[...surface.materials];materials[next.capMaterial]=capMaterial;
    restMesh=createCoarseSurfaceMesh(next.rest,materials);restMesh.name='Remaining original surface';restMesh.userData.sourceFaces=Array.from(view.labels,(_,f)=>f).filter(f=>view.labels[f]!==part);owned.add(restMesh);
    meshes=next.pieces.map((p,i)=>{const m=createCoarseSurfaceMesh(p.arrays,materials,p.center);m.name=i?'Pullable coarse chunk':'Supported coarse chunk';m.userData.coarseChunk=i;owned.add(m);return m;});
    surface.meshes.forEach(m=>{m.visible=false;});
    let point=null,best=-Infinity;const p=next.pieces[1],a=p.arrays;
    for(let f=0;f<a.indices.length/3-p.capFaces;f++){const ids=Array.from(a.indices.subarray(f*3,f*3+3)),q=[0,1,2].map(k=>ids.reduce((s,id)=>s+a.positions[id*3+k]/3,0)),score=q.reduce((s,v,k)=>s+v*next.interface.normal[k],0);if(score>best){best=score;point=q;}}
    const axis=next.interface.normal.map(Math.abs).indexOf(Math.max(...next.interface.normal.map(Math.abs))),normal=[0,0,0];normal[axis]=Math.sign(next.interface.normal[axis]);
    grip={point,local:point.map((v,k)=>v-p.center[k]),normal};pullPercent=0;busy=false;draw();return event('prepared',{part,sourceFaces:faces,receipt:next.receipt});
   }catch(e){if(disposed||token!==generation)return read();busy=false;error=e.message;sync();throw e;}
  }
  async function advance(count=1){if(!Number.isSafeInteger(count)||count<1)throw Error('Positive physical step count required');if(busy||stepping||!model)throw Error('Material is busy');stepping=true;let finish;stepFinished=new Promise(r=>{finish=r;});try{for(let i=0;i<count;i++){if(disposed)break;await model.step();}if(!disposed)draw();return read();}catch(e){running=false;error=e.message;sync();throw e;}finally{stepping=false;finish();}}
  function pull(value){if(busy||!model||!grip)throw Error('Prepare a piece first');if(!Number.isFinite(value))throw Error('Finite pull distance required');pullPercent=value;const amount=value*diagonal/100,target=grip.point.map((v,k)=>v+amount*prepared.interface.normal[k]),xyz=a=>({x:a[0],y:a[1],z:a[2]});
   if(!model.snapshot().hand)model.setSurfaceHand(1,xyz(target),xyz(grip.local),xyz(grip.normal),'embedded-visual');else model.moveHand(xyz(target));running=true;sync();return event('pull',value);
  }
  let diagonal;
  try{
   asset=await session.loadAsset({url:inputs.source,normalize:false,metadata:{label:'Fracture source',source:inputs.source}});surface=collectFractureSurface(asset.root);asset.root.add(owned);
   const result=await callWorker('../fracture-shape-partition.worker.mjs',{geometry:{positions:surface.arrays.positions,indices:surface.arrays.indices},settings:{method:'geodesic-neck',minReachFraction:inputs.minReachFraction??.001,minAreaFraction:inputs.minAreaFraction??.0001,cleanupAreaFraction:inputs.cleanupAreaFraction??.0001,maxCutRatio:4,fixedCuts:inputs.fixedCuts??[]}});partition=result.result;view=shapeHierarchyView(partition,inputs.detailLevel??1,inputs.localDetail??{});
   const bounds=new Box3().setFromObject(asset.root);diagonal=bounds.getSize(new Vector3()).length();marker=new Mesh(new SphereGeometry(diagonal*.006,12,8),new MeshStandardMaterial({color:0xe59b3a,depthTest:false}));marker.name='Pull contact';marker.renderOrder=10;owned.add(marker);
   const hasBranch=id=>{while(id!==null){const n=partition.hierarchy.nodes[id];if(n.kind==='branch')return true;id=n.parent;}return false;};
   selectedPart=inputs.part??view.parts.find(p=>hasBranch(p.nodeId))?.id??0;await prepare(selectedPart);
   const frame=()=>{const b=new Box3().setFromObject(asset.root),c=b.getCenter(new Vector3()),r=b.getSize(new Vector3()).length();return session.setView({position:c.clone().add(new Vector3(1,.65,1.4).normalize().multiplyScalar(r*1.8)).toArray(),target:c.toArray()});};frame();
   unframe=session.onFrame(()=>{if(running&&!disposed&&!busy&&!stepping)void advance().catch(()=>{});});
   unpick=session.onPick?.(hit=>{if(busy||disposed)return;if(hit.object===restMesh){const source=restMesh.userData.sourceFaces[hit.faceIndex];selectedPart=view.labels[source];sync();}else if(hit.object===meshes[1]){const point=asset.root.worldToLocal(new Vector3(...hit.point)),b=model.snapshot().bodies[1],local=model.worldToLocalPoint(1,{x:point.x,y:point.y,z:point.z});grip={...grip,point:point.toArray(),local:[local.x,local.y,local.z]};pullPercent=0;model.release();sync();}});
   const operations={prepare:part=>prepare(part),reset:()=>prepare(selectedPart,{reuse:true}),pull,advance,pause:async()=>{running=false;await stepFinished;sync();return read();},play:()=>{running=true;sync();return read();},release:()=>{model.release();sync();return event('release',null);},strength:value=>{model.setStrength(value);strength=value;updateInputs({...inputs,strength});sync();return event('strength',value);},select:part=>{if(!Number.isInteger(part)||!view.parts[part])throw Error('Choose a detected piece');selectedPart=part;sync();return read();},frame,export:()=>({...read(),preparation:prepared})};
   return {read,operations,mount({root,document,invoke}){
    const p=document.createElement('p');p.textContent='Pull a detected part until its coarse material breaks. The lower side is supported; the original textured surface follows both chunks.';root.append(p);
    const label=(title,element)=>{const l=document.createElement('label'),s=document.createElement('span');s.textContent=title;l.style.cssText='display:grid;gap:6px;margin:12px 0';l.append(s,element);root.append(l);return s;};
    const run=(name,value)=>invoke(name,value).catch(e=>{error=e.message;sync();});
    partSelect=document.createElement('select');partSelect.setAttribute('aria-label','Detected piece');for(const part of view.parts){const o=document.createElement('option');o.value=String(part.id);o.textContent=`Piece ${part.id+1} · ${part.triangles.toLocaleString()} triangles`;partSelect.append(o);}partSelect.addEventListener('change',()=>run('select',Number(partSelect.value)));label('Detected piece',partSelect);
    const button=(text,operation,value)=>{const b=document.createElement('button');b.textContent=text;b.addEventListener('click',()=>run(typeof operation==='function'?operation():operation,typeof value==='function'?value():value));root.append(b);return b;};
    prepareButton=button('Prepare selected piece','prepare',()=>selectedPart);
    function number(title,value,min,step,operation){const input=document.createElement('input');Object.assign(input,{type:'number',className:'transform-input',value:String(value),step:'any'});if(min!==null)input.min=String(min);input.setAttribute('aria-label',title);const grip=label(title,input);drags.push(host.controls.installNumberDrag({input,grip,step,dragStep:step}));input.addEventListener('input',()=>{const n=Number(input.value);if(input.value.trim()&&Number.isFinite(n)&&(min===null||n>=min))run(operation,n);});input.addEventListener('blur',sync);return input;}
    pullInput=number('Pull distance (% object extent)',0,null,.01,'pull');strengthInput=number('Cohesion',strength,Number.MIN_VALUE,1,'strength');
    playButton=button('Play',()=>running?'pause':'play');button('Release hand','release');button('Reset fracture','reset');button('Frame object','frame');
    const hint=document.createElement('p');hint.textContent='First comparison: two rigid chunks, one breakable internal interface, zero gravity. Mass and inertia are approximate; fragment collisions are disabled.';hint.style.fontSize='12px';root.append(hint);status=document.createElement('p');status.setAttribute('role','status');status.style.whiteSpace='pre-line';root.append(status);sync();
   },async dispose(){if(disposed)return;disposed=true;running=false;generation++;unframe?.();unpick?.();for(const w of workers){w.terminate();workerCalls.get(w)?.(Error('Coarse fracture closed'));}workers.clear();drags.forEach(d=>d.dispose());await stepFinished;model?.dispose();owned.remove(marker);marker.geometry.dispose();marker.material.dispose();clearMeshes();capMaterial.dispose();await session.dispose();}};
  }catch(e){disposed=true;for(const w of workers)w.terminate();model?.dispose();clearMeshes();capMaterial.dispose();await session.dispose();throw e;}
 },
};
