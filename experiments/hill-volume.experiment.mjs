import * as THREE from '../lib/three.core.js';
import {MeshStandardNodeMaterial,StorageBufferAttribute,IndirectStorageBufferAttribute} from '../lib/three.webgpu.js';
import {storage,vertexIndex,instanceIndex,Fn,vec4,uint,transformNormalToView} from '../lib/three.tsl.js';
import {makeVolumeSpecimen,volumeConfig,packVolumeBodies,weatherBody,volumePoseAnchors} from './hill-terrain/volume-model.mjs';
import {createViewportPosePin} from '../viewport-pose-pin.mjs';
import {createVolumeGPU} from './hill-terrain/volume-gpu.mjs';
import {scaleAllocation} from './hill-terrain/volume-scale.mjs';
import {createVolumePlayback} from './hill-terrain/volume-playback.mjs';

export default {
 id:'hill-volume',title:'Hill · rock and soil volumes',
 async create({host,inputs={},record=()=>{}}){
  let initialConfig={...(inputs.config??{})};
  let model=makeVolumeSpecimen(initialConfig),solver=null,renderer=null,starting=null,playing=inputs.playing??true,disposed=false,error=null,advancing=false,generation=0,growthEnabled=false,shoveEnabled=true,shoveGesture=null,shoveEpoch=0,anchorControls=null,anchorsVisible=inputs.anchorsVisible??true,operationTail=Promise.resolve(),queuedOperations=0;
  const clock=()=>createVolumePlayback({dt:model.config.dt,...(model.config.scale?{maxBatchSeconds:1/60}:{})});
  let playback=clock();
  let releaseRenderer;const rendererAvailable=new Promise(resolve=>{releaseRenderer=resolve;});
  const session=await host.scene.open(),root=new THREE.Group();root.name='Rock and soil volume specimen';
  const settings={rock:7,weatherDepth:.025,growthRate:.025,pushRadius:.55,pushSpeed:1.5,pushX:-.7,pushY:.4,pushZ:1.0,rockPushX:0,rockPushY:0,rockPushZ:2,shoveGain:2,...inputs.settings};
  const floor=new THREE.Mesh(new THREE.BoxGeometry(4.8,.12,4.8),new MeshStandardNodeMaterial({color:0x575f4d,roughness:1}));floor.position.set(0,-.07,.5);floor.receiveShadow=true;root.add(floor);
  const syncFloor=()=>{if(model.config.fixture!=='hundred-rocks'){floor.geometry.dispose();floor.geometry=new THREE.BoxGeometry(4.8,.12,4.8);floor.position.set(0,-.07,.5);}else{const c=model.config,w=c.dimensions[0]*c.cell,d=c.dimensions[2]*c.cell;floor.geometry.dispose();floor.geometry=new THREE.BoxGeometry(w,.12,d);floor.position.set(c.origin[0]+w/2,-.07,c.origin[2]+d/2);}};syncFloor();
  let asset,renderObjects=[],attributes=[],nodes=[],status,playButton,growthToggle,contactToggle,rockSelect,soilHeightInput,soilHeightLabel,soilHeightDragging=false,soilHeightPending=false,collisionSelect,scalePanel,scaleInfo,scaleMessage,scaleRejection,scaleDraft=false,scalePending=false,scaleFields=[];
  const scaleValues=()=>model.config.scale??{width:model.config.dimensions[0]*model.config.cell,depth:model.config.dimensions[2]*model.config.cell,height:model.config.dimensions[1]*model.config.cell,cell:model.config.cell,spacing:model.config.spacing,rocks:model.bodies.length,freeRocks:0};
  const scaleConfig=patch=>{
   if(model.config.fixture!=='hundred-rocks')throw Error('Choose the rock pile to tune scale');
   const current=scaleValues(),next={...current,...patch};
   if(patch.rocks!==undefined&&patch.freeRocks===undefined)next.freeRocks=current.freeRocks===current.rocks?next.rocks:Math.min(current.freeRocks,next.rocks);
   return volumeConfig({...initialConfig,scale:next});
  };
  const limits=()=>renderer?.backend?.device?.limits;
  const estimate=patch=>{
   try{const c=scaleConfig(patch);return{ok:true,scale:c.scale,dimensions:c.dimensions,...scaleAllocation(c,limits())};}
   catch(e){return{ok:false,reason:e.message};}
  };
  const syncScale=()=>{
   if(!scalePanel)return;
   scaleMessage.textContent=scalePending?'Rebuilding specimen…':scaleRejection??'';
   scalePanel.style.display=model.config.fixture==='hundred-rocks'?'':'none';
   if(!scaleDraft&&!scalePending)for(const {key,input} of scaleFields)input.value=String(Number(scaleValues()[key].toPrecision(8)));
   if(solver&&!scaleDraft&&!scalePending){
    const g=solver.read(),free=model.bodies.reduce((n,b)=>n+Number(!b.anchored),0);
    scaleInfo.textContent=`${g.bodyCount} rocks · ${free} released · ${g.config.dimensions.join(' × ')} grid · ${(g.gpuBufferBytes/1048576).toFixed(0)} MiB GPU buffers · ${(g.config.dt*1000).toFixed(2)} ms step`;
   }
  };
  const anchorRecords=()=>{root.updateMatrixWorld(true);return volumePoseAnchors(model,solver?.read().drive.height??model.runtime?.driveHeight??0).map(a=>({...a,generation,worldPoint:a.specimenPoint?new THREE.Vector3(...a.specimenPoint).applyMatrix4(root.matrixWorld).toArray():null,worldFace:a.specimenFace.map(p=>new THREE.Vector3(...p).applyMatrix4(root.matrixWorld).toArray())}));};
  const read=()=>({id:'hill-volume',objectId:asset?.id,initialized:Boolean(solver),generation,playing,advancing,queuedOperations,growthEnabled,playback:playback.read(),shove:shoveGesture?.read()??null,anchors:anchorRecords(),anchorsVisible,error,settings:{...settings},source:model.source,conditioning:model.conditioning,weatheredMass:model.weatheredMass,
   gpu:solver?.read()??null,view:session.readView(),continuation:'settings/initial configuration via recipe; evolved state via explicit snapshot',capabilities:{heightfieldInput:false,soilPlasticity:true,reciprocalSoilRock:true,representedJointRelease:true,newFracture:false,ecologicalSuccession:false}});
  const sync=()=>{syncScale();if(collisionSelect)collisionSelect.value=model.config.collision;if(status)status.textContent=error??(!solver?'Constructing material volume…':`${solver.read().particleCount.toLocaleString()} material samples · ${solver.read().seconds.toFixed(2)} s · ${playing?'running':'paused'}${advancing?' · computing':''}${playing&&playback.read().physicalSecondsPerWallSecond!==null?' · physics '+playback.read().physicalSecondsPerWallSecond.toFixed(2)+'× wall · host '+playback.read().hostFrameHz.toFixed(0)+' Hz':''}${playing&&playback.read().pendingSeconds>.1?' · '+playback.read().pendingSeconds.toFixed(2)+' s behind':''}`);if(playButton)playButton.textContent=playing?'Pause':'Play';if(growthToggle)growthToggle.checked=growthEnabled;if(contactToggle)contactToggle.checked=model.config.conditionContacts;if(soilHeightInput){soilHeightInput.parentNode.hidden=model.config.fixture!=='hundred-rocks';if(!soilHeightDragging&&!soilHeightPending)soilHeightInput.value=String(model.config.pileSoilHeight);soilHeightInput.max=String(model.config.origin[1]+(model.config.dimensions[1]-2.1)*model.config.cell-.001);if(!soilHeightDragging&&!soilHeightPending)soilHeightLabel.textContent='Initial soil height · '+model.config.pileSoilHeight.toFixed(2)+' m (resets)';}if(rockSelect&&rockSelect.options.length!==model.bodies.length){rockSelect.replaceChildren();model.bodies.forEach((b,i)=>{const o=rockSelect.ownerDocument.createElement('option');o.value=i;o.textContent=b.id;rockSelect.append(o);});rockSelect.value=String(settings.rock);}};
  function releaseDisplay(){for(const m of renderObjects){root.remove(m);m.geometry.dispose();m.material.dispose();}for(const n of nodes)n.dispose();if(renderer)for(const a of attributes)renderer._attributes.delete(a);renderObjects=[];attributes=[];nodes=[];}
  async function initialize(r){
   try{
   renderer=r;if(!r.backend?.isWebGPUBackend||!r.backend.device)throw Error('Volume specimen requires native host WebGPU');
   const {maxVertices}=scaleAllocation(model.config,r.backend.device.limits),packed=packVolumeBodies(model.bodies);
   const attribute=(n,size=4,indirect=false)=>{const a=indirect?new IndirectStorageBufferAttribute(new Uint32Array(n),size):new StorageBufferAttribute(new Float32Array(n*size),size);attributes.push(a);const node=storage(a,indirect?'uint':'vec4',n);nodes.push(node);const init=Fn(()=>node.element(instanceIndex).assign(indirect?uint(0):vec4(0)))().compute(n);nodes.push(init);r.compute(init);return{a,node,raw:r.backend.get(a).buffer};};
   const soilP=attribute(maxVertices),soilN=attribute(maxVertices),rockP=attribute(packed.vertices.length/4),rockN=attribute(packed.vertices.length/4),indirect=attribute(4,1,true);
   const mesh=(p,n,color,label)=>{const geo=new THREE.BufferGeometry();geo.setAttribute('position',p.a);const mat=new MeshStandardNodeMaterial({color,roughness:.95});mat.positionNode=p.node.element(vertexIndex).xyz;mat.normalNode=transformNormalToView(n.node.element(vertexIndex).xyz);const m=new THREE.Mesh(geo,mat);m.name=label;m.frustumCulled=false;m.castShadow=true;m.receiveShadow=true;m.raycast=()=>{};m.userData.kaminosDynamicGeometry=true;root.add(m);renderObjects.push(m);return m;};
   const soil=mesh(soilP,soilN,0x8d7657,'Loose material surface');soil.geometry.setIndirect(indirect.a);
   mesh(rockP,rockN,0xa59a86,'Retained authored rock volumes');
   solver=await createVolumeGPU({device:r.backend.device,model,display:{soilPositions:soilP.raw,soilNormals:soilN.raw,rockPositions:rockP.raw,rockNormals:rockN.raw,indirect:indirect.raw}});
   if(disposed){solver.dispose();solver=null;return;}if(growthEnabled)solver.setDrive(settings.growthRate);sync();session.redraw();
   }catch(e){releaseDisplay();throw e;}
  }
  floor.onBeforeRender=r=>{if(disposed)return;renderer=r;releaseRenderer(r);if(starting||solver||error)return;starting=initialize(r).catch(e=>{error=e.message;playing=false;sync();session.redraw();});};
  try{asset=await session.attach(root,{owned:true,metadata:{label:root.name,source:'hill:direct-3d-material-volumes-v1',type:'experiment'}});}catch(e){floor.geometry.dispose();floor.material.dispose();await session.dispose();throw e;}
  const defaultView=()=>model.config.scale?{position:[model.config.scale.width*1.12,Math.max(5,model.config.scale.height*1.16),model.config.scale.depth*1.11],target:[0,.8,0],fov:42}:model.config.fixture==='hundred-rocks'?{position:[7.5,5.0,8.5],target:[0,.8,0],fov:42}:{position:[4.5,3.1,5.0],target:[0,.55,.45],fov:42};session.setView(inputs.view??defaultView());
  async function requireSolver(){await starting;if(!solver)throw Error(error||'Material source is not mounted');if(disposed)throw Error('Specimen disposed');return solver;}
  async function runSteps(n,playbackBatch=false){if(!Number.isSafeInteger(n)||n<0)throw Error('Choose a nonnegative physical step count');const s=await requireSolver();if(advancing)throw Error('A material operation is pending');advancing=true;sync();try{if(playbackBatch){await s.advance(n);session.redraw();}else{let remaining=n;while(remaining>0){const batch=playback.plan(remaining),started=performance.now();await s.advance(batch);playback.observe(batch,(performance.now()-started)/1000);remaining-=batch;session.redraw();}}}catch(e){error=e.message;playing=false;throw e;}finally{advancing=false;if(playbackBatch)playback.complete();sync();}return playbackBatch?undefined:read();}
  const stopFrame=session.onFrame(({deltaSeconds})=>{
   if(!playing||!solver||disposed||error)return;playback.add(deltaSeconds);
   if(advancing||queuedOperations)return;
   const n=playback.take();if(!n)return;
   runSteps(n,true).catch(()=>{});
  });
  async function releaseRock(rock){const s=await requireSolver();if(advancing)await s.done();s.release(rock);record({kind:'hill-volume.joint-release',constraint:'pose-anchor',rock,id:'pose-anchor:'+model.bodies[rock].id});sync();session.redraw();return read();}
  const operations={
   async setPlaying(value){await requireSolver();playing=Boolean(value);playback.reset();sync();session.redraw();record({kind:'hill-volume.play',value:playing});return read();},
   async advance(seconds=.1){if(!Number.isFinite(seconds)||seconds<0)throw Error('Choose nonnegative physical time');playing=false;playback.reset();const result=await runSteps(Math.round(seconds/model.config.dt));record({kind:'hill-volume.advance',seconds,effective:result.gpu});return result;},
   setSettings(patch){for(const [k,v] of Object.entries(patch)){if(!(k in settings)||!Number.isFinite(v))throw Error('Invalid specimen setting '+k);if(['weatherDepth','pushRadius','shoveGain'].includes(k)&&v<=0)throw Error(k+' must be positive');if(k==='rock'&&(!Number.isInteger(v)||!model.bodies[v]))throw Error('Choose an existing rock');}Object.assign(settings,patch);if(growthEnabled)solver?.setDrive(settings.growthRate);sync();record({kind:'hill-volume.settings',effective:{...settings}});return read();},
   async push(){const s=await requireSolver();if(advancing)await s.done();s.push({center:[settings.pushX,settings.pushY,settings.pushZ],radius:settings.pushRadius,velocity:[settings.pushSpeed,0,0]});record({kind:'hill-volume.impulse',settings:{...settings}});return runSteps(1);},
   async pickRock(ray){const s=await requireSolver();root.updateMatrixWorld(true);const inv=root.matrixWorld.clone().invert(),origin=new THREE.Vector3(...ray.origin).applyMatrix4(inv),direction=new THREE.Vector3(...ray.direction).transformDirection(inv);const hit=await s.pickRay(origin.toArray(),direction.toArray());return hit?{...hit,worldPoint:new THREE.Vector3(...hit.point).applyMatrix4(root.matrixWorld).toArray()}:null;},
   async beginShove(ray){const epoch=++shoveEpoch,sourceGeneration=generation;const hit=await operations.pickRock(ray);return hit?.released&&epoch===shoveEpoch&&sourceGeneration===generation?{...hit,epoch,generation:sourceGeneration}:null;},
   async shove({hit,velocity}){if(!hit?.released||hit.epoch!==shoveEpoch||hit.generation!==generation)throw Error('This fling was superseded; aim again');const s=await requireSolver();root.updateMatrixWorld(true);const inv=root.matrixWorld.clone().invert(),zero=new THREE.Vector3(0,0,0).applyMatrix4(inv),v=new THREE.Vector3(...velocity).applyMatrix4(inv).sub(zero).toArray();s.pushRock(hit.rock,v,hit.localPoint,{bodyLocal:true});shoveEpoch++;const result=await runSteps(1);record({kind:'hill-volume.shove',rock:hit.rock,point:hit.point,localPoint:hit.localPoint,velocity:v});return result;},
   cancelShove(){shoveEpoch++;return read();},
   setShoveEnabled(value){if(typeof value!=='boolean')throw Error('Shove enabled must be boolean');shoveEnabled=value;shoveGesture?.setEnabled(value);record({kind:'hill-volume.shove-enabled',value});return read();},
   async release(rock=settings.rock){return releaseRock(rock);},
   async releaseAll(){const s=await requireSolver();if(advancing)await s.done();for(let i=0;i<model.bodies.length;i++)if(model.bodies[i].anchored)s.release(i);record({kind:'hill-volume.anchors-release',rocks:model.bodies.map((b,i)=>i)});sync();session.redraw();return read();},
   async releaseAnchor({id,generation:expected}){if(expected!==generation)throw Error('This anchor changed; choose its current pin');const a=anchorRecords().find(a=>a.id===id);if(!a)throw Error('Unknown pose anchor');if(!a.attached)return read();if(!a.canRelease)throw Error(a.reason);return releaseRock(a.rock);},
   setAnchorsVisible(value){if(typeof value!=='boolean')throw Error('Anchor visibility must be boolean');anchorsVisible=value;anchorControls?.setVisible(value);record({kind:'hill-volume.anchor-visibility',value});return read();},
   async pushRock(){const s=await requireSolver();const velocity=[settings.rockPushX,settings.rockPushY,settings.rockPushZ];s.pushRock(settings.rock,velocity);record({kind:'hill-volume.rock-impulse',rock:settings.rock,velocity});return runSteps(1);},
   async setGrowth(value){if(typeof value!=='boolean')throw Error('Growth enabled must be boolean');const s=await requireSolver();growthEnabled=value;s.setDrive(value?settings.growthRate:0);sync();record({kind:'hill-volume.growth',rate:value?settings.growthRate:0});return read();},
   async weather(){playing=false;const s=await requireSolver();await s.done();await s.synchronizeModel();const result=weatherBody(model,settings.rock,settings.weatherDepth);s.dispose();solver=null;releaseDisplay();generation++;starting=initialize(renderer).catch(e=>{error=e.message;throw e;});await starting;record({kind:'hill-volume.weather',rock:settings.rock,depth:settings.weatherDepth,...result});sync();return{...read(),weathering:result};},
   async reset(nextConfig=initialConfig,resume=playing){const nextModel=makeVolumeSpecimen(nextConfig,limits());playing=false;growthEnabled=false;if(solver){await solver.done().catch(()=>{});solver.dispose();solver=null;}initialConfig=nextConfig;model=nextModel;playback=clock();settings.rock=Math.min(settings.rock,model.bodies.length-1);syncFloor();releaseDisplay();generation++;playback.reset();error=null;starting=null;if(renderer){starting=initialize(renderer).catch(e=>{error=e.message;sync();session.redraw();throw e;});await starting;}playing=resume;sync();session.redraw();record({kind:'hill-volume.reset'});return read();},
   frame(){session.setView(defaultView());session.redraw();return read();},
   async snapshot(){await operationTail;return(await requireSolver()).snapshot();},
   recipe(){return{config:{...initialConfig,fixture:model.config.fixture,collision:model.config.collision,...(model.config.scale?{scale:model.config.scale}:{})},settings:{...settings},view:session.readView(),anchorsVisible,playing};},
   gpu(){if(!solver)throw Error('Material source not mounted');root.updateMatrixWorld(true);return{device:renderer.backend.device,...solver.resources,generation,coordinateSpace:'specimen-local',localToWorld:root.matrixWorld.toArray(),source:read().source};}
  };
  const resetInitial=operations.reset;
  operations.reset=()=>resetInitial();
  operations.previewScale=estimate;
  operations.setCollision=async collision=>{
   const result=await resetInitial({...initialConfig,collision});
   record({kind:'hill-volume.collision',collision});
   return result;
  };
  operations.setScale=async patch=>{
   const next={...initialConfig,scale:scaleConfig(patch).scale};
   scaleRejection=null;
   const result=await resetInitial(next);
   if(patch.width!==undefined||patch.depth!==undefined||patch.height!==undefined)session.setView(defaultView());
   record({kind:'hill-volume.scale',config:model.config});
   return result;
  };
  operations.setSoilHeight=async height=>{if(model.config.fixture!=='hundred-rocks')throw Error('Choose the hundred-rock pile to edit its soil fill');const next={...initialConfig,pileSoilHeight:height};const result=await resetInitial(next);record({kind:'hill-volume.initial-soil-height',height});return result;};
  operations.setFixture=async fixture=>{if(!['outcrop','hundred-rocks'].includes(fixture))throw Error('Choose an existing specimen');const next={...initialConfig,fixture};delete next.origin;delete next.dimensions;delete next.scale;const result=await resetInitial(next);session.setView(defaultView());record({kind:'hill-volume.fixture',fixture});return result;};
  operations.setInitialContacts=async value=>{if(typeof value!=='boolean')throw Error('Contact preparation must be boolean');const result=await resetInitial({...initialConfig,conditionContacts:value});record({kind:'hill-volume.initial-contact-preparation',value,conditioning:model.conditioning});return result;};
  // Human and agent actions share one order. Playback waits while an action
  // drains the prior physical batch; repeated clicks preserve every request.
  for(const key of ['setPlaying','setSettings','advance','push','pushRock','release','setGrowth','weather','reset','setInitialContacts','shove','setShoveEnabled','releaseAnchor','setAnchorsVisible','releaseAll','setFixture','setSoilHeight','setScale','setCollision']){
   const fn=operations[key];operations[key]=(...args)=>{
    const requested=structuredClone(args);queuedOperations++;if(['advance','weather'].includes(key))playing=false;sync();
    const task=operationTail.then(async()=>{if(['reset','setInitialContacts','setFixture','setSoilHeight','setScale','setCollision'].includes(key)){await Promise.resolve(starting).catch(()=>{});await solver?.done().catch(()=>{});}else{await rendererAvailable;await starting;await solver?.done();}if(disposed)throw Error('Specimen disposed');if(['reset','weather','setInitialContacts','setFixture','setSoilHeight','setScale','setCollision'].includes(key))shoveEpoch++;return fn(...requested);});
    operationTail=task.catch(()=>{});return task.finally(()=>{queuedOperations--;sync();});
   };
  }
  const api={read,...operations};window.kaminosHillVolume=api;
  if(host.controls?.mountImpulseGesture)shoveGesture=host.controls.mountImpulseGesture({pick:operations.pickRock,begin:operations.beginShove,commit:operations.shove,cancel:operations.cancelShove,fling:true,gain:()=>settings.shoveGain,onError:e=>{record({kind:'hill-volume.shove-refused',error:e.message});console.warn(e.message);}});
  if(host.controls?.mountAttachmentControls){anchorControls=host.controls.mountAttachmentControls({asset,attachments:anchorRecords,onRelease:operations.releaseAnchor,onReset:operations.reset,createPin:()=>createViewportPosePin({asset,redraw:()=>session.redraw()})});anchorControls.setVisible(anchorsVisible);}
  return{read,operations,
   mount({root:panel,document,invoke}){
    const description=document.createElement('p');description.textContent='3D material specimen · drag a free rock and flick on release. Pause to inspect or step exactly.';panel.append(description);
    const fixtureSelect=document.createElement('select');fixtureSelect.setAttribute('aria-label','Material specimen');for(const [value,label] of [['outcrop','Small outcrop'],['hundred-rocks','Rock pile']]){const o=document.createElement('option');o.value=value;o.textContent=label;fixtureSelect.append(o);}fixtureSelect.value=model.config.fixture;fixtureSelect.addEventListener('change',()=>invoke('setFixture',fixtureSelect.value).catch(e=>{error=e.message;sync();}));panel.append(fixtureSelect);const soilControl=document.createElement('label');soilHeightLabel=document.createElement('span');soilHeightInput=document.createElement('input');soilHeightInput.type='range';soilHeightInput.min='.18';soilHeightInput.step='.01';soilHeightInput.setAttribute('aria-label','Initial soil height');soilHeightInput.addEventListener('input',()=>{soilHeightLabel.textContent='Initial soil height · '+Number(soilHeightInput.value).toFixed(2)+' m (resets on release)';});soilHeightInput.addEventListener('pointerdown',()=>{soilHeightDragging=true;});for(const type of ['pointerup','pointercancel','blur'])soilHeightInput.addEventListener(type,()=>{soilHeightDragging=false;});soilHeightInput.addEventListener('change',()=>{soilHeightPending=true;invoke('setSoilHeight',Number(soilHeightInput.value)).catch(e=>{error=e.message;}).finally(()=>{soilHeightPending=false;sync();});});soilControl.append(soilHeightLabel,soilHeightInput);panel.append(soilControl);
    scalePanel=document.createElement('fieldset');Object.assign(scalePanel.style,{border:'1px solid #393b3f',borderRadius:'4px',minWidth:'0',padding:'6px 8px'});const scaleTitle=document.createElement('legend');scaleTitle.textContent='Specimen scale';scalePanel.append(scaleTitle);
    const scaleHint=document.createElement('p');scaleHint.textContent='Drag or type. Rebuilds on release or commit.';scalePanel.append(scaleHint);
    scaleInfo=document.createElement('p');scaleMessage=document.createElement('div');scaleMessage.setAttribute('role','status');scalePanel.append(scaleInfo,scaleMessage);panel.append(scalePanel);
    for(const [key,label,step,min] of [['rocks','Rock count',1,1],['freeRocks','Initially released rocks',1,0],['width','Region width (m)',.08,.01],['depth','Region depth (m)',.08,.01],['height','Region height (m)',.08,.01],['cell','Grid cell size (m)',.002,.001],['spacing','Soil particle spacing (m)',.002,.001]]){
     const row=document.createElement('label'),grip=document.createElement('span'),input=document.createElement('input');
     grip.textContent=label;input.type='number';input.step=step>=1?'1':'any';input.min=String(min);input.className='transform-input';input.setAttribute('aria-label',label);
     Object.assign(row.style,{display:'grid',gridTemplateColumns:'minmax(0, 1fr) 78px',alignItems:'center',gap:'6px'});
     const scrub=host.controls.installNumberDrag({input,grip,step});
     scaleFields.push({key,input,scrub});row.append(grip,input);scalePanel.insertBefore(row,scaleInfo);
     input.addEventListener('input',()=>{
      scaleRejection=null;scaleMessage.textContent='';scaleDraft=true;const x=estimate({[key]:input.valueAsNumber});
      scaleInfo.textContent=x.ok?`Proposed · ${x.scale.rocks} rocks · ${x.dimensions.join(' × ')} grid · ≤${x.particleCapacity.toLocaleString()} soil samples · ${(x.majorBytes/1048576).toFixed(0)} MiB major arrays · ${(1000*x.dt).toFixed(2)} ms step`:x.reason;
     });
     input.addEventListener('pointercancel',()=>{scaleDraft=false;syncScale();});
     input.addEventListener('blur',()=>{if(scaleDraft&&!scalePending){scaleDraft=false;syncScale();}});
     input.addEventListener('change',()=>{
      const next=input.valueAsNumber;if(next===scaleValues()[key]){scaleDraft=false;syncScale();return;}
      scalePending=true;scaleDraft=false;syncScale();for(const f of scaleFields)f.input.disabled=true;
      invoke('setScale',{[key]:next}).then(()=>{scalePending=false;sync();}).catch(e=>{scalePending=false;scaleRejection=(solver?'Kept previous settings · ':'Could not build specimen · ')+e.message;sync();}).finally(()=>{for(const f of scaleFields)f.input.disabled=false;});
     });
    }
    const collision=collisionSelect=document.createElement('select');collision.setAttribute('aria-label','Rock collision shape');
    for(const [value,label] of [['convex','Convex rock contacts'],['sphere-pair','Two-sphere rock contacts']]){const o=document.createElement('option');o.value=value;o.textContent=label;collision.append(o);}
    collision.value=model.config.collision;collision.addEventListener('change',()=>invoke('setCollision',collision.value).catch(e=>{error=e.message;sync();}));panel.append(collision);
    status=document.createElement('p');status.setAttribute('role','status');panel.append(status);
    const button=(label,op,arg)=>{const b=document.createElement('button');b.textContent=label;b.type='button';b.addEventListener('click',()=>invoke(op,typeof arg==='function'?arg():arg).catch(e=>{error=e.message;sync();}));panel.append(b);return b;};
    const anchorToggle=document.createElement('input');anchorToggle.type='checkbox';anchorToggle.checked=anchorsVisible;const anchorLabel=document.createElement('label');anchorLabel.append(anchorToggle,' Show pose anchors');panel.append(anchorLabel);anchorToggle.addEventListener('change',()=>invoke('setAnchorsVisible',anchorToggle.checked).catch(e=>{error=e.message;sync();}));
    const shoveToggle=document.createElement('input');shoveToggle.type='checkbox';shoveToggle.checked=shoveEnabled;const shoveLabel=document.createElement('label');shoveLabel.append(shoveToggle,' Fling free rocks');panel.append(shoveLabel);shoveToggle.addEventListener('change',()=>invoke('setShoveEnabled',shoveToggle.checked));
    playButton=button('Play','setPlaying',()=>!playing);button('Advance 0.1 s','advance',.1);button('Frame specimen','frame');
    const prepLabel=document.createElement('label');contactToggle=document.createElement('input');contactToggle.type='checkbox';contactToggle.setAttribute('aria-label','Separate overlapping starting poses');contactToggle.addEventListener('change',()=>invoke('setInitialContacts',contactToggle.checked).catch(e=>{error=e.message;sync();}));prepLabel.append(contactToggle,document.createTextNode('Separate overlapping starting poses (resets)'));panel.append(prepLabel);
    const field=(key,label,step)=>{const l=document.createElement('label'),grip=document.createElement('span'),input=document.createElement('input');grip.textContent=label;input.type='number';input.step='any';input.className='transform-input';input.value=String(settings[key]);input.setAttribute('aria-label',label);input.addEventListener('input',()=>{if(input.value.trim()&&Number.isFinite(Number(input.value)))invoke('setSettings',{[key]:Number(input.value)}).catch(e=>{error=e.message;sync();});});host.controls.installNumberDrag({input,grip,step});l.append(grip,input);panel.append(l);};
    const select=document.createElement('select');rockSelect=select;select.setAttribute('aria-label','Rock volume');model.bodies.forEach((b,i)=>{const o=document.createElement('option');o.value=i;o.textContent=b.id;select.append(o);});select.value=settings.rock;select.addEventListener('change',()=>invoke('setSettings',{rock:Number(select.value)}));panel.append(select);
    button('Release pose anchor','release');button('Release all pose anchors','releaseAll');field('shoveGain','Fling strength',.1);field('rockPushX','Rock velocity impulse X',.1);field('rockPushY','Rock velocity impulse Y',.1);field('rockPushZ','Rock velocity impulse Z',.1);button('Nudge released rock','pushRock');field('weatherDepth','Weathering depth',.005);button('Weather selected rock','weather');
    field('pushX','Push center X',.05);field('pushY','Push center Y',.05);field('pushZ','Push center Z',.05);field('pushRadius','Push radius',.05);field('pushSpeed','Push velocity X',.1);button('Push material','push');
    field('growthRate','Growth velocity',.005);const growth=document.createElement('label'),toggle=document.createElement('input');growthToggle=toggle;toggle.type='checkbox';toggle.setAttribute('aria-label','Prescribed growth');toggle.addEventListener('change',()=>invoke('setGrowth',toggle.checked).catch(e=>{error=e.message;sync();}));growth.append(toggle,document.createTextNode('Prescribed growth'));panel.append(growth);sync();
   },
   async dispose(){for(const f of scaleFields)f.scrub.dispose();anchorControls?.dispose();anchorControls=null;await shoveGesture?.dispose();shoveGesture=null;disposed=true;playing=false;releaseRenderer(null);stopFrame();try{await operationTail;await Promise.resolve(starting).catch(()=>{});await solver?.done();}finally{solver?.dispose();releaseDisplay();floor.geometry.dispose();floor.material.dispose();await session.dispose();if(window.kaminosHillVolume===api)delete window.kaminosHillVolume;}}
  };
 }
};
