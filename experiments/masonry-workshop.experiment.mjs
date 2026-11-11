import {Mesh,MeshStandardMaterial,MeshBasicMaterial,BufferGeometry,Float32BufferAttribute,SphereGeometry,Vector3,Matrix4,Line,LineBasicMaterial} from '../lib/three.core.js';
import {prepareNavigationGeometry} from '../scene-navigation.mjs';
import {createMasonrySource,traceMasonryRay,masonryDefaults} from '../masonry-source.mjs';

const modes=['source','carrier','regions'];
const checkMode=value=>{if(!modes.includes(value))throw Error('Unknown masonry view');return value;};
const geometryFor=(source,carrier=false)=>{
 const positions=[];const geometry=new BufferGeometry();
 // Keep each region contiguous: face-grid traversal otherwise creates hundreds
 // of tiny draw groups for the same three materials.
 for(let materialIndex=0;materialIndex<3;materialIndex++){
  const start=positions.length/3;
  for(const t of source.triangles){if(t.materialIndex!==materialIndex)continue;const p=carrier?t.carrier:t;positions.push(...p.a,...p.b,...p.c);}
  if(positions.length/3>start)geometry.addGroup(start,positions.length/3-start,materialIndex);
 }
 geometry.setAttribute('position',new Float32BufferAttribute(positions,3));geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere();return geometry;
};
const validVector=(v,label)=>{if(!Array.isArray(v)||v.length!==3||!v.every(Number.isFinite))throw Error(`Invalid ${label}`);return v;};

