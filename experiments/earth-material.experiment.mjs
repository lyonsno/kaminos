import * as THREE from '../lib/three.webgpu.js';
import {EARTH_MATERIALS,checkedEarthSnapshot} from '../earth-specimen.mjs';
import {createEarthSurfaceTask,planEarthSurface,rememberEarthSurface} from '../earth-surface-task.mjs';
import {createEarthDynamics} from '../earth-dynamics.mjs';
import {mountEarthControls} from './earth-workshop-controls.mjs';

const defaults={previewResolution:24,liveResolution:16,captureResolution:48,advanceSeconds:.12,pressDepth:.055,pressSeconds:.35,releaseSeconds:.2};
function settings(input={}){const s={...defaults,...input};for(const [k,v]of Object.entries(s))if(!Number.isFinite(v)||v<=0||(['previewResolution','captureResolution','liveResolution'].includes(k)&&(!Number.isSafeInteger(v)||v<2)))throw Error(`Invalid earth setting ${k}`);return s;}
function pose(root){return {position:root.position.toArray(),quaternion:root.quaternion.toArray(),scale:root.scale.toArray()};}
function checkedPose(p){if(!p)return p;for(const [k,n]of [['position',3],['quaternion',4],['scale',3]])if(!Array.isArray(p[k])||p[k].length!==n||!p[k].every(Number.isFinite))throw Error(`Invalid specimen ${k}`);if(p.scale.some(v=>v<=0)||Math.abs(Math.hypot(...p.quaternion)-1)>1e-5)throw Error('Invalid specimen scale or orientation');return p;}
function restore(root,p){if(!p)return;checkedPose(p);for(const [k,n]of [['position',3],['quaternion',4],['scale',3]]){if(!Array.isArray(p[k])||p[k].length!==n||!p[k].every(Number.isFinite))throw Error(`Invalid specimen ${k}`);root[k].fromArray(p[k]);}}
function meshGeometry(triangles){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(triangles.flatMap(t=>[...t.a,...t.b,...t.c]),3));g.computeVertexNormals();g.computeBoundingSphere();return g;}
function checkedForming(value){if(!value||typeof value!=='object')throw Error('Invalid forming history');checkedEarthSnapshot(value.initial);if(!Array.isArray(value.samples))throw Error('Invalid forming sample inventory');for(const sample of value.samples){if(!Number.isFinite(sample.seconds)||sample.seconds<=0)throw Error('Invalid forming sample duration');for(const pose of [sample.from,sample.to])if(!Array.isArray(pose?.position)||pose.position.length!==3||!pose.position.every(Number.isFinite)||!Number.isFinite(pose.radius)||pose.radius<=0)throw Error('Invalid forming tool sample');}return structuredClone(value);}
export default {
 id:'earth-material',title:'Earth material workshop',
 async create({host,inputs={},record,updateInputs=()=>{}}){
  const acceptedSettings=settings(inputs.settings);checkedPose(inputs.pose);checkedPose(inputs.tool);
  const acceptedHistory=inputs.forming===undefined?null:checkedForming(inputs.forming);
  let model=await createEarthDynamics({snapshot:inputs.snapshot,config:inputs.config}),config=acceptedSettings,disposed=false,busy=false,failure=null,source=null,ui,stopRequested=false;
  let session;try{session=await host.scene.open();}catch(error){model.dispose();throw error;}const root=new THREE.Group();
  const limits=()=>{const device=host.scene.rendering().renderer.backend.device,heap=globalThis.performance?.memory;return {maxGridCells:2**21,maxBufferSize:device.limits.maxBufferSize??Infinity,heapBytes:heap?Math.max(0,heap.jsHeapSizeLimit-heap.usedJSHeapSize):Infinity};};
  const builder=createEarthSurfaceTask({limits}),liveBuilder=createEarthSurfaceTask({limits,persistent:true});root.name='Worked earth specimen';
  const materials=EARTH_MATERIALS.map(m=>new THREE.MeshStandardMaterial({color:new THREE.Color(...m.color),roughness:m.roughness,metalness:0,side:THREE.DoubleSide}));
  const surfaces=materials.map((m,i)=>{const mesh=new THREE.Mesh(new THREE.BufferGeometry(),m);mesh.name=i?'Embedded mineral grit':'Cohesive earth matrix';mesh.castShadow=true;mesh.receiveShadow=true;root.add(mesh);return mesh;});
  const trayMaterial=new THREE.MeshStandardMaterial({color:0x45423b,roughness:.86});
  const tray=new THREE.Mesh(new THREE.BoxGeometry(model.config.width+.014,.012,model.config.width+.014),trayMaterial);tray.position.y=-.008;tray.name='Specimen support';root.add(tray);
  const tool=new THREE.Mesh(new THREE.SphereGeometry(1,24,16),new THREE.MeshStandardMaterial({color:0x91a3a6,roughness:.34,metalness:.55,transparent:true,opacity:.48,depthWrite:false}));tool.name='Earth forming tool';tool.scale.setScalar(.075);tool.position.set(0,model.state().top+.10,0);
  restore(root,inputs.pose);restore(tool,inputs.tool);
  let asset,toolAsset,liveEnabled=inputs.live!==false,lastTool=null,liveFlight=null,previewFlight=null,refineTimer=null,stopFrames=()=>{},revision=0,surfaceRevision=0,epoch=0,settling=0,physicsError=null,visibilityReset=false;
  let previewFailure=null;const samples=[],history=acceptedHistory??{initial:model.snapshot(),samples:[]};
  const frame=()=>session.setView({position:[.63,.48,.69],target:[0,.065,0],fov:40});
  const read=()=>({schema:'kaminos.earth-authoring.v1',objectId:asset?.id,toolId:toolAsset?.id,physics:model.state(),physicsWidth:model.config.width,material:{cohesion:model.config.cohesion,friction:model.config.friction,plasticYield:model.config.plasticYield},settings:{...config},busy,failure,live:{enabled:liveEnabled,pendingSamples:samples.length,inFlight:!!liveFlight,revision,surfaceRevision,previewDetail:Math.min(config.liveResolution,config.previewResolution),previewFailure,recordedSamples:history.samples.length,settlingSeconds:settling},surface:source?{resolution:source.reconstruction.resolution,triangles:source.triangles.length,matrixTriangles:source.reconstruction.matrixTriangles,boundary:source.boundary}:null,view:session.readView(),pose:pose(root),tool:pose(tool),snapshotContinuation:'cold contact reconstruction; retained physical values, not solver contact caches'});
  const recipe=()=>({snapshot:model.snapshot(),live:liveEnabled,forming:structuredClone(history),settings:{...config},pose:pose(root),tool:pose(tool),view:session.readView()});
  const show=()=>ui?.refresh();
  const sync=()=>show();
  const update=()=>{updateInputs(recipe());show();};
  const prepare=async(snapshot,resolution)=>{
   const next=await builder.build(snapshot,resolution),geometries=[];
   try{for(let i=0;i<materials.length;i++)geometries.push(meshGeometry(next.triangles.filter(t=>t.materialIndex===i)));if(disposed)throw Error('Earth workshop disposed');return {next,geometries};}
   catch(error){for(const g of geometries)g.dispose();throw error;}
  };
  const install=({next,geometries},atRevision=revision)=>{surfaceRevision=atRevision;for(let i=0;i<surfaces.length;i++){const old=surfaces[i].geometry;surfaces[i].geometry=geometries[i];old.dispose();}source=rememberEarthSurface(next);session.redraw();show();};
  const rebuild=async(resolution=config.previewResolution)=>install(await prepare(model.snapshot(),resolution));
  const replaceModel=async(next,nextSettings,value={})=>{
   let prepared,installed=false;
   try{planEarthSurface(next.snapshot(),nextSettings.captureResolution,limits());prepared=await prepare(next.snapshot(),nextSettings.previewResolution);if(value.view)session.setView(value.view);restore(root,value.pose);restore(tool,value.tool);const old=model;model=next;revision++;epoch++;config=nextSettings;install(prepared);installed=true;old.dispose();}
   finally{if(!installed){next.dispose();for(const g of prepared?.geometries??[])g.dispose();}}
  };
  const toolQuery=()=>{
   root.updateWorldMatrix(true,false);tool.updateWorldMatrix(true,false);
   const rootScale=root.getWorldScale(new THREE.Vector3()),s=tool.getWorldScale(new THREE.Vector3());
   if(Math.max(rootScale.x,rootScale.y,rootScale.z)-Math.min(rootScale.x,rootScale.y,rootScale.z)>1e-6||rootScale.x<=0||Math.max(s.x,s.y,s.z)-Math.min(s.x,s.y,s.z)>1e-6||s.x<=0)throw Error('Use uniform positive scale for the specimen and spherical forming tool');
   return {position:root.worldToLocal(tool.getWorldPosition(new THREE.Vector3())).toArray(),radius:s.x/rootScale.x};
  };
  const work=async(action,reconstruct=true,{replace=false}={})=>{
   if(busy)throw Error('Earth is already being worked');busy=true;settling=0;clearTimeout(refineTimer);builder.cancel();liveBuilder.cancel();stopRequested=replace;failure=null;show();
   try{if(replace)await liveFlight;else await settleInput();if(disposed||(!replace&&stopRequested))throw Error('Stopped before the next operation');stopRequested=false;await action();if(disposed)throw Error('Earth workshop disposed');if(reconstruct)await rebuild();update();return read();}
   catch(error){failure=error.message;show();throw error;}finally{busy=false;if(!disposed&&!stopRequested&&!physicsError&&samples.length)pump();if(!disposed&&!stopRequested&&!physicsError&&(surfaceRevision!==revision||source?.reconstruction.resolution<config.previewResolution)){if(surfaceRevision<revision)coarse();scheduleRefinement();}show();}
  };
  const yieldFrame=()=>new Promise(resolve=>setTimeout(resolve,0));
  const evolve=async(seconds,contact)=>{let remaining=seconds;while(remaining>1e-9){if(disposed)throw Error('Earth workshop disposed');if(stopRequested)throw Error('Stopped; last completed surface retained');const dt=Math.min(remaining,.025);await model.advance(dt,{tool:contact?.()??null});revision++;remaining-=dt;await yieldFrame();}};
  // Native editor movement feeds a retained physical path. Physics runs in a
  // persistent worker; coarse and detailed reconstruction have separate workers.
  // Backpressure queues hand samples rather than launching overlapping worlds.
  const sameTool=(a,b)=>a&&a.radius===b.radius&&a.position.every((v,k)=>v===b.position[k]);
  const disposePrepared=p=>{for(const g of p.geometries)g.dispose();};
  const coarse=()=>{
   if(disposed||previewFlight)return;
   const atEpoch=epoch,atRevision=revision,snapshot=model.snapshot(),resolution=Math.min(config.liveResolution,config.previewResolution);
   previewFlight=liveBuilder.build(snapshot,resolution).then(next=>{
    if(disposed||busy||atEpoch!==epoch||atRevision<surfaceRevision||(atRevision===surfaceRevision&&source?.reconstruction.resolution>=resolution))return;
    const geometries=materials.map((_,i)=>meshGeometry(next.triangles.filter(t=>t.materialIndex===i)));
    install({next,geometries},atRevision);previewFailure=null;
   }).catch(e=>{if(!disposed&&e.name!=='AbortError')previewFailure=e.message;}).finally(()=>{previewFlight=null;show();if(!disposed&&!busy&&atRevision<revision)coarse();});
  };
  const scheduleRefinement=()=>{
   clearTimeout(refineTimer);
   refineTimer=setTimeout(async()=>{
    if(disposed||busy||liveFlight||samples.length||settling>1e-9)return;
    const atEpoch=epoch,atRevision=revision;
    try{const prepared=await prepare(model.snapshot(),config.previewResolution);
     if(disposed||busy||atEpoch!==epoch||atRevision!==revision||samples.length||liveFlight){disposePrepared(prepared);return;}
     install(prepared,atRevision);previewFailure=null;update();
    }catch(e){if(!disposed&&e.name!=='AbortError')previewFailure=e.message;}show();
   },0);
  };
  const pump=()=>{
   if(disposed||stopRequested||physicsError||liveFlight||!samples.length)return liveFlight;
   const sample=samples.shift();
   liveFlight=model.sweep(sample.seconds,sample.from,sample.to).then(()=>{
    revision++;sample.disposition='applied';record({kind:'earth.tool',phase:'applied',effective:sample});if(!stopRequested)coarse();
   }).catch(e=>{if(!disposed){failure=e.message;physicsError=e;liveEnabled=false;samples.unshift(sample);}}).finally(()=>{liveFlight=null;if(!disposed){show();if(!stopRequested){if(samples.length&&!physicsError)pump();else if(!physicsError)scheduleRefinement();}}});
   return liveFlight;
  };
  const settleInput=async()=>{while(liveFlight||samples.length){if(physicsError)throw physicsError;if(!liveFlight)pump();await liveFlight;}};
  const liveFrame=({deltaSeconds=1/60}={})=>{
   if(disposed||busy||!liveEnabled)return;
   if(host.controls.document?.hidden){visibilityReset=true;return;}
   if(visibilityReset){visibilityReset=false;lastTool=toolQuery();return;}
   try{const next=toolQuery(),moved=!sameTool(lastTool,next);if(moved||(settling>0&&!liveFlight&&!samples.length)){
    if(!Number.isFinite(deltaSeconds)||deltaSeconds<0)throw Error('Invalid live frame duration');if(deltaSeconds===0)return;
    clearTimeout(refineTimer);builder.cancel();
    const seconds=moved?deltaSeconds:Math.min(deltaSeconds,settling);settling=moved?config.releaseSeconds:Math.max(0,settling-seconds);
    const sample={seconds,from:lastTool??next,to:next,disposition:'observed'};lastTool=next;history.samples.push(sample);record({kind:'earth.tool',phase:'observed',effective:sample});samples.push(sample);pump();
   }}catch(e){failure=e.message;liveEnabled=false;show();}
  };
  const halt=()=>{stopRequested=true;liveEnabled=false;settling=0;clearTimeout(refineTimer);for(const sample of samples)sample.disposition='stopped';samples.length=0;builder.cancel();liveBuilder.cancel();record({kind:'earth.stop',phase:'applied',effective:{revision,pendingSamples:0}});show();};
  const disposeResources=()=>{for(const mesh of surfaces)mesh.geometry.dispose();for(const m of materials)m.dispose();tray.geometry.dispose();trayMaterial.dispose();tool.geometry.dispose();tool.material.dispose();};
  try{
   await rebuild();asset=await session.attach(root,{owned:true,metadata:{label:root.name,source:'kaminos:earth-specimen',type:'experiment'}});
   toolAsset=await session.attach(tool,{owned:true,metadata:{label:tool.name,source:'kaminos:earth-forming-tool',type:'experiment'}});
   if(inputs.view)session.setView(inputs.view);else frame();lastTool=toolQuery();stopFrames=session.onFrame(liveFrame);
   return {read,operations:{
    frame,
    stop(){halt();return read();},
    async snapshot(){await work(async()=>{},false);return recipe();},
    async live(value){if(typeof value!=='boolean')throw Error('Live physics expects a boolean');liveEnabled=value;settling=0;if(value){if(physicsError)throw physicsError;stopRequested=false;if(surfaceRevision!==revision)coarse();scheduleRefinement();}if(!value)await settleInput();lastTool=toolQuery();show();return read();},
    async configure(patch){const next=settings({...config,...patch});if(busy)throw Error('Wait for forming to finish');planEarthSurface(model.snapshot(),next.liveResolution,limits());planEarthSurface(model.snapshot(),next.previewResolution,limits());planEarthSurface(model.snapshot(),next.captureResolution,limits());if(next.previewResolution!==config.previewResolution)return work(async()=>{await rebuild(next.previewResolution);config=next;},false);config=next;failure=null;sync();update();return read();},
    async material(values){return work(async()=>{await model.setMaterial(values);record({kind:'earth.material',phase:'applied',effective:model.config});},false);},
    async advance({seconds=config.advanceSeconds}={}){if(!Number.isFinite(seconds)||seconds<=0)throw Error('Invalid advance duration');return work(async()=>{await evolve(seconds);record({kind:'earth.advance',phase:'applied',effective:{seconds,state:model.state()}});});},
    async press(){
     const query=toolQuery(),start=tool.position.clone(),localUp=new THREE.Vector3(0,1,0).applyQuaternion(root.getWorldQuaternion(new THREE.Quaternion()));
     return work(async()=>{try{const count=Math.ceil(config.pressSeconds/.025);for(let i=1;i<=count;i++){
      const depth=config.pressDepth*i/count;
      tool.position.copy(start).addScaledVector(localUp,-depth*root.getWorldScale(new THREE.Vector3()).x);session.redraw();
      const contact={position:[query.position[0],query.position[1]-depth,query.position[2]],radius:query.radius};
      await evolve(config.pressSeconds/count,()=>contact);if(i%4===0)await rebuild();
     }
     }finally{tool.position.copy(start);session.redraw();}
     await evolve(config.releaseSeconds);
     record({kind:'earth.press',phase:'applied',effective:{tool:query,depth:config.pressDepth,seconds:config.pressSeconds,releaseSeconds:config.releaseSeconds,state:model.state()}});});
    },
    async reset(){return work(async()=>{await replaceModel(await createEarthDynamics({config:model.config}),config);samples.length=0;physicsError=null;liveEnabled=true;history.initial=model.snapshot();history.samples=[];lastTool=toolQuery();record({kind:'earth.reset',phase:'applied',effective:model.config});},false,{replace:true});},
    async load(value){if(busy)throw Error('Wait for forming to finish');checkedPose(value.pose);checkedPose(value.tool);const nextSettings=settings(value.settings),nextHistory=value.forming===undefined?null:checkedForming(value.forming);return work(async()=>{const next=await createEarthDynamics({snapshot:value.snapshot});if(next.config.width!==model.config.width){next.dispose();throw Error('Load a different tray width by reopening the specimen setup');}await replaceModel(next,nextSettings,value);physicsError=null;history.initial=structuredClone(nextHistory?.initial??value.snapshot);history.samples=structuredClone(nextHistory?.samples??[]);samples.length=0;lastTool=toolQuery();liveEnabled=value.live!==false;host.scene.refreshPresentation(asset);host.scene.refreshPresentation(toolAsset);sync();},false,{replace:true});},
    async freeze(){await settleInput();if(busy)throw Error('Wait for forming to finish');await work(()=>rebuild(config.captureResolution),false);update();record({kind:'earth.freeze',phase:'applied',effective:{state:model.state(),resolution:config.captureResolution,triangles:source.triangles.length}});return {source:{...source.config,halo:1},authoring:recipe(),surface:{...read().surface,captureHalo:1}};},
    source(){if(busy||liveFlight||samples.length||settling>1e-9||surfaceRevision!==revision||source?.reconstruction.resolution<config.previewResolution)throw Error('The displayed surface is behind the physical state; freeze the current specimen first');return structuredClone(source);},
   },mount({document,invoke}){ui=mountEarthControls({document,host,session,root,tool,invoke,read,stop:halt,trace:async()=>{const frozen=await invoke('freeze');return window.kaminosWorkbenchExperiments.open('earth-surface-teacher',{source:{...frozen.source,halo:0},authoring:frozen.authoring,view:frozen.authoring.view,scale:.3,bounces:3,environment:.15});}});},async dispose(){disposed=true;stopFrames();clearTimeout(refineTimer);ui?.dispose();builder.dispose();liveBuilder.dispose();model.dispose();try{await session.dispose();}finally{disposeResources();}}};
  }catch(error){stopFrames();clearTimeout(refineTimer);ui?.dispose();builder.dispose();liveBuilder.dispose();model.dispose();try{await session.dispose();}finally{disposeResources();}throw error;}
 }
};
