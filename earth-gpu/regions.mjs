import {makeEarthState,packMaterial,materialMasses,tetVolume,metric,retainMaterial} from './material.mjs';

// Two fixed local material lattices. The particles and lattice share one matrix
// mass budget; particles carry half, and continuum support nodes carry half.
export function makeRegionState({samplesPerRegion=1536,gritCount=24,seed=71,slabSize=null,notch=true}={}){
 if(!Number.isSafeInteger(samplesPerRegion)||samplesPerRegion<1||!Number.isSafeInteger(gritCount)||gritCount<1)throw Error('Positive material populations required');
 if(slabSize!==null&&(!Number.isSafeInteger(slabSize)||slabSize<2))throw Error('A slab requires at least two patches per side');
 const regionCount=slabSize===null?2:slabSize**2;
 const pitchX=.0075,pitchZ=.0086,halfX=.00365,halfZ=.0042;
 const center=g=>slabSize===null?[(g?1:-1)*.00385,0]:[
  (g%slabSize-(slabSize-1)/2)*pitchX,(Math.floor(g/slabSize)-(slabSize-1)/2)*pitchZ];
 const base=makeEarthState({count:gritCount,width:slabSize===null?.026:slabSize*pitchX+.012,
  depth:slabSize===null?.016:slabSize*pitchZ+.012,radius:.00042,clods:0,materialLevels:0,seed});
 const nodes=[],tets=[],nx=3,ny=2,nz=2,nodeId=(g,x,y,z)=>g*36+(z*3+y)*4+x;
 const shape=(g,u,v,w)=>{
  if(slabSize!==null){
   const [x,z]=center(g);
   return [x+u*halfX,.00015+v*(.0062+.00025*Math.sin(130*(x+u*halfX)+80*(z+w*halfZ))),z+w*halfZ];
  }
  return [(g?1:-1)*.00385+u*.00365*(1-.10*w*w-.08*(2*v-1)**2),.00015+v*.0062*(1-.10*u*u-.08*w*w),w*.0042*(1-.08*u*u)];
 };
 for(let g=0;g<regionCount;g++){
  for(let z=0;z<=nz;z++)for(let y=0;y<=ny;y++)for(let x=0;x<=nx;x++){const p=shape(g,x/nx*2-1,y/ny,z/nz*2-1);nodes.push({p,v:[0,0,0],reference:[...p],region:g});}
  for(let z=0;z<nz;z++)for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){
   const corners=[[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]].map(([a,b,c])=>nodeId(g,x+a,y+b,z+c));
   for(const local of [[0,5,1,6],[0,1,2,6],[0,2,3,6],[0,3,7,6],[0,7,4,6],[0,4,5,6]]){const ids=local.map(i=>corners[i]);if(tetVolume(...ids.map(i=>nodes[i].p))<0)[ids[1],ids[2]]=[ids[2],ids[1]];const p=ids.map(i=>nodes[i].p);tets.push({ids,rest:tetVolume(...p),plastic:metric(p),damage:0,group:g,level:0});}
  }
 }
 const material={nodes,tets,density:1600,ties:[],generation:0},mass=materialMasses(material),referenceMatrixMass=mass.reduce((a,b)=>a+b,0);
 const sampleCount=samplesPerRegion*regionCount,grainCount=gritCount+sampleCount,temporary=new Float32Array(grainCount*24);temporary.set(base.floats);
 const packed=packMaterial({...base,floats:temporary,grainCount,material}),floats=packed.floats,attachments=[],connections=[];
 // Move hard inclusions into the matrix. Their physical contact remains the
 // existing two-sphere path, with off-center impulses and reciprocal reactions.
 for(let i=0;i<gritCount;i++){const o=i*24,[x,z]=center(i%regionCount);floats[o]=x+Math.sin(i*2.4)*.0018;floats[o+1]=.0012+(i%4)*.0011;floats[o+2]=z+Math.cos(i*1.9)*.0025;}
 for(let i=0;i<nodes.length;i++){floats[(grainCount+i)*24+3]*=2;}
 let rng=seed>>>0;const rand=()=>((rng=(Math.imul(rng,1664525)+1013904223)>>>0)/4294967296);
 for(let g=0;g<regionCount;g++){
  const localTets=tets.slice(g*72,(g+1)*72),totalVolume=localTets.reduce((v,t)=>v+t.rest,0),m=totalVolume*material.density*.5/samplesPerRegion,r=Math.cbrt(3*m/(4*Math.PI*material.density));
  const cumulative=[];let v=0;for(const t of localTets){v+=t.rest;cumulative.push(v);}
  for(let j=0;j<samplesPerRegion;j++){
   const quantile=(j+.5)/samplesPerRegion*totalVolume,index=cumulative.findIndex(v=>v>=quantile),t=localTets[index],cuts=[rand(),rand(),rand()].sort((a,b)=>a-b),weights=[cuts[0],cuts[1]-cuts[0],cuts[2]-cuts[1],1-cuts[2]],p=[0,1,2].map(k=>t.ids.reduce((a,id,i)=>a+nodes[id].p[k]*weights[i],0)),body=gritCount+g*samplesPerRegion+j,o=body*24;
   const inv=base.massScale/m;
   floats.set([...p,inv,0,0,0,1,0,0,0,r,0,0,0,r,0,0,2,.15+.7*rand(),inv/(.4*r*r),inv/(.4*r*r),inv/(.4*r*r),m],o);
   attachments.push({body,nodeIds:t.ids.map(i=>i+grainCount),weights,region:g});
  }
 }
 const bands=[],faceBands=new Int32Array(packed.faceCount).fill(-1),grips=[];
 const bandBySide=new Map();
 function connect(a,b,axis){
  const first=connections.length,span=axis==='x'?nz:nx,index=bands.length;
  const address=(g,y,t,forward)=>grainCount+(axis==='x'
   ?nodeId(g,forward?nx:0,y,t):nodeId(g,t,y,forward?nz:0));
  const pattern=slabSize===null?[[0,0],[1,0],[0,1]]:[[0,0]];
  for(let t=0;t<=span;t++)for(let y=0;y<=ny;y++)for(const [dy,dt] of pattern){
   if(y+dy>ny||t+dt>span)continue;
   const i=address(a,y,t,true),j=address(b,y+dy,t+dt,false);
   const rest=Math.hypot(...[0,1,2].map(k=>floats[i*24+k]-floats[j*24+k]));
   connections.push({a:i,b:j,rest});
  }
  bands.push({a,b,first,count:connections.length-first});
  bandBySide.set(a+axis+'+',index);
  bandBySide.set(b+axis+'-',index);
 }
 if(slabSize===null){
  connect(0,1,'x');
  for(let z=0;z<=nz;z++){
   grips.push({node:nodeId(0,0,0,z)+grainCount,region:0});
   grips.push({node:nodeId(1,nx,1,z)+grainCount,region:1});
  }
 }else{
  for(let z=0;z<slabSize;z++)for(let x=0;x<slabSize;x++){
   const g=z*slabSize+x;
   if(x+1<slabSize&&!(notch&&z===0&&x===slabSize-2))connect(g,g+1,'x');
   if(z+1<slabSize)connect(g,g+slabSize,'z');
   if(x===0)for(let k=0;k<=nz;k++)grips.push({node:nodeId(g,0,0,k)+grainCount,region:0});
   if(x===slabSize-1&&z===0)for(let k=0;k<=nz;k++)grips.push({node:nodeId(g,nx,1,k)+grainCount,region:1});
  }
  for(let f=0;f<packed.faceCount;f++){
   const local=Array.from(packed.triangles.subarray(f*4,f*4+3),i=>i-grainCount);
   const region=nodes[local[0]].region,coords=local.map(i=>i%36);
   const side=[['x-',i=>i%4===0],['x+',i=>i%4===nx],['z-',i=>i<12],['z+',i=>i>=24]]
    .find(([,onSide])=>coords.every(onSide));
   if(side)faceBands[f]=bandBySide.get(region+side[0])??-1;
  }
 }
 const linkWords=new Float32Array((attachments.length+connections.length+grips.length)*16),u=new Uint32Array(linkWords.buffer);
 attachments.forEach((a,i)=>{u.set([a.body,...a.nodeIds.slice(0,3)],i*16);u.set([a.nodeIds[3],0,a.region,0],i*16+4);linkWords.set(a.weights,i*16+8);linkWords.set([.42,0,0,0],i*16+12);});
 connections.forEach((c,j)=>{const i=attachments.length+j;u.set([c.a,c.b,0,0,0,1,2,0],i*16);linkWords.set([.75,c.rest,0,0],i*16+12);});
 grips.forEach((a,j)=>{const i=attachments.length+connections.length+j;u.set([a.node,0,0,0,0,2,a.region,0],i*16);linkWords.set(Array.from(floats.subarray(a.node*24,a.node*24+3)),i*16+8);linkWords.set([.8,0,0,0],i*16+12);});
 return {...packed,preparationHeight:.008,floats,grips,mineralCount:gritCount,sampleCount,samplesPerRegion,regionCount,referenceMatrixMass,attachments,connections,linkWords,slabSize,notch,bands,faceBands,patchPitch:[pitchX,pitchZ]};
}
export function regionSummary(state){
 const f=state.floats;let matrixMass=0;for(let i=state.mineralCount;i<state.grainCount;i++)matrixMass+=f[i*24+23];
 const masses=materialMasses(state.material);matrixMass+=masses.reduce((a,b)=>a+b,0)*.5;
 return {matrixMass,regions:state.regionCount,samples:state.sampleCount,connections:state.connections.length};
}

export function retainRegionState(state,floats,plastic,links){return {...retainMaterial(state,floats,plastic),tets:plastic.slice(),linkWords:links.slice()};}
