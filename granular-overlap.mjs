import * as CANNON from './node_modules/cannon-es/dist/cannon-es.js';
import {createGranularPreparation,preparationCollisionHull,preparationSource} from './granular-preparation.mjs';
const finite=(v,name,zero=false)=>{if(!Number.isFinite(v)||(zero?v<0:v<=0))throw Error('Invalid '+name);return v;};
const integer=(v,name)=>{if(!Number.isSafeInteger(v)||v<1)throw Error('Invalid '+name);return v;};
const clone=value=>structuredClone(value);
export function studyConfiguration(input={}){
 const c={seed:41,fineCount:48,fineSolidVolume:7e-7,width:.024,coarseRadius:.0035,settleSeconds:.35,strain:.08,stages:2,passes:4,localSeconds:.025,grids:[[2,2],[2,4]],overlapDiameters:[1,2],...input};
 integer(c.fineCount,'fine count');integer(c.stages,'stages');integer(c.passes,'passes');if(!Number.isSafeInteger(c.seed)||c.seed<0)throw Error('Invalid seed');
 for(const k of ['fineSolidVolume','width','coarseRadius','settleSeconds','localSeconds'])finite(c[k],k);
 finite(c.strain,'strain',true);if(c.strain>=1)throw Error('Strain must be below one');overlapCases(c);return c;
}
export function overlapCases({grids=[[2,2],[2,4]],overlapDiameters=[1,2]}={}){
 if(!Array.isArray(grids)||!grids.length||grids.some(g=>!Array.isArray(g)||g.length!==2||g.some(n=>!Number.isSafeInteger(n)||n<1)))throw Error('Invalid region grids');
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
 const c=studyConfiguration(input),stock=createGranularPreparation({seed:c.seed,count:c.fineCount,grainDetail:0,radius:.001,spread:.2,width:c.width}),large=createGranularPreparation({seed:c.seed+1000,count:2,grainDetail:0,radius:c.coarseRadius,spread:.1,width:c.width});
 let fine,coarse,recipe;try{fine=stock.snapshot().ingredients;coarse=large.snapshot().ingredients;recipe=stock.read().recipe;}finally{stock.dispose();large.dispose();}
 const factor=Math.cbrt(c.fineSolidVolume/fine.reduce((s,g)=>s+g.volume,0));
 fine=fine.map((g,i)=>({...g,id:i+2,vertices:g.vertices.map(p=>p.map(x=>x*factor)),radius:g.radius*factor,volume:g.volume*factor**3,mass:g.mass*factor**3,role:'fine'}));
 coarse=coarse.map((g,i)=>({...g,id:i,role:'parent-stone',materialIndex:2}));
 const ingredients=[...coarse,...fine],maxR=Math.max(...fine.map(g=>g.radius)),spacing=maxR*2.3,side=Math.floor(c.width/spacing);
 if(side<1)throw Error('Fine population cannot fit in the requested specimen width');
 const grains=coarse.map((g,i)=>({id:g.id,position:[(i?1:-1)*c.width*.22,-g.radius*.65,(i?-1:1)*c.width*.1],quaternion:[...g.quaternion],velocity:[0,0,0],angularVelocity:[0,0,0]}));
 let rng=c.seed>>>0;const random=()=>((rng=(Math.imul(rng,1664525)+1013904223)>>>0)+.5)/2**32;
 for(let i=0;i<fine.length;i++){const g=fine[i],x=i%side,z=Math.floor(i/side)%side,y=Math.floor(i/(side*side));grains.push({id:g.id,position:[(x-(side-1)/2+(random()-.5)*.04)*spacing,c.coarseRadius*2+maxR*2+y*spacing,(z-(side-1)/2+(random()-.5)*.04)*spacing],quaternion:[...g.quaternion],velocity:[0,0,0],angularVelocity:[0,0,0]});}
 const state={schema:'kaminos.granular-preparation.v1',recipe:{...recipe,count:ingredients.length,radius:recipe.radius*factor},ingredients,grains,time:0,lidHeight:Math.max(...grains.map((g,i)=>g.position[1]+ingredients[i].radius))+maxR,containerX:0,phase:null,history:[]};
 preparationSource(state);return {configuration:c,state,fineIds:fine.map(g=>g.id),anchorIds:coarse.map(g=>g.id),nominalDiameter:2*state.recipe.radius};
}
export function relaxPatch(snapshot,{activeIds,seconds,lidHeight=snapshot.lidHeight}){
 finite(seconds,'local relaxation duration');finite(lidHeight,'lid height');if(snapshot.phase)throw Error('Patch input must be a completed parent stage');
 const before=clone(snapshot);before.lidHeight=lidHeight;const model=createGranularPreparation(null,before,{activeIds});let local;
 try{model.start('settle',{seconds});model.advance(seconds);if(model.read().phase)throw Error('Local solver returned incomplete relaxation');local=model.snapshot();}finally{model.dispose();}
 const active=new Set(activeIds),result={...before,grains:before.grains.map(row=>active.has(row.id)?local.grains[row.id]:row)};
 return {state:result,localClock:{from:before.time,to:local.time},activeParticleSteps:activeIds.length*Math.ceil(seconds/before.recipe.dt)};
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
export async function runOverlapCase(initial,{configuration,caseDefinition,fineIds,anchorIds,nominalDiameter,onStep=()=>{}}){
 const c=studyConfiguration(configuration);let state=clone(initial),work=0,visits=Array(state.grains.length).fill(0);const originalIngredients=JSON.stringify(initial.ingredients);
 const initialSource=preparationSource(initial),anchorTop=Math.max(...initialSource.triangles.filter(t=>anchorIds.some(id=>t.identity===`grain-${id}`)).flatMap(t=>[t.a[1],t.b[1],t.c[1]]));
 const startTop=initialSource.referenceHeight-.002,requestedEnd=startTop*(1-c.strain),effectiveEnd=Math.max(requestedEnd,anchorTop+1e-5);
 for(let stage=0;stage<c.stages;stage++){
  const lidHeight=startTop+(effectiveEnd-startTop)*(stage+1)/c.stages;state.lidHeight=lidHeight;
  for(let pass=0;pass<c.passes;pass++){
   const offset=caseDefinition.schedule==='shifted'?OFFSETS[pass%OFFSETS.length]:[0,0],reference=clone(state),windows=patchWindows({width:c.width,grid:caseDefinition.grid,overlap:caseDefinition.overlapDiameters*nominalDiameter,offset});
   const assignments=windows.map(window=>({window,activeIds:selectWindow(reference,window,fineIds)}));if(fineIds.some(id=>!assignments.some(a=>a.activeIds.includes(id))))throw Error('Patch layout left fine material unassigned');
   for(const {window,activeIds}of assignments){if(!activeIds.length)continue;const next=relaxPatch(state,{activeIds,seconds:c.localSeconds,lidHeight});state=next.state;work+=next.activeParticleSteps;for(const id of activeIds)visits[id]++;
    const step={stage,pass,window,offset,activeIds,localClock:next.localClock,activeParticleSteps:next.activeParticleSteps,parentStrain:1-lidHeight/startTop};await onStep(step,state);
   }
  }
 }
 if(JSON.stringify(state.ingredients)!==originalIngredients)throw Error('Patch solve changed ingredient identity or mass');for(const id of anchorIds)if(JSON.stringify(state.grains[id])!==JSON.stringify(initial.grains[id]))throw Error('Patch solve moved a prescribed parent stone');
 state.overlapPreparation={case:caseDefinition.id,configuration:c,parentClockHeldAt:initial.time,requestedStrain:c.strain,effectiveStrain:1-effectiveEnd/startTop,activeParticleSteps:work,visits};
 return {state,metrics:packingMetrics(state,anchorIds),activeParticleSteps:work,visits,requestedStrain:c.strain,effectiveStrain:1-effectiveEnd/startTop};
}
export async function loadStudyState(manifest,record,caseId,readBytes){
 if(manifest?.schema!=='kaminos.granular-overlap-study.v1'||manifest.effectiveRoute!=='cannon-es-0.20.0-cpu/convex-grains/frozen-neighbor-patches'||!manifest.source?.commit||manifest.source.dirty)throw Error('Unverified overlap study source or route');
 if(!record?.path||typeof record.sha256!=='string'||(caseId!=='initial'&&!manifest.cases.some(c=>c.id===caseId&&c.status==='completed'&&c.snapshot?.sha256===record.sha256)))throw Error('Comparison result is missing or incomplete');
 const bytes=await readBytes(record.path),hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',value))).map(n=>n.toString(16).padStart(2,'0')).join('');
 if(await hash(bytes)!==record.sha256)throw Error('Comparison artifact hash mismatch');const state=JSON.parse(new TextDecoder().decode(bytes));if(state.phase!==null)throw Error('Comparison contains an incomplete physical stage');
 if(await hash(new TextEncoder().encode(JSON.stringify(state.ingredients)))!==manifest.geometrySha256)throw Error('Comparison changed the ingredient geometry');
 if(state.grains.length!==manifest.configuration.fineCount+manifest.anchorIds.length||state.recipe.width!==manifest.configuration.width)throw Error('Comparison material inventory or extent mismatch');
 if(caseId!=='initial'&&state.overlapPreparation?.case!==caseId)throw Error('Comparison case identity mismatch');preparationSource(state);return state;
}
