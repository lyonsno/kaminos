import * as CANNON from './node_modules/cannon-es/dist/cannon-es.js';
import {GRIT_VERTICES,GRIT_FACES} from './earth-specimen.mjs';
import {ConvexHull} from './lib/addons/math/ConvexHull.js';
import {Vector3} from './lib/three.core.js';
export const PREPARATION_SCHEMA='kaminos.granular-preparation.v1';
export const INGREDIENTS=[
 {name:'dark angular mineral',color:[.095,.073,.045],roughness:.72,metalness:0},
 {name:'warm mineral grit',color:[.30,.20,.105],roughness:.83,metalness:0},
 {name:'pale mineral grit',color:[.53,.43,.28],roughness:.88,metalness:0},
 {name:'preparation tray',color:[.13,.145,.14],roughness:.7,metalness:0},
];
const sub=(a,b)=>a.map((x,k)=>x-b[k]),dot=(a,b)=>a.reduce((s,v,k)=>s+v*b[k],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const positive=(v,n,zero=false)=>{if(!Number.isFinite(v)||(zero?v<0:v<=0))throw Error(`Invalid ${n}`);return v;};
const vector=(v,n)=>{if(!Array.isArray(v)||v.length!==n||!v.every(Number.isFinite))throw Error('Invalid preparation vector');return v;};
const random=seed=>{let s=seed>>>0;return()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return(s+.5)/2**32;};};
const RECIPE_DEFAULTS={seed:41,count:64,grainDetail:1,width:.025,radius:.0027,spread:.45,angularity:.17,friction:.65,paleFraction:.22,darkFraction:.25,density:2600,pourRate:100,dt:1/240,iterations:16};
export function preparationRecipe(input={}){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Invalid mixture');
 const c={...RECIPE_DEFAULTS,...input};
 for(const k of ['seed','count','iterations','grainDetail'])if(!Number.isSafeInteger(c[k])||c[k]<(['seed','grainDetail'].includes(k)?0:1))throw Error(`Invalid ${k}`);
 for(const k of ['width','radius','density','pourRate','dt'])positive(c[k],k);
 for(const k of ['spread','angularity','friction','paleFraction','darkFraction'])positive(c[k],k,true);
 if(c.spread>=1||c.angularity>.45||c.paleFraction+c.darkFraction>1)throw Error('Invalid mixture fractions or morphology');
 if(c.radius*(1+c.spread)*(1+c.angularity)*2>=c.width)throw Error('Grain does not fit inside container');
 return c;
}
// Conservative transient estimate for object-backed Cannon bodies, hulls,
// worker checkpoints and the visible triangle buffers. This is a planning
// estimate, not a measured maximum particle capacity; requests are never reduced.
export function planPreparation(input,{availableBytes=Infinity}={}){
 const c=preparationRecipe(input),estimatedBytes=c.count*(65536+512*(10*4**c.grainDetail+2));
 if(!Number.isSafeInteger(estimatedBytes)||estimatedBytes>availableBytes)throw Error(`Preparation storage estimate ${estimatedBytes} exceeds available ${availableBytes} bytes; previous specimen retained`);
 return {count:c.count,estimatedBytes,availableBytes};
}
// A small convex hull of a coherently perturbed icosahedron. The exact same
// hull is consumed by Cannon contacts, the preview, and the optical source.
function hull(vertices){
 const points=vertices.map(p=>new Vector3(...p)),indices=new Map(points.map((p,i)=>[p,i])),h=new ConvexHull().setFromPoints(points);
 return h.faces.map(f=>{const face=[];let edge=f.edge;do{face.push(indices.get(edge.head().point));edge=edge.next;}while(edge!==f.edge);return face;});
}
function grainDirections(detail){
 let points=GRIT_VERTICES.map(p=>[...p]),faces=GRIT_FACES.map(f=>[...f]);
 for(let level=0;level<detail;level++){
  const edges=new Map(),mid=(a,b)=>{const key=[Math.min(a,b),Math.max(a,b)].join(':');if(edges.has(key))return edges.get(key);const v=points[a].map((x,k)=>(x+points[b][k])*.5),r=Math.hypot(...v),i=points.length;points.push(v.map(x=>x/r));edges.set(key,i);return i;},next=[];
  for(const[a,b,c]of faces){const ab=mid(a,b),bc=mid(b,c),ca=mid(c,a);next.push([a,ab,ca],[ab,b,bc],[ca,bc,c],[ab,bc,ca]);}faces=next;
 }
 return points;
}
function ingredients(c){
 const rng=random(c.seed),result=[],directions=grainDirections(c.grainDetail);
 for(let i=0;i<c.count;i++){
  const r=c.radius*(1+c.spread*(2*rng()-1)),phases=[rng()*6.28,rng()*6.28,rng()*6.28],axes=[.75+.5*rng(),.65+.5*rng(),.75+.5*rng()];
  const vertices=directions.map(p=>{const noise=(Math.sin(2.7*p[0]+1.3*p[1]+phases[0])+Math.sin(2.1*p[1]-p[2]+phases[1])+Math.cos(1.8*p[2]+p[0]+phases[2]))/3;return p.map((v,k)=>v*r*axes[k]*(1+c.angularity*noise));});
  const faces=hull(vertices),volume=faces.reduce((s,[a,b,d])=>s+dot(vertices[a],cross(vertices[b],vertices[d]))/6,0),q=new CANNON.Quaternion();q.setFromEuler(rng()*6.28,rng()*6.28,rng()*6.28);
  const f=rng(),materialIndex=f<c.darkFraction?0:f<c.darkFraction+c.paleFraction?2:1;
  result.push({id:i,vertices,faces,volume,mass:volume*c.density,radius:Math.max(...vertices.map(p=>Math.hypot(...p))),quaternion:q.toArray(),materialIndex});
 }
 return result;
}
export function preparationCollisionHull(g){
 const shape=new CANNON.ConvexPolyhedron({vertices:g.vertices.map(p=>new CANNON.Vec3(...p)),faces:g.faces.map(f=>[...f])}),edges=new Map();
 // SAT uses directions, so the two orientations of one topological edge
 // generate the same cross-product axes. Keep every edge, once; no hull change.
 for(const face of g.faces)for(let j=0;j<face.length;j++){const a=face[j],b=face[(j+1)%face.length],key=[Math.min(a,b),Math.max(a,b)].join(':');if(!edges.has(key)){const edge=shape.vertices[a].vsub(shape.vertices[b]);edge.normalize();edges.set(key,edge);}}
 shape.uniqueEdges=[...edges.values()];return shape;
}
function validateIngredients(all,c){
 if(!Array.isArray(all)||all.length!==c.count)throw Error('Incomplete ingredient inventory');
 for(const [i,g]of all.entries()){
  if(!g||g.id!==i||!Array.isArray(g.vertices)||g.vertices.length<4||!Array.isArray(g.faces)||g.faces.length<4)throw Error('Invalid ingredient geometry');
  g.vertices.forEach(p=>vector(p,3));vector(g.quaternion,4);positive(g.mass,'grain mass');positive(g.volume,'grain volume');positive(g.radius,'grain radius');if(Math.abs(Math.hypot(...g.quaternion)-1)>1e-5||g.vertices.some(p=>Math.hypot(...p)>g.radius+1e-12))throw Error('Invalid ingredient bound or orientation');if(2.1*g.radius>=c.width)throw Error('Generated grain does not fit inside container');
  if(!Number.isSafeInteger(g.materialIndex)||g.materialIndex<0||g.materialIndex>2||g.faces.some(f=>!Array.isArray(f)||f.length!==3||f.some(k=>!Number.isSafeInteger(k)||k<0||k>=g.vertices.length)))throw Error('Invalid grain faces or material');
 }
}
function validatePhysicalState({time,lidHeight,containerX,phase,history,grains},all){
 positive(time,'time',true);positive(lidHeight,'lid height');if(!Number.isFinite(containerX))throw Error('Invalid container position');
 if(!Array.isArray(history)||history.some((h,i)=>!h||typeof h!=='object'||!Number.isFinite(h.started)||(h.completed!==undefined&&!Number.isFinite(h.completed))||(h.completed===undefined&&(!phase||i!==history.length-1))))throw Error('Invalid preparation history');if(phase){if(!history.length||history.at(-1)?.kind!==phase.kind||history.at(-1)?.completed!==undefined)throw Error('Invalid active preparation history');if(!['pour','settle','shake','compress','unload'].includes(phase.kind))throw Error('Invalid saved phase');positive(phase.seconds,'phase duration');positive(phase.elapsed,'phase elapsed',true);if(phase.pourTarget!==undefined&&(phase.kind!=='pour'||!Number.isSafeInteger(phase.pourTarget)||phase.pourTarget<=phase.initialCount||phase.pourTarget>all.length))throw Error('Invalid saved pour target');if(phase.elapsed>=phase.seconds||!Number.isFinite(phase.from)||!Number.isFinite(phase.target)||!Number.isFinite(phase.amplitude)||!Number.isFinite(phase.frequency)||!Number.isSafeInteger(phase.initialCount)||phase.initialCount<0||phase.initialCount>all.length)throw Error('Invalid saved phase');}
 if(!Array.isArray(grains)||grains.length>all.length)throw Error('Invalid deposited inventory');for(const [i,row]of grains.entries()){if(!row||row.id!==i)throw Error('Invalid deposited identity');vector(row.position,3);vector(row.velocity,3);vector(row.angularVelocity,3);vector(row.quaternion,4);if(Math.abs(Math.hypot(...row.quaternion)-1)>1e-5)throw Error('Invalid grain orientation');}
}
function checkpointRecipe(saved){
 if(saved?.schema!==PREPARATION_SCHEMA)throw Error('Invalid preparation checkpoint schema');
 if(!saved.recipe||Object.keys(RECIPE_DEFAULTS).some(k=>!Object.hasOwn(saved.recipe,k)))throw Error('Missing required checkpoint recipe field');
 if(!Object.hasOwn(saved,'phase')||(saved.phase!==null&&(!saved.phase||typeof saved.phase!=='object'||Array.isArray(saved.phase))))throw Error('Missing or invalid checkpoint phase');
 return preparationRecipe(saved.recipe);
}
export function createGranularPreparation(input={},saved=null,{activeIds=null}={}){
 const c=saved===null?preparationRecipe(input):checkpointRecipe(saved);planPreparation(c,{availableBytes:globalThis.performance?.memory?performance.memory.jsHeapSizeLimit-performance.memory.usedJSHeapSize:Infinity});const all=saved?structuredClone(saved.ingredients):ingredients(c);
 validateIngredients(all,c);
 if(activeIds!==null&&(!Array.isArray(activeIds)||new Set(activeIds).size!==activeIds.length||activeIds.some(id=>!Number.isSafeInteger(id)||id<0||id>=all.length)))throw Error('Invalid active grain identities');
 const active=activeIds===null?null:new Set(activeIds);
 const w=new CANNON.World({gravity:new CANNON.Vec3(0,-9.81,0)});w.broadphase=new CANNON.SAPBroadphase(w);w.broadphase.useBoundingBoxes=true;w.solver.iterations=c.iterations;w.solver.tolerance=1e-9;w.allowSleep=true;
 w.defaultContactMaterial.friction=c.friction;w.defaultContactMaterial.restitution=.02;w.defaultContactMaterial.contactEquationStiffness=1e7;
 let time=saved?.time??0,lidHeight=saved?.lidHeight??c.width*2,containerX=saved?.containerX??0,phase=saved?.phase?structuredClone(saved.phase):null,history=structuredClone(saved?.history??[]),disposed=false;
 validatePhysicalState(saved??{time,lidHeight,containerX,phase,history,grains:[]},all);
 const walls=[];
 function plane(position,normal){const b=new CANNON.Body({type:CANNON.Body.KINEMATIC,mass:0,shape:new CANNON.Plane()});b.position.set(...position);b.quaternion.setFromVectors(new CANNON.Vec3(0,0,1),new CANNON.Vec3(...normal));w.addBody(b);return b;}
 walls.push({body:plane([containerX,0,0],[0,1,0]),x:0});
 for(const [axis,sign]of [[0,-1],[0,1],[2,-1],[2,1]]){const x=axis===0?sign*c.width/2:0;walls.push({body:plane([x+containerX,0,axis===2?sign*c.width/2:0],[axis===0?-sign:0,0,axis===2?-sign:0]),x});}
 const lid=plane([containerX,lidHeight,0],[0,-1,0]);lid.collisionResponse=phase?.kind!=='pour';const grains=[];
 const add=(g,row)=>{
  const shape=preparationCollisionHull(g);
  const b=new CANNON.Body({mass:active&&!active.has(g.id)?0:g.mass,shape,linearDamping:.08,angularDamping:.12,allowSleep:true,sleepSpeedLimit:.002,sleepTimeLimit:.2});
  if(row){vector(row.position,3);vector(row.velocity,3);vector(row.angularVelocity,3);vector(row.quaternion,4);if(Math.abs(Math.hypot(...row.quaternion)-1)>1e-5)throw Error('Invalid grain orientation');b.position.set(...row.position);b.velocity.set(...row.velocity);b.angularVelocity.set(...row.angularVelocity);b.quaternion.set(...row.quaternion);}else{
   const rng=random(c.seed^Math.imul(g.id+1,0x9e3779b9));let y=c.width*1.1,x,z;
   // Rejection placement prevents interpenetrating births. Raising the inlet
   // when occupied keeps all grains; nothing is discarded or downsampled.
   for(;;){let found=false;for(let n=0;n<32;n++){x=containerX+(rng()-.5)*(c.width-2.1*g.radius);z=(rng()-.5)*(c.width-2.1*g.radius);if(grains.every(p=>Math.hypot(p.body.position.x-x,p.body.position.y-y,p.body.position.z-z)>p.ingredient.radius+g.radius)){found=true;break;}}if(found)break;y+=2*g.radius;}
   lidHeight=Math.max(lidHeight,y+g.radius+c.radius);lid.position.y=lidHeight;b.position.set(x,y,z);b.quaternion.set(...g.quaternion);
  }
  if(active&&!active.has(g.id)){b.velocity.set(0,0,0);b.angularVelocity.set(0,0,0);}
  w.addBody(b);grains.push({ingredient:g,body:b});
 };
 if(saved){if(!Array.isArray(saved.grains)||saved.grains.length>all.length)throw Error('Invalid deposited inventory');for(const [i,row]of saved.grains.entries()){if(row.id!==i)throw Error('Invalid deposited identity');add(all[i],row);}}
 const top=()=>grains.reduce((h,g)=>{const pose={position:g.body.position.toArray(),quaternion:g.body.quaternion.toArray()};return g.ingredient.vertices.reduce((height,p)=>Math.max(height,transform(p,pose)[1]),h);},0);
 const read=()=>({schema:PREPARATION_SCHEMA,recipe:{...c},deposited:grains.length,total:all.length,time,lidHeight,containerX,top:top(),mass:grains.reduce((s,g)=>s+g.ingredient.mass,0),phase:phase?structuredClone(phase):null,backend:'cannon-es-0.20.0-cpu',boundary:'bounded prepared granular packing; cohesive matrix and weathering not yet represented'});
 const row=g=>({id:g.ingredient.id,position:g.body.position.toArray(),quaternion:g.body.quaternion.toArray(),velocity:g.body.velocity.toArray(),angularVelocity:g.body.angularVelocity.toArray()});
 const snapshot=()=>({schema:PREPARATION_SCHEMA,recipe:{...c},ingredients:structuredClone(all),grains:grains.map(row),time,lidHeight,containerX,phase:phase?structuredClone(phase):null,history:structuredClone(history)});
 function start(kind,options={}){
  if(disposed)throw Error('Preparation disposed');if(phase)throw Error('Preparation already running');
  if(!['pour','settle','shake','compress','unload'].includes(kind))throw Error('Unknown preparation operation');
  const count=options.count;if(kind==='pour'&&count!==undefined&&(!Number.isSafeInteger(count)||count<1))throw Error('Invalid pour count');
  const pourTarget=kind==='pour'?(count===undefined?all.length:grains.length+count):undefined;if(kind==='pour'&&(!Number.isSafeInteger(pourTarget)||pourTarget<=grains.length))throw Error('All ingredients have been poured or invalid pour count');
  const seconds=options.seconds??(kind==='pour'?(pourTarget-grains.length)/c.pourRate:kind==='settle'?.8:kind==='unload'?.4:1);positive(seconds,'duration');
  const strain=options.strain??.25,amplitude=options.amplitude??c.width*.025,frequency=options.frequency??9;
  if(kind==='compress'&&(!Number.isFinite(strain)||strain<=0||strain>=1))throw Error('Compression strain must be between zero and one');
  if(kind==='shake'){positive(amplitude,'shake amplitude',true);positive(frequency,'shake frequency');}
  if(kind!=='pour'&&!grains.length)throw Error('Pour the mixture first');
  const target=kind==='compress'?Math.max(c.radius,top()*(1-strain)):kind==='unload'?Math.max(c.width*1.5,top()+c.width*.3):lidHeight;
  if(kind==='pour'&&pourTarget>all.length){const next=preparationRecipe({...c,count:pourTarget});planPreparation(next,{availableBytes:globalThis.performance?.memory?performance.memory.jsHeapSizeLimit-performance.memory.usedJSHeapSize:Infinity});const additions=ingredients(next).slice(all.length),inventory=[...all,...additions];validateIngredients(inventory,next);all.push(...additions);c.count=next.count;}
  lid.collisionResponse=kind!=='pour';phase={kind,elapsed:0,seconds,from:lidHeight,target,strain,amplitude,frequency,initialCount:grains.length,...(kind==='pour'?{pourTarget}:{})};
  for(const g of grains)g.body.wakeUp();history.push({kind,options:{seconds,strain,amplitude,frequency,...(kind==='pour'?{count:pourTarget-grains.length}:{})},started:time});return read();
 }
 function advance(seconds){
  if(disposed)throw Error('Preparation disposed');positive(seconds,'duration');
  const n=Math.ceil(seconds/c.dt),dt=seconds/n;
  for(let i=0;i<n&&phase;i++){
   const next=Math.min(phase.seconds,phase.elapsed+dt),step=next-phase.elapsed;
   if(phase.kind==='pour'){
    const targetCount=phase.pourTarget??all.length,due=Math.min(targetCount,phase.initialCount+Math.ceil((targetCount-phase.initialCount)*next/phase.seconds));
    while(grains.length<due)add(all[grains.length]);
   }
   const t=next/phase.seconds,eased=t*t*(3-2*t),nextLid=['compress','unload'].includes(phase.kind)?phase.from+(phase.target-phase.from)*eased:lidHeight;
   const nextX=phase.kind==='shake'?phase.amplitude*Math.sin(2*Math.PI*phase.frequency*next)*Math.sin(Math.PI*t)**2:0;
   for(const wall of walls){wall.body.position.x=wall.x+containerX;wall.body.velocity.x=(nextX-containerX)/step;wall.body.aabbNeedsUpdate=true;}
   lid.position.set(containerX,lidHeight,0);lid.velocity.set((nextX-containerX)/step,(nextLid-lidHeight)/step,0);lid.aabbNeedsUpdate=true;
   w.step(step);containerX=nextX;lidHeight=nextLid;time+=step;phase.elapsed=next;
   if(next>=phase.seconds-1e-12){history.at(-1).completed=time;phase=null;lid.collisionResponse=true;containerX=0;for(const wall of walls){wall.body.position.x=wall.x;wall.body.velocity.set(0,0,0);}lid.position.set(0,lidHeight,0);lid.velocity.set(0,0,0);}
  }
  return read();
 }
 return {read,snapshot,start,advance,dispose(){disposed=true;for(const b of [...w.bodies])w.removeBody(b);}};
}
function transform(p,row){const q=row.quaternion,v=cross(q.slice(0,3),p),vv=cross(q.slice(0,3),v);return p.map((x,k)=>x+2*q[3]*v[k]+2*vv[k]+row.position[k]);}
export function preparationSource(snapshot,{container=false}={}){
 if(snapshot?.schema!==PREPARATION_SCHEMA)throw Error('Explicit preparation snapshot required');
 if(!snapshot.recipe||!Array.isArray(snapshot.ingredients)||!Array.isArray(snapshot.grains))throw Error('Incomplete preparation snapshot inventory');if(!snapshot.grains.length&&!container)throw Error('No poured grains in material source');
 const c=checkpointRecipe(snapshot);validateIngredients(snapshot.ingredients,c);validatePhysicalState(snapshot,snapshot.ingredients);
 const triangles=[],all=snapshot.ingredients;
 const rows=snapshot.grains;
 for(const row of rows){const g=all[row.id],v=g.vertices.map(p=>transform(p,row));for(const [a,b,c]of g.faces)triangles.push({a:v[a],b:v[b],c:v[c],materialIndex:g.materialIndex,kind:'prepared-grain',identity:`grain-${g.id}`});}
 const half=c.width/2;
 if(container){const x=snapshot.containerX,a=[x-half,0,-half],b=[x+half,0,-half],c=[x+half,0,half],d=[x-half,0,half];triangles.push({a,b:c,c:b,materialIndex:3,kind:'tray'},{a,b:d,c,materialIndex:3,kind:'tray'});}
 return {schema:'kaminos.prepared-granular-source.v1',config:{kind:'granular-preparation',tileSize:c.width,snapshot:structuredClone(snapshot),container},triangles,materials:structuredClone(INGREDIENTS),referenceHeight:triangles.reduce((h,t)=>Math.max(h,t.a[1],t.b[1],t.c[1]),0)+.002,samplingPlaneHeight:0,boundary:'Actual bounded grain geometry; no continuous matrix, periodic tile or cohesive soil claim',unit:'metres'};
}
