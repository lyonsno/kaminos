import * as T from '../lib/three.core.js';
import {emptyMechanism,checkedMechanism,appendJoint,moveJoint,connectPiston,evaluate,frames,removeBranch} from './link-workshop/model.mjs';
import {mechanismHistory} from './link-workshop/history.mjs';
import {MECHANISM_SOURCE} from './link-workshop/record.mjs';
import {attachmentFrame,createAttachmentFollower} from './link-workshop/attachments.mjs';
import {createMechanismView} from './link-workshop/view.mjs';

export async function createMechanismController({host,inputs={},record=()=>{}}){
 const document=host.controls.document,win=document.defaultView,edits=win.kaminosSceneEdits;
 if(!edits||!host.controls.components)throw Error('Native component editing is required');
 const session=await host.scene.open(),root=inputs.root??new T.Group(),proxy=new T.Object3D();root.name='Link workshop';
 let model=checkedMechanism(inputs.root?.userData.linkMechanism??inputs.recipe??emptyMechanism()),selected=model.nodes.length-1,mode='build',tool='draw',editing=false,playing=false,time=0,t=0,disposed=false,refresh=()=>{},seat,controls;
 let target,whole;
 const grid=new T.GridHelper(30,60,0x637d88,0x344851);grid.rotation.x=Math.PI/2;grid.position.z=-.28;grid.material.transparent=true;grid.material.opacity=.35;grid.raycast=()=>{};root.add(grid);
 const origin=new T.Mesh(new T.SphereGeometry(.1,12,8),new T.MeshBasicMaterial({color:0x59dee2}));root.add(origin);
 root.userData.linkMechanism=model;
 const visual=new T.Group();root.add(visual);const view=createMechanismView(visual),asset=await session.attach(root,{owned:!inputs.root,metadata:{label:root.name,type:'pbr',source:MECHANISM_SOURCE,mechanism:model}});root.parent.add(proxy);
 const objects=()=>host.scene.objects?.()??[{id:asset.id,object:root}],history=mechanismHistory(edits,asset.id,objects),follower=createAttachmentFollower(root,objects);let cycle=0,removeKeys=()=>{};
 let pistonStart=null,snap=true,status,fields=[],stop=()=>{},unsubscribe=()=>{};
 const ensure=()=>{if(disposed||!root.parent)throw Error('Workshop removed; Undo or reopen it');};
 const read=()=>({objectId:asset.id,recipe:structuredClone(model),mode,tool,selected,editing,playing,cycle,fraction:t,points:evaluate(model,t),pistonStart,view:session.readView(),motion:'authored joint kinematics; pistons follow attachment distance'});
 function putProxy(){if(selected<0||!model.nodes[selected])return;root.updateWorldMatrix(true,false);const f=frames(model,t)[selected],p=new T.Vector3(...f.point,0).applyMatrix4(root.matrixWorld);proxy.position.copy(p);proxy.quaternion.copy(root.getWorldQuaternion(new T.Quaternion())).multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0,0,1),f.angle));proxy.scale.set(model.nodes[selected].length??1,1,1);proxy.updateMatrixWorld(true);}
 function update(){root.userData.linkMechanism=model;follower.update(model,t);view.update(model,t,selected,!playing&&mode!=='build');grid.visible=editing&&mode==='build';origin.visible=!model.nodes.length;if(!edits.state().active)putProxy();session.redraw();refresh();}
 function pause(){playing=false;stop();stop=()=>{};update();}
 function resetPose(){pause();cycle=mode==='B'?.5:0;t=mode==='B'?1:0;update();}
 function apply(next,label,{reset=true}={}){ensure();if(reset)resetPose();else pause();edits.apply(whole,{recipe:checkedMechanism(next)},label);record({kind:'links.edit',phase:'applied',effective:read()});return read();}
 const snapshot=()=>({recipe:structuredClone(model)});
 whole=history.register('recipe',{read:snapshot,check:v=>({recipe:checkedMechanism(v.recipe)}),write:v=>{model=checkedMechanism(v.recipe);selected=model.nodes.length?Math.max(0,Math.min(selected,model.nodes.length-1)):-1;pistonStart=null;follower.reset();update();}});
 function handleRead(joint=selected,requestedMode=mode){
  const f=frames(model,requestedMode==='B'?1:0)[joint];if(!f)throw Error('Choose an existing joint');
  root.updateWorldMatrix(true,false);const position=new T.Vector3(...f.point,0).applyMatrix4(root.matrixWorld),q=root.getWorldQuaternion(new T.Quaternion()).multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0,0,1),f.angle)),e=new T.Euler().setFromQuaternion(q);
  return {recipe:structuredClone(model),joint,mode:requestedMode,position:position.toArray(),rotation:[e.x,e.y,e.z],scale:[model.nodes[joint].length??1,1,1]};
 }
 target=history.register('joint',{read:handleRead,readForReplay:v=>handleRead(v.joint,v.mode),check:v=>{if(playing)throw Error('Stop playback to edit joints');checkedMechanism(v.recipe);if(!v.recipe.nodes[v.joint]||!['position','rotation','scale'].every(k=>Array.isArray(v[k])&&v[k].length===3&&v[k].every(Number.isFinite)))throw Error('Finite joint transform required');return structuredClone(v);},write:v=>{
  resetPose();selected=v.joint;const base=v.recipe,n=base.nodes[selected],f=frames(base,v.mode==='B'?1:0)[selected];root.updateWorldMatrix(true,false);const p=new T.Vector3(...v.position).applyMatrix4(root.matrixWorld.clone().invert());
  model=checkedMechanism(base);
  if(!edits.state().active){update();return;}
  const oldWorld=new T.Vector3(...f.point,0).applyMatrix4(root.matrixWorld),moved=oldWorld.distanceTo(new T.Vector3(...v.position))>1e-7;
  const resized=v.mode==='build'&&n.parent!==null&&Math.abs(v.scale[0]-n.length)>1e-7;
  if(moved&&!resized)model=moveJoint(base,selected,[p.x,p.y],v.mode);
  else if(n.parent!==null){const q=new T.Quaternion().setFromEuler(new T.Euler(...v.rotation)).premultiply(root.getWorldQuaternion(new T.Quaternion()).invert()),e=new T.Euler().setFromQuaternion(q),parent=frames(base,v.mode==='B'?1:0)[n.parent],length=v.mode==='build'?v.scale[0]:n.length;model=moveJoint(base,selected,[parent.point[0]+Math.cos(e.z)*length,parent.point[1]+Math.sin(e.z)*length],v.mode);}
  update();
 }});
 seat=host.controls.components.register(asset.id,{enter(){editing=true;resetPose();update();},exit(){editing=false;update();},target(){if(selected<0)return null;if(!edits.state().active)putProxy();return {id:target,type:'link-joint',label:`Joint ${selected+1}`,object:proxy,read:handleRead,frameObjects:[view.markers()[selected]]};},pick(event,{camera,canvas}){
  if(playing){pause();}const r=canvas.getBoundingClientRect(),ray=new T.Raycaster();ray.setFromCamera(new T.Vector2((event.clientX-r.left)/r.width*2-1,1-(event.clientY-r.top)/r.height*2),camera);
  const hit=ray.intersectObjects(view.markers(),false)[0];
  if(hit){const id=hit.object.userData.joint;seat.changed(()=>{selected=id;update();});if(tool==='piston'&&mode==='build'){if(pistonStart===null)pistonStart=id;else{try{apply(connectPiston(model,pistonStart,id),'Connect piston');}catch(e){if(status)status.textContent=e.message;}pistonStart=null;}refresh();}return;}
  if(mode!=='build'||tool!=='draw')return;
  root.updateWorldMatrix(true,false);const plane=new T.Plane(new T.Vector3(0,0,1),0).applyMatrix4(root.matrixWorld),p=ray.ray.intersectPlane(plane,new T.Vector3());if(!p)return;p.applyMatrix4(root.matrixWorld.clone().invert());const at=[p.x,p.y].map(x=>snap?Math.round(x*4)/4:x);
  try{const next=appendJoint(model,event.shiftKey?null:(selected<0?null:selected),at);apply(next,'Draw link');seat.changed(()=>{selected=model.nodes.length-1;update();});}catch(e){if(status)status.textContent=e.message;}
 }});
 unsubscribe=edits.subscribe(()=>{if(!disposed){putProxy();refresh();}});
 const operations={
  append({parent=selected<0?null:selected,point}){const next=appendJoint(model,parent,point);apply(next,'Draw link');seat.changed(()=>{selected=model.nodes.length-1;update();});return read();},
  select({joint}){if(!model.nodes[joint])throw Error('Unknown joint');seat.changed(()=>{selected=joint;update();});return read();},
  move({joint=selected,point,mode:requested=mode}){return apply(moveJoint(model,joint,point,requested),'Move joint');},
  piston({a,b}){return apply(connectPiston(model,a,b),'Connect piston');},
  mode({value}){if(!['build','A','B'].includes(value))throw Error('Unknown mode');seat.changed(()=>{pause();mode=value;cycle=value==='B'?.5:0;t=value==='B'?1:0;pistonStart=null;update();});return read();},
  tool({value}){if(!['draw','select','piston'].includes(value))throw Error('Unknown tool');tool=value;pistonStart=null;refresh();return read();},
  play(){ensure();if(playing)return read();if(!model.nodes.some(n=>n.parent!==null))throw Error('Draw a link first');playing=true;stop=session.onFrame(({deltaSeconds})=>{if(edits.state().active)return;cycle=(cycle+deltaSeconds/model.period)%1;t=(1-Math.cos((cycle+(model.phase??0))*2*Math.PI))/2;update();});refresh();return read();},
  pause(){pause();return read();},reset(){resetPose();return read();},seek({cycle:value}){if(!Number.isFinite(value))throw Error('Finite cycle position required');pause();cycle=((value%1)+1)%1;t=(1-Math.cos((cycle+(model.phase??0))*2*Math.PI))/2;update();return read();},phase({value}){return apply({...model,phase:value},'Change phase');},remove({joint=selected}={}){return apply(removeBranch(model,joint),'Remove branch');},
  attach({objectId,joint=selected}){const entry=objects().find(e=>e.id===objectId);if(!entry||entry.object===root||!model.nodes[joint])throw Error('Choose another scene object and a joint');if(!['glb','pbr','procedural-mesh'].includes(entry.type)||entry.object.userData.linkMechanism)throw Error('Attach a mesh object; simulation sources and other mechanisms need their own binding');if(objects().some(e=>e.object?.userData.linkMechanism?.attachments?.some(a=>a.objectId===objectId)))throw Error('Object is already attached; detach it first');pause();return apply({...model,attachments:[...(model.attachments??[]),{objectId,joint,offset:attachmentFrame(root,model,joint,t,entry.object)}]},'Attach object',{reset:false});},
  detach({objectId}){return apply({...model,attachments:(model.attachments??[]).filter(a=>a.objectId!==objectId)},'Detach object',{reset:false});},
  period({seconds}){return apply({...model,period:seconds},'Change cycle');},
  restore(recipe){apply(recipe,'Open mechanism');seat.changed(()=>{selected=model.nodes.length-1;update();});return read();},snapshot(){return structuredClone(model);},
  frame(){if(host.scene.frame){host.scene.frame([visual,...objects().filter(e=>(model.attachments??[]).some(a=>a.objectId===e.id)).map(e=>e.object)]);return read();}const points=[...evaluate(model,0),...evaluate(model,1)],box=new T.Box3();for(const p of points)box.expandByPoint(new T.Vector3(...p,0).applyMatrix4(root.matrixWorld));if(box.isEmpty())box.setFromCenterAndSize(new T.Vector3(0,2,0),new T.Vector3(6,4,1));const c=box.getCenter(new T.Vector3()),d=Math.max(box.getSize(new T.Vector3()).length(),4);session.setView({position:[c.x,c.y,c.z+d*1.6],target:c.toArray(),fov:38});return read();},
 };
 update();if(!inputs.root){operations.frame();win.kaminosSelection.set([asset.id],asset.id);}
 return {read,operations,root,asset,tick(){if(!playing&&root.parent){if(follower.update(model,t))session.redraw();root.userData.linkMechanism=model;refresh();}},mount({root:panel,document,invoke}){
  panel.innerHTML='<h3>Link workshop</h3><p>Select the workshop and press <b>Tab</b>. Click to place a fixed anchor, then click to extend links. Click an existing joint to branch from it. Shift-click starts another fixed anchor.</p><p>Choose <b>Select / move</b> to adjust joints with G / R / S. In Pose A or B, moving a joint turns its link without stretching it. Tab returns to whole-object placement.</p>';
  const properties=document.createElement('section'),playback=document.createElement('div'),top=document.createElement('div'),transport=document.createElement('div');
  properties.innerHTML='<h3>Mechanism</h3>';playback.style.cssText='position:absolute;inset:0;pointer-events:none;z-index:35';
  for(const el of [top,transport]){el.style.cssText='position:absolute;left:16px;padding:6px;background:#18272de8;border:1px solid #5a707b;border-radius:7px;pointer-events:auto;max-width:calc(100% - 32px);box-sizing:border-box';playback.append(el);}top.style.top='64px';transport.style.bottom='44px';
  status=document.createElement('p');status.setAttribute('role','status');const buttons=[];
  const button=(parent,label,fn,active)=>{const b=document.createElement('button');b.textContent=label;b.type='button';b.className='btn';b.style.margin='3px';b.onclick=()=>Promise.resolve().then(fn).catch(e=>status.textContent=e.message);parent.append(b);buttons.push({b,active});return b;};
  const modes=document.createElement('div');top.append(modes);for(const [label,value]of [['Build','build'],['Pose A','A'],['Pose B','B']])button(modes,label,()=>invoke('mode',{value}),()=>mode===value);
  const tools=document.createElement('div');top.append(tools);for(const [label,value]of [['Draw links','draw'],['Select / move','select'],['Connect piston','piston']])button(tools,label,()=>invoke('tool',{value}),()=>tool===value);
  button(tools,'Delete branch',()=>invoke('remove',{}));
  const hint=document.createElement('div');hint.style.cssText='font-size:12px;padding:4px;color:#bbced4';top.append(hint);
  const label=document.createElement('label'),toggle=document.createElement('input');toggle.type='checkbox';toggle.checked=snap;toggle.onchange=()=>snap=toggle.checked;label.style.cssText='display:block;margin:10px 0';label.append(toggle,' Snap to ¼-unit grid');properties.append(label);
  const numerics=[];
  const number=(parent,label,readValue,writeValue,step)=>{const row=document.createElement('label'),grip=document.createElement('span'),input=document.createElement('input');row.style.cssText='display:flex;gap:10px;align-items:center;justify-content:space-between;margin:8px 0';grip.textContent=label;input.type='number';input.step='any';input.className='transform-input';input.style.width='85px';input.setAttribute('aria-label',label);input.oninput=()=>{if(input.value.trim())Promise.resolve(writeValue(Number(input.value))).catch(e=>status.textContent=e.message);};fields.push(host.controls.installNumberDrag({input,grip,step}));row.append(grip,input);parent.append(row);numerics.push({input,readValue});return input;};
  number(properties,'Cycle seconds',()=>model.period,v=>invoke('period',{seconds:v}),.1);
  number(properties,'Phase offset',()=>model.phase??0,v=>invoke('phase',{value:v}),.01);
  const play=button(transport,'Play',()=>invoke(playing?'pause':'play'),()=>playing);button(transport,'Return to pose',()=>invoke('reset'));button(transport,'Frame mechanism',()=>invoke('frame'));
  number(transport,'Cycle position',()=>cycle,v=>invoke('seek',{cycle:v}),.01);
  const attachmentTitle=document.createElement('h4');attachmentTitle.textContent='Attach at selected joint';properties.append(attachmentTitle);
  const choices=document.createElement('select');choices.setAttribute('aria-label','Object to attach');choices.style.cssText='max-width:100%;background:#24272b;color:#ddd;border:1px solid #555;padding:5px';properties.append(choices);
  button(properties,'Attach object',()=>invoke('attach',{objectId:choices.value}));
  const attached=document.createElement('div');properties.append(attached);let choiceKey='',attachedKey='';const relatedAssets=[];
  button(properties,'Save scene…',()=>win.saveScene());button(properties,'Open saved scene…',()=>win.openSavedScene());
  if(win.kaminosMechanisms)button(properties,'Add another mechanism',()=>win.kaminosMechanisms.add());
  const extras=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Recipe import / export';extras.append(summary);properties.append(extras);
  button(extras,'Export JSON…',async()=>{const recipe=await invoke('snapshot'),url=URL.createObjectURL(new Blob([JSON.stringify(recipe,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='mechanism.links.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),0);});
  const file=document.createElement('input');file.type='file';file.accept='.json';file.hidden=true;file.setAttribute('aria-label','Import mechanism');file.onchange=async()=>{try{if(file.files[0])await invoke('restore',JSON.parse(await file.files[0].text()));}catch(e){status.textContent=e.message;}finally{file.value='';}};button(extras,'Import JSON…',()=>file.click());extras.append(file);properties.append(status);
  refresh=()=>{
   status.textContent=`${playing?'Playing':editing?'Editing':'Tab to edit'} · ${model.nodes.filter(n=>n.parent!==null).length} links · ${model.pistons.length} pistons${selected>=0?' · Joint '+(selected+1):''}`;
   hint.textContent=pistonStart!==null?'Choose the second joint · Esc cancels':!editing?'Tab enters joint editing':mode!=='build'?'G / R pose the selected link · lengths stay fixed':tool==='draw'?'Click to extend · click a joint to branch · Shift-click a new anchor':tool==='piston'?'Click two joints to connect a piston':'Select a joint · G / R / S edit · Esc cancels';
   tools.hidden=mode!=='build';play.textContent=playing?'Pause':'Play';
   for(const {input,readValue}of numerics)if(document.activeElement!==input||input.readOnly)input.value=String(Math.round(readValue()*10000)/10000);
   for(const {b,active}of buttons){b.style.background=active?.()?'#387f88':'';if(active)b.setAttribute('aria-pressed',String(!!active()));}
   const entries=objects(),available=entries.filter(e=>e.object!==root&&['glb','pbr','procedural-mesh'].includes(e.type)&&!e.object.userData.linkMechanism&&!entries.some(m=>m.object?.userData.linkMechanism?.attachments?.some(a=>a.objectId===e.id)));
   const key=JSON.stringify(available.map(e=>[e.id,e.label]));if(key!==choiceKey){choiceKey=key;const old=choices.value;choices.replaceChildren();choices.disabled=!available.length;if(!available.length){const option=document.createElement("option");option.textContent="Add a mesh to attach";choices.append(option);}for(const e of available){const option=document.createElement('option');option.value=e.id;option.textContent=e.label??e.id;choices.append(option);}if(available.some(e=>e.id===old))choices.value=old;}
   const attachedEntries=(model.attachments??[]).map(a=>({...a,entry:entries.find(e=>e.id===a.objectId)})),ak=JSON.stringify(attachedEntries.map(a=>[a.objectId,a.joint,a.entry?.label,!!a.entry]));
   if(ak!==attachedKey){attachedKey=ak;attached.replaceChildren();relatedAssets.splice(0);for(const a of attachedEntries){const row=document.createElement('div');row.style.margin='6px 0';const select=document.createElement('button');select.className='btn';select.textContent=(a.entry?.label??'Missing object: '+a.objectId)+' · joint '+(a.joint+1);select.onclick=()=>host.scene.select(a.objectId);select.disabled=!a.entry;const detach=document.createElement('button');detach.className='btn';detach.textContent='Detach';detach.onclick=()=>invoke('detach',{objectId:a.objectId}).catch(e=>status.textContent=e.message);row.append(select,detach);attached.append(row);if(a.entry)relatedAssets.push({id:a.objectId,root:a.entry.object});}}
  };
  controls=host.controls.mountObject({asset,relatedAssets,properties,playback});
  const keys=event=>{if(playback.hidden||event.defaultPrevented||event.repeat||event.target.closest?.('input,textarea,select,[contenteditable="true"]')||edits.state().active)return;if(event.code==='Space'&&event.shiftKey&&!event.ctrlKey&&!event.metaKey&&!event.altKey){event.preventDefault();event.stopImmediatePropagation();invoke(playing?'pause':'play').catch(e=>status.textContent=e.message);}else if(event.key==='Escape'&&editing){pistonStart=null;tool='select';refresh();}};
  document.addEventListener('keydown',keys);removeKeys=()=>document.removeEventListener('keydown',keys);refresh();

 },async dispose(){if(disposed)return;playing=false;stop();seat.dispose();unsubscribe();history.dispose();follower.dispose();controls?.dispose();for(const f of fields)f.dispose();proxy.removeFromParent();disposed=true;removeKeys();await session.dispose();view.dispose();root.remove(grid,origin,visual);grid.geometry.dispose();grid.material.dispose();origin.geometry.dispose();origin.material.dispose();}};
}
export default {id:'link-workshop',title:'Link workshop',async create(context){
 const service=context.host.controls.document.defaultView.kaminosMechanisms;
 if(!service)return createMechanismController(context);
 const runtime=await service.add(context.inputs.recipe);runtime.operations.frame();return {read:runtime.read,operations:runtime.operations,mount({root}){root.textContent='Mechanisms are saved with the scene. Select one to edit its links and attachments. Closing this experiment leaves your construction in the scene.';},dispose(){}};
}};

