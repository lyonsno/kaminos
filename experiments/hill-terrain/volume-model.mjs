import {createRockOutcrop,buildConvexRock} from './rock-geometry.mjs';
export const PARTICLE_WORDS=36,BODY_WORDS=40;
const dot=(a,b)=>a.reduce((n,v,i)=>n+v*b[i],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export const contains=(s,p,margin=0)=>s.planes.every(q=>dot(q.slice(0,3),p)<=q[3]+margin);

// Exact signed tetrahedron integrals over the closed source surface. Render
// tessellation changes neither physical volume nor the mass distribution.
export function rockMoments(s,density=2400){
 let volume=0;const first=[0,0,0],second=Array(9).fill(0);
 for(let i=0;i<s.positions.length;i+=9){
  const a=s.positions.slice(i,i+3),b=s.positions.slice(i+3,i+6),c=s.positions.slice(i+6,i+9),v=dot(a,cross(b,c))/6;volume+=v;
  for(let r=0;r<3;r++){first[r]+=v*(a[r]+b[r]+c[r])/4;
   for(let q=0;q<3;q++)second[q*3+r]+=v*((a[r]+b[r]+c[r])*(a[q]+b[q]+c[q])+a[r]*a[q]+b[r]*b[q]+c[r]*c[q])/20;
  }
 }
 if(volume<=1e-12)throw Error('Rock needs a positive closed volume');
 const center=first.map(x=>x/volume),cov=second.map((x,i)=>density*(x-volume*center[i%3]*center[Math.floor(i/3)])),tr=cov[0]+cov[4]+cov[8];
 const inertia=cov.map((v,i)=>(i%4===0?tr:0)-v);
 return{volume,mass:volume*density,center,inertia};
}
function inverse3(m){
 const a=m.slice(0,3),b=m.slice(3,6),c=m.slice(6,9),bc=cross(b,c),ca=cross(c,a),ab=cross(a,b),det=dot(a,bc);
 if(det<=0)throw Error('Invalid rigid inertia');
 return [bc[0],ca[0],ab[0],bc[1],ca[1],ab[1],bc[2],ca[2],ab[2]].map(v=>v/det);
}
export function volumeConfig(input={}){
 const c={cell:.12,spacing:.075,dt:.0015,density:1600,rockDensity:2400,bulk:12000,shear:5000,friction:.65,contactFriction:.6,gravity:9.81,origin:[-2.4,-.36,-1.8],dimensions:[40,30,40],...input};
 for(const k of ['cell','spacing','dt','density','rockDensity','bulk','shear'])if(!Number.isFinite(c[k])||c[k]<=0)throw Error('Invalid volume '+k);
 for(const k of ['friction','contactFriction','gravity'])if(!Number.isFinite(c[k])||c[k]<0)throw Error('Invalid volume '+k);
 if(!Array.isArray(c.origin)||c.origin.length!==3||!c.origin.every(Number.isFinite)||!Array.isArray(c.dimensions)||c.dimensions.length!==3||!c.dimensions.every(x=>Number.isInteger(x)&&x>=8))throw Error('Invalid material domain');
 if(c.dt>c.cell/Math.sqrt((c.bulk+4*c.shear/3)/c.density)*.2)throw Error('Time step exceeds explicit elastic CFL');
 return c;
}
export function makeVolumeSpecimen(input={}){
 const config=volumeConfig(input),source=createRockOutcrop({origin:[0,.53,.45]});
 const bodies=source.solids.map(s=>{const m=rockMoments(s,config.rockDensity);return{id:s.id,bed:s.bed,position:m.center,rotation:[0,0,0,1],velocity:[0,0,0],omega:[0,0,0],anchored:true,
  solid:buildConvexRock(s.planes.map(p=>[...p.slice(0,3),p[3]-dot(p.slice(0,3),m.center)])),mass:m.mass,inertia:m.inertia,volume:m.volume};});
 const particles=[],h=config.spacing;
 // Explicit volume occupancy, independent of the old terrain source. Two
 // lobes, a low apron and a hollow surround the retained authored outcrop.
 for(let x=-1.95+h/2;x<1.95;x+=h)for(let z=-1.35+h/2;z<2.35;z+=h){
  const top=.20+.72*Math.exp(-((x+.95)**2/.32+(z-.25)**2/1.1))+.30*Math.exp(-((x-.9)**2/.45+(z-1.0)**2/.65))-.16*Math.exp(-((x-.25)**2/.25+(z-1.55)**2/.30));
  for(let y=h/2;y<top;y+=h){const p=[x,y,z];if(source.solids.some(s=>contains(s,p,h*.1)))continue;
   const row=Array(PARTICLE_WORDS).fill(0);row.splice(0,8,...p,config.density*h**3,0,0,0,h**3);particles.push(...row);
  }
 }
 return{config,bodies,particles:new Float32Array(particles),weatheredMass:0,history:[],source:'direct-3d-material-volumes-v1'};
}
export function packVolumeBodies(bodies){
 const body=new Float32Array(bodies.length*BODY_WORDS),ints=new Uint32Array(body.buffer),planes=[],triangles=[],vertices=[],vertexBodies=[];
 for(let i=0;i<bodies.length;i++){
  const b=bodies[i],j=i*BODY_WORDS,inv=inverse3(b.inertia);body.set([...b.position,b.anchored?0:1/b.mass,...b.rotation,...b.velocity,0,...b.omega,0],j);
  for(let k=0;k<3;k++)body.set([...inv.slice(k*3,k*3+3),0],j+16+k*4);
  ints.set([planes.length/4,b.solid.planes.length,triangles.length/12,b.solid.positions.length/9],j+28);
  for(const p of b.solid.planes)planes.push(...p);
  let radius=0;
  for(let k=0;k<b.solid.positions.length;k+=3){const p=b.solid.positions.slice(k,k+3);radius=Math.max(radius,Math.hypot(...p));vertices.push(...p,0);vertexBodies.push(i);}
  for(let k=0;k<b.solid.positions.length;k+=9)for(let q=0;q<3;q++)triangles.push(...b.solid.positions.slice(k+q*3,k+q*3+3),0);
  body.set([radius,b.mass,b.volume,0],j+32);body.set([...(b.restPosition??b.position),0],j+36);
 }
 return{body,planes:new Float32Array(planes),triangles:new Float32Array(triangles),vertices:new Float32Array(vertices),vertexBodies:new Uint32Array(vertexBodies)};
}
export function rotate(q,v){const t=cross(q.slice(0,3),v).map(x=>x*2),u=cross(q.slice(0,3),t);return v.map((x,i)=>x+q[3]*t[i]+u[i]);}
export function weatherBody(model,index,distance){
 if(!Number.isInteger(index)||!model.bodies[index]||!Number.isFinite(distance)||distance<=0)throw Error('Choose a rock and positive weathering depth');
 const b=model.bodies[index],old=b.solid,next=buildConvexRock(old.planes.map(p=>[...p.slice(0,3),p[3]-distance]));
 const moments=rockMoments(next,model.config.rockDensity),lostMass=b.mass-moments.mass;
 if(lostMass<=0)throw Error('Weathering must remove material');
 const verts=old.positions,lo=[0,1,2].map(k=>Math.min(...verts.filter((_,i)=>i%3===k))),hi=[0,1,2].map(k=>Math.max(...verts.filter((_,i)=>i%3===k)));
 const h=Math.min(model.config.spacing,distance),samples=[];
 for(let x=lo[0]+h/2;x<hi[0];x+=h)for(let y=lo[1]+h/2;y<hi[1];y+=h)for(let z=lo[2]+h/2;z<hi[2];z+=h){const p=[x,y,z];if(contains(old,p)&&!contains(next,p))samples.push(p);}
 if(!samples.length)throw Error('Weathered shell not resolved by the chosen sampling');
 const volume=lostMass/model.config.density/samples.length,added=new Float32Array(samples.length*PARTICLE_WORDS);
 samples.forEach((p,i)=>{const r=rotate(b.rotation,p),world=r.map((x,k)=>x+b.position[k]),t=cross(b.omega,r);added.set([...world,volume*model.config.density,...b.velocity.map((x,k)=>x+t[k]),volume],i*PARTICLE_WORDS);});
 // Keep the existing local reference origin and integrate inertia about it.
 // Uniform recession may move the centroid: recenter and carry its world pose.
 const shift=rotate(b.rotation,moments.center);b.position=b.position.map((v,k)=>v+shift[k]);if(b.restPosition)b.restPosition=b.restPosition.map((v,k)=>v+shift[k]);
 b.velocity=b.velocity.map((v,k)=>v+cross(b.omega,shift)[k]);
 b.solid=buildConvexRock(next.planes.map(p=>[...p.slice(0,3),p[3]-dot(p.slice(0,3),moments.center)]));b.mass=moments.mass;b.inertia=moments.inertia;b.volume=moments.volume;
 const particles=new Float32Array(model.particles.length+added.length);particles.set(model.particles);particles.set(added,model.particles.length);model.particles=particles;model.weatheredMass+=lostMass;
 return{lostMass,addedParticles:samples.length};
}
