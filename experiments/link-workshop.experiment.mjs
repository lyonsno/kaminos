import * as T from '../lib/three.core.js';
import {emptyMechanism,checkedMechanism,appendJoint,moveJoint,connectPiston,evaluate,frames} from './link-workshop/model.mjs';
import {createMechanismView} from './link-workshop/view.mjs';

export default {id:'link-workshop',title:'Link workshop',async create({host,inputs={},record=()=>{}}){
 const document=host.controls.document,win=document.defaultView,edits=win.kaminosSceneEdits;
 if(!edits||!host.controls.components)throw Error('Native component editing is required');
 const session=await host.scene.open(),root=new T.Group(),proxy=new T.Object3D();root.name='Link workshop';
 let model=checkedMechanism(inputs.recipe??emptyMechanism()),selected=model.nodes.length-1,mode='build',tool='draw',editing=false,playing=false,time=0,t=0,disposed=false,refresh=()=>{},seat,controls;
 const target='@link-joint:'+root.uuid,whole='@link-recipe:'+root.uuid,geometryTarget='@link-geometry:'+root.uuid;
 const grid=new T.GridHelper(30,60,0x637d88,0x344851);grid.rotation.x=Math.PI/2;grid.position.z=-.28;grid.material.transparent=true;grid.material.opacity=.35;grid.raycast=()=>{};root.add(grid);
 const origin=new T.Mesh(new T.SphereGeometry(.1,12,8),new T.MeshBasicMaterial({color:0x59dee2}));root.add(origin);
 const view=createMechanismView(root),asset=await session.attach(root,{owned:true,metadata:{label:root.name,type:'experiment',source:'experiment:link-workshop'}});root.parent.add(proxy);
 let pistonStart=null,snap=true,status,fields=[],stop=()=>{},unsubscribe=()=>{};
 const ensure=()=>{if(disposed||!root.parent)throw Error('Workshop removed; Undo or reopen it');};
 const read=()=>({objectId:asset.id,recipe:structuredClone(model),mode,tool,selected,editing,playing,fraction:t,points:evaluate(model,t),bodies:view.bodyManifest(),pistonStart,view:session.readView(),motion:'authored joint kinematics; pistons follow attachment distance'});
 function putProxy(){if(selected<0||!model.nodes[selected])return;root.updateWorldMatrix(true,false);const f=frames(model,t)[selected],p=new T.Vector3(...f.point,0).applyMatrix4(root.matrixWorld);proxy.position.copy(p);proxy.quaternion.copy(root.getWorldQuaternion(new T.Quaternion())).multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0,0,1),f.angle));proxy.scale.set(model.nodes[selected].length??1,1,1);proxy.updateMatrixWorld(true);}
 function update(){view.update(model,t,selected,!playing&&mode!=='build');grid.visible=editing&&mode==='build';origin.visible=!model.nodes.length;if(!edits.state().active)putProxy();session.redraw();refresh();}
 function pause(){playing=false;stop();stop=()=>{};t=mode==='B'?1:0;update();}
 function apply(next,label){ensure();pause();edits.apply(whole,{recipe:checkedMechanism(next)},label);record({kind:'links.edit',phase:'applied',effective:read()});return read();}
 edits.register(geometryTarget,{read:()=>view.replacementState(),check:v=>structuredClone(v),write:v=>{view.setBodies(v);session.redraw();refresh();}});
 const snapshot=()=>({recipe:structuredClone(model)});
 edits.register(whole,{read:snapshot,check:v=>({recipe:checkedMechanism(v.recipe)}),write:v=>{model=checkedMechanism(v.recipe);selected=model.nodes.length?Math.max(0,Math.min(selected,model.nodes.length-1)):-1;pistonStart=null;update();}});
 function handleRead(joint=selected,requestedMode=mode){
  const f=frames(model,requestedMode==='B'?1:0)[joint];if(!f)throw Error('Choose an existing joint');
  root.updateWorldMatrix(true,false);const position=new T.Vector3(...f.point,0).applyMatrix4(root.matrixWorld),q=root.getWorldQuaternion(new T.Quaternion()).multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0,0,1),f.angle)),e=new T.Euler().setFromQuaternion(q);
  return {recipe:structuredClone(model),joint,mode:requestedMode,position:position.toArray(),rotation:[e.x,e.y,e.z],scale:[model.nodes[joint].length??1,1,1]};
 }
 edits.register(target,{read:handleRead,readForReplay:v=>handleRead(v.joint,v.mode),check:v=>{if(playing)throw Error('Stop playback to edit joints');checkedMechanism(v.recipe);if(!v.recipe.nodes[v.joint]||!['position','rotation','scale'].every(k=>Array.isArray(v[k])&&v[k].length===3&&v[k].every(Number.isFinite)))throw Error('Finite joint transform required');return structuredClone(v);},write:v=>{
  pause();selected=v.joint;const base=v.recipe,n=base.nodes[selected],f=frames(base,v.mode==='B'?1:0)[selected];root.updateWorldMatrix(true,false);const p=new T.Vector3(...v.position).applyMatrix4(root.matrixWorld.clone().invert());
  model=checkedMechanism(base);
  if(!edits.state().active){update();return;}
  const oldWorld=new T.Vector3(...f.point,0).applyMatrix4(root.matrixWorld),moved=oldWorld.distanceTo(new T.Vector3(...v.position))>1e-7;
  const resized=v.mode==='build'&&n.parent!==null&&Math.abs(v.scale[0]-n.length)>1e-7;
  if(moved&&!resized)model=moveJoint(base,selected,[p.x,p.y],v.mode);
  else if(n.parent!==null){const q=new T.Quaternion().setFromEuler(new T.Euler(...v.rotation)).premultiply(root.getWorldQuaternion(new T.Quaternion()).invert()),e=new T.Euler().setFromQuaternion(q),parent=frames(base,v.mode==='B'?1:0)[n.parent],length=v.mode==='build'?v.scale[0]:n.length;model=moveJoint(base,selected,[parent.point[0]+Math.cos(e.z)*length,parent.point[1]+Math.sin(e.z)*length],v.mode);}
  update();
 }});
 seat=host.controls.components.register(asset.id,{enter(){editing=true;pause();update();},exit(){editing=false;update();},target(){if(selected<0)return null;if(!edits.state().active)putProxy();return {id:target,type:'link-joint',label:`Joint ${selected+1}`,object:proxy,read:handleRead,frameObjects:[view.markers()[selected]]};},pick(event,{camera,canvas}){
  if(playing){if(status)status.textContent='Stop playback to edit joints.';return;}const r=canvas.getBoundingClientRect(),ray=new T.Raycaster();ray.setFromCamera(new T.Vector2((event.clientX-r.left)/r.width*2-1,1-(event.clientY-r.top)/r.height*2),camera);
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
  mode({value}){if(!['build','A','B'].includes(value))throw Error('Unknown mode');seat.changed(()=>{pause();mode=value;t=value==='B'?1:0;pistonStart=null;update();});return read();},
  tool({value}){if(!['draw','select','piston'].includes(value))throw Error('Unknown tool');tool=value;pistonStart=null;refresh();return read();},
  play(){ensure();if(playing)return read();if(!model.nodes.some(n=>n.parent!==null))throw Error('Draw a link first');playing=true;time=0;stop=session.onFrame(({deltaSeconds})=>{time+=deltaSeconds;t=(1-Math.cos(time*2*Math.PI/model.period))/2;update();});refresh();return read();},
  pause(){pause();return read();},period({seconds}){return apply({...model,period:seconds},'Change cycle');},
  restore(recipe){apply(recipe,'Open mechanism');seat.changed(()=>{selected=model.nodes.length-1;update();});return read();},snapshot(){return structuredClone(model);},
  exportBodies(){return {...view.exportBodies(),recipe:structuredClone(model)};},
  importBodies(packet){ensure();pause();const state=view.replacementState(),byId=new Map(state.bodies.map(b=>[b.id,b]));if(packet?.schema!=='kaminos.assembly-geometry.v1'||!Array.isArray(packet.bodies)||!packet.bodies.length)throw Error('Choose an assembly geometry package');const seen=new Set();for(const b of packet.bodies){if(seen.has(b.id))throw Error('Duplicate body');seen.add(b.id);byId.set(b.id,b);}edits.apply(geometryTarget,{schema:packet.schema,bodies:[...byId.values()]},'Replace body geometry');const result=view.bodyManifest();record({kind:'links.geometry-return',phase:'applied',effective:result});return read();},
  frame(){const points=[...evaluate(model,0),...evaluate(model,1)],box=new T.Box3();for(const p of points)box.expandByPoint(new T.Vector3(...p,0).applyMatrix4(root.matrixWorld));if(box.isEmpty())box.setFromCenterAndSize(new T.Vector3(0,2,0),new T.Vector3(6,4,1));const c=box.getCenter(new T.Vector3()),d=Math.max(box.getSize(new T.Vector3()).length(),4);session.setView({position:[c.x,c.y,c.z+d*1.85],target:c.toArray(),fov:38});return read();},
 };
 update();operations.frame();win.kaminosSelection.set([asset.id],asset.id);
 return {read,operations,mount({root:panel,document,invoke}){
  panel.innerHTML='<h3>Link workshop</h3><p>Select the workshop and press <b>Tab</b>. Click to place a fixed anchor, then click to extend links. Click an existing joint to branch from it. Shift-click starts another fixed anchor.</p><p>Choose <b>Select / move</b> to adjust joints with G / R / S. In Pose A or B, moving a joint turns its link without stretching it. Tab returns to whole-object placement.</p>';
  const properties=document.createElement('section'),playback=document.createElement('div');properties.innerHTML='<h3>Links & joints</h3><p>Tab edits joints. Click the plane to extend; click a joint to branch. Shift-click plants a new anchor. G moves; R turns; S resizes in Build.</p>';playback.style.cssText='position:absolute;bottom:44px;left:16px;z-index:35;padding:5px;background:#18272de8;border:1px solid #5a707b;border-radius:7px';status=document.createElement('p');status.setAttribute('role','status');
  const buttons=[];const button=(parent,label,fn,active)=>{const b=document.createElement('button');b.textContent=label;b.type='button';b.style.cssText='margin:3px;padding:7px 10px;border:1px solid #667b87;border-radius:5px;background:#263740;color:#e4eef2';b.onclick=()=>Promise.resolve().then(fn).catch(e=>status.textContent=e.message);parent.append(b);buttons.push({b,active});return b;};
  for(const [label,value]of [['Build','build'],['Pose A','A'],['Pose B','B']])button(properties,label,()=>invoke('mode',{value}),()=>mode===value);
  const tools=document.createElement('div');properties.append(tools);for(const [label,value]of [['Draw links','draw'],['Select / move','select'],['Connect piston','piston']])button(tools,label,()=>invoke('tool',{value}),()=>tool===value);
  const tip=document.createElement('p');tip.textContent='Connect piston: click its two joints. Pistons currently follow the posed linkage; this is not a force solver.';properties.append(tip);
  const label=document.createElement('label'),toggle=document.createElement('input');toggle.type='checkbox';toggle.checked=snap;toggle.onchange=()=>snap=toggle.checked;label.style.cssText='display:block;margin:10px 0';label.append(toggle,' Snap to ¼-unit grid');properties.append(label);
  const cycle=document.createElement('label'),grip=document.createElement('span'),input=document.createElement('input');cycle.style.cssText='display:flex;justify-content:space-between;align-items:center;margin:10px 0';grip.textContent='Cycle seconds ';input.type='number';input.step='any';input.className='transform-input';input.style.width='75px';input.setAttribute('aria-label','Cycle seconds');input.oninput=()=>{if(input.value.trim())invoke('period',{seconds:Number(input.value)}).catch(e=>status.textContent=e.message);};const handle=host.controls.installNumberDrag({input,grip,step:.1});fields.push(handle);cycle.append(grip,input);properties.append(cycle);
  button(playback,'Play',()=>invoke('play'),()=>playing);button(playback,'Stop',()=>invoke('pause'));button(playback,'Frame mechanism',()=>invoke('frame'));
  button(properties,'Save mechanism…',async()=>{const recipe=await invoke('snapshot'),url=URL.createObjectURL(new Blob([JSON.stringify(recipe,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='mechanism.links.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),0);});
  button(properties,'Export body geometry…',async()=>{const packet=await invoke('exportBodies'),url=URL.createObjectURL(new Blob([JSON.stringify(packet)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='mechanism.bodies.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),0);});
  const geometryFile=document.createElement('input');geometryFile.type='file';geometryFile.accept='.json';geometryFile.hidden=true;geometryFile.setAttribute('aria-label','Replace body geometry');geometryFile.onchange=async()=>{try{if(geometryFile.files[0])await invoke('importBodies',JSON.parse(await geometryFile.files[0].text()));}catch(e){status.textContent=e.message;}finally{geometryFile.value='';}};button(properties,'Replace body geometry…',()=>geometryFile.click());properties.append(geometryFile);
  const file=document.createElement('input');file.type='file';file.accept='.json';file.hidden=true;file.setAttribute('aria-label','Open mechanism');file.onchange=async()=>{try{if(file.files[0])await invoke('restore',JSON.parse(await file.files[0].text()));}catch(e){status.textContent=e.message;}finally{file.value='';}};button(properties,'Open mechanism…',()=>file.click());properties.append(file,status);
  refresh=()=>{status.textContent=`${playing?'Playing · Stop returns to the selected pose':editing?'Editing':'Tab to edit'} · ${model.nodes.filter(n=>n.parent!==null).length} links · ${model.pistons.length} pistons${selected>=0?' · Joint '+(selected+1):''}${pistonStart!==null?' · choose second piston joint':''} · ${view.bodyManifest().replacements} returned bodies${view.bodyManifest().warnings.length?' · '+view.bodyManifest().warnings.join(' '):''}`;tools.hidden=mode!=='build';if(document.activeElement!==input||input.readOnly)input.value=String(model.period);for(const {b,active}of buttons)b.style.background=active?.()?'#387f88':'#263740';};
  controls=host.controls.mountObject({asset,properties,playback});refresh();
 },async dispose(){if(disposed)return;pause();seat.dispose();unsubscribe();edits.discard(e=>[target,whole,geometryTarget].includes(e.id));edits.unregister(target);edits.unregister(whole);edits.unregister(geometryTarget);controls?.dispose();for(const f of fields)f.dispose();proxy.removeFromParent();disposed=true;await session.dispose();view.dispose();}};
}};