export default {
 id:'masonry-workshop',title:'Masonry source workshop',
 async create({host,inputs={},record,updateInputs=()=>{}}){
  let config=createMasonrySource(inputs.source??{}).config,mode=checkMode(inputs.display??inputs.mode??'source');
  const poses=inputs.stones??[
   {position:[-.77,.14,-.55],quaternion:[0,0,0,1],scale:[1,1,1]},
   {position:[.77,.14,-.55],quaternion:[0,0,0,1],scale:[1,1,1]},
   {position:[-.77,.14,.55],quaternion:[0,0,0,1],scale:[1,1,1]},
   {position:[.77,.14,.55],quaternion:[0,0,0,1],scale:[1,1,1]},
  ];
  if(!Array.isArray(poses)||!poses.length)throw Error('Masonry workshop needs at least one stone');
  for(const p of poses){validVector(p.position,'stone position');validVector(p.scale??[1,1,1],'stone scale');if((p.scale??[1,1,1]).some(x=>x<=0)||!Array.isArray(p.quaternion)||p.quaternion.length!==4||!p.quaternion.every(Number.isFinite)||Math.hypot(...p.quaternion)===0)throw Error('Invalid stone transform');}
  const initialProbe=validVector(inputs.probe??[-.11,.28,-.12],'probe position');
  const session=await host.scene.open(),stones=[];
  const materials=[new MeshStandardMaterial({color:0x938675,roughness:.84}),new MeshStandardMaterial({color:0x938675,roughness:.97}),new MeshStandardMaterial({color:0x938675,roughness:.97})];
  const regionMaterials=[new MeshBasicMaterial({color:0x417eab}),new MeshBasicMaterial({color:0xe9a945}),new MeshBasicMaterial({color:0xc86b81})];
  const carrierMaterials=[new MeshStandardMaterial({color:0xabb1b9,roughness:.8})];
  const probe=new Mesh(new SphereGeometry(.017,12,8),new MeshBasicMaterial({color:0xffe09a}));probe.name='Ray target · move with the scene gizmo';probe.position.fromArray(initialProbe);
  let probeAsset,rayLine,lastProbe=null,disposed=false,panelStatus,probeText,modeSelect;
  const controls=new Map();
  const recipe=()=>({source:{...config},display:mode,stones:stones.map(({mesh})=>({position:mesh.position.toArray(),quaternion:mesh.quaternion.toArray(),scale:mesh.scale.toArray()})),probe:probe.position.toArray(),view:session.readView()});
  const read=()=>({schema:'kaminos.masonry-workshop.v1',source:config,display:mode,stones:stones.map(s=>({id:s.asset.id,config:s.source.config,regions:s.source.counts,triangles:s.source.triangles.length,position:s.mesh.position.toArray()})),probe:lastProbe,recipe:recipe(),representations:{geometry:'authored explicit inward relief',appearance:'ordinary PBR baseline',nvidia:'unimplemented',sbtf:'unimplemented',simulation:'not run'}});
  const persist=()=>{updateInputs(recipe());session.redraw();};
  const sync=()=>{if(modeSelect)modeSelect.value=mode;for(const [key,input] of controls)if(host.controls.document?.activeElement!==input)input.value=String(config[key]);if(panelStatus)panelStatus.textContent=`${stones.length} editable stones · ${stones.reduce((n,s)=>n+s.source.triangles.length,0).toLocaleString()} triangles. PBR baseline; neural responses not built yet.`;};
  const applyMode=()=>{for(const s of stones){s.mesh.geometry=s[mode==='carrier'?'carrier':'detailed'];s.mesh.material=mode==='regions'?regionMaterials:mode==='carrier'?[carrierMaterials[0],carrierMaterials[0],carrierMaterials[0]]:materials;}sync();session.redraw();};
  const clearRay=()=>{if(rayLine){rayLine.removeFromParent();rayLine.geometry.dispose();rayLine.material.dispose();rayLine=null;}lastProbe=null;if(probeText)probeText.textContent='Move the gold target with the native gizmo, then inspect its viewing ray.';};
  const refresh=nextConfig=>{
   const sources=stones.map(s=>createMasonrySource({...nextConfig,seed:nextConfig.seed+s.index*17}));
   const prepared=[];
   try{for(const source of sources)prepared.push({source,detailed:geometryFor(source),carrier:geometryFor(source,true)});}
   catch(error){for(const p of prepared){p.detailed.dispose();p.carrier.dispose();}throw error;}
   config=nextConfig;
   for(let i=0;i<stones.length;i++){const s=stones[i],p=prepared[i];s.mesh.geometry=p.detailed;s.detailed.dispose();s.carrier.dispose();Object.assign(s,p);}
   applyMode();clearRay();for(const s of stones){host.scene.refreshPresentation(s.asset);void prepareNavigationGeometry(s.mesh).catch(error=>{if(panelStatus)panelStatus.textContent=error.message;});}sync();persist();
  };
  const inspect=request=>{
   const view=session.readView(),origin=validVector(request?.origin??view.position,'ray origin');
   const target=probe.getWorldPosition(new Vector3()),direction=request?.direction??target.toArray().map((x,i)=>x-origin[i]);validVector(direction,'ray direction');if(Math.hypot(...direction)===0)throw Error('Invalid masonry ray direction');
   const worldOrigin=new Vector3().fromArray(origin),worldDirection=new Vector3().fromArray(direction).normalize();
   let best=null;
   for(const s of stones){
    if(!s.mesh.parent||!s.mesh.visible)continue;s.mesh.updateWorldMatrix(true,false);
    const inverse=new Matrix4().copy(s.mesh.matrixWorld).invert();const localOrigin=worldOrigin.clone().applyMatrix4(inverse),localDirection=worldDirection.clone().transformDirection(inverse);
    const ray={origin:localOrigin.toArray(),direction:localDirection.toArray()};
    const source=traceMasonryRay(s.source,ray),carrier=traceMasonryRay(s.source,{...ray,surface:'carrier'});
    if(!source.hit&&!carrier.hit)continue;
    const selected=carrier.hit?carrier:source,world=new Vector3().fromArray(selected.position).applyMatrix4(s.mesh.matrixWorld),distance=world.distanceTo(worldOrigin);
    if(best&&distance>=best.distance)continue;
    best={stoneId:s.asset.id,distance,source,carrier,origin:[...origin],direction:worldDirection.toArray(),sourceWorld:source.hit?new Vector3().fromArray(source.position).applyMatrix4(s.mesh.matrixWorld).toArray():null,carrierWorld:carrier.hit?new Vector3().fromArray(carrier.position).applyMatrix4(s.mesh.matrixWorld).toArray():null};
   }
   clearRay();lastProbe=best??{hit:false,origin:[...origin],direction:worldDirection.toArray()};
   if(best){const endpoint=new Vector3().fromArray(best.sourceWorld??best.carrierWorld),begin=endpoint.clone().addScaledVector(worldDirection,-.35);const g=new BufferGeometry().setFromPoints([begin,endpoint]);rayLine=new Line(g,new LineBasicMaterial({color:0xffdd72,depthTest:false}));rayLine.renderOrder=1000;rayLine.raycast=()=>{};probe.add(rayLine);rayLine.applyMatrix4(new Matrix4().copy(probe.matrixWorld).invert());}
   if(probeText)probeText.textContent=best?`${best.source.hit?best.source.region+' · source hit':'Source miss'} / ${best.carrier.hit?'carrier hit':'carrier miss'}${best.source.hit?' · UV '+best.source.uv.map(x=>x.toFixed(3)).join(', '):''}`:'This ray misses all stones.';
   record({kind:'masonry.inspect',phase:'applied',effective:lastProbe});session.redraw();return lastProbe;
  };
  try{
   for(let i=0;i<poses.length;i++){
    const source=createMasonrySource({...config,seed:config.seed+i*17}),detailed=geometryFor(source),carrier=geometryFor(source,true),mesh=new Mesh(detailed,materials);
    mesh.name=`Stone ${i+1}`;mesh.position.fromArray(poses[i].position);mesh.quaternion.fromArray(poses[i].quaternion).normalize();mesh.scale.fromArray(poses[i].scale??[1,1,1]);mesh.castShadow=true;mesh.receiveShadow=true;
    const stone={index:i,source,detailed,carrier,mesh,asset:null};stones.push(stone);stone.asset=await session.attach(mesh,{owned:true,metadata:{label:mesh.name,source:'authored:masonry-workshop-v1',type:'experiment'}});
   }
   probeAsset=await session.attach(probe,{owned:true,metadata:{label:probe.name,source:'authored:masonry-ray-target',type:'experiment'}});
   applyMode();session.setView(inputs.view??{position:[3.3,2.5,3.4],target:[0,.18,0],fov:43});
  }catch(error){for(const s of stones){s.detailed.dispose();s.carrier.dispose();}await session.dispose();for(const m of [...materials,...regionMaterials,...carrierMaterials])m.dispose();probe.geometry.dispose();probe.material.dispose();throw error;}
  return {
   read,
   operations:{
    source(values){const next=createMasonrySource({...config,...values});refresh(next.config);record({kind:'masonry.source',phase:'applied',effective:recipe()});return read();},
    display({mode:value}){mode=checkMode(value);applyMode();persist();return read();},
    sourceData(){return {recipe:recipe(),stones:stones.map(s=>({id:s.asset.id,source:structuredClone(s.source)}))};},
    inspect,
    frame(){return session.setView({position:[3.3,2.5,3.4],target:[0,.18,0],fov:43});},
    recipe,
   },
   mount({root:panel,document,invoke}){
    const heading=document.createElement('h3');heading.textContent='Masonry source';
    const intro=document.createElement('p');intro.textContent='Select and move stones normally. The recipe below shapes all four sources; relief is authored geometry, not simulated damage.';
    const select=document.createElement('select');modeSelect=select;select.setAttribute('aria-label','Masonry view');for(const [value,label] of [['source','Detailed source'],['carrier','Enclosing carrier'],['regions','Material regions']]){const o=document.createElement('option');o.value=value;o.textContent=label;select.append(o);}select.value=mode;
    const status=document.createElement('p');status.setAttribute('role','status');panelStatus=status;
    const fail=e=>{status.textContent=e.message;sync();};select.addEventListener('change',()=>invoke('display',{mode:select.value}).catch(fail));
    panel.append(heading,intro,select);
    for(const [key,label,step] of [['bevel','Corner rounding',.005],['margin','Rich margin width',.01],['relief','Margin relief',.003],['seed','Source seed',1]]){
     const row=document.createElement('label');row.style.cssText='display:flex;gap:8px;align-items:center;margin:8px 0';const grip=document.createElement('span');grip.textContent=label;grip.style.flex='1';
     const input=document.createElement('input');input.type='number';input.step='any';input.className='transform-input';input.style.width='78px';input.setAttribute('aria-label',label);controls.set(key,input);
     input.addEventListener('change',()=>{const value=Number(input.value);if(input.value.trim()&&Number.isFinite(value))invoke('source',{[key]:value}).catch(fail);else sync();});
     host.controls.installNumberDrag({input,grip,step});row.append(grip,input);panel.append(row);
    }
    const legend=document.createElement('p');legend.textContent='Regions: blue face · amber margin · rose corner.';
    const button=document.createElement('button');button.textContent='Inspect ray to gold target';button.addEventListener('click',()=>invoke('inspect',{}).catch(fail));
    probeText=document.createElement('p');probeText.textContent='Move the gold target with the native gizmo, then inspect its viewing ray.';
    const frame=document.createElement('button');frame.textContent='Frame masonry';frame.addEventListener('click',()=>invoke('frame').catch(fail));
    const copy=document.createElement('button');copy.textContent='Copy current workshop link';copy.addEventListener('click',()=>{const u=new URL(location.href);u.searchParams.set('experiment_inputs',JSON.stringify(recipe()));navigator.clipboard.writeText(u.href).then(()=>{status.textContent='Current source, object transforms, ray target and camera copied in the link.';}).catch(fail);});
    panel.append(legend,button,probeText,frame,copy,status);sync();
   },
   async dispose(){if(disposed)return;disposed=true;clearRay();await session.dispose();for(const s of stones){s.detailed.dispose();s.carrier.dispose();}for(const m of [...materials,...regionMaterials,...carrierMaterials])m.dispose();},
  };
 },
};
