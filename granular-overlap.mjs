import * as CANNON from './node_modules/cannon-es/dist/cannon-es.js';
import {createGranularPreparation,preparationCollisionHull,preparationSource,validatePreparationSnapshot} from './granular-preparation.mjs';
const finite=(v,name,zero=false)=>{if(!Number.isFinite(v)||(zero?v<0:v<=0))throw Error('Invalid '+name);return v;};
const integer=(v,name)=>{if(!Number.isSafeInteger(v)||v<1)throw Error('Invalid '+name);return v;};
const clone=value=>structuredClone(value);
export function studyConfiguration(input={}){
 const c={seed:41,fineCount:256,fineSolidVolume:2.65e-7,width:.024,coarseRadius:.0035,anchorExposureDiameters:.75,dt:1/480,commitPolicy:'core',settleSeconds:.8,platenQuantile:.5,strain:.08,stages:0,passes:4,localSeconds:.025,grids:[[2,2],[2,4]],overlapDiameters:[.5,1],...input};
 integer(c.fineCount,'fine count');if(!Number.isSafeInteger(c.stages)||c.stages<0)throw Error('Invalid stages');integer(c.passes,'passes');if(!Number.isSafeInteger(c.seed)||c.seed<0)throw Error('Invalid seed');
 for(const k of ['fineSolidVolume','width','coarseRadius','settleSeconds','localSeconds'])finite(c[k],k);
 finite(c.strain,'strain',true);if(c.strain>=1)throw Error('Strain must be below one');finite(c.anchorExposureDiameters,'anchor exposure');finite(c.dt,'dt');if(!['core','all-active'].includes(c.commitPolicy))throw Error('Invalid commit policy');finite(c.platenQuantile,'platen quantile');if(c.platenQuantile>1)throw Error('Platen quantile must be at most one');overlapCases(c);return c;
}
export function overlapCases({grids=[[2,2],[2,4]],overlapDiameters=[.5,1]}={}){
 if(!Array.isArray(grids)||grids.some(g=>!Array.isArray(g)||g.length!==2||g.some(n=>!Number.isSafeInteger(n)||n<1)))throw Error('Invalid region grids');
 if(!Array.isArray(overlapDiameters)||!overlapDiameters.length||overlapDiameters.some(n=>!Number.isFinite(n)||n<0))throw Error('Invalid overlap widths');
 const cases=[{id:'whole',label:'Whole fine layer',grid:[1,1],schedule:'fixed',overlapDiameters:0}];
 for(const grid of grids)for(const overlap of overlapDiameters)for(const schedule of ['fixed','shifted'])cases.push({id:`${grid.join('x')}-${schedule}-${overlap}d`,label:`${grid.join('×')} · ${schedule} · ${overlap} grain overlap`,grid:[...grid],schedule,overlapDiameters:overlap});
 if(new Set(cases.map(c=>c.id)).size!==cases.length)throw Error('Duplicate comparison cases');return cases;
}
export function patchWindows({width,grid,overlap=0,offset=[0,0]}){
 finite(width,'width');finite(overlap,'overlap',true);if(!Array.isArray(grid)||grid.length!==2||grid.some(n=>!Number.isSafeInteger(n)||n<1)||!Array.isArray(offset)||offset.length!==2||offset.some(n=>!Number.isFinite(n)||Math.abs(n)>=.5))throw Error('Invalid patch grid or offset');
 const axes=grid.map((n,axis)=>Array.from({length:n+1},(_,i)=>i===0?-width/2:i===n?width/2:-width/2+(i+offset[axis])*width/n));
 const windows=[];for(let z=0;z<grid[1];z++)for(let x=0;x<grid[0];x++)windows.push({id:`${x},${z}`,bounds:[Math.max(-width/2,axes[0][x]-overlap/2),Math.min(width/2,axes[0][x+1]+overlap/2),Math.max(-width/2,axes[1][z]-overlap/2),Math.min(width/2,axes[1][z+1]+overlap/2)],core:[axes[0][x],axes[0][x+1],axes[1][z],axes[1][z+1]]});return windows;
}
export function selectWindow(snapshot,window,ids){
 const [xmin,xmax,zmin,zmax]=window.bounds;return ids.filter(id=>{const [x,,z]=snapshot.grains[id].position;return x>=xmin&&x<=xmax&&z>=zmin&&z<=zmax;});
}
export function makeStudyState(input={}){
 const c=studyConfiguration(input),stock=createGranularPreparation({seed:c.seed,count:c.fineCount,grainDetail:0,radius:.001,spread:.2,width:c.width,dt:c.dt}),large=createGranularPreparation({seed:c.seed+1000,count:2,grainDetail:0,radius:c.coarseRadius,spread:.1,width:c.width});
 let fine,coarse,recipe;try{fine=stock.snapshot().ingredients;coarse=large.snapshot().ingredients;recipe=stock.read().recipe;}finally{stock.dispose();large.dispose();}
 const factor=Math.cbrt(c.fineSolidVolume/fine.reduce((s,g)=>s+g.volume,0));
 fine=fine.map((g,i)=>({...g,id:i+2,vertices:g.vertices.map(p=>p.map(x=>x*factor)),radius:g.radius*factor,volume:g.volume*factor**3,mass:g.mass*factor**3,role:'fine'}));
 coarse=coarse.map((g,i)=>({...g,id:i,role:'parent-stone',materialIndex:2}));
 const ingredients=[...coarse,...fine],maxR=Math.max(...fine.map(g=>g.radius)),spacing=maxR*2.3,side=Math.floor(c.width/spacing);
 if(side<1)throw Error('Fine population cannot fit in the requested specimen width');
 const rotated=g=>{const q=new CANNON.Quaternion(...g.quaternion);return g.vertices.map(p=>q.vmult(new CANNON.Vec3(...p)));};
 const anchorGeometry=coarse.map(rotated),grains=coarse.map((g,i)=>({id:g.id,position:[(i?1:-1)*c.width*.22,2*recipe.radius*factor*c.anchorExposureDiameters-Math.max(...anchorGeometry[i].map(p=>p.y)),(i?-1:1)*c.width*.1],quaternion:[...g.quaternion],velocity:[0,0,0],angularVelocity:[0,0,0]}));
 let rng=c.seed>>>0;const random=()=>((rng=(Math.imul(rng,1664525)+1013904223)>>>0)+.5)/2**32,columns=new Map();
 for(let i=0;i<fine.length;i++){
  const g=fine[i],x=i%side,z=Math.floor(i/side)%side,key=x+','+z,px=(x-(side-1)/2+(random()-.5)*.04)*spacing,pz=(z-(side-1)/2+(random()-.5)*.04)*spacing,vertices=rotated(g);let support=columns.get(key)??0;
  for(let j=0;j<coarse.length;j++){const row=grains[j],points=anchorGeometry[j];if(px+g.radius>=row.position[0]+Math.min(...points.map(p=>p.x))&&px-g.radius<=row.position[0]+Math.max(...points.map(p=>p.x))&&pz+g.radius>=row.position[2]+Math.min(...points.map(p=>p.z))&&pz-g.radius<=row.position[2]+Math.max(...points.map(p=>p.z)))support=Math.max(support,row.position[1]+Math.max(...points.map(p=>p.y)));}
  const py=support-Math.min(...vertices.map(p=>p.y))+.02*stateDiameter();grains.push({id:g.id,position:[px,py,pz],quaternion:[...g.quaternion],velocity:[0,0,0],angularVelocity:[0,0,0]});columns.set(key,py+Math.max(...vertices.map(p=>p.y)));
 }
 function stateDiameter(){return 2*recipe.radius*factor;}
 const state={schema:'kaminos.granular-preparation.v1',recipe:{...recipe,count:ingredients.length,radius:recipe.radius*factor},ingredients,grains,time:0,lidHeight:Math.max(...grains.map((g,i)=>g.position[1]+ingredients[i].radius))+maxR,containerX:0,phase:null,history:[]};
 validatePreparationSnapshot(state);return {configuration:c,state,fineIds:fine.map(g=>g.id),anchorIds:coarse.map(g=>g.id),nominalDiameter:2*state.recipe.radius};
}
export function relaxPatch(snapshot,{activeIds,commitIds=activeIds,seconds,lidHeight=snapshot.lidHeight}){
 if(!Array.isArray(commitIds)||new Set(commitIds).size!==commitIds.length||commitIds.some(id=>!activeIds.includes(id)))throw Error('Invalid committed grain identities');finite(seconds,'local relaxation duration');finite(lidHeight,'lid height');if(snapshot.phase)throw Error('Patch input must be a completed parent stage');
 const before=clone(snapshot);before.lidHeight=lidHeight;const model=createGranularPreparation(null,before,{activeIds});let local;
 try{model.start('settle',{seconds});model.advance(seconds);if(model.read().phase)throw Error('Local solver returned incomplete relaxation');local=model.snapshot();}finally{model.dispose();}
 const active=new Set(commitIds),result={...before,grains:before.grains.map(row=>active.has(row.id)?local.grains[row.id]:row)};
 return {state:result,localClock:{from:before.time,to:local.time},activeParticleSteps:activeIds.length*Math.ceil(seconds/before.recipe.dt),committedParticleSteps:commitIds.length*Math.ceil(seconds/before.recipe.dt)};
}
export function packingMetrics(snapshot,anchorIds=[]){
 const anchors=new Set(anchorIds),shapes=snapshot.ingredients.map(preparationCollisionHull),positions=snapshot.grains.map(g=>new CANNON.Vec3(...g.position)),quaternions=snapshot.grains.map(g=>new CANNON.Quaternion(...g.quaternion));let contacts=0,maxPenetration=0,maxFloorPenetration=0,maxLidPenetration=0;
 for(let i=0;i<shapes.length;i++){
  if(!anchors.has(i)){const body=snapshot.grains[i];for(const vertex of shapes[i].vertices){const p=quaternions[i].vmult(vertex).vadd(positions[i]);maxFloorPenetration=Math.max(maxFloorPenetration,-p.y);maxLidPenetration=Math.max(maxLidPenetration,p.y-snapshot.lidHeight);}}
  for(let j=i+1;j<shapes.length;j++){if(anchors.has(i)&&anchors.has(j))continue;if(positions[i].distanceTo(positions[j])>=snapshot.ingredients[i].radius+snapshot.ingredients[j].radius)continue;const axis=new CANNON.Vec3();if(shapes[i].findSeparatingAxis(shapes[j],positions[i],quaternions[i],positions[j],quaternions[j],axis)){const depth=shapes[i].testSepAxis(axis,shapes[j],positions[i],quaternions[i],positions[j],quaternions[j]);if(depth>0){contacts++;maxPenetration=Math.max(maxPenetration,depth);}}}
 }
 return {grains:snapshot.grains.length,mass:snapshot.ingredients.reduce((s,g)=>s+g.mass,0),contacts,maxPenetration,maxFloorPenetration,maxLidPenetration};
}
const OFFSETS=[[0,0],[.25,0],[0,.25],[-.25,-.25]];
export function rigidHeightLowerBound(grain){
 let radius=Infinity;for(const face of grain.faces){const [a,b,c]=face.map(i=>grain.vertices[i]),u=b.map((v,i)=>v-a[i]),v=c.map((v,i)=>v-a[i]),n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];radius=Math.min(radius,Math.abs(n.reduce((s,v,i)=>s+v*a[i],0))/Math.hypot(...n));}return 2*radius;
}
export function specimenLoading(state,{fineIds,anchorIds,strain,platenQuantile}){
 const source=preparationSource(state),tops=new Map(fineIds.map(id=>[id,-Infinity]));let anchorTop=-Infinity;
 for(const t of source.triangles){const id=Number(t.identity?.replace('grain-','')),top=Math.max(t.a[1],t.b[1],t.c[1]);if(tops.has(id))tops.set(id,Math.max(tops.get(id),top));if(anchorIds.includes(id))anchorTop=Math.max(anchorTop,top);}
 const fineTops=Array.from(tops.values()).sort((a,b)=>a-b),startTop=Math.max(...fineTops),quantileHeight=fineTops[Math.floor((fineTops.length-1)*platenQuantile)],requestedEnd=quantileHeight*(1-strain),effectiveEnd=Math.max(requestedEnd,anchorTop+1e-5);
 return {startTop,requestedEnd,effectiveEnd,anchorTop,quantileHeight,fineTops,loadedFineCount:fineTops.filter(y=>y>effectiveEnd).length,loadedFineFraction:fineTops.filter(y=>y>effectiveEnd).length/fineTops.length,referenceMaximumSpeed:Math.max(...fineIds.map(id=>Math.hypot(...state.grains[id].velocity)))};
}
export async function runOverlapCase(initial,{configuration,caseDefinition,fineIds,anchorIds,nominalDiameter,loading=null,onStep=()=>{}}){
 const c=studyConfiguration(configuration);let state=clone(initial),work=0,committedWork=0,visits=Array(state.grains.length).fill(0),evaluationVisits=Array(state.grains.length).fill(0);const originalIngredients=JSON.stringify(initial.ingredients);
 async function pass(phase,stage,pass,seconds,lidHeight){
  state.lidHeight=lidHeight;const offset=caseDefinition.schedule==='shifted'?OFFSETS[pass%OFFSETS.length]:[0,0],reference=clone(state),windows=patchWindows({width:c.width,grid:caseDefinition.grid,overlap:caseDefinition.overlapDiameters*nominalDiameter,offset});
  const assignments=windows.map(window=>{const [a,b,d,e]=window.core,coreIds=fineIds.filter(id=>{const [x,,z]=reference.grains[id].position;return x>=a&&(x<b||(b===c.width/2&&x<=b))&&z>=d&&(z<e||(e===c.width/2&&z<=e));});const activeIds=selectWindow(reference,window,fineIds);return {window,activeIds,coreIds,commitIds:c.commitPolicy==='core'?coreIds:activeIds};});if(fineIds.some(id=>!assignments.some(a=>a.activeIds.includes(id))))throw Error('Patch layout left fine material unassigned');if(c.commitPolicy==='core'&&fineIds.some(id=>assignments.filter(a=>a.commitIds.includes(id)).length!==1))throw Error('Patch core ownership is not unique');
  for(const {window,activeIds,coreIds,commitIds}of assignments){if(!activeIds.length)continue;const next=relaxPatch(state,{activeIds,commitIds,seconds,lidHeight});state=next.state;work+=next.activeParticleSteps;committedWork+=next.committedParticleSteps;for(const id of commitIds)visits[id]++;for(const id of activeIds)evaluationVisits[id]++;
   await onStep({phase,stage,pass,window,offset,activeIds,coreIds,commitIds,localClock:next.localClock,activeParticleSteps:next.activeParticleSteps,committedParticleSteps:next.committedParticleSteps},state);
  }
 }
 // Every case starts from the identical unprepared inventory. The whole reference
 // supplies the subsequent common loading planes, never a pre-packed initial bed.
 const preparationPasses=Math.ceil(c.settleSeconds/c.localSeconds);for(let i=0;i<preparationPasses;i++)await pass('settle',-1,i,Math.min(c.localSeconds,c.settleSeconds-i*c.localSeconds),initial.lidHeight);
 const prepared=clone(state);loading=loading??specimenLoading(prepared,{fineIds,anchorIds,strain:c.strain,platenQuantile:c.platenQuantile});
 if(!c.stages)loading={...loading,effectiveEnd:loading.startTop,requestedEnd:loading.startTop,loadedFineCount:0,loadedFineFraction:0};if(c.stages&&!(loading.startTop>loading.effectiveEnd))throw Error('Reference loading does not compress the fine layer');
 const rigidMinimum=Math.max(...fineIds.map(id=>rigidHeightLowerBound(state.ingredients[id])));if(c.stages&&loading.effectiveEnd<rigidMinimum)throw Error('Compression height cannot fit the rigid fine grains');loading={...loading,rigidHeightLowerBound:rigidMinimum};
 for(let stage=0;stage<c.stages;stage++){const height=loading.startTop+(loading.effectiveEnd-loading.startTop)*(stage+1)/c.stages;for(let i=0;i<c.passes;i++)await pass('compress',stage,i,c.localSeconds,height);}
 if(JSON.stringify(state.ingredients)!==originalIngredients)throw Error('Patch solve changed ingredient identity or mass');for(const id of anchorIds)if(JSON.stringify(state.grains[id])!==JSON.stringify(initial.grains[id]))throw Error('Patch solve moved a prescribed parent stone');
 state.overlapPreparation={case:caseDefinition.id,configuration:c,parentClockHeldAt:initial.time,requestedStrain:c.stages?c.strain:0,effectiveStrain:1-loading.effectiveEnd/loading.startTop,activeParticleSteps:work,committedParticleSteps:committedWork,visits,evaluationVisits,loading};
 return {state,prepared,loading,metrics:packingMetrics(state,anchorIds),activeParticleSteps:work,committedParticleSteps:committedWork,visits,evaluationVisits,requestedStrain:c.stages?c.strain:0,effectiveStrain:1-loading.effectiveEnd/loading.startTop};
}
export async function loadStudyState(manifest,record,caseId,readBytes){
 if(manifest?.schema!=='kaminos.granular-overlap-study.v2'||!['cannon-es-0.20.0-cpu/convex-grains/frozen-neighbor-patches','cannon-es-0.20.0-cpu/convex-grains/local-context-patches'].includes(manifest.effectiveRoute)||typeof manifest.source?.commit!=='string'||!manifest.source.commit||![false,''].includes(manifest.source.dirty))throw Error('Unverified overlap study source or route');
 if(!manifest.configuration||typeof manifest.configuration!=='object'||Object.keys(studyConfiguration()).some(key=>!Object.hasOwn(manifest.configuration,key)))throw Error('Incomplete overlap manifest configuration');const c=studyConfiguration(manifest.configuration);
 if(!Array.isArray(manifest.anchorIds)||!manifest.anchorIds.length||new Set(manifest.anchorIds).size!==manifest.anchorIds.length||manifest.anchorIds.some(id=>!Number.isSafeInteger(id)||id<0)||!Array.isArray(manifest.cases))throw Error('Invalid overlap manifest anchor or case inventory');finite(manifest.nominalDiameter,'manifest nominal diameter');
 const definition=overlapCases(c).find(entry=>entry.id===caseId),entry=manifest.cases.find(entry=>entry.id===caseId);
 if(caseId!=='initial'&&(!definition||!entry||['grid','schedule','overlapDiameters'].some(key=>JSON.stringify(definition[key])!==JSON.stringify(entry[key]))))throw Error('Invalid overlap manifest case definition');
 if(!record?.path||typeof record.sha256!=='string'||(caseId!=='initial'&&!(entry.status==='completed'&&entry.snapshot?.sha256===record.sha256)))throw Error('Comparison result is missing or incomplete');
 const bytes=await readBytes(record.path),hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',value))).map(n=>n.toString(16).padStart(2,'0')).join('');
 if(await hash(bytes)!==record.sha256)throw Error('Comparison artifact hash mismatch');const state=JSON.parse(new TextDecoder().decode(bytes));if(state.phase!==null)throw Error('Comparison contains an incomplete physical stage');
 if(await hash(new TextEncoder().encode(JSON.stringify(state.ingredients)))!==manifest.geometrySha256)throw Error('Comparison changed the ingredient geometry');
 if(state.grains.length!==c.fineCount+manifest.anchorIds.length||state.recipe.width!==c.width||manifest.anchorIds.some(id=>id>=state.grains.length)||Math.abs(manifest.nominalDiameter-2*state.recipe.radius)>1e-12)throw Error('Comparison material inventory, diameter or extent mismatch');
 if(caseId!=='initial'){
  if(state.overlapPreparation?.case!==caseId)throw Error('Comparison case identity mismatch');if(Object.keys(studyConfiguration()).some(key=>JSON.stringify(c[key])!==JSON.stringify(state.overlapPreparation.configuration?.[key])))throw Error('Comparison configuration mismatch');const initial=await loadStudyState(manifest,manifest.initial,'initial',readBytes);
  if(state.time!==initial.time||state.overlapPreparation.parentClockHeldAt!==initial.time)throw Error('Comparison parent clock changed');
  for(const id of manifest.anchorIds)if(JSON.stringify(state.grains[id])!==JSON.stringify(initial.grains[id]))throw Error('Comparison prescribed anchor moved');
 }
 validatePreparationSnapshot(state);return state;
}
