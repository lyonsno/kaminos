import * as THREE from '../../lib/three.core.js';
import {validateRestPlan,restHeads,authoredRestPlan,referenceRestPlan,restJointPartner,shapeRestPlan} from './rest-skeleton-edit.mjs';
import {mountSkeletonShapeControls} from './skeleton-shape-controls.mjs';
import {captureRestTransform,applyRestTransform} from './rest-skeleton-transform.mjs';
import {checkedPose} from '../../scene-edit-session.mjs';
import {validateProportionAtlas,measureProportionAtlas} from './skeleton-proportions.mjs';

const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
const identity=()=>({position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]});
const poseOf=root=>({position:root.position.toArray(),rotation:[root.rotation.x,root.rotation.y,root.rotation.z],scale:root.scale.toArray()});
const putPose=(root,pose)=>{pose=checkedPose(pose);root.position.fromArray(pose.position);root.rotation.set(...pose.rotation);root.scale.fromArray(pose.scale);root.updateMatrixWorld(true);};

export async function loadRestEditorInput(inputs,{fetchImpl=globalThis.fetch}={}){
 if(inputs.recipe){if(!/^[a-f0-9]{64}$/i.test(inputs.recipe_sha256??'')||inputs.plan||inputs.plan_url)throw Error('A recipe needs its digest and no competing plan');const r=await fetchImpl(inputs.recipe,{cache:'no-store'});if(!r.ok)throw Error('Recipe HTTP '+r.status);const bytes=await r.arrayBuffer();if(await digest(bytes)!==inputs.recipe_sha256)throw Error('Recipe digest mismatch');inputs=JSON.parse(new TextDecoder().decode(bytes));if(inputs.recipe)throw Error('Nested recipes are not supported');}
 let plan,sha=inputs.baseline_sha256;
 if(inputs.plan){if(inputs.plan_url)throw Error('Choose a plan file or inline plan');plan=validateRestPlan(inputs.plan);sha=plan.rest_authoring?.baselineSha256??sha;}
 else {if(!inputs.plan_url||!/^[a-f0-9]{64}$/i.test(inputs.plan_sha256??''))throw Error('Explicit plan URL and digest required');const r=await fetchImpl(inputs.plan_url,{cache:'no-store'});if(!r.ok)throw Error('Plan HTTP '+r.status);const bytes=await r.arrayBuffer();if(await digest(bytes)!==inputs.plan_sha256)throw Error('Plan digest mismatch');plan=validateRestPlan(JSON.parse(new TextDecoder().decode(bytes)));sha=plan.rest_authoring?.baselineSha256??inputs.plan_sha256;}
 const displayMatrix=plan.rest_authoring?.displayMatrix??inputs.display_matrix,proportionAtlas=validateProportionAtlas(plan.rest_authoring?.proportionAtlas??inputs.proportion_atlas??null,plan),reference=proportionAtlas?proportionAtlas.references.find(r=>r.id===proportionAtlas.activeReference):plan.rest_authoring?.reference??inputs.reference??null;
 const result=authoredRestPlan(plan,{baselineSha256:sha,displayMatrix,reference,view:plan.rest_authoring?.view??inputs.view??null,referenceDisplay:plan.rest_authoring?.referenceDisplay??null,scene:plan.rest_authoring?.scene??null,proportionAtlas});
 const m=new THREE.Matrix4().fromArray(result.rest_authoring.displayMatrix);
 if(Math.abs(m.determinant())<1e-12||m.elements[3]!==0||m.elements[7]!==0||m.elements[11]!==0||m.elements[15]!==1)throw Error('Invertible affine display frame required');
 if(reference){const J=reference.jointNames?.length;if(!J||reference.parents?.length!==J||reference.positions?.length!==J*3||!reference.positions.every(Number.isFinite)||reference.parents.some((p,j)=>!Number.isInteger(p)||p< -1||p>=j))throw Error('Invalid reference skeleton');}
 return {plan:result,baselineSha256:sha,displayMatrix:m,reference,proportionAtlas,startingBody:inputs.starting_body??null};
}

