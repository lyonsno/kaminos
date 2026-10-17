import * as THREE from './lib/three.core.js';
import {MeshBVH} from './node_modules/three-mesh-bvh/build/index.module.js';
import {admitProxy,proxyBoundary,proxySection,proxySlab,proxySettings,tetFaces} from './mechanical-proxy-core.mjs';

export function meshSnapshot(entry){
 if(!entry?.object)throw Error('Select a triangle mesh');
 const positions=[],triangles=[];entry.object.updateWorldMatrix(true,true);
 const inverse=entry.object.matrixWorld.clone().invert(),point=new THREE.Vector3();
 entry.object.traverse(mesh=>{
  if(mesh.isSkinnedMesh||mesh.morphTargetInfluences?.length)throw Error('Mechanical proxy currently requires an unrigged, unmorphed mesh');
  if(!mesh.isMesh)return;const g=mesh.geometry,attribute=g?.getAttribute('position');if(!attribute)return;
  const transform=new THREE.Matrix4().multiplyMatrices(inverse,mesh.matrixWorld),base=positions.length;
  for(let i=0;i<attribute.count;i++)positions.push(point.fromBufferAttribute(attribute,i).applyMatrix4(transform).toArray());
  const count=g.index?.count??attribute.count;if(count%3)throw Error('Complete triangle geometry required');
  for(let i=0;i<count;i+=3)triangles.push([0,1,2].map(k=>base+(g.index?g.index.getX(i+k):i+k)));
 });
 if(!triangles.length)throw Error('Selected object has no triangles');
 return{positions,triangles,source:{id:entry.id,label:entry.label??entry.object.name??'Mesh',url:entry.source??null}};
}

