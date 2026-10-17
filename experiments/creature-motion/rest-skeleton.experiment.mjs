import * as THREE from '../../lib/three.core.js';
import {validateRestPlan,restHeads,withRestHeads,moveRestJoint,authoredRestPlan} from './rest-skeleton-edit.mjs';

const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export async function loadRestEditorInput(inputs,{fetchImpl=globalThis.fetch}={}){
 if(inputs.recipe){if(!/^[a-f0-9]{64}$/i.test(inputs.recipe_sha256??'')||inputs.plan||inputs.plan_url)throw Error('A recipe needs its digest and no competing plan');const r=await fetchImpl(inputs.recipe,{cache:'no-store'});if(!r.ok)throw Error('Recipe HTTP '+r.status);const bytes=await r.arrayBuffer();if(await digest(bytes)!==inputs.recipe_sha256)throw Error('Recipe digest mismatch');inputs=JSON.parse(new TextDecoder().decode(bytes));if(inputs.recipe)throw Error('Nested recipes are not supported');}
 let plan,sha=inputs.baseline_sha256;
 if(inputs.plan){if(inputs.plan_url)throw Error('Choose a plan file or inline plan');plan=validateRestPlan(inputs.plan);sha=plan.rest_authoring?.baselineSha256??sha;}
 else {if(!inputs.plan_url||!/^[a-f0-9]{64}$/i.test(inputs.plan_sha256??''))throw Error('Explicit plan URL and digest required');const r=await fetchImpl(inputs.plan_url,{cache:'no-store'});if(!r.ok)throw Error('Plan HTTP '+r.status);const bytes=await r.arrayBuffer();if(await digest(bytes)!==inputs.plan_sha256)throw Error('Plan digest mismatch');plan=validateRestPlan(JSON.parse(new TextDecoder().decode(bytes)));sha=plan.rest_authoring?.baselineSha256??inputs.plan_sha256;}
 const displayMatrix=plan.rest_authoring?.displayMatrix??inputs.display_matrix,reference=plan.rest_authoring?.reference??inputs.reference??null;
 const result=authoredRestPlan(plan,{baselineSha256:sha,displayMatrix,reference,view:plan.rest_authoring?.view??inputs.view??null});
 const m=new THREE.Matrix4().fromArray(result.rest_authoring.displayMatrix);
 if(Math.abs(m.determinant())<1e-12||m.elements[3]!==0||m.elements[7]!==0||m.elements[11]!==0||m.elements[15]!==1)throw Error('Invertible affine display frame required');
 if(reference){const J=reference.jointNames?.length;if(!J||reference.parents?.length!==J||reference.positions?.length!==J*3||!reference.positions.every(Number.isFinite)||reference.parents.some((p,j)=>!Number.isInteger(p)||p< -1||p>=j))throw Error('Invalid reference skeleton');}
 return {plan:result,baselineSha256:sha,displayMatrix:m,reference};
}

function links(plan,positions,color){
 const g=new THREE.BufferGeometry(),J=plan.length,names=new Map(plan.map((j,i)=>[j.name,i]));
 const edges=plan.map((j,i)=>[typeof j.parent==='number'?j.parent:names.get(j.parent)??-1,i]).filter(([p])=>p>=0);
 const a=new THREE.BufferAttribute(new Float32Array(edges.length*6),3);g.setAttribute('position',a);
 const mesh=new THREE.LineSegments(g,new THREE.LineBasicMaterial({color,depthTest:false,transparent:true,opacity:.75}));mesh.renderOrder=5;mesh.raycast=()=>{};
 const update=values=>{let k=0;for(const [p,j]of edges)for(const index of[p,j])for(const v of values[index])a.array[k++]=v;a.needsUpdate=true;g.computeBoundingSphere();};update(positions);
 return {mesh,update};
}

