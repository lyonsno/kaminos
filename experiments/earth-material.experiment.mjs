import * as THREE from '../lib/three.webgpu.js';
import {EarthSpecimen,EARTH_MATERIALS} from '../earth-specimen.mjs';
import {createEarthSurfaceTask,planEarthSurface} from '../earth-surface-task.mjs';
import {mountEarthControls} from './earth-workshop-controls.mjs';

const defaults={previewResolution:24,captureResolution:48,advanceSeconds:.12,pressDepth:.055,pressSeconds:.35,releaseSeconds:.2};
function settings(input={}){const s={...defaults,...input};for(const [k,v]of Object.entries(s))if(!Number.isFinite(v)||v<=0||(['previewResolution','captureResolution'].includes(k)&&(!Number.isSafeInteger(v)||v<2)))throw Error(`Invalid earth setting ${k}`);return s;}
function pose(root){return {position:root.position.toArray(),quaternion:root.quaternion.toArray(),scale:root.scale.toArray()};}
function checkedPose(p){if(!p)return p;for(const [k,n]of [['position',3],['quaternion',4],['scale',3]])if(!Array.isArray(p[k])||p[k].length!==n||!p[k].every(Number.isFinite))throw Error(`Invalid specimen ${k}`);if(p.scale.some(v=>v<=0)||Math.abs(Math.hypot(...p.quaternion)-1)>1e-5)throw Error('Invalid specimen scale or orientation');return p;}
function restore(root,p){if(!p)return;checkedPose(p);for(const [k,n]of [['position',3],['quaternion',4],['scale',3]]){if(!Array.isArray(p[k])||p[k].length!==n||!p[k].every(Number.isFinite))throw Error(`Invalid specimen ${k}`);root[k].fromArray(p[k]);}}
function meshGeometry(triangles){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(triangles.flatMap(t=>[...t.a,...t.b,...t.c]),3));g.computeVertexNormals();g.computeBoundingSphere();return g;}
export default {
 id:'earth-material',title:'Earth material workshop',
 async create({host,inputs={},record,updateInputs=()=>{}}){
  let model=inputs.snapshot?EarthSpecimen.fromSnapshot(inputs.snapshot):new EarthSpecimen(inputs.config),config=settings(inputs.settings),disposed=false,busy=false,failure=null,source=null,ui,stopRequested=false;
  const session=await host.scene.open(),root=new THREE.Group();
  const limits=()=>{const device=host.scene.rendering().renderer.backend.device,heap=globalThis.performance?.memory;return {maxBufferSize:device.limits.maxBufferSize??Infinity,heapBytes:heap?Math.max(0,heap.jsHeapSizeLimit-heap.usedJSHeapSize):Infinity};};
  const builder=createEarthSurfaceTask({limits});root.name='Worked earth specimen';
  const materials=EARTH_MATERIALS.map(m=>new THREE.MeshStandardMaterial({color:new THREE.Color(...m.color),roughness:m.roughness,metalness:0,side:THREE.DoubleSide}));
  const surfaces=materials.map((m,i)=>{const mesh=new THREE.Mesh(new THREE.BufferGeometry(),m);mesh.name=i?'Embedded mineral grit':'Cohesive earth matrix';mesh.castShadow=true;mesh.receiveShadow=true;root.add(mesh);return mesh;});
  const trayMaterial=new THREE.MeshStandardMaterial({color:0x45423b,roughness:.86});
  const tray=new THREE.Mesh(new THREE.BoxGeometry(model.config.width+.014,.012,model.config.width+.014),trayMaterial);tray.position.y=-.008;tray.name='Specimen support';root.add(tray);
  const tool=new THREE.Mesh(new THREE.SphereGeometry(1,24,16),new THREE.MeshStandardMaterial({color:0x91a3a6,roughness:.34,metalness:.55,transparent:true,opacity:.48,depthWrite:false}));tool.name='Earth forming tool';tool.scale.setScalar(.075);tool.position.set(0,model.state().top+.10,0);
  restore(root,inputs.pose);restore(tool,inputs.tool);
  let asset,toolAsset;
  const frame=()=>session.setView({position:[.63,.48,.69],target:[0,.065,0],fov:40});
  const read=()=>({schema:'kaminos.earth-authoring.v1',objectId:asset?.id,toolId:toolAsset?.id,physics:model.state(),physicsWidth:model.config.width,material:{cohesion:model.config.cohesion,friction:model.config.friction,plasticYield:model.config.plasticYield},settings:{...config},busy,failure,surface:source?{resolution:source.reconstruction.resolution,triangles:source.triangles.length,matrixTriangles:source.reconstruction.matrixTriangles,boundary:source.boundary}:null,view:session.readView(),pose:pose(root),tool:pose(tool),snapshotContinuation:'cold contact reconstruction; retained physical values, not solver contact caches'});
  const recipe=()=>({snapshot:model.snapshot(),settings:{...config},pose:pose(root),tool:pose(tool),view:session.readView()});
  const show=()=>ui?.refresh();
  const sync=()=>show();
  const update=()=>{updateInputs(recipe());show();};
  const rebuild=async(resolution=config.previewResolution)=>{
   const next=await builder.build(model.snapshot(),resolution);
   const geometries=materials.map((_,i)=>meshGeometry(next.triangles.filter(t=>t.materialIndex===i)));
   for(let i=0;i<surfaces.length;i++){const old=surfaces[i].geometry;surfaces[i].geometry=geometries[i];old.dispose();}source=next;session.redraw();show();
  };
  const toolQuery=()=>{
   root.updateWorldMatrix(true,false);tool.updateWorldMatrix(true,false);
   const rootScale=root.getWorldScale(new THREE.Vector3()),s=tool.getWorldScale(new THREE.Vector3());
   if(Math.max(rootScale.x,rootScale.y,rootScale.z)-Math.min(rootScale.x,rootScale.y,rootScale.z)>1e-6||rootScale.x<=0||Math.max(s.x,s.y,s.z)-Math.min(s.x,s.y,s.z)>1e-6||s.x<=0)throw Error('Use uniform positive scale for the specimen and spherical forming tool');
   return {position:root.worldToLocal(tool.getWorldPosition(new THREE.Vector3())).toArray(),radius:s.x/rootScale.x};
  };
  const work=async(action,reconstruct=true)=>{
   if(busy)throw Error('Earth is already being worked');busy=true;stopRequested=false;failure=null;show();
   try{await action();if(disposed)throw Error('Earth workshop disposed');if(reconstruct)await rebuild();update();return read();}
   catch(error){failure=error.message;show();throw error;}finally{busy=false;show();}
  };
  const yieldFrame=()=>new Promise(resolve=>setTimeout(resolve,0));
  const evolve=async(seconds,contact)=>{let remaining=seconds;while(remaining>1e-9){if(disposed)throw Error('Earth workshop disposed');if(stopRequested)throw Error('Stopped; last completed surface retained');const dt=Math.min(remaining,.025);model.advance(dt,{tool:contact?.()??null});remaining-=dt;await yieldFrame();}};
  const disposeResources=()=>{for(const mesh of surfaces)mesh.geometry.dispose();for(const m of materials)m.dispose();tray.geometry.dispose();trayMaterial.dispose();tool.geometry.dispose();tool.material.dispose();};
  try{
   await rebuild();asset=await session.attach(root,{owned:true,metadata:{label:root.name,source:'kaminos:earth-specimen',type:'experiment'}});
   toolAsset=await session.attach(tool,{owned:true,metadata:{label:tool.name,source:'kaminos:earth-forming-tool',type:'experiment'}});
   if(inputs.view)session.setView(inputs.view);else frame();
   return {read,operations:{
    frame,
    snapshot:()=>recipe(),
    async configure(patch){const next=settings({...config,...patch});if(busy)throw Error('Wait for forming to finish');planEarthSurface(model.snapshot(),next.previewResolution,limits());planEarthSurface(model.snapshot(),next.captureResolution,limits());if(next.previewResolution!==config.previewResolution)return work(async()=>{await rebuild(next.previewResolution);config=next;},false);config=next;failure=null;sync();update();return read();},
    material(values){if(busy)throw Error('Wait for forming to finish');model.setMaterial(values);failure=null;sync();update();record({kind:'earth.material',phase:'applied',effective:model.config});return read();},
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
    async reset(){if(busy)throw Error('Wait for forming to finish');const next=new EarthSpecimen(model.config);const old=model;model=next;old.dispose();await rebuild();failure=null;update();record({kind:'earth.reset',phase:'applied',effective:model.config});return read();},
    async load(value){if(busy)throw Error('Wait for forming to finish');checkedPose(value.pose);checkedPose(value.tool);const nextSettings=settings(value.settings),next=EarthSpecimen.fromSnapshot(value.snapshot);if(next.config.width!==model.config.width){next.dispose();throw Error('Load a different tray width by reopening the specimen setup');}try{restore(root,value.pose);restore(tool,value.tool);}catch(error){next.dispose();throw error;}const old=model;model=next;config=nextSettings;old.dispose();await rebuild();host.scene.refreshPresentation(asset);host.scene.refreshPresentation(toolAsset);if(value.view)session.setView(value.view);failure=null;sync();update();return read();},
    async freeze(){if(busy)throw Error('Wait for forming to finish');await work(()=>rebuild(config.captureResolution),false);update();record({kind:'earth.freeze',phase:'applied',effective:{state:model.state(),resolution:config.captureResolution,triangles:source.triangles.length}});return {source:{...source.config,halo:1},authoring:recipe(),surface:{...read().surface,captureHalo:1}};},
    source(){if(busy)throw Error('Wait for forming to finish');return structuredClone(source);},
   },mount({document,invoke}){ui=mountEarthControls({document,host,session,root,tool,invoke,read,stop:()=>{stopRequested=true;builder.cancel();},trace:async()=>{const frozen=await invoke('freeze');return window.kaminosWorkbenchExperiments.open('earth-surface-teacher',{source:{...frozen.source,halo:0},authoring:frozen.authoring,scale:.3,bounces:3,environment:.15});}});},async dispose(){disposed=true;ui?.dispose();builder.dispose();model.dispose();try{await session.dispose();}finally{disposeResources();}}};
  }catch(error){ui?.dispose();builder.dispose();model.dispose();try{await session.dispose();}finally{disposeResources();}throw error;}
 }
};
