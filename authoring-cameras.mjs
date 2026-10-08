import {installSceneControlHistory,installRelativeNumberDrag,formatAuthoringNumber} from './scene-control-history.mjs';
import {checkedCameraRecord} from './scene-camera.mjs';
export function installCameraAuthoring({document,service,bookmarks,edits,selected,select,onError}){
 const host=document.getElementById('authoring-camera-properties'),legacy=document.createElement('details');legacy.id='camera-view-bookmarks';legacy.innerHTML='<summary>View bookmarks</summary><div class="camera-note">Saved navigation angles from the earlier view tool. Convert an angle into a camera object to use it as an authored shot.</div><button class="btn" id="camera-bookmark-convert">Create camera from bookmark</button>';
 const old=document.createElement('div');while(host.firstChild)old.append(host.firstChild);legacy.append(old);
 host.innerHTML='<h2>Scene camera</h2><select id="scene-active-camera" aria-label="Active scene camera"></select><div class="camera-actions"><button class="btn" id="scene-add-camera">Add camera</button><button class="btn" id="scene-camera-view">View camera · Num 0</button><button class="btn" id="scene-camera-align">Align camera to view</button><button class="btn" id="scene-camera-capture">Capture active camera</button></div><label class="camera-lock"><input id="scene-camera-lock" type="checkbox"> Lock Camera to View</label><p id="scene-camera-status" class="camera-note" aria-live="polite"></p><h2>Output frame</h2><label class="camera-lens-row">Aspect <input class="transform-input" id="scene-frame-x" type="number" step="any" min="0.001" aria-label="Frame width ratio"><span>:</span><input class="transform-input" id="scene-frame-y" type="number" step="any" min="0.001" aria-label="Frame height ratio"></label><p class="camera-note">Camera capture samples the framed image at viewport resolution. It preserves the shot aspect when panels or the window resize.</p>';
 host.append(legacy);
 const objectPanel=document.createElement('section');objectPanel.id='selected-camera-properties';objectPanel.hidden=true;objectPanel.innerHTML='<h3>Camera</h3><div class="camera-actions"><button class="btn" id="selected-camera-active">Set active camera</button><button class="btn" id="selected-camera-view">View through camera</button></div><div id="selected-camera-data"></div>';
 document.getElementById('authoring-type-slot').append(objectPanel);
 const controls=[],fields=[];
 for(const [key,label,step] of [['lens','Lens (mm)',.25],['sensorWidth','Sensor width (mm)',.1],['near','Clip start',.001],['far','Clip end',1]]){
  const row=document.createElement('label');row.className='camera-lens-row';row.innerHTML=`<span>${label}</span><input class="transform-input" id="selected-camera-${key}" type="number" step="any" min="0.001">`;objectPanel.querySelector('#selected-camera-data').append(row);const input=row.querySelector('input');input.setAttribute('aria-label',label);controls.push(input);fields.push({input,key,step});
 }
 const byId=id=>document.getElementById(id),fail=error=>{byId('scene-camera-status').textContent=error.message;onError(error);},run=action=>{try{return action();}catch(error){fail(error);}};
 const selectedCamera=()=>selected()?.type==='camera'?selected():null;
 const fieldsState=()=>service.read();
 function refresh(){
  const data=service.read(),state=service.state(),item=selectedCamera(),choice=byId('scene-active-camera'),key=JSON.stringify([data.cameras.map(({id,label})=>({id,label})),data.settings.activeId]);
  if(choice.dataset.items!==key){choice.dataset.items=key;choice.replaceChildren();const empty=document.createElement('option');empty.value='';empty.textContent='No active camera';choice.append(empty);for(const record of data.cameras){const option=document.createElement('option');option.value=record.id;option.textContent=record.label;choice.append(option);}choice.value=data.settings.activeId??'';}
  byId('scene-camera-lock').checked=state.locked;
  byId('scene-camera-status').textContent=state.mode==='camera'?(state.locked?'Camera view · navigation edits the camera':'Camera view · pan/zoom adjusts the frame; orbit leaves camera view'):'User view · navigating leaves cameras unchanged';
  for(const id of ['scene-camera-view','scene-camera-align','scene-camera-capture'])byId(id).disabled=!data.settings.activeId||!!edits.state().active||edits.state().replaying;
  byId('scene-camera-align').disabled=state.mode==='camera'||!data.settings.activeId||!!edits.state().active;
  byId('scene-add-camera').disabled=!!edits.state().active||edits.state().replaying;
  byId('scene-frame-x').value=document.activeElement===byId('scene-frame-x')?byId('scene-frame-x').value:String(data.settings.aspect[0]);byId('scene-frame-y').value=document.activeElement===byId('scene-frame-y')?byId('scene-frame-y').value:String(data.settings.aspect[1]);
  objectPanel.hidden=!item;
  for(const {input,key} of fields)if(item&&document.activeElement!==input)input.value=String(item.camera[key]);
  const frameEl=byId('scene-camera-frame');frameEl.hidden=state.mode!=='camera';
  if(state.frame){Object.assign(frameEl.style,{left:state.frame.x+'px',top:state.frame.y+'px',width:state.frame.width+'px',height:state.frame.height+'px'});frameEl.dataset.cameraId=state.activeId;frameEl.querySelector('span').textContent=data.cameras.find(o=>o.id===state.activeId)?.label||'Camera';}
 }
 const frameEl=document.createElement('div');frameEl.id='scene-camera-frame';frameEl.hidden=true;frameEl.innerHTML='<span></span>';document.getElementById('viewport').append(frameEl);
 byId('scene-add-camera').onclick=()=>run(()=>{const id=service.create();select(id);});
 byId('scene-camera-view').onclick=()=>{run(()=>service.toggle());byId('scene-camera-view').blur();};
 byId('scene-active-camera').onchange=event=>{run(()=>service.setActive(event.target.value||null));event.target.blur();};
 byId('scene-camera-align').onclick=()=>run(()=>service.align());
 byId('scene-camera-lock').onchange=event=>{run(()=>service.lock(event.target.checked));event.target.blur();};
 byId('scene-camera-capture').onclick=async()=>{try{const result=await service.capture();if(result?.ok===false)throw Error(result.error);}catch(error){fail(error);}};
 byId('selected-camera-active').onclick=()=>run(()=>{service.setActive(selectedCamera().id);service.enter();});
 byId('selected-camera-view').onclick=()=>run(()=>{service.setActive(selectedCamera().id);service.enter();});
 byId('camera-bookmark-convert').onclick=()=>run(()=>{const data=bookmarks.read(),view=data.items.find(item=>item.id===data.selectedId);if(!view)throw Error('Select a view bookmark first');const id=service.createFromView(view.label,view.view);select(id);});
 const aspectControls=[byId('scene-frame-x'),byId('scene-frame-y')];
 const sessions=[],drags=[];
 function attach(inputs,label,readPatch){
  const validate=()=>{try{const next=readPatch();if(next)edits.preview(next);return true;}catch(error){fail(error);return false;}};
  let session;
  for(const input of inputs){
   const reject=()=>{if(!session.state().pending)return false;if(validate())return false;session.cancel();refresh();return true;};
   input.addEventListener('change',reject);input.addEventListener('keydown',event=>{if(event.key==='Enter'&&reject()){event.preventDefault();event.stopImmediatePropagation();input.blur();}},true);
  }
  session=installSceneControlHistory({controls:inputs,edits,id:'@scene-cameras',label,onError:fail});sessions.push(session);
  for(const input of inputs){input.addEventListener('input',()=>{if(session.state().pending)validate();});input.addEventListener('blur',()=>{refresh();});}
  return session;
 }
 attach(controls,'Edit camera lens',()=>{
  const item=selectedCamera();if(!item)throw Error('Select a camera');const next={...item.camera};for(const {input,key} of fields){if(input.value===''||!Number.isFinite(input.valueAsNumber))throw Error('Enter a valid camera value');next[key]=input.valueAsNumber;}const record=checkedCameraRecord({...item,camera:next});return {...fieldsState(),cameras:fieldsState().cameras.map(o=>o.id===item.id?record:o)};
 });
 attach(aspectControls,'Edit camera frame',()=>{const aspect=aspectControls.map(input=>input.valueAsNumber);if(!aspect.every(v=>Number.isFinite(v)&&v>0))throw Error('Frame ratios must be positive');return {settings:{...fieldsState().settings,aspect}};});
 for(const {input,step} of fields)drags.push(installRelativeNumberDrag({input,step}));for(const input of aspectControls)drags.push(installRelativeNumberDrag({input,step:.1}));
 for(const input of [...controls,...aspectControls])input.addEventListener('blur',()=>{if(!edits.state().active){const item=selectedCamera(),field=fields.find(f=>f.input===input);input.value=String(field?item?.camera[field.key]:service.read().settings.aspect[input===aspectControls[0]?0:1]);}refresh();});
 document.addEventListener('kaminos-inspector-context-change',refresh);edits.subscribe(()=>{if(!sessions.some(s=>s.state().pending))drags.forEach(d=>d.stop());refresh();});
 const selectedNode=document.getElementById('transform-inspector');new document.defaultView.MutationObserver(refresh).observe(selectedNode,{attributes:true,attributeFilter:['data-selected-object-id','data-selected-group-id','data-selected-field-id']});
 document.getElementById('viewport').addEventListener('pointerdown',event=>{
  const state=service.state();if(event.button!==0||!state.frame||event.target.closest?.('button,input,select,summary,details')||edits.state().active)return;const viewport=document.getElementById('viewport').getBoundingClientRect(),r=state.frame,x=event.clientX-viewport.left,y=event.clientY-viewport.top;const inside=x>=r.x-5&&x<=r.x+r.width+5&&y>=r.y-5&&y<=r.y+r.height+5;const edge=Math.min(Math.abs(x-r.x),Math.abs(x-r.x-r.width),Math.abs(y-r.y),Math.abs(y-r.y-r.height));if(inside&&edge<=5){event.preventDefault();event.stopImmediatePropagation();select(state.activeId);}
 },true);
 refresh();return {refresh,sessions};
}
