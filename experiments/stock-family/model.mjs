import {validateRestArc,unwrapRestArc} from './rest-arc.mjs';
export const SOURCE_SHA='0d24383aa503956b927c7e9b0e52fcf6197a1c0928a0a465989b92fc9c458773';
// Source-local Z is longitudinal. Authored bands surround observed feet and
// mouths; these are not automatically inferred semantic segments.
export const DEFAULT_RECIPE={schema:'kaminos.stock-family.v1',source:{
  url:`/api/read?root=generated-meshes&path=${SOURCE_SHA}.glb`,sha256:SOURCE_SHA,
  profile:{min:-.4999839663505554,max:.5002454519271851,xMin:-.1665765643119812,xMax:.16658924520015717,
    locks:[[-.4999839663505554,-.45],[-.43,-.23],[.22,.39],[.45,.5002454519271851]]}},
  variants:[
    {id:'short',label:'Short',length:.72,bend:0,protect:true},
    {id:'long',label:'Long',length:2,bend:0,protect:true},
    {id:'bend',label:'Bend',length:1.5,bend:80,protect:true},
    {id:'reverse',label:'Reverse bend',length:1.5,bend:-110,protect:true},
    {id:'stretch',label:'Long stress',length:4,bend:140,protect:true},
    {id:'tight',label:'Tight stress',length:.6,bend:180,protect:true},
  ]};
