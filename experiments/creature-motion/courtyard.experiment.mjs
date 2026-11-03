import * as THREE from '../../lib/three.core.js';
import {createLivingScene} from './living-scene.experiment.mjs';
import {createStimulusSequence,validateStimulusProgram} from './stimulus-sequence.mjs';
import {createInvestigationRecording,investigationOperations} from '../../investigation-recording.mjs';
const clone=x=>structuredClone(x),sources=new Set(['fire','beacon','traveler']);
export function validateCourtyardProgram(value){
 const program=validateStimulusProgram(value);
 for(const event of program.events){
  if(!sources.has(event.source))throw Error('Unknown courtyard source');
  if(!Object.keys(event.patch).length)throw Error('Stimulus patch cannot be empty');
  for(const [key,value] of Object.entries(event.patch)){
   if(key==='flow'&&event.source==='fire'&&Number.isFinite(value)&&value>=0)continue;
   if(key==='visible'&&event.source==='beacon'&&typeof value==='boolean')continue;
   if(key==='scale'&&event.source==='beacon'&&Number.isFinite(value)&&value>0)continue;
   if(key==='moving'&&event.source==='traveler'&&typeof value==='boolean')continue;
   throw Error(`Invalid ${event.source} stimulus field: ${key}`);
  }
 }
 return program;
}
export async function createCourtyard({host,inputs={},record=operation=>investigationOperations.emit(operation)},dependencies={}){
 const initial=inputs.actors?clone(inputs):await(await fetch(new URL('./courtyard.setup.json',import.meta.url))).json();
 let program=validateCourtyardProgram(initial.program),sequence=createStimulusSequence(program),automatic=initial.automatic??false;
 if(typeof automatic!=='boolean')throw Error('Timed objects require a boolean run state');
 const session=await host.scene.open(),props=new Map(),seatings=[],log=[],manualSources=new Set();
 let living,flame,disposed=false,mountNode=null,ui=null,worldTime=0,programTime=0,baselineInputs,mountRoot,recording,failure=null;
 const materials=[0x968d7a,0xa59b86,0x8b8477,0xb1a58e].map(color=>new THREE.MeshStandardMaterial({color,roughness:.93}));
 const bronze=new THREE.MeshStandardMaterial({color:0x876844,metalness:.65,roughness:.48}),inlay=new THREE.MeshStandardMaterial({color:0x4b716e,metalness:.6,roughness:.5});
 function mesh(parent,geometry,material,position){const m=new THREE.Mesh(geometry,material);m.position.fromArray(position);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;}
 // All 120 tiles remain individually represented by instance matrices, sharing
 // four drawables. The selected object is still the ordinary Stone court root.
 const floor=new THREE.Group();floor.name='Stone court';
 for(let material=0;material<4;material++){
  const positions=[];for(let x=0;x<12;x++)for(let z=0;z<10;z++)if((x*7+z*11)%4===material)positions.push([x-5.5,-.09,z-4.5]);
  const tiles=new THREE.InstancedMesh(new THREE.BoxGeometry(.99,.16,.99),materials[material],positions.length);
  positions.forEach((p,i)=>tiles.setMatrixAt(i,new THREE.Matrix4().makeTranslation(...p)));tiles.castShadow=true;tiles.receiveShadow=true;floor.add(tiles);
 }
 const architecture=new THREE.Group();architecture.name='Court colonnade';
 const boxes=[];
 for(const x of [-5,5])for(const z of [-4,-1.3,1.3,4]){
  if(x===-5&&z===-1.3)continue;
  for(const [size,p,index]of [[[.72,.2,.72],[x,.1,z],1],[[.55,.18,.55],[x,.29,z],0],[[.65,.26,.65],[x,2.8,z],1],[[.8,.18,.8],[x,3.02,z],0]])boxes.push({size,p,index});
  mesh(architecture,new THREE.CylinderGeometry(.18,.25,2.3,12),materials[1],[x,1.52,z]);
 }
 for(const x of [-5,5])boxes.push({size:[.65,.35,8.8],p:[x,3.2,0],index:2});
 for(const z of [-4.8,4.8])for(const x of [-4,-2,0,2,4])boxes.push({size:[1.98,.45,.35],p:[x,.225,z],index:2});
 for(let i=0;i<4;i++){
  const rows=boxes.filter(row=>row.index===i);if(!rows.length)continue;
  const batch=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),materials[i],rows.length);
  rows.forEach((row,n)=>batch.setMatrixAt(n,new THREE.Matrix4().compose(new THREE.Vector3(...row.p),new THREE.Quaternion(),new THREE.Vector3(...row.size))));batch.castShadow=true;batch.receiveShadow=true;architecture.add(batch);
 }
 const programState=()=>({...sequence.read(),time:programTime,cycle:Math.floor(programTime/program.duration)});
 const identity=()=>({time:worldTime,clock:'viewer frame seconds',program:programState(),automatic});
 const emit=(kind,effective)=>{const event={kind,phase:'applied',target:'furnace-courtyard',clock:identity(),effective};log.push(clone(event));record(event);};
 const consume=event=>record(event.phase&&event.target&&Object.hasOwn(event,'effective')?event:{kind:event.kind,phase:event.phase??'applied',target:event.actor??'creatures',...(event.actor?{actor:event.actor}:{}),clock:identity(),effective:clone(event)});
 const makeLiving=(value,sceneHost=host)=>(dependencies.createLivingScene??createLivingScene)({host:sceneHost,inputs:value,record:consume},dependencies);
 function patch(source,values){
  validateCourtyardProgram({duration:1,events:[{at:0,source,patch:values}]});
  if(source==='fire'){flame.setControls({'volume-flow-rate':values.flow});return;}
  const row=props.get(source);if(!row?.root.parent)throw Error(`Source removed from scene: ${source}`);
  if(values.visible!==undefined)row.root.visible=values.visible;
  if(values.scale!==undefined)row.root.scale.setScalar(values.scale);
  if(values.moving!==undefined)row.moving=values.moving;
  row.root.updateMatrixWorld(true);session.redraw();
 }
 function captureTravelerPlacement(){const row=props.get('traveler');if(row)row.origin.add(row.root.position.clone().sub(row.lastMotionPosition));}
 function resetTraveler(){const row=props.get('traveler');if(!row)return;captureTravelerPlacement();row.motionTime=0;row.root.position.copy(row.origin);row.lastMotionPosition.copy(row.root.position);row.root.updateMatrixWorld(true);}
 function move(seconds){
  const row=props.get('traveler');if(!row?.root.parent)return;
  captureTravelerPlacement();if(row.moving){row.motionTime+=seconds*row.speed;const t=row.motionTime;row.root.position.copy(row.origin).add(new THREE.Vector3(row.width*Math.sin(t*.7),.5*Math.sin(t*1.1),0));row.root.updateMatrixWorld(true);session.redraw();}row.lastMotionPosition.copy(row.root.position);
 }
 function applyEvents(step){
  programTime=step.time;
  for(const event of step.events){
   if(manualSources.has(event.source))continue;
   const row=props.get(event.source);
   if(row&&!row.root.parent){manualSources.add(event.source);emit('courtyard.source-removed',{source:event.source,hostId:row.asset.id});continue;}
   if(event.at===0&&event.source==='traveler')resetTraveler();patch(event.source,event.patch);emit('courtyard.event',{event,observationPhase:'world edit on viewer frame; creatures and fluid retain their ordinary clocks'});
  }
 }
 function tick({deltaSeconds}){
  if(disposed)return;
  if(!Number.isFinite(deltaSeconds)||deltaSeconds<0)throw Error('Viewer frame requires finite nonnegative seconds');
  try{
   if(automatic)for(const step of sequence.advance(deltaSeconds)){worldTime+=step.seconds;move(step.seconds);applyEvents(step);}
   else{worldTime+=deltaSeconds;move(deltaSeconds);}
   sync();
  }catch(error){automatic=false;failure=error.message;emit('courtyard.schedule-failed',{error:failure,creatures:'independent',fire:'ordinary native controls'});sync();}
 }
 function read(){return {schema:'kaminos.creature-courtyard.v2',...identity(),mounted:!disposed,failure,sources:Object.fromEntries([...props].map(([id,row])=>[id,{hostId:row.asset.id,mounted:Boolean(row.root.parent),scheduled:automatic&&!manualSources.has(id),visible:row.root.visible,moving:row.moving??false,motionTime:row.motionTime??0,speed:row.speed??null,width:row.width??null,authoredPosition:row.origin.toArray(),position:row.root.position.toArray(),scale:row.root.scale.toArray()}])),fire:flame.read(),creatures:living?.read()??null,diagnostic,log:clone(log),continuation:{events:'viewer-time edits; independent native fire and creatures',restart:'creature recipes only; no fluid checkpoint'}};}
 function sync(){
  if(!ui)return;const text=failure?`Timed objects stopped: ${failure}`:`Timed objects ${automatic?'running':'paused'} · ${(programTime%program.duration).toFixed(1)} / ${program.duration} s`;
  if(ui.status.textContent!==text)ui.status.textContent=text;ui.automatic.checked=automatic;
 }
 function exportFile(value,name){const document=host.controls.document,url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=name;a.click();URL.revokeObjectURL(url);}
 let diagnostic=false;
 const guide=new THREE.Group();guide.name='Selected creature sensory field';guide.visible=false;guide.userData.kaminosEditorOnly=true;
 const guideMaterial=new THREE.LineBasicMaterial({color:0x70d9cb,transparent:true,opacity:.65,depthTest:false});let guideLine;
 function showField(){
  if(!diagnostic||!living)return;const selected=globalThis.window?.kaminosSelection?.read()?.activeId;
  const actor=living.read().actors.find(x=>x.state.host.id===selected),field=actor?.state.attention?.sensoryField;guide.visible=Boolean(field);if(!field)return;
  const eye=new THREE.Vector3(...field.eye),forward=new THREE.Vector3(...field.gaze),up=new THREE.Vector3(0,1,0),side=new THREE.Vector3().crossVectors(forward,up).normalize();if(side.lengthSq()<1e-8)side.set(1,0,0);up.crossVectors(side,forward).normalize();
  const points=[],length=2;
  for(let i=0;i<32;i++){const a=i/32*Math.PI*2,b=(i+1)/32*Math.PI*2;const rim=t=>eye.clone().addScaledVector(forward,Math.cos(field.fieldOfView*.5)*length).addScaledVector(side,Math.cos(t)*Math.sin(field.fieldOfView*.5)*length).addScaledVector(up,Math.sin(t)*Math.sin(field.fieldOfView*.5)*length);points.push(rim(a),rim(b));if(i%8===0)points.push(eye.clone(),rim(a));}
  guideLine.geometry.dispose();guideLine.geometry=new THREE.BufferGeometry().setFromPoints(points);session.redraw();
 }
 const operations={
  setRunning:input=>living.operations.setRunning(input),actor:input=>living.operations.actor(input),
  automatic({enabled}={}){if(typeof enabled!=='boolean')throw Error('Timed objects require boolean');automatic=enabled;failure=null;if(enabled)for(const step of sequence.advance(0))applyEvents(step);sync();emit('courtyard.automatic',{enabled});return read();},
  scheduled({source,enabled}={}){if(!sources.has(source)||typeof enabled!=='boolean')throw Error('Source timer requires a known source and boolean');if(enabled)manualSources.delete(source);else manualSources.add(source);emit('courtyard.source-timer',{source,enabled});return read();},
  manual({source,patch:values}={}){patch(source,values);manualSources.add(source);emit('courtyard.manual',{source,patch:values});return read();},
  travel({speed,width}={}){if(speed!==undefined&&(!Number.isFinite(speed)||speed<0)||width!==undefined&&(!Number.isFinite(width)||width<0))throw Error('Travel speed and width must be finite nonnegative values');const row=props.get('traveler');if(speed!==undefined)row.speed=speed;if(width!==undefined)row.width=width;emit('courtyard.travel',{speed:row.speed,width:row.width});return read();},
  repeat(){manualSources.clear();resetTraveler();for(const step of sequence.repeat())applyEvents(step);sync();emit('courtyard.repeat',{preservesExperience:true,fire:'ordinary control edits only'});return read();},
  program(value){program=validateCourtyardProgram(value);sequence=createStimulusSequence(program);manualSources.clear();resetTraveler();programTime=0;if(automatic)for(const step of sequence.advance(0))applyEvents(step);sync();emit('courtyard.program',program);return read();},
  async restart(){
   await living.operations.setRunning({running:false});
   const staged=new Map(),stagingHost={...host,scene:{...host.scene,open:async()=>{const s=await host.scene.open();return {...s,attach:async(root,options)=>{staged.set(root,root.visible);root.visible=false;return s.attach(root,options);}};}}};
   let next;try{next=await makeLiving(clone(baselineInputs),stagingHost);}catch(error){emit('courtyard.restart-failed',{error:error.message,retained:'held prior cohort'});throw error;}
   const previous=living;living=next;await previous.dispose();for(const [root,visible]of staged)root.visible=visible;if(mountRoot)living.mount({root:mountRoot});session.redraw();emit('courtyard.restart',{creatures:'original cohort',sources:'continue independently'});return read();
  },
  field({visible}={}){if(typeof visible!=='boolean')throw Error('Sensory field requires boolean');diagnostic=visible;guide.visible=visible;return read();},
  export(){exportFile({recording:recording.snapshot(),context:read()},'courtyard-observation.json');return read();},
 };
 function mountSource({asset,id,document,invoke}){
  const properties=document.createElement('section'),title=document.createElement('strong'),status=document.createElement('output'),fields=[];title.textContent=id==='fire'?'Timed flame changes':props.get(id).root.name;properties.append(title);
  const failed=error=>{status.textContent=error.message;};
  function check(label,readValue,change){const wrap=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.setAttribute('aria-label',label);wrap.append(input,document.createTextNode(label));input.onchange=async()=>{try{await change(input.checked);status.textContent='';}catch(e){failed(e);}syncFields();};properties.append(wrap);fields.push(()=>{input.checked=readValue();});return input;}
  function number(label,readValue,change,step){const wrap=document.createElement('label'),grip=document.createElement('span'),input=document.createElement('input');grip.textContent=label;input.type='number';input.step='any';input.min='0';input.className='transform-input';input.setAttribute('aria-label',label);wrap.append(grip,input);properties.append(wrap);input.oninput=async()=>{if(!input.value.trim()||!Number.isFinite(Number(input.value)))return;try{await change(Number(input.value));status.textContent='';}catch(e){failed(e);}syncFields();};fields.push(()=>{if(document.activeElement!==input)input.value=String(readValue());});host.controls.installNumberDrag?.({input,grip,step});}
  check('Follow timed events',()=>!manualSources.has(id),enabled=>invoke('scheduled',{source:id,enabled}));
  if(id==='beacon'){check('Beacon visible',()=>props.get(id).root.visible,visible=>invoke('manual',{source:id,patch:{visible}}));number('Beacon size',()=>props.get(id).root.scale.x,scale=>invoke('manual',{source:id,patch:{scale}}),.01);}
  if(id==='traveler'){check('Lantern moving',()=>props.get(id).moving,moving=>invoke('manual',{source:id,patch:{moving}}));number('Travel speed',()=>props.get(id).speed,speed=>invoke('travel',{speed}),.01);number('Travel width',()=>props.get(id).width,width=>invoke('travel',{width}),.05);}
  const note=document.createElement('p');note.textContent=id==='fire'?'The flame keeps its normal emitter and simulation controls. Timed events only edit its flow.':'Place this object with the ordinary editor. Editing its state releases it from timed events.';properties.append(note,status);
  const syncFields=()=>fields.forEach(fn=>fn());syncFields();seatings.push(host.controls.mountObject({asset,properties,onSelected:syncFields}));
 }
 try{
  flame=await(dependencies.openFlame?.()??host.flame.open());if(!flame?.read().active)throw Error('Courtyard requires an authored Fire & smoke field');
  await session.attach(floor,{owned:true,metadata:{label:floor.name,source:'rubberneck:courtyard-stone-floor'}});
  await session.attach(architecture,{owned:true,metadata:{label:architecture.name,source:'rubberneck:courtyard-colonnade'}});
  for(const id of ['beacon','traveler']){
   const root=new THREE.Group();root.name=id==='beacon'?'Bronze iris beacon':'Crossing bronze lantern';
   mesh(root,new THREE.IcosahedronGeometry(.4,1),bronze,[0,0,0]);for(const rotation of [0,Math.PI*.5]){const ring=mesh(root,new THREE.TorusGeometry(.55,.035,6,28),inlay,[0,0,0]);ring.rotation.x=rotation;}
   root.position.set(id==='beacon'?2.5:0,1.2,id==='beacon'?1:-2);root.visible=id!=='beacon';const asset=await session.attach(root,{owned:true,metadata:{label:root.name,source:`rubberneck:${id}`}});props.set(id,{root,asset,moving:false,speed:1,width:3,motionTime:0,origin:root.position.clone(),lastMotionPosition:root.position.clone()});
  }
  if(initial.arch){const asset=await session.loadAsset({url:initial.arch.url,normalize:false,metadata:{label:'Carved stone arch',source:initial.arch.url}});const b=new THREE.Box3().setFromObject(asset.root),size=b.getSize(new THREE.Vector3()),center=b.getCenter(new THREE.Vector3());asset.root.scale.setScalar(3.3/size.y);asset.root.position.set(-center.x*asset.root.scale.x,-b.min.y*asset.root.scale.y,-4.5-center.z*asset.root.scale.z);asset.root.updateMatrixWorld(true);}
  guideLine=new THREE.LineSegments(new THREE.BufferGeometry(),guideMaterial);guideLine.renderOrder=100;guide.add(guideLine);await session.attach(guide,{owned:true,presentation:true});
  baselineInputs={...initial,running:false,attention:{...initial.attention,interests:[...props.values()].map(row=>({object:row.asset.id,label:row.root.name,anchor:'center',interest:1.2}))}};
  living=await makeLiving(clone(baselineInputs));if(automatic)for(const step of sequence.advance(0))applyEvents(step);session.setView(initial.view);
  const stop=session.onFrame(frame=>{tick(frame);showField();});seatings.push({dispose:stop});
  recording=createInvestigationRecording({id:crypto.randomUUID(),source:{experiment:'rubberneck/courtyard',program},initial:read(),startingConditions:{kind:'authored-creature-baseline',fluidCheckpoint:false}});
  if(globalThis.window)window.kaminosCreatureCourtyard={read,operations};
  return {read,operations,mount({root,document=host.controls.document,invoke}){
   mountRoot=root;living.mount({root});const node=document.createElement('section');mountNode=node;node.className='creature-courtyard-controls';node.style.cssText='display:grid;gap:8px;padding:10px';
   const title=document.createElement('strong'),status=document.createElement('output'),label=document.createElement('label'),timed=document.createElement('input');title.textContent='Courtyard objects';timed.type='checkbox';timed.setAttribute('aria-label','Run timed objects');label.append(timed,document.createTextNode('Run timed objects'));timed.onchange=()=>invoke('automatic',{enabled:timed.checked});node.append(title,status,label);
   function action(label,op){const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=()=>invoke(op).catch(e=>status.textContent=e.message);node.append(b);}
   action('Repeat object events','repeat');action('Restart creatures','restart');action('Save observation and event history','export');
   const fieldLabel=document.createElement('label'),field=document.createElement('input');field.type='checkbox';field.setAttribute('aria-label','Selected creature sensory field');field.onchange=()=>invoke('field',{visible:field.checked});fieldLabel.append(field,document.createTextNode('Show selected creature’s sensory field'));node.append(fieldLabel);
   const details=document.createElement('details'),summary=document.createElement('summary'),editor=document.createElement('textarea');summary.textContent='Timed event program';editor.setAttribute('aria-label','Courtyard event program');editor.rows=10;editor.style.width='100%';editor.value=JSON.stringify(program,null,2);editor.oninput=()=>{try{invoke('program',JSON.parse(editor.value)).catch(e=>status.textContent=e.message);}catch(e){status.textContent=e.message;}};details.append(summary,editor);node.append(details);
   const note=document.createElement('p');note.textContent='Select a bronze object to edit it. Timed objects and creatures run independently; fire keeps its ordinary controls. Events use viewer seconds and do not provide exact fluid replay.';node.append(note);root.append(node);ui={status,automatic:timed};sync();
   if(host.controls.mountObject){for(const [id,row]of props)mountSource({asset:row.asset,id,document,invoke});const fire=host.scene.objects?.().find(x=>x.type==='flame-emitter');if(fire)mountSource({asset:{id:fire.id,root:fire.object},id:'fire',document,invoke});}
  },async dispose(){disposed=true;recording?.finish();if(globalThis.window?.kaminosCreatureCourtyard?.read===read)delete window.kaminosCreatureCourtyard;for(const seat of seatings)seat?.dispose?.();mountNode?.remove();await living?.dispose();await session.dispose();}};
 }catch(error){await living?.dispose();await session.dispose();throw error;}
}
export default {id:'rubberneck/courtyard',title:'Creatures · furnace courtyard',create:createCourtyard};
