import * as THREE from '../lib/three.core.js';
import {createCarriageRun} from '../casting-carriage.mjs';
import pourStudy from './stage-pour.experiment.mjs';
import {stageLetterCastings,createCastingTransfer,castingPickupPose} from '../casting-transfer.mjs';

export default {id:'stage-casting',title:'Workshop · casting to fire',async create({host,inputs={},record},createPourStudy=pourStudy.create){
 const doc=host.controls.document,app=doc.defaultView,author=app.kaminosSceneAuthoring;
 const study=await createPourStudy({host,inputs,record}),session=await host.scene.open();
 let flame,closed=false,pending=Promise.resolve(),pieceId=null,cursor=0,sourceRecipe=null,burnStart=null,ignitionSeconds=2,transferSeconds=4,phase='At the mold',status,updateButtons=()=>{},cleanup=()=>{},createdFire=false;
 const object=id=>host.scene.objects().find(o=>o.id===id)?.object;
 let carriageRuntime=null,carriageId=null,carriagePose=null,carriageRecipe=null,carriagePayload=null;
 const carriage=createCarriageRun({write:position=>{
  if(!object(carriageId))throw Error('Loader was removed');
  const current=carriageRuntime.read();
  if(current.playing||current.cycle!==carriagePose||JSON.stringify(current.recipe)!==carriageRecipe||app.kaminosSceneEdits?.state().active)throw Error('Loader edited · automatic transfer stopped');
  if(carriagePayload&&(!object(carriagePayload)||!current.recipe.attachments?.some(a=>a.objectId===carriagePayload)))throw Error('Casting removed or detached · transfer stopped');
  carriageRuntime.operations.seek({cycle:position-(current.recipe.phase??0)});
  const next=carriageRuntime.read();carriagePose=next.cycle;carriageRecipe=JSON.stringify(next.recipe);
 },arrive:()=>{phase='Loader at '+(carriage.read().target===.5?'kiln':'mold');refresh();}});
 const carrierEntry=()=>host.scene.objects().find(e=>e.id===inputs.carrierId||(!inputs.carrierId&&e.object.userData.linkMechanism?.castingCarrier?.moldId===study.read().moldId));
 const mold=()=>object(study.read().moldId);
 const kiln=()=>host.scene.objects().find(o=>o.id===inputs.kilnId||(!inputs.kilnId&&o.label?.startsWith('Kiln ·')))?.object;
 const pose=o=>({position:o.position.toArray(),rotation:[o.rotation.x,o.rotation.y,o.rotation.z],scale:o.scale.toArray()});
 const adopt=()=>{
  if(pieceId&&object(pieceId))return;
  const recipe=mold()?.userData.kaminosStageMold;if(!recipe)return;
  const prefix=recipe.label+' · piece ',matches=host.scene.objects().filter(row=>row.object.userData.kaminosStageCasting?.label.startsWith(prefix));
  if(!matches.length){pieceId=null;return;}
  const found=matches.at(-1);pieceId=found.id;cursor=Math.max(cursor,...matches.map(row=>Number(row.object.userData.kaminosStageCasting.label.slice(prefix.length))||0));sourceRecipe=JSON.stringify(recipe);phase='Saved casting · ignite or remove';
 };
 adopt();
 const active=()=>{if(closed)throw Error('Casting workshop is closed');};
 const read=()=>({phase,pieceId,cursor,transfer:transfer.read(),carriage:carriage.read(),carrierId:carrierEntry()?.id,ignitionSeconds,transferSeconds,igniting:burnStart!==null,combustion:pieceId?author.burningState(pieceId):null,study:study.read(),fidelity:'Authored solid inserts and joint kinematics; existing thermal combustion. Liquid solidification is not simulated.',firePrepared:!!flame});
 const refresh=()=>{if(status)status.textContent=phase+(pieceId?' · '+author.burningState(pieceId).status:'');updateButtons();};
 const transfer=createCastingTransfer({write:p=>{const root=object(pieceId);if(!root)throw Error('The travelling casting was removed');root.position.fromArray(p.position);root.rotation.set(...p.rotation);root.scale.fromArray(p.scale);root.updateMatrixWorld(true);session.redraw();},arrive:()=>{phase='At the kiln · ignite when you like';host.scene.refreshPresentation({id:pieceId,root:object(pieceId)});record({kind:'casting.arrive',effective:{pieceId,pose:pose(object(pieceId))}});refresh();}});
 const serial=fn=>arg=>{const task=pending.then(()=>{active();return fn(arg);});pending=task.catch(()=>{});return task;};
 async function prepare(){
  if(flame)return;
  const k=kiln();if(!k)throw Error('Choose a kiln object for this workshop');
  flame=await host.flame.open();
  if(!flame.read().scene.objects.some(o=>o.id==='flame-field')){
   const artifact=await fetch('/artifacts/inference-kiln/study.json').then(r=>{if(!r.ok)throw Error('Kiln basin recipe unavailable');return r.json();});
   await host.fire.add(inputs.basinId??artifact.sourceBasinId);createdFire=true;host.fire.setEnabled(false);flame.setPaused(true);
   flame.setControls({'volume-resolution':32,'volume-steps':8,'volume-render-scale':.5,'volume-look-freeze':1});
   k.updateWorldMatrix(true,false);
   const inlet=k.localToWorld(new THREE.Vector3(0,-.05,.28));
   host.scene.setTransform('flame-emitter',{position:inlet.toArray(),rotation:[0,0,0],scale:[1,1,1]});
   app.kaminosFlameDomain.set({position:inlet.clone().add(new THREE.Vector3(0,1.5,0)).toArray(),scale:[1,1,1]});
  }
  phase='Burner prepared · release a letter';refresh();
 }
 async function unmold(){
   adopt();if(pieceId&&object(pieceId))throw Error('Remove the current casting before lifting the next letter');
   if(transfer.read()?.moving)throw Error('Let this letter arrive, or stop its transfer first');
   if(burnStart!==null)throw Error('Stop ignition before releasing another letter');
   await study.operations.stopPour();
   const m=mold();if(!m)throw Error('The mold was removed');const p=m.userData.kaminosStageMold,signature=JSON.stringify(p);if(signature!==sourceRecipe){cursor=0;sourceRecipe=signature;}
   const letters=stageLetterCastings(p),part=letters[cursor%letters.length];
   const start=castingPickupPose(m,part.offset);
   const id=await author.addStageCasting(part.recipe,start);pieceId=id;cursor++;
   phase='At the mold · fasten or carry the casting';record({kind:'casting.unmold',effective:{id,part,cursor,pose:start}});refresh();return {id,part,start};
 }
 async function carrier(){
  const entry=carrierEntry();if(!entry)throw Error('This workshop has no loader assigned');
  carriageId=entry.id;carriageRuntime=await app.kaminosMechanisms.ensure(entry.object);
  const joint=inputs.carrierJoint??entry.object.userData.linkMechanism.castingCarrier?.joint;
  if(!Number.isInteger(joint)||!carriageRuntime.read().recipe.nodes[joint])throw Error('Choose an existing loader delivery joint');
  return {runtime:carriageRuntime,joint};
 }
 function startCarriage(runtime,target,payload){
  runtime.operations.pause();const current=runtime.read();
  carriagePose=current.cycle;carriageRecipe=JSON.stringify(current.recipe);carriagePayload=payload;
  carriage.start(Math.acos(1-2*current.fraction)/(2*Math.PI),target,transferSeconds);
 }
 async function detachCasting(){
  for(const row of host.scene.objects())if(row.object.userData.linkMechanism?.attachments?.some(a=>a.objectId===pieceId))await app.kaminosMechanisms.invoke(row.id,'detach',{objectId:pieceId});
 }
 const operations={...study.operations,read,
  prepare:serial(async()=>{try{await prepare();return read();}catch(e){flame=null;throw e;}}),
  unmold:serial(async()=>{await unmold();return read();}),
  release:serial(async()=>{
   const k=kiln();if(!k)throw Error('Choose a kiln object for this workshop');k.updateWorldMatrix(true,false);
   const {id,part,start}=await unmold();
   const fire=host.fire.read(),source=fire.registered?fire.pose:{position:k.localToWorld(new THREE.Vector3(0,-.05,.28)).toArray()};
   const q=k.getWorldQuaternion(new THREE.Quaternion()).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI/2,0,0))),e=new THREE.Euler().setFromQuaternion(q);
   const target={position:source.position.map((v,i)=>v+(i===1?.75:i===2?.08:0)),rotation:[e.x,e.y,e.z],scale:start.scale};
   phase='Carrying letter '+cursor;transfer.start(start,target,{seconds:transferSeconds,lift:1});record({kind:'casting.release',effective:{id,part,cursor,from:start,to:target,transferSeconds}});refresh();return read();
  }),
  carry:serial(async()=>{
   adopt();if(!pieceId||!object(pieceId))throw Error('Unmold a letter first');
   if(burnStart!==null)throw Error('Stop ignition before moving the loader');
   if(transfer.read()?.moving)throw Error('Stop the hover transfer first');
   const {runtime,joint}=await carrier();
   if(!runtime.read().recipe.attachments?.some(a=>a.objectId===pieceId))runtime.operations.attach({objectId:pieceId,joint});
   startCarriage(runtime,.5,pieceId);phase='Loader carrying the casting';refresh();return read();
  }),
  returnLoader:serial(async()=>{
   if(burnStart!==null)throw Error('Stop ignition before returning the loader');
   const {runtime}=await carrier();await detachCasting();
   startCarriage(runtime,0,null);phase='Casting set down · loader returning';refresh();return read();
  }),
  ignite:serial(async()=>{
   adopt();if(!pieceId||!object(pieceId))throw Error('Release a letter first');if(transfer.read()?.moving||carriage.read()?.moving)throw Error('Let the letter arrive before ignition');
   if(!flame){try{await prepare();}catch(e){flame=null;throw e;}}
   phase='Preparing burnable material';refresh();await author.settleCombustion();active();
   const state=author.burningState(pieceId);if(state.status!=='resident')throw Error(state.error??'Burnable material has not attached to the fire runtime');
   // elapsed comes from the resident thermal consumer, so pausing or slow
   // simulation does not silently shorten the dose.
   burnStart={elapsed:state.state?.elapsed??null};host.fire.setEnabled(true);flame.setPaused(false);phase='Igniting';refresh();return read();
  }),
  removeCasting:serial(async()=>{adopt();if(!pieceId)return read();transfer.cancel();carriage.cancel();await detachCasting();if(flame)host.fire.setEnabled(false);burnStart=null;await app.removeSceneObject(pieceId);pieceId=null;phase='Casting removed · lift the next letter';refresh();return read();}),
  stopIgnition:serial(async()=>{if(flame)host.fire.setEnabled(false);burnStart=null;phase='Source off · material continues burning';refresh();return read();}),
  stopTransfer(){active();transfer.cancel();carriage.cancel();phase='Transfer stopped · move the casting with native controls';refresh();return read();},
  setIgnitionSeconds(value){active();value=Number(value);if(!Number.isFinite(value)||value<=0)throw Error('Ignition seconds must be positive');ignitionSeconds=value;refresh();return read();},
  setTransferSeconds(value){active();value=Number(value);if(!Number.isFinite(value)||value<=0)throw Error('Transfer seconds must be positive');transferSeconds=value;refresh();return read();},
  pause(){active();if(flame)flame.setPaused(!flame.read().paused);return read();},
 };
 const stop=session.onFrame(({deltaSeconds})=>{try{
  transfer.advance(deltaSeconds);carriage.advance(deltaSeconds);
  if(burnStart!==null){if(!object(pieceId))throw Error('Casting removed · ignition stopped');const state=author.burningState(pieceId);if(state.status!=='resident')throw Error(state.error??'Material unavailable · ignition stopped');const elapsed=state.state?.elapsed;if(Number.isFinite(elapsed)){burnStart.elapsed??=elapsed;if(elapsed-burnStart.elapsed>=ignitionSeconds){host.fire.setEnabled(false);burnStart=null;phase='Source off · material continues burning';record({kind:'casting.ignition-ended',effective:{pieceId,elapsed,ignitionSeconds}});}}}
  refresh();
 }catch(error){transfer.cancel();carriage.cancel();if(flame)host.fire.setEnabled(false);burnStart=null;phase=error.message;refresh();}});
 return {read,operations,mount({root,invoke}){
  study.mount({root,invoke});
  const k=kiln(),row=host.scene.objects().find(o=>o.object===k);if(!row)throw Error('Choose a kiln object');
  const panel=doc.createElement('section');panel.dataset.stageOperating='kiln';panel.setAttribute('aria-label','Kiln controls');
  const title=doc.createElement('header'),label=doc.createElement('span');label.className='operating-title';label.textContent='Kiln';title.append(label);panel.append(title);
  const call=name=>invoke(name).catch(e=>{phase=e.message;refresh();});
  const ignite=doc.createElement('button');ignite.className='btn';ignite.textContent='Ignite';ignite.title='Heat the letter for the chosen simulation time, then turn the source off and let the material burn.';ignite.onclick=()=>call(burnStart!==null?'stopIgnition':'ignite');title.append(ignite);
  const release=doc.createElement('button');release.className='btn';release.textContent='Unmold next letter';release.title='Lift a separate solid letter at the mold for pickup. Liquid solidification is not simulated.';release.onclick=()=>call('unmold');
  doc.querySelector('[data-stage-operating="mold"]').append(release);
  const loader=carrierEntry();let loaderMount;
  if(loader){
   const card=doc.createElement('section');card.dataset.stageOperating='loader';card.setAttribute('aria-label','Loader controls');
   const head=doc.createElement('header');head.className='operating-title';head.textContent='Loader';card.append(head);
   for(const [label,op,tip]of [['Carry to kiln','carry','Fasten the current letter at its current position, then move the loader from here to Pose B.'],['Set down & return','returnLoader','Detach the letter in place and return the loader to Pose A.'],['Stop','stopTransfer','Hold the loader and attached casting where they are.']]){const b=doc.createElement('button');b.className='btn';b.textContent=label;b.title=tip;b.onclick=()=>call(op);card.append(b);}
   loaderMount=host.controls.mountOperating({asset:{id:loader.id,root:loader.object},node:card,side:'left',anchor:[0,1,0]});
  }else{const hover=doc.createElement('button');hover.className='btn';hover.textContent='Lift & hover to kiln';hover.onclick=()=>call('release');panel.append(hover);}
  const remove=doc.createElement('button');remove.className='btn';remove.textContent='Remove casting';remove.title='Remove the current casting through scene history; Undo restores it. Clear it before the next delivery.';remove.onclick=()=>call('removeCasting');panel.append(remove);
  const drags=[],fields={};
  for(const [name,text,value]of [['setTransferSeconds','Carry · seconds',transferSeconds],['setIgnitionSeconds','Ignition · sim seconds',ignitionSeconds]]){const l=doc.createElement('label');l.textContent=text;const input=doc.createElement('input');input.type='number';input.min='.01';input.step='.1';input.value=value;fields[name]=input;input.className='transform-input';input.setAttribute('aria-label',text);input.onchange=()=>invoke(name,input.value).catch(e=>{phase=e.message;refresh();});l.append(input);panel.append(l);drags.push(host.controls.installNumberDrag({input,step:.1}));}
  status=doc.createElement('p');status.className='operating-status';status.setAttribute('role','status');panel.append(status);
  const mount=host.controls.mountOperating({asset:{id:row.id,root:k},node:panel,side:'right',anchor:[.35,.3,.2]});
  updateButtons=()=>{for(const [name,value]of [['setTransferSeconds',transferSeconds],['setIgnitionSeconds',ignitionSeconds]])if(doc.activeElement!==fields[name])fields[name].value=value;ignite.textContent=burnStart!==null?'Stop ignition':'Ignite';release.disabled=!!(pieceId&&object(pieceId));};
  const note=doc.createElement('p');note.textContent='Unmold a letter, carry it with the loader, then ignite it at the kiln. The loader follows authored joint poses; burning uses the actual thermal material. Liquid solidification is not simulated.';root.prepend(note);
  cleanup=()=>{drags.forEach(d=>d.dispose());release.remove();loaderMount?.dispose();mount.dispose();};refresh();
 },async dispose(){if(closed)return;closed=true;await pending;stop();cleanup();transfer.cancel();carriage.cancel();if(burnStart!==null&&flame)host.fire.setEnabled(false);burnStart=null;if(createdFire&&flame)flame.setPaused(true);await study.dispose();await session.dispose();}};
}};
