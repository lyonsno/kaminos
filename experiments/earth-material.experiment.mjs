import * as THREE from '../lib/three.webgpu.js';
import {EarthSpecimen,EARTH_MATERIALS} from '../earth-specimen.mjs';
import {createEarthTeacherSource} from '../earth-surface.mjs';

const defaults={previewResolution:24,captureResolution:48,advanceSeconds:.12,pressDepth:.055,pressSeconds:.35,releaseSeconds:.2};
function settings(input={}){const s={...defaults,...input};for(const [k,v]of Object.entries(s))if(!Number.isFinite(v)||v<=0||(['previewResolution','captureResolution'].includes(k)&&(!Number.isSafeInteger(v)||v<2)))throw Error(`Invalid earth setting ${k}`);return s;}
function pose(root){return {position:root.position.toArray(),quaternion:root.quaternion.toArray(),scale:root.scale.toArray()};}
function checkedPose(p){if(!p)return p;for(const [k,n]of [['position',3],['quaternion',4],['scale',3]])if(!Array.isArray(p[k])||p[k].length!==n||!p[k].every(Number.isFinite))throw Error(`Invalid specimen ${k}`);if(p.scale.some(v=>v<=0)||Math.abs(Math.hypot(...p.quaternion)-1)>1e-5)throw Error('Invalid specimen scale or orientation');return p;}
function restore(root,p){if(!p)return;checkedPose(p);for(const [k,n]of [['position',3],['quaternion',4],['scale',3]]){if(!Array.isArray(p[k])||p[k].length!==n||!p[k].every(Number.isFinite))throw Error(`Invalid specimen ${k}`);root[k].fromArray(p[k]);}}
function meshGeometry(triangles){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(triangles.flatMap(t=>[...t.a,...t.b,...t.c]),3));g.computeVertexNormals();g.computeBoundingSphere();return g;}
export default {
 id:'earth-material',title:'Earth material workshop',
 async create({host,inputs={},record,updateInputs=()=>{}}){
  let model=inputs.snapshot?EarthSpecimen.fromSnapshot(inputs.snapshot):new EarthSpecimen(inputs.config),config=settings(inputs.settings),disposed=false,busy=false,failure=null,source=null,status,fields=[];
  const session=await host.scene.open(),root=new THREE.Group();root.name='Worked earth specimen';
  const materials=EARTH_MATERIALS.map(m=>new THREE.MeshStandardMaterial({color:new THREE.Color(...m.color),roughness:m.roughness,metalness:0,side:THREE.DoubleSide}));
  const surfaces=materials.map((m,i)=>{const mesh=new THREE.Mesh(new THREE.BufferGeometry(),m);mesh.name=i?'Embedded mineral grit':'Cohesive earth matrix';mesh.castShadow=true;mesh.receiveShadow=true;root.add(mesh);return mesh;});
  const trayMaterial=new THREE.MeshStandardMaterial({color:0x45423b,roughness:.86});
  const tray=new THREE.Mesh(new THREE.BoxGeometry(model.config.width+.014,.012,model.config.width+.014),trayMaterial);tray.position.y=-.008;tray.name='Specimen support';root.add(tray);
  const tool=new THREE.Mesh(new THREE.SphereGeometry(1,24,16),new THREE.MeshStandardMaterial({color:0x91a3a6,roughness:.34,metalness:.55,transparent:true,opacity:.48,depthWrite:false}));tool.name='Earth forming tool';tool.scale.setScalar(.075);tool.position.set(0,model.state().top+.10,0);
  restore(root,inputs.pose);restore(tool,inputs.tool);
  let asset,toolAsset;
  const frame=()=>session.setView({position:[.63,.48,.69],target:[0,.065,0],fov:40});
  const read=()=>({schema:'kaminos.earth-authoring.v1',objectId:asset?.id,toolId:toolAsset?.id,physics:model.state(),settings:{...config},busy,failure,surface:source?{resolution:source.reconstruction.resolution,triangles:source.triangles.length,matrixTriangles:source.reconstruction.matrixTriangles,boundary:source.boundary}:null,view:session.readView(),pose:pose(root),tool:pose(tool),snapshotContinuation:'cold contact reconstruction; retained physical values, not solver contact caches'});
  const recipe=()=>({snapshot:model.snapshot(),settings:{...config},pose:pose(root),tool:pose(tool),view:session.readView()});
  const show=()=>{if(status){const s=model.state();status.textContent=failure?`Stopped: ${failure}`:`${busy?'Working · ':''}${s.particles} soil samples · ${s.grains} grains · ${s.time.toFixed(3)} s · ${s.brokenBonds} broken bonds · ${source?.triangles.length??0} surface triangles`;}};
  const sync=(force=false)=>{for(const {input,key,material}of fields)if(force||input.ownerDocument.activeElement!==input||input.readOnly)input.value=String(material?model.config[key]:config[key]);show();};
  const update=()=>{updateInputs(recipe());show();};
  const rebuild=(resolution=config.previewResolution)=>{
   const next=createEarthTeacherSource({snapshot:model.snapshot(),resolution,halo:0});
   const geometries=materials.map((_,i)=>meshGeometry(next.triangles.filter(t=>t.materialIndex===i)));
   for(let i=0;i<surfaces.length;i++){const old=surfaces[i].geometry;surfaces[i].geometry=geometries[i];old.dispose();}source=next;session.redraw();show();
  };
  const toolQuery=()=>{
   root.updateWorldMatrix(true,false);tool.updateWorldMatrix(true,false);
   const rootScale=root.getWorldScale(new THREE.Vector3()),s=tool.getWorldScale(new THREE.Vector3());
   if(Math.max(rootScale.x,rootScale.y,rootScale.z)-Math.min(rootScale.x,rootScale.y,rootScale.z)>1e-6||rootScale.x<=0||Math.max(s.x,s.y,s.z)-Math.min(s.x,s.y,s.z)>1e-6||s.x<=0)throw Error('Use uniform positive scale for the specimen and spherical forming tool');
   return {position:root.worldToLocal(tool.getWorldPosition(new THREE.Vector3())).toArray(),radius:s.x/rootScale.x};
  };
  const work=async(action)=>{
   if(busy)throw Error('Earth is already being worked');busy=true;failure=null;show();
   try{await action();if(disposed)throw Error('Earth workshop disposed');rebuild();update();return read();}
   catch(error){failure=error.message;show();throw error;}finally{busy=false;show();}
  };
  const yieldFrame=()=>new Promise(resolve=>setTimeout(resolve,0));
  const evolve=async(seconds,contact)=>{let remaining=seconds;while(remaining>1e-9){if(disposed)throw Error('Earth workshop disposed');const dt=Math.min(remaining,.025);model.advance(dt,{tool:contact?.()??null});remaining-=dt;await yieldFrame();}};
  const disposeResources=()=>{for(const mesh of surfaces)mesh.geometry.dispose();for(const m of materials)m.dispose();tray.geometry.dispose();trayMaterial.dispose();tool.geometry.dispose();tool.material.dispose();};
  try{
   rebuild();asset=await session.attach(root,{owned:true,metadata:{label:root.name,source:'kaminos:earth-specimen',type:'experiment'}});
   toolAsset=await session.attach(tool,{owned:true,metadata:{label:tool.name,source:'kaminos:earth-forming-tool',type:'experiment'}});
   if(inputs.view)session.setView(inputs.view);else frame();
   return {read,operations:{
    frame,
    snapshot:()=>recipe(),
    async configure(patch){const next=settings({...config,...patch});if(busy)throw Error('Wait for forming to finish');if(next.previewResolution!==config.previewResolution)rebuild(next.previewResolution);config=next;failure=null;sync();update();return read();},
    material(values){if(busy)throw Error('Wait for forming to finish');model.setMaterial(values);failure=null;sync();update();record({kind:'earth.material',phase:'applied',effective:model.config});return read();},
    async advance({seconds=config.advanceSeconds}={}){if(!Number.isFinite(seconds)||seconds<=0)throw Error('Invalid advance duration');return work(async()=>{await evolve(seconds);record({kind:'earth.advance',phase:'applied',effective:{seconds,state:model.state()}});});},
    async press(){
     const query=toolQuery(),start=tool.position.clone(),localUp=new THREE.Vector3(0,1,0).applyQuaternion(root.getWorldQuaternion(new THREE.Quaternion()));
     return work(async()=>{try{const count=Math.ceil(config.pressSeconds/.025);for(let i=1;i<=count;i++){
      const depth=config.pressDepth*i/count;
      tool.position.copy(start).addScaledVector(localUp,-depth*root.getWorldScale(new THREE.Vector3()).x);session.redraw();
      const contact={position:[query.position[0],query.position[1]-depth,query.position[2]],radius:query.radius};
      await evolve(config.pressSeconds/count,()=>contact);if(i%4===0)rebuild();
     }
     }finally{tool.position.copy(start);session.redraw();}
     await evolve(config.releaseSeconds);
     record({kind:'earth.press',phase:'applied',effective:{tool:query,depth:config.pressDepth,seconds:config.pressSeconds,releaseSeconds:config.releaseSeconds,state:model.state()}});});
    },
    async reset(){if(busy)throw Error('Wait for forming to finish');const next=new EarthSpecimen(model.config);const old=model;model=next;old.dispose();rebuild();failure=null;update();record({kind:'earth.reset',phase:'applied',effective:model.config});return read();},
    async load(value){if(busy)throw Error('Wait for forming to finish');checkedPose(value.pose);checkedPose(value.tool);const nextSettings=settings(value.settings),next=EarthSpecimen.fromSnapshot(value.snapshot);if(next.config.width!==model.config.width){next.dispose();throw Error('Load a different tray width by reopening the specimen setup');}try{restore(root,value.pose);restore(tool,value.tool);}catch(error){next.dispose();throw error;}const old=model;model=next;config=nextSettings;old.dispose();rebuild();host.scene.refreshPresentation(asset);host.scene.refreshPresentation(toolAsset);if(value.view)session.setView(value.view);failure=null;sync();update();return read();},
    async freeze(){if(busy)throw Error('Wait for forming to finish');rebuild(config.captureResolution);update();record({kind:'earth.freeze',phase:'applied',effective:{state:model.state(),resolution:config.captureResolution,triangles:source.triangles.length}});return {source:{...source.config,halo:1},authoring:recipe(),surface:{...read().surface,captureHalo:1}};},
    source(){if(busy)throw Error('Wait for forming to finish');return structuredClone(source);},
   },mount({root:panel,document,invoke}){
    const note=document.createElement('p');note.textContent='Move the forming tool with the normal scene gizmo, then press. Advance lets the bed settle. The fine earth and grit share physical contact. This first specimen has bounded sides.';panel.append(note);
    const fail=e=>{failure=e.message;sync();};
    const row=(label,key,step)=>{const el=document.createElement('label'),grip=document.createElement('span'),input=document.createElement('input');grip.textContent=label+' ';input.type='number';input.className='transform-input';input.step=String(step);input.value=String(config[key]);input.setAttribute('aria-label',label);input.oninput=()=>{if(!input.value.trim())return;return invoke('configure',{[key]:Number(input.value)}).catch(fail);};input.onblur=()=>sync(true);el.append(grip,input);panel.append(el);fields.push({input,key,drag:host.controls.installNumberDrag({input,grip,step})});};
    for(const [label,key,step]of [['Cohesion (N)','cohesion',.2],['Friction','friction',.05],['Compaction yield strain','plasticYield',.01]]){const el=document.createElement('label'),grip=document.createElement('span'),input=document.createElement('input');grip.textContent=label+' ';input.type='number';input.className='transform-input';input.step=String(step);input.value=String(model.config[key]);input.setAttribute('aria-label',label);input.oninput=()=>{if(!input.value.trim())return;return invoke('material',{[key]:Number(input.value)}).catch(fail);};input.onblur=()=>sync(true);el.append(grip,input);panel.append(el);fields.push({input,key,material:true,drag:host.controls.installNumberDrag({input,grip,step})});}
    row('Press depth (m)','pressDepth',.005);row('Press duration (s)','pressSeconds',.05);row('Release settle (s)','releaseSeconds',.05);row('Advance duration (s)','advanceSeconds',.025);row('Preview detail','previewResolution',2);row('Capture detail','captureResolution',4);
    const button=(label,action)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=()=>Promise.resolve().then(action).catch(fail);panel.append(b);return b;};
    button('Press at tool',()=>invoke('press'));button('Advance earth',()=>invoke('advance'));button('Frame specimen',()=>invoke('frame'));button('Prepare capture mesh',()=>invoke('freeze'));
    button('Trace frozen specimen',async()=>{const frozen=await invoke('freeze');return window.kaminosWorkbenchExperiments.open('earth-surface-teacher',{source:{...frozen.source,halo:0},authoring:frozen.authoring,scale:.3,bounces:3,environment:.15});});
    button('Save capture recipe',async()=>{const frozen=await invoke('freeze'),url=URL.createObjectURL(new Blob([JSON.stringify({source:frozen.source})],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='earth-material-teacher.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),0);});
    button('Save specimen JSON',async()=>{const value=await invoke('snapshot'),url=URL.createObjectURL(new Blob([JSON.stringify(value)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='earth-specimen.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),0);});
    const file=document.createElement('input');file.type='file';file.accept='.json,application/json';file.hidden=true;file.onchange=async()=>{try{if(file.files[0])await invoke('load',JSON.parse(await file.files[0].text()));}catch(e){fail(e);}finally{file.value='';}};panel.append(file);button('Load specimen JSON',()=>file.click());button('Reset specimen',()=>invoke('reset'));
    status=document.createElement('p');status.setAttribute('role','status');panel.append(status);show();
   },async dispose(){disposed=true;for(const {drag}of fields)drag?.dispose?.();model.dispose();try{await session.dispose();}finally{disposeResources();}}};
  }catch(error){model.dispose();try{await session.dispose();}finally{disposeResources();}throw error;}
 }
};