export function installMechanicalProxy({document,scene,camera,canvas,selected,redraw}){
 const panel=document.createElement('details');panel.id='mechanical-proxy-tool';panel.className='mechanical-proxy-tool';
 panel.innerHTML=`<summary>Mechanical proxy</summary><div class="mp-body">
 <div class="mp-fields"><label>Tolerance <input data-mp="envelope" type="number" step="any" min="0" value="0.05"></label>
 <input data-mp="envelope-log" type="range" min="-5" max="-0.3" step="0.05" value="-1.30103" aria-label="Tolerance logarithmic scale">
 <output data-mp="absolute"></output>
 <label>Interior spacing <input data-mp="spacing" type="number" min="0" step="any" value="0.1"></label>
 <label>Trial seconds <input data-mp="budgetSeconds" type="number" min="0" step="any" value="5"></label></div>
 <div class="mp-actions"><button data-mp="generate" type="button">Generate</button><button data-mp="cancel" type="button" disabled>Cancel</button><button data-mp="close" type="button" title="Close inspection">Close</button></div>
 <div data-mp="status" role="status">Select a mesh</div>
 <label>Results <select data-mp="results" aria-label="Mechanical proxy results"><option value="">No results</option></select></label>
 <div class="mp-modes" role="group" aria-label="Proxy comparison"><button data-mode="original">Original</button><button data-mode="proxy" aria-pressed="true">Proxy</button><button data-mode="overlay">Overlay</button></div>
 <label>Interior <select data-mp="interior"><option value="section">Section</option><option value="slab">Slab</option><option value="surface">Surface</option><option value="wire">All elements</option></select></label>
 <label>Axis <select data-mp="axis"><option value="0">X</option><option value="1">Y</option><option value="2" selected>Z</option></select></label>
 <label>Section <input data-mp="offset" type="range" min="0" max="1" step="0.001" value="0.5"></label>
 <label>Slab thickness <input data-mp="width" type="range" min="0" max="0.5" step="0.001" value="0.05"></label>
 <label><input data-mp="isolate" type="checkbox"> Isolate element and neighbors</label>
 <label><input data-mp="deviation" type="checkbox"> Source distance</label><output data-mp="distance-scale"></output>
 <div data-mp="element"></div><button data-mp="keep" type="button" disabled>Keep result</button>
 <details><summary>Result data</summary><a data-mp="download" target="_blank" rel="noopener">Open full result</a><pre data-mp="facts"></pre></details></div>`;
 document.getElementById('authoring-object-tools').append(panel);
 const $=name=>panel.querySelector(`[data-mp="${name}"]`),state={status:'idle',mode:'proxy',interior:'section',axis:2,offset:.5,width:.05,selectedTet:null,isolate:false,deviation:false};
 let target,snapshot,identity,result,rows=[],group,boundaryMesh,inspectionMesh,ghost,bvh,sourceGeometry,job,token=0,timer,visibleBefore,disposed=false;
 const request=async(body,query='')=>{const response=await fetch('/api/mechanical-proxy'+query,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});const data=await response.json();if(!response.ok)throw Error(data.error??`Mechanical proxy HTTP ${response.status}`);return data;};
 const status=text=>{$('status').textContent=text;};
 function clearGroup(){if(group){scene.remove(group);group.traverse(o=>{o.geometry?.dispose();if(o.material)for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose();});}group=null;boundaryMesh=inspectionMesh=ghost=null;}
 function restore(){clearGroup();if(target?.object)target.object.visible=visibleBefore;redraw();}
 function bounds(){const box=new THREE.Box3();for(const p of result.positions)box.expandByPoint(new THREE.Vector3(...p));return box;}
 function planeValues(){const box=bounds(),axis=state.axis,low=box.min.getComponent(axis),extent=box.max.getComponent(axis)-low;return{offset:low+state.offset*extent,width:state.width*extent,box};}
 function geometry(faces){const values=[];for(const f of faces)for(const p of f)values.push(...p);const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(values,3));g.computeVertexNormals();return g;}
 function makeGhost(){const copy=target.object.clone(true);copy.matrixAutoUpdate=true;copy.position.set(0,0,0);copy.quaternion.identity();copy.scale.set(1,1,1);copy.visible=true;copy.traverse(o=>{if(o.isMesh){o.geometry=o.geometry.clone();o.material=new THREE.MeshBasicMaterial({color:0xc7d3dc,transparent:true,opacity:.12,depthWrite:false,wireframe:true});}});return copy;}
 function distances(g){
  if(!bvh){sourceGeometry=new THREE.BufferGeometry();sourceGeometry.setAttribute('position',new THREE.Float32BufferAttribute(snapshot.positions.flat(),3));sourceGeometry.setIndex(snapshot.triangles.flat());bvh=new MeshBVH(sourceGeometry);}
  const p=new THREE.Vector3(),hit={},a=g.getAttribute('position'),colors=[],color=new THREE.Color(),scale=result.diagonal*result.settings.envelope;let max=0;
  for(let i=0;i<a.count;i++){p.fromBufferAttribute(a,i);bvh.closestPointToPoint(p,hit);const d=hit.distance;max=Math.max(max,d);const u=Math.min(1,d/scale);color.setRGB(.12+.8*u,.67-.4*u,.73-.55*u);colors.push(color.r,color.g,color.b);}
  g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));$('distance-scale').textContent=`0 - ${scale.toPrecision(3)} local units; max ${max.toPrecision(3)}`;
 }
 function render(){
  if(!target)return;restore();if(!result||state.mode==='original'){target.object.visible=visibleBefore;return;}target.object.visible=false;
  group=new THREE.Group();group.name='Mechanical proxy inspection';group.matrixAutoUpdate=false;group.matrix.copy(target.object.matrixWorld);scene.add(group);
  if(state.mode==='overlay'){ghost=makeGhost();group.add(ghost);}
  const boundary=proxyBoundary(result),g=geometry(boundary.map(f=>f.ids.map(i=>result.positions[i])));
  if(state.deviation)distances(g);
  const material=new THREE.MeshStandardMaterial({color:state.deviation?0xffffff:0x719a9c,roughness:.75,side:THREE.DoubleSide,vertexColors:state.deviation});
  boundaryMesh=new THREE.Mesh(g,material);group.add(boundaryMesh);
  const {offset,width}=planeValues();
  if(state.interior!=='surface'){
   const normal=new THREE.Vector3();normal.setComponent(state.axis,-1);material.clippingPlanes=[new THREE.Plane(normal,offset).applyMatrix4(group.matrix)];
   const selected=state.selectedTet;let ids=state.interior==='section'?null:state.interior==='wire'?result.tetrahedra.map((_,i)=>i):proxySlab(result,state.axis,offset,width);
   const neighbor=new Set(selected===null?[]:result.tetrahedra.flatMap((t,i)=>t.some(n=>result.tetrahedra[selected].includes(n))?[i]:[]));
   let polygons=state.interior==='section'?proxySection(result,state.axis,offset).map(p=>({tet:p.tet,points:p.points})):ids.flatMap(tet=>tetFaces.map(f=>({tet,points:f.map(i=>result.positions[result.tetrahedra[tet][i]])})));
   if(state.isolate&&selected!==null)polygons=polygons.filter(p=>neighbor.has(p.tet));
   const faces=[],faceTets=[],colors=[],lines=[],color=new THREE.Color();
   for(const polygon of polygons){for(let k=1;k<polygon.points.length-1;k++){faces.push([polygon.points[0],polygon.points[k],polygon.points[k+1]]);faceTets.push(polygon.tet);color.setHex(polygon.tet===selected?0xf2bf55:neighbor.has(polygon.tet)?0x8ccdb8:0x47777e);for(let j=0;j<3;j++)colors.push(color.r,color.g,color.b);}for(let k=0;k<polygon.points.length;k++)lines.push(...polygon.points[k],...polygon.points[(k+1)%polygon.points.length]);}
   const sectionGeometry=geometry(faces);sectionGeometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
   inspectionMesh=new THREE.Mesh(sectionGeometry,new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.DoubleSide,transparent:state.interior!=='section',opacity:state.interior==='section'?1:.25,depthWrite:state.interior==='section',polygonOffset:true,polygonOffsetFactor:1,polygonOffsetUnits:1}));inspectionMesh.userData.faceTets=faceTets;group.add(inspectionMesh);
   const edgeGeometry=new THREE.BufferGeometry();edgeGeometry.setAttribute('position',new THREE.Float32BufferAttribute(lines,3));group.add(new THREE.LineSegments(edgeGeometry,new THREE.LineBasicMaterial({color:0xd4e4e4,transparent:true,opacity:.8,depthTest:true})));
  }
  $('element').textContent=state.selectedTet===null?'':`Element ${state.selectedTet} / ${result.tetrahedra.length}`;redraw();
 }
 const read=()=>({...state,targetId:target?.id??null,sourceDigest:identity?.sourceDigest??null,jobId:job?.jobId??null,resultId:job?.status==='passed'?job.id:null,settings:result?.settings??null,results:rows.map(r=>({...r})),resultFacts:result?{points:result.positions.length,tetrahedra:result.tetrahedra.length,volume:result.volume,effective:result.effective}:null});
 async function refreshRows(){if(!identity)return;rows=(await request(null,`?source=${identity.sourceDigest}`)).results;$('results').replaceChildren(...rows.map(r=>{const o=document.createElement('option');o.value=r.id;o.textContent=`${r.kept?'Kept · ':''}${r.settings.envelope} / ${r.settings.spacing} · ${r.status}`;return o;}));if(job)$('results').value=job.id;}
 function setBusy(busy){$('generate').disabled=busy;$('cancel').disabled=!busy;}
 async function loadResult(id){const next=await request(null,`?id=${id}&result=1`);if(next.sourceDigest!==identity?.sourceDigest)throw Error('Result belongs to another source');if(next.status!=='passed')throw Error(`Result is ${next.status}`);admitProxy(next.mesh);result=next.mesh;job=next;state.status='passed';state.selectedTet=null;$('keep').disabled=false;$('download').href=`/api/read?root=mechanical-proxies&path=${id}%2Fmesh.json`;$('facts').textContent=JSON.stringify({...next,mesh:undefined},null,2);status(next.cached?'Cached result':'Complete');render();return read();}
 async function observe(id,generation){
  const row=await request(null,`?id=${id}`);if(generation!==token||disposed)return;
  job=row;state.status=row.status;status(row.status==='running'?`${row.phase==='initializing'?'Initializing':'Meshing'} · ${(row.elapsedSeconds??0).toFixed(1)} s total`:row.status);
  if(['pending','running','submitting'].includes(row.status)){timer=setTimeout(()=>observe(id,generation).catch(fail),500);return;}
  setBusy(false);await refreshRows();if(row.status==='passed')await loadResult(id);else{status(`${row.status}${row.error?': '+row.error:''}`);$('facts').textContent=JSON.stringify(row,null,2);}
 }
 const fail=error=>{setBusy(false);state.status='failed';status(error.message);};
 const operations={
  async open(){
   const entry=selected();if(!entry?.object)throw Error('Select a mesh');snapshot=meshSnapshot(entry);restore();target=entry;visibleBefore=entry.object.visible;result=null;sourceGeometry?.dispose();bvh=null;sourceGeometry=null;token++;clearTimeout(timer);panel.open=true;
   identity=await request({action:'inspect',input:{...snapshot,settings:proxySettings({envelope:Number($('envelope').value),spacing:Number($('spacing').value),budgetSeconds:Number($('budgetSeconds').value)})}});state.status='idle';status(target.label??'Mesh');await refreshRows();const kept=rows.findLast(r=>r.kept&&r.status==='passed');if(kept)await loadResult(kept.id);updateAbsolute();return read();
  },
  async generate(settings){if(!target||selected()?.id!==target.id)await operations.open();const effective=proxySettings(settings??Object.fromEntries(['envelope','spacing','budgetSeconds'].map(k=>[k,Number($(k).value)])));const current=meshSnapshot(target);if(JSON.stringify(current.positions)!==JSON.stringify(snapshot.positions)||JSON.stringify(current.triangles)!==JSON.stringify(snapshot.triangles))throw Error('Source geometry changed; reopen Mechanical proxy');setBusy(true);const generation=++token;job=await request({action:'generate',input:{...snapshot,settings:effective}});state.status=job.status;await refreshRows();await observe(job.id,generation);return read();},
  async cancel(){if(job)await request({action:'cancel',id:job.id});return read();},
  async selectResult(id){return loadResult(id);},
  setView(mode){if(!['original','proxy','overlay'].includes(mode))throw Error('Unknown proxy view');state.mode=mode;for(const b of panel.querySelectorAll('[data-mode]'))b.setAttribute('aria-pressed',String(b.dataset.mode===mode));render();return read();},
  setSection(value){if(value.axis!==undefined){if(![0,1,2].includes(value.axis))throw Error('Invalid section axis');state.axis=value.axis;$('axis').value=String(value.axis);}for(const k of ['offset','width'])if(value[k]!==undefined){if(!Number.isFinite(value[k])||value[k]<0||value[k]>1)throw Error('Section fraction must be in [0,1]');state[k]=value[k];$(k).value=String(value[k]);}if(value.interior!==undefined){if(!['section','slab','surface','wire'].includes(value.interior))throw Error('Unknown interior view');state.interior=value.interior;$('interior').value=value.interior;}render();return read();},
  selectElement(index){if(!result||!Number.isInteger(index)||index<0||index>=result.tetrahedra.length)throw Error('Valid tetrahedron required');state.selectedTet=index;render();return read();},
  async keep(){if(!job||!result)throw Error('Generate a complete proxy first');await request({action:'keep',id:job.id});await refreshRows();status('Kept');return read();},
  close(){token++;clearTimeout(timer);restore();target=null;result=null;state.status='idle';panel.open=false;setBusy(false);return read();},
  read,
 };
 function updateAbsolute(){if(identity)$('absolute').textContent=`${(identity.diagonal*Number($('envelope').value)).toPrecision(4)} local units`;$('envelope-log').value=String(Math.log10(Number($('envelope').value)));}
 function invoke(name,value){return Promise.resolve().then(()=>operations[name](value)).catch(error=>{fail(error);throw error;});}
 $('generate').onclick=()=>invoke('generate').catch(()=>{});$('cancel').onclick=()=>invoke('cancel').catch(()=>{});$('keep').onclick=()=>invoke('keep').catch(()=>{});$('close').onclick=()=>operations.close();
 $('results').onchange=()=>invoke('selectResult',$('results').value).catch(()=>{});
 $('envelope').oninput=updateAbsolute;$('envelope-log').oninput=()=>{$('envelope').value=String(10**Number($('envelope-log').value));updateAbsolute();};
 for(const button of panel.querySelectorAll('[data-mode]')){button.type='button';button.onclick=()=>operations.setView(button.dataset.mode);}
 for(const key of ['axis','offset','width','interior'])$(key).oninput=()=>operations.setSection({[key]:key==='interior'?$(key).value:Number($(key).value)});
 for(const key of ['isolate','deviation'])$(key).onchange=()=>{state[key]=$(key).checked;render();};
 panel.addEventListener('toggle',()=>{if(panel.open&&!target)invoke('open').catch(()=>{});else if(!panel.open&&target)operations.close();});
 let down;
 const hit=event=>{if(!inspectionMesh)return null;const rect=canvas.getBoundingClientRect(),ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1),camera);return ray.intersectObject(inspectionMesh)[0];};
 canvas.addEventListener('pointerdown',event=>{if(event.button===0&&panel.open&&hit(event)){down=[event.clientX,event.clientY];event.stopImmediatePropagation();}},true);
 canvas.addEventListener('pointerup',event=>{if(!down)return;const moved=Math.hypot(event.clientX-down[0],event.clientY-down[1]);down=null;if(moved<4){const intersection=hit(event);if(intersection){operations.selectElement(inspectionMesh.userData.faceTets[intersection.faceIndex]);event.stopImmediatePropagation();}}},true);
 function refresh(){const entry=selected();let supported=false;entry?.object?.traverse(o=>{if(o.isMesh)supported=true;});panel.hidden=!supported;if(target&&entry?.id!==target.id)operations.close();if(supported&&new URLSearchParams(location.search).get('mechanicalProxy')==='1'&&!panel.dataset.autoOpened){panel.dataset.autoOpened='true';invoke('open').catch(()=>{});}}
 return{...operations,refresh,dispose(){disposed=true;operations.close();sourceGeometry?.dispose();panel.remove();}};
}