export function validateProfile(p){
  if(!p||![p.min,p.max,p.xMin,p.xMax].every(Number.isFinite)||p.min>=p.max||p.xMin>=p.xMax||!Array.isArray(p.locks))throw Error('Invalid source profile');
  let end=p.min;
  for(const b of p.locks){if(!Array.isArray(b)||b.length!==2||!b.every(Number.isFinite)||b[0]<end||b[0]>=b[1]||b[1]>p.max)throw Error('Invalid protected bands');end=b[1];}return p;
}
export function validateParameters(p){
  if(!p||![p.length,p.bend].every(Number.isFinite)||typeof p.protect!=='boolean')throw Error('Parameters must be finite with explicit feature protection');
  if(p.length<=0)throw Error('Positive length required');return {...p};
}
export function validateRecipe(value){
  const r=structuredClone(value);
  if(r?.schema!=='kaminos.stock-family.v1'||!r.source||!/^[a-f0-9]{64}$/.test(r.source.sha256)||typeof r.source.url!=='string'||!r.source.url)throw Error('Invalid stock source recipe');
  validateStockSource(r.source);
  if(r.sources!==undefined){if(!Array.isArray(r.sources))throw Error('Invalid source library');r.sources.forEach(validateStockSource);}
  if(r.referencePose!==undefined){for(const k of ['position','rotation','scale'])if(!Array.isArray(r.referencePose?.[k])||r.referencePose[k].length!==3||!r.referencePose[k].every(Number.isFinite))throw Error('Invalid reference pose');}
  if(!Array.isArray(r.variants)||!r.variants.length)throw Error('Variants required');
  const ids=new Set();for(const v of r.variants){validateParameters(v);if(typeof v.id!=='string'||!v.id||ids.has(v.id)||typeof v.label!=='string')throw Error('Unique named variants required');ids.add(v.id);
    if(v.pose){for(const k of ['position','rotation','scale'])if(!Array.isArray(v.pose[k])||v.pose[k].length!==3||!v.pose[k].every(Number.isFinite))throw Error('Invalid variant pose');}}return r;
}
export function validateStockSource(source){
  if(!source||typeof source.url!=='string'||!source.url||!/^[a-f0-9]{64}$/.test(source.sha256))throw Error('Invalid stock source');
  if(source.fit&&!['x','y','z','-x','-y','-z'].includes(source.fit.axis))throw Error('Invalid source axis');
  if(source.fit?.arc!==undefined)validateRestArc(source.fit.arc);
  validateProfile(source.profile);return structuredClone(source);
}
export const bandPercent=(profile,value)=>String(Number(((value-profile.min)/(profile.max-profile.min)*100).toFixed(4)));
export function bandsFromPercent(profile,rows){
  validateProfile(profile);
  const boundaries=[profile.min,profile.max,...profile.locks.flat()];
  const locks=rows.map((row,index)=>row.map((text,end)=>{
    if(typeof text!=='string'||!text.trim()||!Number.isFinite(Number(text)))throw Error('Enter a finite percent for both band endpoints');
    const value=Number(text),original=profile.locks[index]?.[end];
    // Display precision must not move an unchanged or shared source boundary.
    if(original!==undefined&&Number(bandPercent(profile,original))===value)return original;
    const boundary=boundaries.find(v=>Number(bandPercent(profile,v))===value);
    return boundary??profile.min+value/100*(profile.max-profile.min);
  }));
  return validateProfile({...profile,locks}).locks;
}
export function replaceStockSource(recipe,source){
  const next=validateRecipe(recipe),checked=validateStockSource(source);
  const sources=new Map([next.source,...(next.sources??[]),checked].map(s=>[s.sha256,structuredClone(s)]));
  return validateRecipe({...next,source:checked,sources:[...sources.values()]});
}
// A declared axis, centered unit longitudinal extent, and no inferred semantic
// protection. Authored bands belong to this fitted source, never its predecessor.
export function fitStockSource(positions,normals,axis,arc){
  const rotations={x:([x,y,z])=>[-z,y,x],y:([x,y,z])=>[x,-z,y],z:p=>p,
    '-x':([x,y,z])=>[z,y,-x],'-y':([x,y,z])=>[x,z,-y],'-z':([x,y,z])=>[-x,y,-z]};
  if(!rotations[axis])throw Error('Invalid source axis');
  if(!positions.length||positions.length%3||positions.length!==normals.length||!positions.every(Number.isFinite)||!normals.every(Number.isFinite))throw Error('Finite matching position and normal arrays required');
  const out=new Float32Array(positions.length),n=new Float32Array(normals.length),lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
  for(let i=0;i<out.length;i+=3){const p=rotations[axis](Array.from(positions.subarray(i,i+3)));out.set(p,i);n.set(rotations[axis](Array.from(normals.subarray(i,i+3))),i);p.forEach((v,k)=>{lo[k]=Math.min(lo[k],v);hi[k]=Math.max(hi[k],v);});}
  if(arc!==undefined){
    const unwrapped=unwrapRestArc(out,n,arc),low=[Infinity,Infinity,Infinity],high=[-Infinity,-Infinity,-Infinity];
    for(let i=0;i<out.length;i++){low[i%3]=Math.min(low[i%3],unwrapped.positions[i]);high[i%3]=Math.max(high[i%3],unwrapped.positions[i]);}
    const extent=high[2]-low[2];if(!(extent>0)||!(high[0]>low[0]))throw Error('Source needs nonzero longitudinal and cross-section extent');
    const referencePositions=out.slice(),referenceNormals=n.slice();
    for(let i=0;i<out.length;i++){
      referencePositions[i]=(out[i]-(lo[i%3]+hi[i%3])/2)/extent;
      unwrapped.positions[i]=(unwrapped.positions[i]-(i%3===0?0:(low[i%3]+high[i%3])/2))/extent;
    }
    return {...unwrapped,referencePositions,referenceNormals,profile:{min:-.5,max:.5,xMin:Math.fround(low[0]/extent),xMax:Math.fround(high[0]/extent),locks:[]}};
  }
  const extent=hi[2]-lo[2];if(!(extent>0)||!(hi[0]>lo[0]))throw Error('Source needs nonzero longitudinal and cross-section extent');
  for(let i=0;i<out.length;i++)out[i]=(out[i]-(lo[i%3]+hi[i%3])/2)/extent;
  return {positions:out,normals:n,profile:{min:-.5,max:.5,xMin:Math.fround((lo[0]-hi[0])/2/extent),xMax:Math.fround((hi[0]-lo[0])/2/extent),locks:[]}};
}
export function createStockWarp(profile,parameters){
  const p=validateProfile(profile),v=validateParameters(parameters),angle=v.bend*Math.PI/180;
  if(Math.abs(angle)>=2*Math.PI)throw Error('A closed turn overlaps the open channel endpoints');
  const locks=v.protect?p.locks:[],locked=locks.reduce((s,b)=>s+b[1]-b[0],0),free=p.max-p.min-locked;
  if(free<=0||v.length<=locked)throw Error('Length cannot contain the protected bands and positive free spans');
  const stretch=(v.length-locked)/free,k=angle/(v.length-locked),minFactor=Math.min(1-k*p.xMin,1-k*p.xMax);
  if(minFactor<=0)throw Error('Inner channel would fold: increase length or reduce bend');
  const breaks=[...new Set([p.min,p.max,...locks.flat()])].sort((a,b)=>a-b),segments=[];
  let x=0,z=0,theta=-angle/2;
  for(let i=0;i<breaks.length-1;i++){
    const a=breaks[i],b=breaks[i+1],rigid=locks.some(([lo,hi])=>(a+b)/2>=lo&&(a+b)/2<=hi),rate=rigid?1:stretch,curvature=rigid?0:k;
    const segment={a,b,x,z,theta,rate,curvature,rigid};segments.push(segment);
    const q=at(segment,b);x=q.x;z=q.z;theta=q.theta;
  }
  const midpoint=locate((p.min+p.max)/2);
  function at(s,value){const distance=(value-s.a)*s.rate,turn=s.curvature*distance,half=turn/2;
    const sinc=Math.abs(half)<1e-8?1-half*half/6:Math.sin(half)/half;
    return {x:s.x+distance*sinc*Math.sin(s.theta+half),z:s.z+distance*sinc*Math.cos(s.theta+half),theta:s.theta+turn,segment:s};}
  function locate(value){if(!Number.isFinite(value)||value<p.min-1e-6||value>p.max+1e-6)throw Error('Vertex outside fitted longitudinal profile');const s=segments.find(s=>value<s.b)??segments.at(-1);return at(s,value);}
  function point(a){
    if(a.length!==3||!a.every(Number.isFinite)||a[0]<p.xMin-1e-6||a[0]>p.xMax+1e-6)throw Error('Vertex outside fitted cross-section');
    const q=locate(a[2]),c=Math.cos(q.theta),s=Math.sin(q.theta),axial=q.segment.rate*(1-q.segment.curvature*a[0]);
    return {position:[q.x-midpoint.x+a[0]*c,a[1],q.z-midpoint.z+(p.min+p.max)/2-a[0]*s],axial,theta:q.theta};}
  function normal(n,a){const q=point(a),c=Math.cos(q.theta),s=Math.sin(q.theta),t=n[2]/q.axial;
    const out=[c*n[0]+s*t,n[1],-s*n[0]+c*t],length=Math.hypot(...out);return length?out.map(v=>v/length):out;}
  return {point,normal,metrics:{freeStretch:stretch,protectedLength:locked,
    minAxialStretch:Math.min(locks.length?1:Infinity,stretch*minFactor),
    maxAxialStretch:Math.max(locks.length?1:0,stretch*Math.max(1-k*p.xMin,1-k*p.xMax)),
    maxCurvature:Math.abs(k),protectedBands:locks.map(b=>[...b]),
    limitations:['UVs travel with the surface; texel scale changes in free spans.','Global self-intersection and fluid transport are not tested.']}};
}
export function deformStock(positions,normals,profile,parameters,restAxial){
  if(positions.length%3||positions.length!==normals.length||!positions.every(Number.isFinite)||!normals.every(Number.isFinite))throw Error('Finite matching position and normal arrays required');
  if(restAxial&&(restAxial.length!==positions.length/3||!restAxial.every(v=>Number.isFinite(v)&&v>0)))throw Error('Positive matching rest strain required');
  const warp=createStockWarp(profile,parameters),out=new Float32Array(positions.length),n=new Float32Array(normals.length);
  let min=Infinity,max=-Infinity;
  for(let i=0;i<positions.length;i+=3){const p=Array.from(positions.subarray(i,i+3)),q=warp.point(p);out.set(q.position,i);n.set(warp.normal(Array.from(normals.subarray(i,i+3)),p),i);
    const strain=q.axial/(restAxial?.[i/3]??1);min=Math.min(min,strain);max=Math.max(max,strain);}
  if(restAxial){warp.metrics.minAxialStretch=min;warp.metrics.maxAxialStretch=max;}
  return {positions:out,normals:n,metrics:warp.metrics};
}
