import * as THREE from '../../lib/three.core.js';
import {createLivingScene} from './living-scene.experiment.mjs';
import {createStimulusSequence,validateStimulusProgram} from './stimulus-sequence.mjs';
import {createInvestigationRecording,investigationOperations} from '../../investigation-recording.mjs';
const clone=x=>structuredClone(x);
const sources=new Set(['fire','beacon','traveler']);
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
export async function createCourtyard({host,inputs={},record=()=>{}},dependencies={}){
 const initial=inputs.actors?clone(inputs):await(await fetch(new URL('./courtyard.setup.json',import.meta.url))).json();
 let sequence=createStimulusSequence(validateCourtyardProgram(initial.program)),automatic=true,living=null,disposed=false,mountNode=null,diagnostic=false,recording=null;
 const session=await host.scene.open(),props=new Map(),seatings=[],log=[];let ui=null,worldTime=0,programTime=0;
 const materials=[0x968d7a,0xa59b86,0x8b8477,0xb1a58e].map(color=>new THREE.MeshStandardMaterial({color,roughness:.93}));
 const bronze=new THREE.MeshStandardMaterial({color:0x876844,metalness:.65,roughness:.48}),inlay=new THREE.MeshStandardMaterial({color:0x4b716e,metalness:.6,roughness:.5});
 const floor=new THREE.Group();floor.name='Stone court';
 function mesh(parent,geometry,material,position){const m=new THREE.Mesh(geometry,material);m.position.fromArray(position);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;}
 function box(parent,size,position,index=0){return mesh(parent,new THREE.BoxGeometry(...size),materials[index%materials.length],position);}
 for(let x=0;x<12;x++)for(let z=0;z<10;z++)box(floor,[.99,.16,.99],[x-5.5,-.09,z-4.5],(x*7+z*11)%4);
 // Perimeter architecture leaves the authored walking ellipse open. The
 // contact solver remains creature-owned; these are ordinary editable props.
 const architecture=new THREE.Group();architecture.name='Court colonnade';
 for(const x of [-5,5])for(const z of [-4,-1.3,1.3,4]){
  box(architecture,[.72,.2,.72],[x,.1,z],1);box(architecture,[.55,.18,.55],[x,.29,z],0);
  mesh(architecture,new THREE.CylinderGeometry(.18,.25,2.3,12),materials[1],[x,1.52,z]);
  box(architecture,[.65,.26,.65],[x,2.8,z],1);box(architecture,[.8,.18,.8],[x,3.02,z],0);
 }
 for(const x of [-5,5])box(architecture,[.65,.35,8.8],[x,3.2,0],2);
 for(const z of [-4.8,4.8])for(const x of [-4,-2,0,2,4])box(architecture,[1.98,.45,.35],[x,.225,z],2);
 let flame;
 const programState=()=>({...sequence.read(),time:programTime,cycle:Math.floor(programTime/sequence.read().program.duration)});
 const identity=()=>({time:worldTime,program:programState(),automatic});
 const emit=(kind,effective)=>{const event={kind,phase:'applied',target:'furnace-courtyard',clock:identity(),effective};log.push(clone(event));record(event);investigationOperations.emit(event);};
 function patch(source,values){
  validateCourtyardProgram({duration:1,events:[{at:0,source,patch:values}]});
  if(source==='fire'){flame.setControls({'volume-flow-rate':values.flow});return;}
  const row=props.get(source);if(!row?.asset.root.parent)throw Error(`Source removed from scene: ${source}`);
  if(values.visible!==undefined)row.root.visible=values.visible;
  if(values.scale!==undefined)row.root.scale.setScalar(values.scale);
  if(values.moving!==undefined)row.moving=values.moving;
  row.root.updateMatrixWorld(true);session.redraw();
 }
 const worldSteps=seconds=>automatic?sequence.advance(seconds):[{seconds,time:sequence.read().time,events:[]}];
 function beforeStep(step){
  worldTime+=step.seconds;programTime=step.time;
  const traveler=props.get('traveler');if(traveler?.moving){const phase=step.time%sequence.read().program.duration;traveler.root.position.x=3*Math.sin(phase*.7);traveler.root.position.y=1.3+.5*Math.sin(phase*1.1);traveler.root.updateMatrixWorld(true);}
  for(const event of step.events){patch(event.source,event.patch);emit('courtyard.event',{event,observationPhase:'after world edit, before creature step',observations:living?.read().actors.map(({id,state})=>({id,attention:state.attention,engagement:state.action.engagement}))??[]});}
  sync();
 }
 function read(){return {schema:'kaminos.creature-courtyard.v1',...identity(),mounted:!disposed,sources:Object.fromEntries([...props].map(([id,row])=>[id,{hostId:row.asset.id,mounted:Boolean(row.root.parent),visible:row.root.visible,moving:row.moving??false,position:row.root.position.toArray(),scale:row.root.scale.toArray()}])),fire:flame?.read()??null,creatures:living?.read()??null,diagnostic,log:clone(log),continuation:{events:'repeat preserves creature experience',restart:'initial creature recipes and source controls; flame fluid field is not a checkpoint'}};}
 function sync(){if(!ui)return;const s=programState();ui.status.textContent=`${automatic?'Scheduled':'Manual'} · ${s.time.toFixed(1)} / ${s.program.duration} s · cycle ${s.cycle+1}`;ui.toggle.textContent=automatic?'Use manual sources':'Resume schedule';}
 function exportFile(value,name){const document=host.controls.document,url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=name;a.click();URL.revokeObjectURL(url);}
 const operations={
  setRunning:input=>living.operations.setRunning(input),advance:input=>living.operations.advance(input),actor:input=>living.operations.actor(input),
  automatic({enabled}={}){if(typeof enabled!=='boolean')throw Error('Automatic schedule requires boolean');automatic=enabled;sync();emit('courtyard.automatic',{enabled});return read();},
  manual({source,patch:values}={}){patch(source,values);automatic=false;sync();emit('courtyard.manual',{source,patch:values});return read();},
  repeat(){automatic=true;for(const step of sequence.repeat())beforeStep(step);emit('courtyard.repeat',{preservesExperience:true});return read();},
  program(value){const program=validateCourtyardProgram(value);sequence=createStimulusSequence(program);automatic=true;for(const step of sequence.advance(0))beforeStep(step);emit('courtyard.program',program);return read();},
  async restart(){await living.operations.setRunning({running:false});for(const actor of initial.actors)await living.operations.replace({id:actor.id,creature:clone(actor.creature)});worldTime=0;automatic=true;for(const step of sequence.repeat())beforeStep(step);emit('courtyard.restart',{creatures:'initial recipes',fluidCheckpoint:false});return read();},
  field({visible}={}){if(typeof visible!=='boolean')throw Error('Sensory field requires boolean');diagnostic=visible;guide.visible=visible;return read();},
  export(){exportFile({recording:recording.snapshot(),context:read()},'courtyard-observation.json');return read();},
  frame(){session.setView(initial.view);return read();},
 };
 const guide=new THREE.Group();guide.name='Selected creature sensory field';guide.visible=false;guide.userData.kaminosEditorOnly=true;
 const guideMaterial=new THREE.LineBasicMaterial({color:0x70d9cb,transparent:true,opacity:.65,depthTest:false});let guideLine;
 function showField(){
  if(!diagnostic||!living)return;const selected=globalThis.window?.kaminosSelection?.read()?.activeId;
  const actor=living.read().actors.find(x=>x.state.host.id===selected),field=actor?.state.attention?.sensoryField;guide.visible=Boolean(field);if(!field)return;
  const eye=new THREE.Vector3(...field.eye),forward=new THREE.Vector3(...field.gaze),up=new THREE.Vector3(0,1,0),side=new THREE.Vector3().crossVectors(forward,up).normalize();if(side.lengthSq()<1e-8)side.set(1,0,0);up.crossVectors(side,forward).normalize();
  const points=[],length=2; // Drawing length only; actual per-source ranges stay in the inspector.
  for(let i=0;i<32;i++){const a=i/32*Math.PI*2,b=(i+1)/32*Math.PI*2;const rim=t=>eye.clone().addScaledVector(forward,Math.cos(field.fieldOfView*.5)*length).addScaledVector(side,Math.cos(t)*Math.sin(field.fieldOfView*.5)*length).addScaledVector(up,Math.sin(t)*Math.sin(field.fieldOfView*.5)*length);points.push(rim(a),rim(b));if(i%8===0)points.push(eye.clone(),rim(a));}
  guideLine.geometry.dispose();guideLine.geometry=new THREE.BufferGeometry().setFromPoints(points);session.redraw();
 }
 try{
  await session.attach(floor,{owned:true,metadata:{label:floor.name,source:'rubberneck:courtyard-stone-floor'}});
  await session.attach(architecture,{owned:true,metadata:{label:architecture.name,source:'rubberneck:courtyard-colonnade'}});
  for(const id of ['beacon','traveler']){
   const root=new THREE.Group();root.name=id==='beacon'?'Bronze iris beacon':'Crossing bronze lantern';
   mesh(root,new THREE.IcosahedronGeometry(.4,1),bronze,[0,0,0]);for(const rotation of [0,Math.PI*.5]){const ring=mesh(root,new THREE.TorusGeometry(.55,.035,6,28),inlay,[0,0,0]);ring.rotation.x=rotation;}
   root.position.set(id==='beacon'?2.5:-3,1.2,id==='beacon'?1:-2);const asset=await session.attach(root,{owned:true,metadata:{label:root.name,source:`rubberneck:${id}`}});props.set(id,{root,asset,moving:false});
  }
  if(initial.arch){const asset=await session.loadAsset({url:initial.arch.url,normalize:false,metadata:{label:'Carved stone arch',source:initial.arch.url}});const b=new THREE.Box3().setFromObject(asset.root),size=b.getSize(new THREE.Vector3()),center=b.getCenter(new THREE.Vector3());asset.root.scale.setScalar(3.3/size.y);asset.root.position.set(-center.x*asset.root.scale.x,-b.min.y*asset.root.scale.y,-4.5-center.z*asset.root.scale.z);asset.root.updateMatrixWorld(true);}
  guideLine=new THREE.LineSegments(new THREE.BufferGeometry(),guideMaterial);guideLine.renderOrder=100;guide.add(guideLine);await session.attach(guide,{owned:true,presentation:true});
  flame=await (dependencies.openFlame?.()??host.flame.open());if(!flame?.read().active)throw Error('Courtyard requires an active authored Fire & smoke field');
  const livingInputs={...initial,running:false,attention:{...initial.attention,interests:[...props.values()].map(row=>({object:row.asset.id,label:row.root.name,anchor:'center',interest:1.2}))}};
  living=await (dependencies.createLivingScene??createLivingScene)({host,inputs:livingInputs,record},{...dependencies,worldSteps,beforeStep});
  for(const step of sequence.advance(0))beforeStep(step);
  session.setView(initial.view);
  const stop=session.onFrame(showField);seatings.push({dispose:stop});
  recording=createInvestigationRecording({id:crypto.randomUUID(),source:{experiment:'rubberneck/courtyard',program:sequence.read().program},initial:read(),startingConditions:{kind:'authored-creature-baseline',fluidCheckpoint:false}});
  if(globalThis.window)window.kaminosCreatureCourtyard={read,operations};
  return {read,operations,mount({root,document=host.controls.document,invoke}){
   living.mount({root});const node=document.createElement('section');mountNode=node;node.style.cssText='display:grid;gap:8px;padding:10px';node.className='creature-courtyard-controls';
   const title=document.createElement('strong');title.textContent='Furnace courtyard';node.append(title);
   const status=document.createElement('output');node.append(status);const act=(label,op,input)=>{const button=document.createElement('button');button.type='button';button.textContent=label;button.onclick=async()=>{try{await invoke(op,typeof input==='function'?input():input);}catch(e){status.textContent=e.message;}};node.append(button);return button;};
   const toggle=act('Use manual sources','automatic',()=>({enabled:!automatic}));act('Repeat events · keep experience','repeat');act('Restart creatures and events','restart');act('Advance 1 simulation second','advance',{seconds:1});act('Frame courtyard','frame');
   const label=document.createElement('label'),field=document.createElement('input');field.type='checkbox';field.setAttribute('aria-label','Selected creature sensory field');field.onchange=()=>invoke('field',{visible:field.checked});label.append(field,document.createTextNode('Show selected creature’s sensory field'));node.append(label);
   for(const [text,source,values]of [['Fire quiet','fire',{flow:0}],['Fire small','fire',{flow:1.2}],['Fire large','fire',{flow:6}],['Beacon show','beacon',{visible:true}],['Beacon hide','beacon',{visible:false}],['Lantern move','traveler',{moving:true}],['Lantern stop','traveler',{moving:false}]])act(text,'manual',{source,patch:values});
   const details=document.createElement('details'),summary=document.createElement('summary'),editor=document.createElement('textarea');summary.textContent='Edit timed events';editor.setAttribute('aria-label','Courtyard event program');editor.rows=12;editor.style.width='100%';editor.value=JSON.stringify(sequence.read().program,null,2);details.append(summary,editor);const apply=document.createElement('button');apply.textContent='Apply event program';apply.onclick=()=>{try{invoke('program',JSON.parse(editor.value)).catch(e=>status.textContent=e.message);}catch(e){status.textContent=e.message;}};details.append(apply);node.append(details);act('Save observation and event history','export');
   const note=document.createElement('p');note.textContent='48 s repeating sequence. Manual source controls hold the schedule; creatures keep their experience. The field drawing shows gaze direction, not occlusion. Restart does not restore evolved fire fluid.';node.append(note);root.append(node);ui={status,toggle};sync();
   for(const row of props.values())if(host.controls.mountObject){const properties=document.createElement('p');properties.textContent='Timed courtyard source. Move it with ordinary scene controls; choose Manual to hold its event program.';seatings.push(host.controls.mountObject({asset:row.asset,properties}));}
  },async dispose(){disposed=true;recording?.finish();if(globalThis.window?.kaminosCreatureCourtyard?.read===read)delete window.kaminosCreatureCourtyard;for(const seat of seatings)seat?.dispose?.();mountNode?.remove();await living?.dispose();await session.dispose();}};
 }catch(error){await living?.dispose();await session.dispose();throw error;}
}
export default {id:'rubberneck/courtyard',title:'Creatures · furnace courtyard',create:createCourtyard};
