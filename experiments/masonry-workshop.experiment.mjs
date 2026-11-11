import {Mesh,MeshStandardMaterial,MeshBasicMaterial,BufferGeometry,Float32BufferAttribute,SphereGeometry,Vector3,Matrix3,Matrix4,Color,Line,LineBasicMaterial} from '../lib/three.core.js';
import {prepareNavigationGeometry} from '../scene-navigation.mjs';
import {createMasonrySource,traceMasonryRay,masonryDefaults} from '../masonry-source.mjs';

const modes=['source','carrier','regions'];
const checkMode=value=>{if(!modes.includes(value))throw Error('Unknown masonry view');return value;};
const regionColors=[0x417eab,0xe9a945,0xc86b81].map(hex=>new Color(hex).toArray());
const sourceColor=new Color(0x938675).toArray();
const paintGeometry=(geometry,source,regions=false)=>{
 const colors=geometry.getAttribute('color');let i=0;
 for(const t of source.triangles){const c=regions?regionColors[t.materialIndex]:sourceColor;for(let k=0;k<3;k++)colors.setXYZ(i++,...c);}
 colors.needsUpdate=true;
};
const geometryFor=(source,carrier=false)=>{
 const positions=[];const geometry=new BufferGeometry();
 for(const t of source.triangles){const p=carrier?t.carrier:t;positions.push(...p.a,...p.b,...p.c);}
 geometry.setAttribute('position',new Float32BufferAttribute(positions,3));
 geometry.setAttribute('color',new Float32BufferAttribute(new Float32Array(positions.length),3));paintGeometry(geometry,source);
 geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere();return geometry;
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
  // One material per mesh avoids Three WebGPU override-material shadow
  // collisions between draw groups. Diagnostic region colors live on vertices.
  const sourceMaterial=new MeshStandardMaterial({vertexColors:true,roughness:.9});
  const regionMaterial=new MeshBasicMaterial({vertexColors:true});
  const carrierMaterial=new MeshStandardMaterial({color:0xabb1b9,roughness:.8});
  const materials=[sourceMaterial,regionMaterial,carrierMaterial],dragHandles=[];
  const probe=new Mesh(new SphereGeometry(.017,12,8),new MeshBasicMaterial({color:0xffe09a}));probe.name='Ray target · move with the scene gizmo';probe.position.fromArray(initialProbe);
  let probeAsset,rayLine,lastProbe=null,disposed=false,panelStatus,probeText,modeSelect;
  const controls=new Map();
  const recipe=()=>({source:{...config},display:mode,stones:stones.map(({mesh})=>({position:mesh.position.toArray(),quaternion:mesh.quaternion.toArray(),scale:mesh.scale.toArray()})),probe:probe.position.toArray(),view:session.readView()});
  const read=()=>({schema:'kaminos.masonry-workshop.v1',source:config,display:mode,stones:stones.map(s=>({id:s.asset.id,config:s.source.config,regions:s.source.counts,triangles:s.source.triangles.length,position:s.mesh.position.toArray()})),probe:lastProbe,recipe:recipe(),representations:{geometry:'authored explicit inward relief',appearance:'ordinary PBR baseline',nvidia:'unimplemented',sbtf:'unimplemented',simulation:'not run'}});
  const persist=()=>{updateInputs(recipe());session.redraw();};
  const sync=(force=false)=>{if(modeSelect)modeSelect.value=mode;for(const [key,input] of controls)if(force||host.controls.document?.activeElement!==input||input.readOnly)input.value=String(config[key]);if(panelStatus)panelStatus.textContent=`${stones.length} editable stones · ${stones.reduce((n,s)=>n+s.source.triangles.length,0).toLocaleString()} triangles. PBR baseline; neural responses not built yet.`;};
  const applyMode=()=>{for(const s of stones){s.mesh.geometry=s[mode==='carrier'?'carrier':'detailed'];paintGeometry(s.detailed,s.source,mode==='regions');s.mesh.material=mode==='regions'?regionMaterial:mode==='carrier'?carrierMaterial:sourceMaterial;}sync();session.redraw();};
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
    const normalMatrix=new Matrix3().getNormalMatrix(s.mesh.matrixWorld),worldNormal=hit=>hit.hit?new Vector3().fromArray(hit.normal).applyNormalMatrix(normalMatrix).toArray():null;
    best={sourceWorldNormal:worldNormal(source),carrierWorldNormal:worldNormal(carrier),stoneId:s.asset.id,distance,source,carrier,origin:[...origin],direction:worldDirection.toArray(),sourceWorld:source.hit?new Vector3().fromArray(source.position).applyMatrix4(s.mesh.matrixWorld).toArray():null,carrierWorld:carrier.hit?new Vector3().fromArray(carrier.position).applyMatrix4(s.mesh.matrixWorld).toArray():null};
   }
   clearRay();lastProbe=best??{hit:false,origin:[...origin],direction:worldDirection.toArray()};
   if(best){const endpoint=new Vector3().fromArray(best.sourceWorld??best.carrierWorld),begin=endpoint.clone().addScaledVector(worldDirection,-.35);const g=new BufferGeometry().setFromPoints([begin,endpoint]);rayLine=new Line(g,new LineBasicMaterial({color:0xffdd72,depthTest:false}));rayLine.renderOrder=1000;rayLine.raycast=()=>{};const parent=probe.parent;parent.updateWorldMatrix(true,false);parent.add(rayLine);rayLine.applyMatrix4(new Matrix4().copy(parent.matrixWorld).invert());}
   if(probeText)probeText.textContent=best?`${best.source.hit?best.source.region+' · source hit':'Source miss'} / ${best.carrier.hit?'carrier hit':'carrier miss'}${best.source.hit?' · UV '+best.source.uv.map(x=>x.toFixed(3)).join(', '):''}`:'This ray misses all stones.';
   record({kind:'masonry.inspect',phase:'applied',effective:lastProbe});session.redraw();return lastProbe;
  };
  try{
   for(let i=0;i<poses.length;i++){
    const source=createMasonrySource({...config,seed:config.seed+i*17}),detailed=geometryFor(source),carrier=geometryFor(source,true),mesh=new Mesh(detailed,sourceMaterial);
    mesh.name=`Stone ${i+1}`;mesh.position.fromArray(poses[i].position);mesh.quaternion.fromArray(poses[i].quaternion).normalize();mesh.scale.fromArray(poses[i].scale??[1,1,1]);mesh.castShadow=true;mesh.receiveShadow=true;
    const stone={index:i,source,detailed,carrier,mesh,asset:null};stones.push(stone);stone.asset=await session.attach(mesh,{owned:true,metadata:{label:mesh.name,source:'authored:masonry-workshop-v1',type:'experiment'}});
   }
   probeAsset=await session.attach(probe,{owned:true,metadata:{label:probe.name,source:'authored:masonry-ray-target',type:'experiment'}});
   applyMode();session.setView(inputs.view??{position:[3.3,2.5,3.4],target:[0,.18,0],fov:43});
  }catch(error){for(const s of stones){s.detailed.dispose();s.carrier.dispose();}await session.dispose();for(const m of materials)m.dispose();probe.geometry.dispose();probe.material.dispose();throw error;}
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
    const fail=e=>{sync(true);status.textContent=e.message;};select.addEventListener('change',()=>invoke('display',{mode:select.value}).catch(fail));
    panel.append(heading,intro,select);
    for(const [key,label,step] of [['bevel','Corner rounding',.005],['margin','Rich margin width',.01],['relief','Margin relief',.003],['seed','Source seed',1]]){
     const row=document.createElement('label');row.style.cssText='display:flex;gap:8px;align-items:center;margin:8px 0';const grip=document.createElement('span');grip.textContent=label;grip.style.flex='1';
     const input=document.createElement('input');input.type='number';input.step='any';input.className='transform-input';input.style.width='100%';input.setAttribute('aria-label',label);controls.set(key,input);
     input.addEventListener('change',()=>{const value=Number(input.value);if(input.value.trim()&&Number.isFinite(value))invoke('source',{[key]:value}).catch(fail);else sync();});
     const field=document.createElement('span');field.style.cssText='display:inline-flex;flex:0 0 86px;width:86px';field.append(input);row.append(grip,field);panel.append(row);input.addEventListener('blur',()=>sync());dragHandles.push(host.controls.installNumberDrag({input,grip,step}));
    }
    const legend=document.createElement('p');legend.textContent='Regions: blue face · amber margin · rose corner.';
    const button=document.createElement('button');button.textContent='Inspect ray to gold target';button.addEventListener('click',()=>invoke('inspect',{}).catch(fail));
    probeText=document.createElement('p');probeText.textContent='Move the gold target with the native gizmo, then inspect its viewing ray.';
    const frame=document.createElement('button');frame.textContent='Frame masonry';frame.addEventListener('click',()=>invoke('frame').catch(fail));
    const copy=document.createElement('button');copy.textContent='Copy current workshop link';copy.addEventListener('click',()=>{const u=new URL(location.href);u.searchParams.set('experiment_inputs',JSON.stringify(recipe()));navigator.clipboard.writeText(u.href).then(()=>{status.textContent='Current source, object transforms, ray target and camera copied in the link.';}).catch(fail);});
    panel.append(legend,button,probeText,frame,copy,status);sync();
   },
   async dispose(){if(disposed)return;disposed=true;for(const h of dragHandles)h?.dispose?.();clearRay();await session.dispose();for(const s of stones){s.detailed.dispose();s.carrier.dispose();}for(const m of materials)m.dispose();},
  };
 },
};
