// Authored geometric approximation of columnar stone; no cooling or fracture simulation.
export const causewayDefaults=Object.freeze({width:.12,depth:.12*Math.sqrt(3)/2,seed:73,relief:.003,shoulder:.09,dish:.12,grain:.018,sheetGap:.00025});
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
function randomGenerator(seed){let s=seed>>>0;return()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return(s+.5)/4294967296;};}
const area=p=>Math.abs(p.reduce((s,a,i)=>{const b=p[(i+1)%p.length];return s+a[0]*b[1]-a[1]*b[0];},0))/2;
function clip(poly,nx,nz,b){const out=[];for(let i=0;i<poly.length;i++){const a=poly[i],c=poly[(i+1)%poly.length],da=b-nx*a[0]-nz*a[1],dc=b-nx*c[0]-nz*c[1];if(da>=-1e-12)out.push(a);if((da>=0)!==(dc>=0)){const t=da/(da-dc);out.push([a[0]+t*(c[0]-a[0]),a[1]+t*(c[1]-a[1])]);}}return out;}
// A fixed local mineral field controls small facets and their material palette.
// Smooth broad components plus small cells avoid a separate painted tracking grid.
function mineral(x,z,id){const q=Math.sin(x*13931.37+z*7919.21+id*93.7)*43758.5453;return q-Math.floor(q);}
export function createCausewaySource(options={}){
 const config={...causewayDefaults,...options};
 for(const [k,v]of Object.entries(config))if(!Number.isFinite(v)||v<0||(['width','depth'].includes(k)&&v===0))throw Error('Invalid causeway '+k);
 if(!Number.isSafeInteger(config.seed)||config.shoulder>.3||config.dish>.5||config.grain>.2)throw Error('Invalid causeway shape');
 const rng=randomGenerator(config.seed),seeds=[];
 for(let row=0;row<4;row++)for(let col=0;col<4;col++)seeds.push({id:row*4+col,x:(col+.5+(row%2)*.5+(rng()-.5)*.65)*config.width/4-config.width/2,z:(row+.5+(rng()-.5)*.65)*config.depth/4-config.depth/2,phase:rng()*Math.PI*2,tone:rng(),level:rng()});
 const ghosts=[];for(let tz=-1;tz<=1;tz++)for(let tx=-1;tx<=1;tx++)for(const s of seeds)ghosts.push({...s,x:s.x+tx*config.width,z:s.z+tz*config.depth});
 const materials=[];for(let i=0;i<32;i++){const v=.16+.18*i/31;materials.push({name:'basalt mineral '+i,color:[v*.92,v*.98,v*1.05],roughness:.72+.18*(1-i/31),metalness:0});}
 const columns=seeds.map(s=>{
  let poly=[[s.x-config.width,s.z-config.depth],[s.x+config.width,s.z-config.depth],[s.x+config.width,s.z+config.depth],[s.x-config.width,s.z+config.depth]];
  for(const n of ghosts){const dx=n.x-s.x,dz=n.z-s.z;if(Math.hypot(dx,dz)<1e-10)continue;poly=clip(poly,dx,dz,(n.x*n.x+n.z*n.z-s.x*s.x-s.z*s.z)/2);}
  // Polygonal shoulders retain long faces. Small clipped corners avoid a circular pebble outline.
  const rim=[];for(let i=0;i<poly.length;i++){const p=poly[(i+poly.length-1)%poly.length],v=poly[i],n=poly[(i+1)%poly.length];for(const neighbor of [p,n])rim.push([v[0]+.12*(neighbor[0]-v[0]),v[1]+.12*(neighbor[1]-v[1])]);}
  const boundary=[];for(let i=0;i<rim.length;i++){const a=rim[i],b=rim[(i+1)%rim.length];for(let j=0;j<3;j++)boundary.push([a[0]+(b[0]-a[0])*j/3,a[1]+(b[1]-a[1])*j/3]);}
  const topHeight=-config.sheetGap-config.relief*(.12+.62*s.level+.1*Math.sin(s.x*35+s.z*24));
  const top=boundary.map(p=>{const a=Math.atan2(p[1]-s.z,p[0]-s.x),inset=config.shoulder*(1+.13*Math.sin(3*a+s.phase));return[s.x+(p[0]-s.x)*(1-inset),s.z+(p[1]-s.z)*(1-inset)];});
  return {...s,cell:poly,cellArea:area(poly),sides:poly.length,boundary,topHeight,topArea:area(top)};
 });
 const triangles=[];
 const add=(a,b,c,materialIndex,column,region,tile)=>{const ab=b.map((v,i)=>v-a[i]),ac=c.map((v,i)=>v-a[i]);const normal=[ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]];if(Math.hypot(...normal)<1e-16)return;triangles.push({a,b,c,materialIndex,column,region,tile});};
 for(let tz=-1;tz<=1;tz++)for(let tx=-1;tx<=1;tx++){
  const tile=[tx,tz],translate=p=>[p[0]+tx*config.width,p[1],p[2]+tz*config.depth];
  for(const c of columns){
   const count=c.boundary.length;
   const topHeight=(x,z,radial)=>{
    const grain=config.relief*config.grain*(mineral(x,z,c.id)-.5)*clamp((1-radial)/.15);
    const dish=config.relief*config.dish*(1-radial*radial)*(.65+.35*Math.sin(c.phase));
    return config.relief===0?-config.sheetGap:c.topHeight-dish+grain;
   };
   const vertex=(radial,index,drop=0)=>{
    const a=c.boundary[index%count],dx=a[0]-c.x,dz=a[1]-c.z,angle=Math.atan2(dz,dx);
    const retreat=config.shoulder*(1+.13*Math.sin(3*angle+c.phase));
    const inset=drop===0?retreat:retreat*(.3+.7*Math.exp(-drop*12));
    const scale=Math.min(.985,radial*(1-inset))*(drop>.3?1-.009*(1+Math.sin(drop*11+c.phase)):1),x=c.x+dx*scale,z=c.z+dz*scale;
    const y=topHeight(x,z,radial)-config.relief*drop;
    return [x,y,z];
   };
   const rim=Array.from({length:count},(_,i)=>vertex(1,i));
   const tone=(a,b,c2)=>{const x=(a[0]+b[0]+c2[0])/3,z=(a[2]+b[2]+c2[2])/3;return Math.round(clamp(.25+.45*c.tone+.3*mineral(x,z,c.id))*31);};
   const push=(a,b,d,region)=>add(translate(a),translate(b),translate(d),tone(a,b,d),c.id,region,tile);
   const edges=rim.map((a,i)=>{const b=rim[(i+1)%count],nx=b[2]-a[2],nz=a[0]-b[0];return {nx,nz,b:nx*a[0]+nz*a[2],center:nx*c.x+nz*c.z};});
   const topVertex=p=>{const radial=clamp(Math.max(...edges.map(e=>(e.nx*p[0]+e.nz*p[1]-e.center)/(e.b-e.center))));return[p[0],topHeight(p[0],p[1],radial),p[1]];};
   const pitch=config.width/56,point=(i,j)=>[(i+.18*(mineral(i,j,103)-.5))*pitch,(j+.18*(mineral(i,j,211)-.5))*pitch];
   const loX=Math.floor(Math.min(...rim.map(p=>p[0]))/pitch)-1,hiX=Math.ceil(Math.max(...rim.map(p=>p[0]))/pitch)+1,loZ=Math.floor(Math.min(...rim.map(p=>p[2]))/pitch)-1,hiZ=Math.ceil(Math.max(...rim.map(p=>p[2]))/pitch)+1;
   for(let j=loZ;j<hiZ;j++)for(let i=loX;i<hiX;i++)for(const initial of [[point(i,j),point(i+1,j),point(i+1,j+1)],[point(i,j),point(i+1,j+1),point(i,j+1)]]){
    let polygon=initial;for(const e of edges){polygon=clip(polygon,e.nx,e.nz,e.b);if(polygon.length<3)break;}
    for(let k=1;k+1<polygon.length;k++)push(topVertex(polygon[0]),topVertex(polygon[k+1]),topVertex(polygon[k]),'top');
   }
   let upper=rim;
   for(const [radial,drop,region]of [[1.01,.16,'shoulder'],[1.005,.7,'side'],[1.0,1.7,'side'],[1,3.2,'side']]){
    const lower=Array.from({length:count},(_,i)=>vertex(radial,i,drop));
    for(let i=0;i<count;i++){const j=(i+1)%count;push(upper[i],upper[j],lower[j],region);push(upper[i],lower[j],lower[i],region);}upper=lower;
   }
  }
  const y=-config.sheetGap-config.relief*3,a=translate([-config.width/2,y,-config.depth/2]),b=translate([config.width/2,y,-config.depth/2]),c=translate([config.width/2,y,config.depth/2]),d=translate([-config.width/2,y,config.depth/2]);add(a,c,b,1,-1,'backing',tile);add(a,d,c,1,-1,'backing',tile);
 }
 return {schema:'kaminos.causeway-source.v1',config,columns,triangles,materials,captureDomain:{width:config.width,depth:config.depth},referenceHeight:.00005,chart:{width:config.width,depth:config.depth,offsetMeters:.004,boundary:'repeat'},boundary:'Periodic column realization with one whole tile of physical context on each side; finite context is not infinite transport.',representation:'Authored shallow columnar stone, varying shoulders, dished tops and mineral facets. No cooling, erosion or fracture simulation.'};
}