export async function createRestSkeletonEditor({host,inputs={},record=()=>{}},{fetchImpl=globalThis.fetch}={}){
 const loaded=await loadRestEditorInput(inputs,{fetchImpl}),baseline=structuredClone(loaded.plan),matrix=loaded.displayMatrix,inverse=matrix.clone().invert(),reference=loaded.reference;
 const document=host.controls.document,session=await host.scene.open(),edits=document.defaultView?.kaminosSceneEdits;
 if(!edits) {await session.dispose();throw Error('Shared scene edit ledger unavailable');}
 let plan=structuredClone(baseline),selected=plan.joints.find(j=>j.name.includes('shoulder'))?.name??plan.joints[0].name,mirror=false,descendants=false,disposed=false,error=null,changed=false,refresh=()=>{},stop=()=>{},unlisten=()=>{},referenceSide='x';
 const handles=[],seats=[],by=new Map(),target='@rest-skeleton:'+crypto.randomUUID();let referenceRoot,baselineRoot,referenceMode='side',showBaseline=false;
 const toWorld=p=>new THREE.Vector3(...p).applyMatrix4(matrix).toArray(),toLocal=p=>new THREE.Vector3(...p).applyMatrix4(inverse).toArray();
 const positions=()=>plan.joints.map(j=>toWorld(j.head));
 const gather=()=>Object.fromEntries(handles.map(h=>[h.name,toLocal(h.asset.root.position.toArray())]));
 function active(){if(disposed)throw Error('Rest skeleton editor disposed');if(handles.some(h=>!h.asset.root.parent))throw Error('Joint handle removed; Undo removal or reopen the skeleton');}
 function sync(){active();const heads=gather();if(plan.joints.some(j=>j.head.some((v,k)=>Math.abs(v-heads[j.name][k])>1e-9))){plan=withRestHeads(plan,heads);changed=true;error=null;graph.update(positions());refresh();}return plan;}
 function install(next){active();next=validateRestPlan(next);if(!same(next.joints.map(j=>[j.name,j.parent]),baseline.joints.map(j=>[j.name,j.parent])))throw Error('This editing session preserves the loaded topology');
  plan=next;for(const h of handles){h.asset.root.position.fromArray(toWorld(plan.joints.find(j=>j.name===h.name).head));host.scene.refreshPresentation(h.asset);}graph.update(positions());error=null;changed=true;session.redraw();refresh();}
 function snapshot(){sync();return {heads:restHeads(plan)};}
 const checked=value=>({heads:restHeads(withRestHeads(baseline,value.heads))});
 const exported=()=>{sync();return authoredRestPlan(plan,{baselineSha256:loaded.baselineSha256,displayMatrix:matrix.toArray(),reference,view:session.readView()});};
 const graph=links(plan.joints,positions(),0x4ce4ed),graphRoot=new THREE.Group();graphRoot.name='Rest skeleton connections';graphRoot.add(graph.mesh);
 const read=()=>{try{sync();}catch(e){error=e.message;}return {status:error?'invalid':'editing-rest-pose',error,selected,mirror,descendants,changed,baselineSha256:loaded.baselineSha256,referenceMode,showBaseline,view:session.readView(),joints:handles.map(h=>({name:h.name,parent:plan.joints.find(j=>j.name===h.name).parent,id:h.asset.id,position:h.asset.root.position.toArray(),head:toLocal(h.asset.root.position.toArray())})),semantics:'Rest-joint edits require new conditioning/generation; no existing clip or skin is modified'};};
 const apply=(next,label)=>{active();sync();return edits.apply(target,{heads:restHeads(next)},label);};
 const operations={
  read,
  select({name,pair=false}={}){active();const h=by.get(name);if(!h)throw Error('Unknown joint');selected=name;const other=name.replace('-left-','-right-')===name?name.replace('-right-','-left-'):name.replace('-left-','-right-');const ids=[h.asset.id];if(pair&&other!==name&&by.has(other))ids.push(by.get(other).asset.id);document.defaultView.kaminosSelection.set(ids,h.asset.id);refresh();return read();},
  move({name=selected,position,mirror:paired=mirror,descendants:branch=descendants}={}){sync();if(!Array.isArray(position)||position.length!==3||!position.every(Number.isFinite))throw Error('Position must have three finite display coordinates');apply(moveRestJoint(plan,{name,position:toLocal(position),mirror:paired,descendants:branch}),'Edit skeleton joint');record({kind:'skeleton.rest.move',phase:'applied',requested:{name,position,mirror:paired,descendants:branch},effective:exported()});return read();},
  options(input={}){active();for(const key of Object.keys(input))if(!['mirror','descendants'].includes(key)||typeof input[key]!=='boolean')throw Error('Unknown editor option');mirror=input.mirror??mirror;descendants=input.descendants??descendants;refresh();return read();},
  reset(){apply(baseline,'Reset rest skeleton');record({kind:'skeleton.rest.reset',phase:'applied'});return read();},
  undo:async()=>{await edits.undo();sync();return read();},redo:async()=>{await edits.redo();sync();return read();},
  export(){const value=exported();record({kind:'skeleton.rest.export',phase:'applied',effective:value});return value;},
  setup(){return {plan:exported()};},
  reference({mode=referenceMode,baseline:visible=showBaseline}={}){active();if(!['off','overlay','side'].includes(mode)||typeof visible!=='boolean')throw Error('Invalid reference display');referenceMode=mode;showBaseline=visible;if(referenceRoot){referenceRoot.visible=mode!=='off';referenceRoot.position.set(0,0,0);if(mode==='side')referenceRoot.position[referenceSide]=1.6;}baselineRoot.visible=visible;session.redraw();refresh();return read();},
  frame({direction='side'}={}){active();const dirs={side:[3,0,0],front:[0,0,3],dorsal:[0,3,.001],perspective:[2,1.7,2]};if(!dirs[direction])throw Error('Unknown view');referenceSide=direction==='side'?'z':'x';operations.reference({});const box=new THREE.Box3();for(const h of handles)box.expandByPoint(h.asset.root.position);const c=box.getCenter(new THREE.Vector3());session.setView({position:c.clone().add(new THREE.Vector3(...dirs[direction])).toArray(),target:c.toArray(),up:[0,1,0]});host.scene.frame([...handles.map(h=>h.asset.root),...(referenceRoot?.visible?[referenceRoot]:[])]);return session.readView();},
 };
 try{
  await session.attach(graphRoot,{owned:true,metadata:{label:graphRoot.name,source:'derived:rest-skeleton-connections'}});
  const baseGraph=links(baseline.joints,positions(),0xe5b95c);baselineRoot=new THREE.Group();baselineRoot.name='Unchanged source skeleton';baselineRoot.add(baseGraph.mesh);baselineRoot.visible=false;await session.attach(baselineRoot,{owned:true,metadata:{label:baselineRoot.name,source:loaded.baselineSha256}});
  if(reference){referenceRoot=new THREE.Group();referenceRoot.name=reference.label??'Reference skeleton';referenceRoot.position.x=1.6;const p=reference.jointNames.map((_,i)=>reference.positions.slice(i*3,i*3+3));const line=links(reference.jointNames.map((name,i)=>({name,parent:reference.parents[i]})),p,0xdd96ff);referenceRoot.add(line.mesh);for(const v of p){const dot=new THREE.Mesh(new THREE.SphereGeometry(.008,8,6),new THREE.MeshBasicMaterial({color:0xdd96ff}));dot.position.fromArray(v);dot.raycast=()=>{};referenceRoot.add(dot);}await session.attach(referenceRoot,{owned:true,metadata:{label:referenceRoot.name,source:typeof reference.source==='string'?reference.source:reference.source?.path??'caller-reference'}});}
  for(const j of plan.joints){const root=new THREE.Mesh(new THREE.SphereGeometry(.019,12,8),new THREE.MeshBasicMaterial({color:j.name.includes('-toe')?0xffa057:0x4ce4ed,depthTest:false}));root.name=j.name;root.renderOrder=10;root.position.fromArray(toWorld(j.head));const asset=await session.attach(root,{owned:true,metadata:{label:j.name,source:'rest-joint:'+j.name}}),h={name:j.name,asset};handles.push(h);by.set(j.name,h);}
  edits.register(target,{read:snapshot,check:checked,write:value=>install(withRestHeads(baseline,value.heads))});
  unlisten=edits.subscribe(()=>{if(disposed)return;try{sync();}catch(e){error=e.message;}refresh();});
  stop=session.onFrame(()=>{try{sync();}catch(e){if(error!==e.message){error=e.message;refresh();}}});
  if(inputs.view??baseline.rest_authoring?.view)session.setView(inputs.view??baseline.rest_authoring.view);else operations.frame({direction:'side'});
 }catch(e){stop();unlisten();edits.discard(entry=>entry.id===target);edits.unregister(target);await session.dispose();throw e;}
 return {read,operations,async dispose(){if(disposed)return;stop();unlisten();for(const seat of seats)seat.dispose();edits.discard(entry=>entry.id===target||Object.keys(entry.before?.roots??{}).some(id=>handles.some(h=>h.asset.id===id))||handles.some(h=>h.asset.id===entry.id));edits.unregister(target);disposed=true;await session.dispose();},mount({root:panel,document,invoke}){
  const initialSelected=selected,tools=document.createElement('section');tools.style.cssText='font-size:12px;line-height:1.4;padding:8px 0';panel.append(tools);
  const title=document.createElement('h3'),note=document.createElement('p'),status=document.createElement('output');title.textContent='Rest skeleton · author proportions';note.textContent='Cyan: editable · orange: toes · purple: source Cat reference. Select joints and G / gizmo to move; Shift-select and S X narrows/widens a pair. Save skeleton JSON for fresh motion generation; Scene Save does not replace it.';tools.append(title,note,status);
  const call=(name,input)=>invoke(name,input).catch(e=>{status.textContent=e.message;});
  const controls=document.createElement('div'),select=document.createElement('select');select.setAttribute('aria-label','Joint');for(const h of handles){const o=document.createElement('option');o.value=h.name;o.textContent=h.name;select.append(o);}select.onchange=()=>call('select',{name:select.value});controls.append(select);
  const button=(label,name,input,where=controls)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=()=>call(name,typeof input==='function'?input():input);where.append(b);return b;};
  button('Select L/R pair','select',()=>({name:selected,pair:true}));button('Undo','undo');button('Redo','redo');button('Reset skeleton','reset');
  const referenceSelect=document.createElement('select');referenceSelect.setAttribute('aria-label','Reference display');for(const [value,text]of[['side','Reference beside'],['overlay','Reference overlay'],['off','Reference off']]){const o=document.createElement('option');o.value=value;o.textContent=text;referenceSelect.append(o);}referenceSelect.onchange=()=>call('reference',{mode:referenceSelect.value});referenceSelect.disabled=!reference;controls.append(referenceSelect);
  const show=document.createElement('label'),ghost=document.createElement('input');ghost.type='checkbox';ghost.onchange=()=>call('reference',{baseline:ghost.checked});show.append(ghost,' Show original');controls.append(show);controls.style.cssText='display:flex;flex-wrap:wrap;gap:5px';tools.append(controls);
  const views=document.createElement('div');views.style.cssText='display:flex;flex-wrap:wrap;gap:5px;margin-top:8px';for(const [name,direction]of[['Side','side'],['Front','front'],['Dorsal','dorsal'],['Perspective','perspective']])button(name,'frame',{direction},views);tools.append(views);
  const fields=[];
  const makeProperties=()=>{const p=document.createElement('section'),h=document.createElement('h3'),hint=document.createElement('p');h.textContent='Joint position · display frame';hint.textContent='Mirror / branch options apply to these fields. Viewport G moves only the selected scene joints.';p.append(h,hint);
   for(const [key,text]of[['mirror','Mirror L/R field edits'],['descendants','Move descendant branch with field edits']]){const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.dataset.restOption=key;input.onchange=()=>call('options',{[key]:input.checked});label.append(input,text);p.append(label);}
   for(let k=0;k<3;k++){const label=document.createElement('label'),grip=document.createElement('span'),field=document.createElement('input');grip.textContent=['X','Y','Z'][k]+' ';field.type='number';field.step='any';field.className='transform-input';field.setAttribute('aria-label','Joint '+['X','Y','Z'][k]);
    // One numeric gesture is one shared history transaction. Mirror and branch
    // coordinates are part of the same complete head snapshot.
    let began=false,base=null;
    const begin=()=>{if(!began){base=structuredClone(sync());edits.begin(target,'Edit joint position');began=true;}};
    const update=()=>{if(!field.value.trim()||!Number.isFinite(Number(field.value)))return;try{begin();const world=toWorld(base.joints.find(j=>j.name===selected).head);world[k]=Number(field.value);const next=moveRestJoint(base,{name:selected,position:toLocal(world),mirror,descendants});edits.preview({heads:restHeads(next)});}catch(e){status.textContent=e.message;}};
    const finish=cancel=>{if(!began)return;try{cancel?edits.cancel():edits.commit();}finally{began=false;base=null;refresh();}};
    field.oninput=update;field.onchange=()=>finish(false);field.onblur=()=>finish(false);field.onkeydown=e=>{if(e.key==='Escape'){finish(true);field.blur();}if(e.key==='Enter'){finish(false);field.blur();}};
    host.controls.installNumberDrag({input:field,grip,step:.005});label.append(grip,field);p.append(label);fields.push({field,k});
   }return p;};
  for(const h of handles){const properties=makeProperties(),playback=document.createElement('div');properties.style.cssText='font-size:12px;line-height:1.4';for(const label of properties.querySelectorAll('label'))label.style.display='block';seats.push(host.controls.mountObject({asset:h.asset,properties,playback,onSelected:()=>{selected=h.name;properties.prepend(tools);refresh();}}));}
  const save=document.createElement('button');save.textContent='Save skeleton JSON';save.type='button';save.onclick=async()=>{try{const plan=await invoke('export'),text=JSON.stringify(plan,null,2)+'\n';if(typeof document.defaultView.showSaveFilePicker==='function'){const file=await document.defaultView.showSaveFilePicker({suggestedName:'authored-skeleton.json',types:[{description:'Skeleton plan JSON',accept:{'application/json':['.json']}}]});const writer=await file.createWritable();await writer.write(text);await writer.close();status.textContent='Saved '+file.name+' — pass this plan to conditioning.';}else{const url=URL.createObjectURL(new Blob([text],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='authored-skeleton.json';a.click();URL.revokeObjectURL(url);status.textContent='Downloaded authored-skeleton.json';}}catch(e){if(e.name!=='AbortError')status.textContent=e.message;}};
  const open=document.createElement('button'),file=document.createElement('input');open.type='button';open.textContent='Open skeleton JSON';file.type='file';file.accept='.json,application/json';file.hidden=true;open.onclick=()=>file.click();file.onchange=async()=>{try{const plan=JSON.parse(await file.files[0].text());validateRestPlan(plan);if(!plan.rest_authoring)throw Error('Open a saved rest-skeleton authoring file');await document.defaultView.kaminosWorkbenchExperiments.open('marionette/rest-skeleton',{plan});}catch(e){status.textContent=e.message;}finally{file.value='';}};tools.append(save,open,file);
  for(const element of tools.querySelectorAll('button,select'))element.style.cssText='background:#292c31;color:#e5e7eb;border:1px solid #454a52;border-radius:4px;padding:4px;font-size:12px;max-width:100%';
  refresh=()=>{select.value=selected;referenceSelect.value=referenceMode;ghost.checked=showBaseline;const h=by.get(selected);if(h){const p=h.asset.root.position.toArray();for(const {field,k}of fields)if(document.activeElement!==field)field.value=String(p[k]);}for(const e of document.querySelectorAll('[data-rest-option]'))e.checked=e.dataset.restOption==='mirror'?mirror:descendants;if(error)status.textContent=error;};refresh();operations.select({name:initialSelected});
 }};
}
export default {id:'marionette/rest-skeleton',title:'Creature · rest skeleton authoring',create:createRestSkeletonEditor};
