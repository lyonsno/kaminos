import {createViewFan,viewFanCameras,viewFanPose,updateViewFanAnchor,sourceSceneWithoutFans,VIEW_FAN_SOURCE} from './view-fan.mjs';

export function installViewFanTool({THREE,document,viewport,camera,entries,readView,writeView,capture,readContext,
 mount,releaseTree,readSelected,redraw,onFrame,installNumberDrag,openDocument}){
 let armed=false,busy=false,gesture=null,timer=null,selected=null;
 const button=document.createElement('button');button.type='button';button.id='view-fan-pull';button.textContent='Pull view fan';
 button.title='Drag from a material neighborhood to pull out contextual views';
 Object.assign(button.style,{position:'absolute',top:'48px',left:'12px',zIndex:'45',padding:'7px 12px',background:'#243b46',color:'#d9edf4',border:'1px solid #577785',borderRadius:'5px'});
 const message=document.createElement('div');message.id='view-fan-status';message.setAttribute('role','status');
 Object.assign(message.style,{position:'absolute',top:'87px',left:'12px',zIndex:'45',maxWidth:'360px',fontSize:'12px',color:'#d1e7ee',pointerEvents:'none',textShadow:'0 1px 3px #000'});
 viewport.append(button,message);
 const panel=document.createElement('section');panel.className='scene-owner-properties';panel.hidden=true;
 const heading=document.createElement('h3');heading.textContent='View fan';panel.append(heading);
 const controls={};
 for(const [key,label,step] of [['spread','Angular spread',1],['radius','Neighborhood radius',.02],['cardWidth','Window size',.02]]){
  const row=document.createElement('label'),grip=document.createElement('span'),input=document.createElement('input');
  grip.textContent=label;input.type='number';input.step='any';input.min=key==='spread'?'0':'0.000001';input.className='transform-input';input.setAttribute('aria-label',label);
  Object.assign(row.style,{display:'flex',gap:'8px',alignItems:'center',margin:'9px 0'});Object.assign(input.style,{width:'92px',marginLeft:'auto'});
  row.append(grip,input);panel.append(row);controls[key]=input;installNumberDrag({input,grip,step});
  input.addEventListener('input',()=>{if(!selected||!input.value||!input.validity.valid)return;clearTimeout(timer);const id=selected.id;timer=setTimeout(()=>{timer=null;update(id,{[key]:Number(input.value)}).catch(fail);},120);});
 }
 const commands=document.createElement('div');commands.style.cssText='display:flex;gap:6px;flex-wrap:wrap';
 const command=(label,action)=>{const node=document.createElement('button');node.type='button';node.textContent=label;node.onclick=()=>Promise.resolve().then(action).catch(fail);commands.append(node);};
 command('Original view',()=>writeView(selected.object.userData.kaminosViewFan.sourceView));
 command('Update from scene',()=>update(selected.id,{}));
 command('Restore captured scene',()=>{
  const record=selected,fan=record.object.userData.kaminosViewFan,context=structuredClone(fan.context);
  context.objects.push({...readContext().objects.find(o=>o.id===record.id)});context.activeObjectId=record.id;context.selectionIds=[record.id];
  return openDocument(context);
 });
 panel.append(commands);const description=document.createElement('p');description.className='small';description.textContent='Captured viewport views. Spread and neighborhood edits re-evaluate the current scene. The cross marks the selected carrier location.';panel.append(description);
 document.getElementById('transform-inspector').append(panel);
 function fail(error){message.textContent=error.message;message.style.color='#ffbd9f';}
 function setArmed(value){armed=value;button.setAttribute('aria-pressed',String(value));button.textContent=value?'Drag from a material…':'Pull view fan';viewport.style.cursor=value?'crosshair':'';message.textContent=value?'Drag from the part you noticed. Escape cancels.':'';message.style.color='#d1e7ee';}
 button.onclick=()=>setArmed(!armed);
 function pick(x,y){
  const bounds=viewport.getBoundingClientRect(),ray=new THREE.Raycaster();
  camera.updateMatrixWorld();ray.setFromCamera(new THREE.Vector2((x-bounds.left)/bounds.width*2-1,1-(y-bounds.top)/bounds.height*2),camera);
  const sources=entries().filter(e=>e.object.visible&&e.source!==VIEW_FAN_SOURCE&&e.type!=='light'&&e.type!=='camera');
  for(const entry of sources)entry.object.updateWorldMatrix(true,true);
  for(const hit of ray.intersectObjects(sources.map(e=>e.object),true)){
   const entry=sources.find(e=>{for(let o=hit.object;o;o=o.parent)if(o===e.object)return true;return false;});
   if(!entry||!hit.face)continue;
   const normal=hit.face.normal.clone().applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld));
   return {anchor:{objectId:entry.id,position:hit.point.toArray(),normal:normal.toArray(),...(hit.uv?{uv:hit.uv.toArray()}:{})},ray};
  }
  throw Error('Choose a visible surface in the scene');
 }
 function placementAt(x,y,anchor){
  const bounds=viewport.getBoundingClientRect(),ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2((x-bounds.left)/bounds.width*2-1,1-(y-bounds.top)/bounds.height*2),camera);
  const normal=camera.getWorldDirection(new THREE.Vector3()),plane=new THREE.Plane().setFromNormalAndCoplanarPoint(normal,new THREE.Vector3(...anchor.position));
  const position=ray.ray.intersectPlane(plane,new THREE.Vector3());if(!position)throw Error('Cannot place the fan on this view');
  return position.addScaledVector(normal,-camera.position.distanceTo(new THREE.Vector3(...anchor.position))*.10).toArray();
 }
 function captureFan(anchor,options={}){
  const sourceView=options.sourceView??readView(),distance=new THREE.Vector3(...sourceView.position).distanceTo(new THREE.Vector3(...anchor.position));
  const radius=options.radius??distance*Math.tan(sourceView.fov*Math.PI/360)*.30,spread=options.spread??25;
  const views=viewFanCameras({sourceView,anchor:anchor.position,radius,spread}),context=sourceSceneWithoutFans(readContext());
  const captured=capture(views,options.resolution??256);
  return {schema:'kaminos.view-fan.v1',anchor:structuredClone(anchor),sourceView,context,radius,spread,cardWidth:options.cardWidth??radius*1.35,
   views:captured,renderer:{route:'ordinary viewport compositor',backend:'WebGPU',state:context.postprocessing??null},capturedAt:new Date().toISOString()};
 }
 async function create({anchor,placement,...options}){
  if(busy)throw Error('A view fan is being created');
  if(!entries().some(e=>e.id===anchor.objectId))throw Error('The selected source is no longer in the scene');
  busy=true;message.textContent='Drawing contextual views…';
  try{
   const data=captureFan(anchor,options),root=createViewFan({viewFan:data});
   const pose=viewFanPose(data.sourceView,placement??anchor.position);root.position.fromArray(pose.position);root.quaternion.copy(pose.quaternion);updateViewFanAnchor(root);
   const result=await mount(root,{type:'pbr',source:VIEW_FAN_SOURCE,label:'View fan',viewFan:data});
   redraw();message.textContent='View fan created · move, rotate and scale it with the scene tools.';return {id:result.id,views:data.views.map(v=>({angle:v.angle,width:v.width,height:v.height,view:v.view}))};
  }finally{busy=false;}
 }
 async function update(id,patch){
  if(busy)throw Error('A view fan is being created');
  const entry=entries().find(e=>e.id===id&&e.source===VIEW_FAN_SOURCE);if(!entry)throw Error('Select a view fan');
  busy=true;
  try{
   const previous=entry.object.userData.kaminosViewFan;
   const next=patch.cardWidth!==undefined?{...previous,cardWidth:patch.cardWidth}:captureFan(previous.anchor,{...previous,...patch});
   const built=createViewFan({viewFan:next}),old=new THREE.Group();
   for(const child of [...entry.object.children])old.add(child);
   entry.object.userData.kaminosViewFan=next;
   for(const child of [...built.children])entry.object.add(child);
   entry.viewFan=structuredClone(next);entry.object.userData.kaminosSceneObject.viewFan=structuredClone(next);
   releaseTree(old);updateViewFanAnchor(entry.object);redraw();sync();return read();
  }finally{busy=false;}
 }
 function down(event){
  if(!armed||busy||event.button!==0||event.target.closest?.('button,input,select,textarea'))return;
  event.preventDefault();event.stopImmediatePropagation();
  try{const {anchor}=pick(event.clientX,event.clientY);gesture={anchor,id:event.pointerId,x:event.clientX,y:event.clientY};viewport.setPointerCapture(event.pointerId);message.textContent='Release to place the views';}catch(error){fail(error);}
 }
 function up(event){
  if(!gesture||event.pointerId!==gesture.id)return;
  event.preventDefault();event.stopImmediatePropagation();const g=gesture;gesture=null;viewport.releasePointerCapture(event.pointerId);setArmed(false);
  const x=Math.abs(event.clientX-g.x)+Math.abs(event.clientY-g.y)<5?g.x:g.x+(event.clientX-g.x),y=Math.abs(event.clientX-g.x)+Math.abs(event.clientY-g.y)<5?g.y-110:event.clientY;
  create({anchor:g.anchor,placement:placementAt(x,y,g.anchor)}).catch(fail);
 }
 function cancel(event){if(event.key==='Escape'&&armed){if(gesture&&viewport.hasPointerCapture(gesture.id))viewport.releasePointerCapture(gesture.id);gesture=null;setArmed(false);event.preventDefault();event.stopImmediatePropagation();}}
 function sync(){
  selected=readSelected();if(selected?.source!==VIEW_FAN_SOURCE)selected=null;panel.hidden=!selected;
  if(selected){const data=selected.object.userData.kaminosViewFan;for(const [key,input] of Object.entries(controls))if(document.activeElement!==input||input.readOnly)input.value=String(data[key]);}
  for(const entry of entries())if(entry.source===VIEW_FAN_SOURCE)updateViewFanAnchor(entry.object);
 }
 const unsubscribe=onFrame(sync);viewport.addEventListener('pointerdown',down,true);viewport.addEventListener('pointerup',up,true);document.addEventListener('keydown',cancel,true);
 const read=()=>({armed,busy,fans:entries().filter(e=>e.source===VIEW_FAN_SOURCE).map(e=>({id:e.id,anchor:e.object.userData.kaminosViewFan.anchor,views:e.object.userData.kaminosViewFan.views.map(v=>({angle:v.angle,view:v.view,width:v.width,height:v.height})),sourceView:e.object.userData.kaminosViewFan.sourceView}))});
 return {read,create,update,pick:(x,y)=>pick(x,y).anchor,arm:()=>setArmed(true),dispose(){clearTimeout(timer);unsubscribe();viewport.removeEventListener('pointerdown',down,true);viewport.removeEventListener('pointerup',up,true);document.removeEventListener('keydown',cancel,true);button.remove();message.remove();panel.remove();}};
}
