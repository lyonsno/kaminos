import {makeEarthState,packMaterial,materialMasses,tetVolume,metric} from './material.mjs';

// Two fixed local material lattices. The particles and lattice share one matrix
// mass budget; particles carry half, and continuum support nodes carry half.
export function makeRegionState({samplesPerRegion=1536,gritCount=24,seed=71}={}){
 if(!Number.isSafeInteger(samplesPerRegion)||samplesPerRegion<1||!Number.isSafeInteger(gritCount)||gritCount<1)throw Error('Positive material populations required');
 const base=makeEarthState({count:gritCount,width:.026,depth:.016,radius:.00042,clods:0,materialLevels:0,seed});
 const nodes=[],tets=[],nx=3,ny=2,nz=2,nodeId=(g,x,y,z)=>g*36+(z*3+y)*4+x;
 const shape=(g,u,v,w)=>[(g?1:-1)*.00385+u*.00365*(1-.10*w*w-.08*(2*v-1)**2),.00015+v*.0062*(1-.10*u*u-.08*w*w),w*.0042*(1-.08*u*u)];
 for(let g=0;g<2;g++){
  for(let z=0;z<=nz;z++)for(let y=0;y<=ny;y++)for(let x=0;x<=nx;x++){const p=shape(g,x/nx*2-1,y/ny,z/nz*2-1);nodes.push({p,v:[0,0,0],reference:[...p],region:g});}
  for(let z=0;z<nz;z++)for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){
   const corners=[[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]].map(([a,b,c])=>nodeId(g,x+a,y+b,z+c));
   for(const local of [[0,5,1,6],[0,1,2,6],[0,2,3,6],[0,3,7,6],[0,7,4,6],[0,4,5,6]]){const ids=local.map(i=>corners[i]);if(tetVolume(...ids.map(i=>nodes[i].p))<0)[ids[1],ids[2]]=[ids[2],ids[1]];const p=ids.map(i=>nodes[i].p);tets.push({ids,rest:tetVolume(...p),plastic:metric(p),damage:0,group:g,level:0});}
  }
 }
 const material={nodes,tets,density:1600,ties:[],generation:0},mass=materialMasses(material),referenceMatrixMass=mass.reduce((a,b)=>a+b,0);
 const sampleCount=samplesPerRegion*2,grainCount=gritCount+sampleCount,temporary=new Float32Array(grainCount*24);temporary.set(base.floats);
 const packed=packMaterial({...base,floats:temporary,grainCount,material}),floats=packed.floats,attachments=[],connections=[];
 // Move hard inclusions into the matrix. Their physical contact remains the
 // existing two-sphere path, with off-center impulses and reciprocal reactions.
 for(let i=0;i<gritCount;i++){const o=i*24,g=i%2;floats[o]=(g?1:-1)*.00385+Math.sin(i*2.4)*.0018;floats[o+1]=.0012+(i%4)*.0011;floats[o+2]=Math.cos(i*1.9)*.0025;}
 for(let i=0;i<nodes.length;i++){floats[(grainCount+i)*24+3]*=2;}
 let rng=seed>>>0;const rand=()=>((rng=(Math.imul(rng,1664525)+1013904223)>>>0)/4294967296);
 for(let g=0;g<2;g++){
  const localTets=tets.filter(t=>t.group===g),totalVolume=localTets.reduce((v,t)=>v+t.rest,0),m=totalVolume*material.density*.5/samplesPerRegion,r=Math.cbrt(3*m/(4*Math.PI*material.density));
  const cumulative=[];let v=0;for(const t of localTets){v+=t.rest;cumulative.push(v);}
  for(let j=0;j<samplesPerRegion;j++){
   const quantile=(j+.5)/samplesPerRegion*totalVolume,index=cumulative.findIndex(v=>v>=quantile),t=localTets[index],cuts=[rand(),rand(),rand()].sort((a,b)=>a-b),weights=[cuts[0],cuts[1]-cuts[0],cuts[2]-cuts[1],1-cuts[2]],p=[0,1,2].map(k=>t.ids.reduce((a,id,i)=>a+nodes[id].p[k]*weights[i],0)),body=gritCount+g*samplesPerRegion+j,o=body*24;
   const inv=base.massScale/m;
   floats.set([...p,inv,0,0,0,1,0,0,0,r,0,0,0,r,0,0,2,.15+.7*rand(),inv/(.4*r*r),inv/(.4*r*r),inv/(.4*r*r),m],o);
   attachments.push({body,nodeIds:t.ids.map(i=>i+grainCount),weights,region:g});
  }
 }
 // A band of axial and diagonal links supplies initial tensile/shear coupling.
 // Broken connections never regenerate merely because the sides touch again.
 for(let z=0;z<3;z++)for(let y=0;y<3;y++)for(const [dy,dz]of [[0,0],[1,0],[0,1]]){
  if(y+dy>2||z+dz>2)continue;
  const a=nodeId(0,3,y,z)+grainCount,b=nodeId(1,0,y+dy,z+dz)+grainCount,rest=Math.hypot(...[0,1,2].map(k=>floats[a*24+k]-floats[b*24+k]));connections.push({a,b,rest});
 }
 const grips=[];
 for(let z=0;z<3;z++){grips.push({node:nodeId(0,0,0,z)+grainCount,region:0});grips.push({node:nodeId(1,3,1,z)+grainCount,region:1});}
 const linkWords=new Float32Array((attachments.length+connections.length+grips.length)*16),u=new Uint32Array(linkWords.buffer);
 attachments.forEach((a,i)=>{u.set([a.body,...a.nodeIds.slice(0,3)],i*16);u.set([a.nodeIds[3],0,a.region,0],i*16+4);linkWords.set(a.weights,i*16+8);linkWords.set([.42,0,0,0],i*16+12);});
 connections.forEach((c,j)=>{const i=attachments.length+j;u.set([c.a,c.b,0,0,0,1,2,0],i*16);linkWords.set([.75,c.rest,0,0],i*16+12);});
 grips.forEach((a,j)=>{const i=attachments.length+connections.length+j;u.set([a.node,0,0,0,0,2,a.region,0],i*16);linkWords.set(Array.from(floats.subarray(a.node*24,a.node*24+3)),i*16+8);linkWords.set([.8,0,0,0],i*16+12);});
 return {...packed,preparationHeight:.008,floats,grips,mineralCount:gritCount,sampleCount,samplesPerRegion,regionCount:2,referenceMatrixMass,attachments,connections,linkWords};
}
export function regionSummary(state){
 const f=state.floats;let matrixMass=0;for(let i=state.mineralCount;i<state.grainCount;i++)matrixMass+=f[i*24+23];
 const masses=materialMasses(state.material);matrixMass+=masses.reduce((a,b)=>a+b,0)*.5;
 return {matrixMass,regions:state.regionCount,samples:state.sampleCount,connections:state.connections.length};
}
