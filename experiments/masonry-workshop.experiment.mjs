import {Mesh,MeshStandardMaterial,MeshBasicMaterial,BufferGeometry,Float32BufferAttribute,SphereGeometry,Vector3,Matrix3,Matrix4,Color,Line,LineBasicMaterial} from '../lib/three.core.js';
import {prepareNavigationGeometry} from '../scene-navigation.mjs';
import {createMasonrySource,traceMasonryRay,resolveMasonryConfig} from '../masonry-source.mjs';

import {controlDefinitions,controlValue,displayValue,createLiveMasonryEdits} from '../masonry-controls.mjs';

const modes=['source','integral','carrier','regions'];
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
  let config=resolveMasonryConfig({...inputs.source,...(inputs.resolutions?.integral!==undefined?{cells:inputs.resolutions.integral}:{})}),displayCells=inputs.resolutions?.display??inputs.displayCells??config.cells,mode=checkMode(inputs.display??inputs.mode??'source');
  resolveMasonryConfig({...config,cells:displayCells});
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
  let probeAsset,rayLine,lastProbe=null,disposed=false,panelStatus,probeText,modeSelect,liveEdits;
  const controls=new Map(),drafts=new Map();
  const recipe=()=>({source:{...config},resolutions:{display:displayCells,integral:config.cells},display:mode,stones:stones.map(({mesh})=>({position:mesh.position.toArray(),quaternion:mesh.quaternion.toArray(),scale:mesh.scale.toArray()})),probe:probe.position.toArray(),view:session.readView()});
  const read=()=>({schema:'kaminos.masonry-workshop.v1',source:config,resolutions:{display:displayCells,integral:config.cells},display:mode,stones:stones.map(s=>({id:s.asset.id,config:s.source.config,regions:s.source.counts,triangles:s.source.triangles.length,displayTriangles:s.displaySource.triangles.length,position:s.mesh.position.toArray()})),probe:lastProbe,recipe:recipe(),representations:{geometry:'authored explicit inward relief',appearance:'ordinary PBR baseline',nvidia:'unimplemented',sbtf:'unimplemented',simulation:'not run'}});
  const persist=()=>{updateInputs(recipe());session.redraw();};
  const sync=(force=false)=>{
   if(modeSelect)modeSelect.value=mode;
   for(const [key,input] of controls){
    const value=key==='displayCells'?displayCells:config[key];
    if(force||host.controls.document?.activeElement!==input||input.readOnly)input.value=String(displayValue(key,drafts.get(key)??value));
    const d=controlDefinitions.find(d=>d.key===key),minimum=Math.min(config.width,config.height,config.depth)/2;
    input.max=String(key==='bevel'?minimum*1000*(1-1e-6):key==='relief'?(minimum-config.bevel)*1000*(1-1e-6):Math.max(d.max,displayValue(key,value)));
   }
   if(panelStatus)panelStatus.textContent=`${stones.length} stones · display ${stones.reduce((n,s)=>n+s.displaySource.triangles.length,0).toLocaleString()} triangles · integral source ${stones.reduce((n,s)=>n+s.source.triangles.length,0).toLocaleString()}. Geometry only; traced integral and learned responses are not built.`;
  };
  const applyMode=()=>{for(const s of stones){s.mesh.geometry=mode==='carrier'?s.carrier:mode==='integral'?s.integral:s.detailed;paintGeometry(s.detailed,s.displaySource,mode==='regions');s.mesh.material=mode==='regions'?regionMaterial:mode==='carrier'?carrierMaterial:sourceMaterial;}sync();session.redraw();};
  const clearRay=()=>{if(rayLine){rayLine.removeFromParent();rayLine.geometry.dispose();rayLine.material.dispose();rayLine=null;}lastProbe=null;if(probeText)probeText.textContent='Move the gold target with the native gizmo, then inspect its viewing ray.';};
  const refresh=(nextConfig,nextDisplay=displayCells)=>{
   resolveMasonryConfig({...nextConfig,cells:nextDisplay});
   const changed=Object.keys(nextConfig).some(k=>k!=='cells'&&nextConfig[k]!==config[k]);
   const integralChanged=changed||nextConfig.cells!==config.cells,displayChanged=changed||nextDisplay!==displayCells;
   if(!integralChanged&&!displayChanged)return;
   const prepared=[],allocated=[];
   try{
    for(const stone of stones){const p={};prepared.push(p);
     if(integralChanged){p.source=createMasonrySource({...nextConfig,seed:nextConfig.seed+stone.index*17});p.integral=geometryFor(p.source);allocated.push(p.integral);}
     if(displayChanged){p.displaySource=createMasonrySource({...nextConfig,cells:nextDisplay,seed:nextConfig.seed+stone.index*17});p.detailed=geometryFor(p.displaySource);allocated.push(p.detailed);p.carrier=geometryFor(p.displaySource,true);allocated.push(p.carrier);}
    }
   }catch(error){for(const g of allocated)g.dispose();throw error;}
   config=nextConfig;displayCells=nextDisplay;
   for(let i=0;i<stones.length;i++){const stone=stones[i],p=prepared[i];for(const key of ['detailed','carrier','integral'])if(p[key])stone[key].dispose();Object.assign(stone,p);}
   applyMode();clearRay();for(const stone of stones){if(!stone.mesh.parent)continue;host.scene.refreshPresentation(stone.asset);void prepareNavigationGeometry(stone.mesh).catch(error=>{if(panelStatus)panelStatus.textContent=error.message;});}sync();persist();
  };
  const tune=values=>{const {displayCells:nextDisplay=displayCells,...source}=values;refresh(resolveMasonryConfig({...config,...source}),nextDisplay);record({kind:'masonry.source',phase:'applied',effective:recipe()});return read();};
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
    const source=createMasonrySource({...config,seed:config.seed+i*17}),displaySource=createMasonrySource({...config,cells:displayCells,seed:config.seed+i*17}),detailed=geometryFor(displaySource),carrier=geometryFor(displaySource,true),integral=geometryFor(source),mesh=new Mesh(detailed,sourceMaterial);
    mesh.name=`Stone ${i+1}`;mesh.position.fromArray(poses[i].position);mesh.quaternion.fromArray(poses[i].quaternion).normalize();mesh.scale.fromArray(poses[i].scale??[1,1,1]);mesh.castShadow=true;mesh.receiveShadow=true;
    const stone={index:i,source,displaySource,detailed,carrier,integral,mesh,asset:null};stones.push(stone);stone.asset=await session.attach(mesh,{owned:true,metadata:{label:mesh.name,source:'authored:masonry-workshop-v1',type:'experiment'}});
   }
   probeAsset=await session.attach(probe,{owned:true,metadata:{label:probe.name,source:'authored:masonry-ray-target',type:'experiment'}});
   applyMode();session.setView(inputs.view??{position:[3.3,2.5,3.4],target:[0,.18,0],fov:43});
  }catch(error){for(const s of stones){s.detailed.dispose();s.carrier.dispose();s.integral.dispose();}await session.dispose();for(const m of materials)m.dispose();probe.geometry.dispose();probe.material.dispose();throw error;}
  return {
   read,
   operations:{
    source:values=>tune(values),
    tune,
    resolution({display=displayCells,integral=config.cells}){return tune({displayCells:display,cells:integral});},
    async flushEdits(){await liveEdits?.flush();return read();},
    display({mode:value}){mode=checkMode(value);applyMode();persist();return read();},
    sourceData(){return {recipe:recipe(),stones:stones.map(s=>({id:s.asset.id,source:structuredClone(s.source)}))};},
    inspect,
    frame(){return session.setView({position:[3.3,2.5,3.4],target:[0,.18,0],fov:43});},
    recipe,
   },
   mount({root:panel,document,invoke}){
    const heading=document.createElement('h3');heading.textContent='Masonry source';
    const intro=document.createElement('p');intro.textContent='Select and move stones normally. The recipe below shapes all four sources; relief is authored geometry, not simulated damage.';
    const select=document.createElement('select');modeSelect=select;select.setAttribute('aria-label','Masonry view');for(const [value,label] of [['source','Display surface'],['integral','Integral source mesh'],['carrier','Enclosing carrier'],['regions','Material regions']]){const o=document.createElement('option');o.value=value;o.textContent=label;select.append(o);}select.value=mode;
    const status=document.createElement('p');status.setAttribute('role','status');panelStatus=status;
    const fail=e=>{drafts.clear();sync(true);status.textContent=e.message;};
    liveEdits=createLiveMasonryEdits({apply:async patch=>{await invoke('tune',patch);for(const [key,value] of Object.entries(patch))if(drafts.get(key)===value)drafts.delete(key);sync();},onError:fail});select.addEventListener('change',()=>invoke('display',{mode:select.value}).catch(fail));
    panel.append(heading,intro,select);
    for(const d of controlDefinitions){const {key,label,step}=d;
     const row=document.createElement('label');row.style.cssText='display:flex;gap:8px;align-items:center;margin:8px 0';const grip=document.createElement('span');grip.textContent=label+(d.unit?' ('+d.unit+')':'');grip.style.flex='1';
     const input=document.createElement('input');input.type='number';input.step='any';input.min=String(d.min??0);input.className='transform-input';input.style.width='100%';input.setAttribute('aria-label',label);controls.set(key,input);
     const schedule=()=>{if(!input.value.trim()||!Number.isFinite(Number(input.value)))return;const value=controlValue(key,Number(input.value));input.value=String(displayValue(key,value));drafts.set(key,value);liveEdits.schedule({[key]:value});};
     input.addEventListener('input',schedule);input.addEventListener('change',()=>{schedule();void liveEdits.flush();});
     const field=document.createElement('span');field.style.cssText='display:inline-flex;flex:0 0 86px;width:86px';field.append(input);row.append(grip,field);panel.append(row);input.addEventListener('blur',()=>{void liveEdits.flush();sync();});dragHandles.push(host.controls.installNumberDrag({input,grip,step}));
    }
    const legend=document.createElement('p');legend.textContent='Regions: blue face · amber margin · rose corner.';
    const button=document.createElement('button');button.textContent='Inspect ray to gold target';button.addEventListener('click',()=>invoke('inspect',{}).catch(fail));
    probeText=document.createElement('p');probeText.textContent='Move the gold target with the native gizmo, then inspect its viewing ray.';
    const frame=document.createElement('button');frame.textContent='Frame masonry';frame.addEventListener('click',()=>invoke('frame').catch(fail));
    const copy=document.createElement('button');copy.textContent='Copy current workshop link';copy.addEventListener('click',()=>{const u=new URL(location.href);u.searchParams.set('experiment_inputs',JSON.stringify(recipe()));navigator.clipboard.writeText(u.href).then(()=>{status.textContent='Current source, object transforms, ray target and camera copied in the link.';}).catch(fail);});
    panel.append(legend,button,probeText,frame,copy,status);sync();
   },
   async dispose(){if(disposed)return;disposed=true;liveEdits?.dispose();for(const h of dragHandles)h?.dispose?.();clearRay();await session.dispose();for(const s of stones){s.detailed.dispose();s.carrier.dispose();s.integral.dispose();}for(const m of materials)m.dispose();},
  };
 },
};
