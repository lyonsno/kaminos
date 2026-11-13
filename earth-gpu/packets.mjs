import {makeEarthState} from './material.mjs';
// A packet represents a bound aggregate of fines, not an individual clay platelet.
// Its fixed sphere volume and mass survive rearrangement. Bulk pore volume is free.
export function makePacketState({count=32768,packetCount=count*2,packetRadius=.00011,...options}={}){
 if(!Number.isSafeInteger(packetCount)||packetCount<1||!(packetRadius>0&&Number.isFinite(packetRadius)))throw Error('Positive packet count and radius required');
 const grit=makeEarthState({...options,count,clods:0,materialLevels:0}),floats=new Float32Array((count+packetCount)*24);floats.set(grit.floats);
 let gritBound=0;for(let i=0;i<count;i++){const o=i*24;gritBound=Math.max(gritBound,Math.abs(floats[o+16])+floats[o+11],Math.abs(floats[o+17])+floats[o+15]);}
 const {width,depth,massScale}=grit,cell=Math.max(grit.radius*4.2,gritBound+packetRadius),buckets=new Map(),key=(x,y,z)=>`${x},${y},${z}`;
 const rotate=(q,v)=>{const [x,y,z,w]=q,[a,b,c]=v;const t=[2*(y*c-z*b),2*(z*a-x*c),2*(x*b-y*a)];return [a+w*t[0]+y*t[2]-z*t[1],b+w*t[1]+z*t[0]-x*t[2],c+w*t[2]+x*t[1]-y*t[0]];};
 let top=0;
 for(let i=0;i<count;i++){const o=i*24,p=Array.from(floats.subarray(o,o+3)),c=p.map(v=>Math.floor(v/cell)),k=key(...c);if(!buckets.has(k))buckets.set(k,[]);buckets.get(k).push(i);top=Math.max(top,p[1]+Math.max(floats[o+11],floats[o+15]));}
 const spacing=packetRadius*2.08,nx=Math.floor(width/spacing),nz=Math.floor(depth/spacing);if(nx<2||nz<2)throw Error('Packets do not fit in specimen');
 let ny=Math.max(2,Math.ceil(top/spacing));let accepted=[];
 // Permute the whole volume before selecting positions, so packets do not form
 // a hidden bottom slab. If pores cannot hold the requested count, extend height.
 while(accepted.length<packetCount){accepted=[];const total=nx*ny*nz;let stride=Math.max(1,Math.floor(total*.61803398875));const gcd=(a,b)=>b?gcd(b,a%b):a;while(gcd(stride,total)!==1)stride++;
  for(let n=0;n<total&&accepted.length<packetCount;n++){const slot=(n*stride)%total,p=[(slot%nx+.5)*spacing-width/2,(Math.floor(slot/(nx*nz))+.5)*spacing,(Math.floor(slot/nx)%nz+.5)*spacing-depth/2],c=p.map(v=>Math.floor(v/cell));let clear=true;
   for(let z=-1;z<=1&&clear;z++)for(let y=-1;y<=1&&clear;y++)for(let x=-1;x<=1&&clear;x++)for(const i of buckets.get(key(c[0]+x,c[1]+y,c[2]+z))??[]){const o=i*24,q=Array.from(floats.subarray(o+4,o+8));for(let l=0;l<2;l++){const a=rotate(q,[floats[o+16+l],0,0]),r=floats[o+(l?15:11)];if(Math.hypot(...p.map((v,k)=>v-floats[o+k]-a[k]))<r+packetRadius){clear=false;break;}}if(!clear)break;}
   if(clear)accepted.push(p);
  }if(accepted.length<packetCount)ny=Math.max(ny+1,Math.ceil(ny*1.25));
 }
 const volume=4*Math.PI/3*packetRadius**3,mass=1600*volume,inv=massScale/mass;
 for(let i=0;i<packetCount;i++){const shade=((Math.imul(i+1,1664525)+(grit.seed>>>0))>>>0)/4294967296;floats.set([...accepted[i],inv,0,0,0,1,0,0,0,packetRadius,0,0,0,packetRadius,0,0,1,shade,inv/(.4*packetRadius**2),inv/(.4*packetRadius**2),inv/(.4*packetRadius**2),mass],(count+i)*24);}
 return {...grit,floats,packetCount,packetRadius,preparationHeight:ny*spacing,packetDensity:1600,packetVolume:volume,phase:'cohesive aggregate packets'};
}
export function packetGrid(state,reach=.35){
 const n=state.floats.length/24;if(n!==state.grainCount+state.packetCount)throw Error('Every body must have an explicit material phase');
 let gritBound=0,fineRadius=0;for(let i=0;i<n;i++){const o=i*24;if(i<state.grainCount)gritBound=Math.max(gritBound,Math.abs(state.floats[o+16])+state.floats[o+11],Math.abs(state.floats[o+17])+state.floats[o+15]);else fineRadius=Math.max(fineRadius,state.floats[o+11]);}
 const capacity=c=>2**Math.ceil(Math.log2(Math.max(1,c*2)));return {coarseCell:Math.max(2*gritBound,gritBound+fineRadius)+fineRadius*reach,fineCell:fineRadius*(2+reach),coarseBuckets:capacity(state.grainCount),fineBuckets:capacity(state.packetCount),gritBound,fineRadius};
}