function links(joints,positions,color){
 const names=new Map(joints.map((j,i)=>[j.name,i]));
 const edges=joints.map((j,i)=>[typeof j.parent==='number'?j.parent:names.get(j.parent)??-1,i]).filter(([p])=>p>=0);
 const geometry=new THREE.BufferGeometry(),a=new THREE.BufferAttribute(new Float32Array(edges.length*6),3);geometry.setAttribute('position',a);
 const mesh=new THREE.LineSegments(geometry,new THREE.LineBasicMaterial({color,depthTest:false,transparent:true,opacity:.85}));mesh.renderOrder=5;mesh.raycast=()=>{};
 const update=values=>{let k=0;for(const [p,j]of edges)for(const index of[p,j])for(const v of values[index])a.array[k++]=v;a.needsUpdate=true;geometry.computeBoundingSphere();};update(positions);
 return {mesh,update};
}

export async function createRestSkeletonEditor({host,inputs={},record=()=>{}},{fetchImpl=globalThis.fetch}={}){
 const loaded=await loadRestEditorInput(inputs,{fetchImpl});let baseline=loaded.plan,matrix=loaded.displayMatrix,atlas=loaded.proportionAtlas,reference=loaded.reference;
 const openedPlan=structuredClone(baseline);
 const document=host.controls.document,win=document.defaultView,session=await host.scene.open(),edits=win?.kaminosSceneEdits;
 if(!edits||!host.controls.components){await session.dispose();throw Error('Shared component editing host unavailable');}
 let plan=structuredClone(baseline),selected=[plan.joints.find(j=>j.name.includes('shoulder'))?.name??plan.joints[0].name],active=selected[0],mirror=false,descendants=false,editMode=false,disposed=false;
 let refresh=()=>{},componentSeat,controlSeat,shapeControls,unsubscribe=()=>{},draft=null,error=null;
 const target='@rest-components:'+crypto.randomUUID(),root=new THREE.Group(),proxy=new THREE.Group(),markers=new Map();root.name='Creature · rest skeleton';proxy.name='Rest joint transform';proxy.userData.kaminosEditorHelper=true;
 const referenceTarget=target+':reference',bodyTarget=target+':body';
 const positions=()=>plan.joints.map(j=>new THREE.Vector3(...j.head).applyMatrix4(matrix).toArray());
 let graph;
 function rebuild(){for(const child of [...root.children]){child.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});root.remove(child);}markers.clear();graph=links(plan.joints,positions(),0x4ce4ed);root.add(graph.mesh);
 for(const [i,j]of plan.joints.entries()){
  const marker=new THREE.Mesh(new THREE.SphereGeometry(.018,12,8),new THREE.MeshBasicMaterial({color:0x4ce4ed,depthTest:false}));marker.name=j.name;marker.renderOrder=10;marker.position.fromArray(positions()[i]);root.add(marker);markers.set(j.name,marker);
 }}rebuild();
 let referenceRoot=null,referenceAsset=null,asset=null;
 function assertLive(){if(disposed||!root.parent)throw Error('Skeleton removed; Undo removal or reopen it');}
 const sourceFrame=()=>{root.updateWorldMatrix(true,false);return root.matrixWorld.clone().multiply(matrix).toArray();};
 const capture=()=>captureRestTransform(plan,{selected:selected.length?[...selected]:[plan.joints[0].name],active:active??plan.joints[0].name,mirror,descendants,pivot:host.controls.transformSettings?.().pivot??'median',rotation:poseOf(root).rotation,localToWorld:sourceFrame()});
 const snapshot=()=>structuredClone(draft??capture());
 function repaint(){
  const p=positions();for(const [i,j]of plan.joints.entries()){
   const marker=markers.get(j.name);marker.position.fromArray(p[i]);marker.material.color.setHex(editMode&&selected.includes(j.name)?0xffad45:0x4ce4ed);
  }graph.update(p);root.updateMatrixWorld(true);session.redraw();refresh();
 }
 function placeProxy(){if(!editMode||!selected.length)return;draft=null;putPose(proxy,capture());}
 const exported=()=>{assertLive();return authoredRestPlan(plan,{baselineSha256:loaded.baselineSha256,displayMatrix:matrix.toArray(),reference,proportionAtlas:atlas,view:session.readView(),referenceDisplay:null,scene:{skeleton:poseOf(root),reference:referenceRoot?poseOf(referenceRoot):null,referenceVisible:referenceRoot?.visible??false}});};
 const read=()=>({status:error?'invalid':editMode?'editing-rest-joints':'object-mode',error,selected:[...selected],active,mirror,descendants,objectId:asset?.id,referenceId:referenceAsset?.id,targetId:target,baselineSha256:loaded.baselineSha256,objectPose:poseOf(root),referencePose:referenceRoot?poseOf(referenceRoot):null,
  proportions:measureProportionAtlas(plan,atlas),referenceSource:structuredClone(reference?.source??null),joints:plan.joints.map(j=>({name:j.name,parent:j.parent,head:[...j.head],position:markers.get(j.name).getWorldPosition(new THREE.Vector3()).toArray()})),semantics:'Rest-joint candidate; placement does not change anatomy; fresh motion generation is separate'});
 const operations={
  read,
  reference({id}={}){assertLive();if(!atlas)throw Error('No proportion atlas supplied');edits.apply(referenceTarget,{id},'Change reference skeleton');record({kind:'skeleton.reference',phase:'applied',effective:{id,source:reference.source}});return read();},
  proportions:()=>measureProportionAtlas(plan,atlas),
  startFrom({id}={}){
   assertLive();if(edits.state().active)throw Error('Finish or cancel the active edit first');
   const ref=atlas?.references.find(r=>r.id===id);if(id!=='opened'&&!ref)throw Error('Choose an available source body');
   const next=id==='opened'?structuredClone(openedPlan):authoredRestPlan(referenceRestPlan(ref),{baselineSha256:ref.source.sha256,displayMatrix:new THREE.Matrix4().toArray(),reference:ref,proportionAtlas:{...atlas,profile:ref.profile,activeReference:id}});
   next.rest_authoring.scene={skeleton:poseOf(root),reference:referenceRoot?poseOf(referenceRoot):null,referenceVisible:referenceRoot?.visible??false};next.rest_authoring.view=session.readView();
   edits.apply(bodyTarget,{plan:next,baseline:next},'Start from '+(ref?.label??'opened skeleton'));record({kind:'skeleton.start-from',phase:'applied',effective:{id,source:next.source_exemplar?.source??null}});return read();
  },
  structure({part}={}){assertLive();if(!editMode)throw Error('Press Tab to edit body structure');if(!atlas)throw Error('Explicit correspondence required');const names=part==='trunk'?atlas.profile.trunk:['fore','hind'].includes(part)?['left','right'].map(side=>atlas.profile[part][side][0]):null;if(!names||names.some(n=>!markers.has(n)))throw Error('Unsupported body structure');componentSeat.changed(()=>{selected=[...names];active=selected[0];placeProxy();repaint();});return read();},
  shape(input){assertLive();if(!editMode)throw Error('Press Tab to edit body structure');if(!atlas)throw Error('Explicit correspondence required');const transaction=edits.state().active;if(transaction&&transaction.id!==target)throw Error('Finish the active edit first');const start=transaction?.before??snapshot(),from=applyRestTransform(baseline,start),next=shapeRestPlan(from,atlas.profile,input),value=captureRestTransform(next,start);if(transaction)edits.preview(value);else edits.apply(target,value,'Shape '+input.part);record({kind:'skeleton.shape',phase:transaction?'preview':'applied',effective:input});return read();},
  select({name,extend=false,pair=false}={}){
   assertLive();if(!markers.has(name))throw Error('Unknown joint');if(!editMode)throw Error('Press Tab to edit skeleton joints');
   componentSeat.changed(()=>{if(extend){if(selected.includes(name)&&selected.length>1)selected=selected.filter(n=>n!==name);else if(!selected.includes(name))selected.push(name);}else selected=[name];active=selected.includes(name)?name:selected.at(-1);
    const other=restJointPartner(plan,name);if(pair&&other&&markers.has(other)&&!selected.includes(other))selected.push(other);placeProxy();repaint();});return read();
  },
  options(input={}){for(const key of Object.keys(input))if(!['mirror','descendants'].includes(key)||typeof input[key]!=='boolean')throw Error('Unknown editor option');componentSeat.changed(()=>{mirror=input.mirror??mirror;descendants=input.descendants??descendants;placeProxy();refresh();});return read();},
  move({name=active,position,mirror:paired=mirror,descendants:branch=descendants}={}){
   operations.select({name});const start=captureRestTransform(plan,{selected:[name],active:name,mirror:paired,descendants:branch,localToWorld:sourceFrame()});edits.apply(target,{...start,position},'Edit rest joints');return read();
  },
  undo:async()=>{await edits.undo();return read();},redo:async()=>{await edits.redo();return read();},
  export(){const value=exported();record({kind:'skeleton.rest.export',phase:'applied',effective:value});return value;},
  setup:()=>({plan:exported()}),
  frame({direction='side'}={}){
   const dirs={side:[3,0,0],front:[0,0,3],dorsal:[0,3,.001],perspective:[2,1.7,2]};if(!dirs[direction])throw Error('Unknown view');
   root.updateMatrixWorld(true);referenceRoot?.updateMatrixWorld(true);const box=new THREE.Box3().setFromObject(root);if(referenceRoot?.visible)box.union(new THREE.Box3().setFromObject(referenceRoot));const center=box.getCenter(new THREE.Vector3()),radius=box.getSize(new THREE.Vector3()).length()/2;
   session.setView({position:center.clone().add(new THREE.Vector3(...dirs[direction]).normalize().multiplyScalar(Math.max(radius*3.8,.5))).toArray(),target:center.toArray(),up:direction==='dorsal'?[0,0,-1]:[0,1,0]});return session.readView();
  },
 };
 try{
  putPose(root,baseline.rest_authoring.scene?.skeleton??identity());
  asset=await session.attach(root,{owned:true,metadata:{label:root.name,source:'authored-rest-skeleton:'+loaded.baselineSha256}});root.parent.add(proxy);
  edits.register(bodyTarget,{read:()=>({plan:exported(),baseline:structuredClone(baseline)}),check:value=>{const p=validateRestPlan(value.plan),b=validateRestPlan(value.baseline);validateProportionAtlas(p.rest_authoring?.proportionAtlas??null);const m=new THREE.Matrix4().fromArray(p.rest_authoring?.displayMatrix??[]);if(!p.rest_authoring||Math.abs(m.determinant())<1e-12)throw Error('An authored source body with a valid display frame is required');return {plan:p,baseline:b};},write:value=>{
   const next=value.plan;baseline=structuredClone(value.baseline);plan=structuredClone(next);matrix.fromArray(next.rest_authoring.displayMatrix);loaded.baselineSha256=next.rest_authoring.baselineSha256;atlas=validateProportionAtlas(next.rest_authoring.proportionAtlas??null);reference=atlas?atlas.references.find(r=>r.id===atlas.activeReference):next.rest_authoring.reference;
   selected=selected.filter(n=>plan.joints.some(j=>j.name===n));if(!selected.length)selected=[atlas?.profile.fore.left[0]??plan.joints[0].name];active=selected.includes(active)?active:selected[0];draft=null;error=null;putPose(root,next.rest_authoring.scene?.skeleton??identity());if(referenceRoot&&reference){drawReference();putPose(referenceRoot,next.rest_authoring.scene?.reference??identity());referenceRoot.visible=next.rest_authoring.scene?.referenceVisible??true;}rebuild();placeProxy();repaint();
  }});
  if(reference){
   referenceRoot=new THREE.Group();drawReference();
   const legacy=baseline.rest_authoring.referenceDisplay,initial=identity();initial.position[legacy?.axis==='x'?0:2]=legacy?.mode==='overlay'?0:1.6;
   putPose(referenceRoot,baseline.rest_authoring.scene?.reference??initial);referenceRoot.visible=baseline.rest_authoring.scene?.referenceVisible??(legacy?.mode!=='off');
   referenceAsset=await session.attach(referenceRoot,{owned:true,metadata:{label:atlas?'Reference atlas':referenceRoot.name,source:atlas?'caller-proportion-atlas':typeof reference.source==='string'?reference.source:reference.source?.path??'caller-reference'}});
   if(atlas)edits.register(referenceTarget,{read:()=>({id:atlas.activeReference}),check:value=>{if(!atlas.references.some(r=>r.id===value.id))throw Error('Unknown atlas reference');return {id:value.id};},write:value=>{assertLive();atlas.activeReference=value.id;reference=atlas.references.find(r=>r.id===value.id);drawReference();session.redraw();refresh();}});
  }
  edits.register(target,{read:snapshot,check:value=>{applyRestTransform(baseline,value);return structuredClone(value);},write:value=>{assertLive();const next=applyRestTransform(baseline,value);plan=next;draft=structuredClone(value);putPose(proxy,value);error=null;repaint();}});
  componentSeat=host.controls.components.register(asset.id,{
   enter(){assertLive();editMode=true;placeProxy();repaint();},exit(){editMode=false;draft=null;repaint();},
   target:()=>{if(!selected.length)return null;if(!edits.state().active&&!edits.state().replaying)placeProxy();return {id:target,type:'rest-joints',label:active+(selected.length>1?` + ${selected.length-1}`:''),object:proxy,read:snapshot,localOrientation:poseOf(root).rotation,frameObjects:selected.map(name=>markers.get(name))};},
   selectAll(action){componentSeat.changed(()=>{selected=action==='deselect'?[]:plan.joints.map(j=>j.name);active=selected.includes(active)?active:selected[0]??null;draft=null;placeProxy();repaint();});},
   pick(event,{camera,canvas}){const r=canvas.getBoundingClientRect(),ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2((event.clientX-r.left)/r.width*2-1,1-(event.clientY-r.top)/r.height*2),camera);const hit=ray.intersectObjects([...markers.values()],false)[0];if(hit)operations.select({name:hit.object.name,extend:event.shiftKey});},
  });
  unsubscribe=edits.subscribe(state=>{if(disposed)return;if(!state.active&&!state.replaying){draft=null;placeProxy();}refresh();});
  if(baseline.rest_authoring.view)session.setView(baseline.rest_authoring.view);else operations.frame();
  win.kaminosSelection.set([asset.id],asset.id);
  if(loaded.startingBody)operations.startFrom({id:loaded.startingBody});
 }catch(e){componentSeat?.dispose();unsubscribe();edits.discard(entry=>[target,referenceTarget,bodyTarget].includes(entry.id));edits.unregister(target);edits.unregister(referenceTarget);edits.unregister(bodyTarget);proxy.removeFromParent();await session.dispose();throw e;}
 function drawReference(){
  for(const child of [...referenceRoot.children]){child.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});referenceRoot.remove(child);}
  referenceRoot.name=reference.label??'Reference skeleton';referenceRoot.userData.proportionReference={id:atlas?.activeReference??null,source:structuredClone(reference.source??null)};
  const p=reference.jointNames.map((_,i)=>reference.positions.slice(i*3,i*3+3));referenceRoot.add(links(reference.jointNames.map((name,i)=>({name,parent:reference.parents[i]})),p,0xdd96ff).mesh);
  for(const v of p){const marker=new THREE.Mesh(new THREE.SphereGeometry(.012,8,6),new THREE.MeshBasicMaterial({color:0xdd96ff,depthTest:false}));marker.position.fromArray(v);referenceRoot.add(marker);}
 }
 return {read,operations,async dispose(){
  if(disposed)return;shapeControls?.dispose();componentSeat?.dispose();controlSeat?.dispose();unsubscribe();edits.discard(entry=>[target,referenceTarget,bodyTarget,asset.id,referenceAsset?.id].includes(entry.id)||Object.keys(entry.before?.roots??{}).some(id=>id===asset.id||id===referenceAsset?.id));edits.unregister(target);edits.unregister(referenceTarget);edits.unregister(bodyTarget);proxy.removeFromParent();disposed=true;await session.dispose();
 },mount({root:panel,document,invoke}){
  const properties=document.createElement('section'),playback=document.createElement('div'),title=document.createElement('h3'),hint=document.createElement('p'),selection=document.createElement('p'),options=document.createElement('div');
  title.textContent='Rest skeleton';properties.append(title,hint,selection,options);properties.style.cssText='font-size:12px;line-height:1.45';
  shapeControls=mountSkeletonShapeControls({document,properties,invoke,edits,target,host,read:()=>({plan,atlas,editMode,selected}),onError:e=>{hint.textContent=e.message;}});
  for(const [key,label]of[['mirror','Mirror L/R'],['descendants','Move branch']]){
   const row=document.createElement('label'),input=document.createElement('input');row.style.display='block';input.type='checkbox';input.dataset.restOption=key;input.onchange=()=>{input.blur();invoke('options',{[key]:input.checked}).catch(e=>{hint.textContent=e.message;});};row.append(input,label);options.append(row);
  }
  const files=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Skeleton file';files.append(summary);const fileHint=document.createElement('p');fileHint.textContent='Save anatomy here. Scene Save retains placement, but cannot reconstruct these rest joints yet. Opening an older edit of this same joint graph keeps this comparison atlas.';files.append(fileHint);
  const status=document.createElement('output');status.style.display='block';files.append(status);
  const save=document.createElement('button');save.type='button';save.textContent='Save skeleton…';save.onclick=async()=>{try{
   const value=await invoke('export'),text=JSON.stringify(value,null,2)+'\n';if(typeof win.showSaveFilePicker==='function'){
    const handle=await win.showSaveFilePicker({suggestedName:'authored-skeleton.json',types:[{description:'Skeleton plan JSON',accept:{'application/json':['.json']}}]});const writer=await handle.createWritable();await writer.write(text);await writer.close();status.textContent='Saved '+handle.name;
   }else{const url=URL.createObjectURL(new Blob([text],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='authored-skeleton.json';a.click();URL.revokeObjectURL(url);status.textContent='Downloaded skeleton';}
  }catch(e){if(e.name!=='AbortError')status.textContent=e.message;}};
  const open=document.createElement('button'),file=document.createElement('input');open.type='button';open.textContent='Open skeleton…';file.type='file';file.accept='.json,application/json';file.hidden=true;open.onclick=()=>file.click();file.onchange=async()=>{try{const saved=validateRestPlan(JSON.parse(await file.files[0].text()));if(!saved.rest_authoring)throw Error('Choose a saved authoring skeleton');const parents=new Map(plan.joints.map(j=>[j.name,j.parent])),sameGraph=saved.joints.length===plan.joints.length&&saved.joints.every(j=>parents.has(j.name)&&parents.get(j.name)===j.parent);await win.kaminosWorkbenchExperiments.open('marionette/rest-skeleton',{plan:saved,...(!saved.rest_authoring.proportionAtlas&&sameGraph&&atlas?{proportion_atlas:atlas}:{})});}catch(e){status.textContent=e.message;}finally{file.value='';}};
  files.append(save,open,file);properties.append(files);panel.textContent='Select the skeleton. Tab edits joints. The purple reference is a separate scene object.';
  const proportions=document.createElement('details'),proportionTitle=document.createElement('summary'),referenceChoice=document.createElement('select'),comparison=document.createElement('div'),proportionNote=document.createElement('p');
  proportions.open=true;proportions.dataset.proportionAtlas='';proportionTitle.textContent='Proportions · reference comparison';proportions.append(proportionTitle);referenceChoice.setAttribute('aria-label','Reference skeleton');
  if(atlas){for(const r of atlas.references){const o=document.createElement('option');o.value=r.id;o.textContent=r.label;referenceChoice.append(o);}referenceChoice.onchange=()=>{referenceChoice.blur();invoke('reference',{id:referenceChoice.value}).catch(e=>{proportionNote.textContent=e.message;});};proportions.append(referenceChoice,proportionNote,comparison);properties.append(proportions);}
  const format=(v,unit)=>v===null?'—':unit==='degrees'?v.toFixed(1)+'°':unit==='fraction'?(v*100).toFixed(3)+'%':v.toFixed(3);
  refresh=()=>{shapeControls.refresh();hint.textContent=error??(editMode?'Edit Mode · click joints · Shift-click adds · G / R / S · Tab returns to Object Mode':'Object Mode · G / R / S places the whole skeleton · Tab edits its joints');selection.hidden=options.hidden=!editMode;selection.textContent=selected.length===1?active:`${selected.length} joints · ${active}`;for(const input of options.querySelectorAll('input'))input.checked=input.dataset.restOption==='mirror'?mirror:descendants;
   if(atlas){const measurement=measureProportionAtlas(plan,atlas),r=measurement.references.find(r=>r.id===atlas.activeReference);referenceChoice.value=r.id;proportionNote.textContent='Rest geometry only · not motion support. '+(measurement.status!=='measured'||r.comparison.reference.status!=='measured'?'Partial/unmeasurable; — means unmeasured. ':'')+r.label+' · '+r.source.sha256.slice(0,8);comparison.replaceChildren();
    const table=document.createElement('table');table.style.cssText='width:100%;font-size:11px;border-collapse:collapse';const head=document.createElement('tr');for(const label of ['Measure','Yours','Ref.','Δ']){const th=document.createElement('th');th.textContent=label;th.style.cssText='padding:3px 4px;text-align:'+(label==='Measure'?'left':'right');head.append(th);}table.append(head);
    const order=['shoulderWidth','hipWidth','shoulderHipRatio','foreReach','hindReach','foreHindRatio','foreProximalFraction','hindProximalFraction','foreBend','hindBend','foreFootForward','hindFootForward','foreAsymmetry','hindAsymmetry'];
    for(const id of order){const row=r.comparison.rows.find(x=>x.id===id);if(!row)continue;const tr=document.createElement('tr');tr.dataset.proportion=id;tr.style.background=editMode&&selected.some(n=>row.joints.includes(n))?'#ad6b162b':'';const delta=row.delta===null?'—':row.unit==='degrees'?(row.delta>=0?'+':'')+row.delta.toFixed(1)+'°':row.unit==='fraction'?(row.delta>=0?'+':'')+(row.delta*100).toFixed(3)+'pp':row.relativeDelta===null?'—':(row.relativeDelta>=0?'+':'')+(row.relativeDelta*100).toFixed(0)+'%';for(const [i,label]of [row.label,format(row.candidate,row.unit),format(row.reference,row.unit),delta].entries()){const td=document.createElement('td');td.textContent=label;td.style.cssText='padding:3px 4px;text-align:'+(i?'right':'left');tr.append(td);}table.append(tr);}comparison.append(table);
    const missing=[...measurement.candidate.missing,...r.comparison.reference.missing];if(missing.length){const note=document.createElement('p');note.textContent=missing.join('; ');comparison.append(note);}
   }
  };
  controlSeat=host.controls.mountObject({asset,properties,playback});refresh();
 }};
}
export default {id:'marionette/rest-skeleton',title:'Creature · rest skeleton authoring',create:createRestSkeletonEditor};
