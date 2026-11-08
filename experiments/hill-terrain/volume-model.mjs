import {createRockOutcrop,buildConvexRock} from './rock-geometry.mjs';
import {convexFeatures,conditionRockPoses,verticalContactHeight} from './convex-contact.mjs';
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
 const defaults=input.fixture==='hundred-rocks'?{origin:[-3.36,-.36,-3.84],dimensions:[56,36,64]}:{};
 const c={fixture:'outcrop',pileSoilHeight:.65,contactIterations:2,cell:.12,spacing:.075,dt:.0015,density:1600,rockDensity:2400,bulk:12000,shear:5000,friction:.65,contactFriction:.6,gravity:9.81,origin:[-2.4,-.36,-1.8],dimensions:[40,30,40],conditionContacts:true,...defaults,...input};
 if(!['outcrop','hundred-rocks'].includes(c.fixture))throw Error('Unknown material fixture');if(!Number.isSafeInteger(c.contactIterations)||c.contactIterations<1)throw Error('Contact iterations must be a positive integer');
 for(const k of ['cell','spacing','dt','density','rockDensity','bulk','shear'])if(!Number.isFinite(c[k])||c[k]<=0)throw Error('Invalid volume '+k);
 for(const k of ['friction','contactFriction','gravity'])if(!Number.isFinite(c[k])||c[k]<0)throw Error('Invalid volume '+k);
 if(!Array.isArray(c.origin)||c.origin.length!==3||!c.origin.every(Number.isFinite)||!Array.isArray(c.dimensions)||c.dimensions.length!==3||!c.dimensions.every(x=>Number.isInteger(x)&&x>=8))throw Error('Invalid material domain');
 if(c.dt>c.cell/Math.sqrt((c.bulk+4*c.shear/3)/c.density)*.2)throw Error('Time step exceeds explicit elastic CFL');
 if(!Number.isFinite(c.pileSoilHeight)||c.pileSoilHeight<.18||c.fixture==='hundred-rocks'&&c.pileSoilHeight>=c.origin[1]+(c.dimensions[1]-2.1)*c.cell)throw Error('Initial soil height must fit inside the physical material domain');
 if(typeof c.conditionContacts!=='boolean')throw Error('Contact preparation must be boolean');
 return c;
}
export function makeVolumeSpecimen(input={}){
 const config=volumeConfig(input),source=createRockOutcrop({origin:[0,.53,.45]});
 let bodies=source.solids.map(s=>{const m=rockMoments(s,config.rockDensity);return{id:s.id,bed:s.bed,position:m.center,rotation:[0,0,0,1],velocity:[0,0,0],omega:[0,0,0],anchored:true,
  solid:buildConvexRock(s.planes.map(p=>[...p.slice(0,3),p[3]-dot(p.slice(0,3),m.center)])),mass:m.mass,inertia:m.inertia,volume:m.volume};});
 let conditioning;
 if(config.fixture==='hundred-rocks'){
  const templates=bodies.map(b=>{const solid=buildConvexRock(b.solid.planes.map(p=>[...p.slice(0,3),p[3]*.65])),m=rockMoments(solid,config.rockDensity);return{...b,solid,mass:m.mass,inertia:m.inertia,volume:m.volume};});
  const half=[0,1,2].map(k=>Math.max(...templates.map(b=>Math.max(...b.solid.positions.filter((_,i)=>i%3===k).map(Math.abs))))),pitch=half.map(v=>2*v+.04);bodies=[];
  for(let y=0;y<4;y++)for(let z=0;z<5;z++)for(let x=0;x<5;x++){
   const b=templates[(x+3*z+2*y)%templates.length],next={...b,id:`pile-${y}-${z}-${x}`,bed:y,position:[(x-2)*pitch[0],0,(z-2)*pitch[2]],rotation:[0,0,0,1],velocity:[0,0,0],omega:[0,0,0]};
   next.position[1]=y?verticalContactHeight(next,bodies[(y-1)*25+z*5+x])+1e-5:-Math.min(...b.solid.positions.filter((_,i)=>i%3===1))+1e-5;bodies.push(next);
  }
  conditioning={kind:'disjoint source-bounded stack',verticalShifts:bodies.map(()=>0),maxShift:0};
 }else conditioning=config.conditionContacts?conditionRockPoses(bodies):{kind:'unconditioned authored poses',maxShift:0,verticalShifts:bodies.map(()=>0)};
 const width=2*Math.max(...bodies.map(b=>Math.max(...b.solid.positions.filter((_,i)=>i%3!==1).map(Math.abs))))+.1,buckets=new Map();
 for(const b of bodies){const key=[0,2].map(k=>Math.floor(b.position[k]/width)).join(',');if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(b);}
 const neighbors=(x,z)=>{const out=[],ix=Math.floor(x/width),iz=Math.floor(z/width);for(let i=-1;i<=1;i++)for(let j=-1;j<=1;j++)out.push(...(buckets.get([ix+i,iz+j].join(','))??[]));return out;};
 const particles=[],h=config.spacing;
 // Explicit volume occupancy, independent of the old terrain source. Two
 // lobes, a low apron and a hollow surround the retained authored outcrop.
 const pile=config.fixture==='hundred-rocks',bounds=pile?[-3.0,3.0,-3.45,3.45]:[-1.95,1.95,-1.35,2.35];
 for(let x=bounds[0]+h/2;x<bounds[1];x+=h)for(let z=bounds[2]+h/2;z<bounds[3];z+=h){
  const localBodies=neighbors(x,z);const top=pile?.18+(config.pileSoilHeight-.18)*Math.exp(-((x/2.5)**4+(z/3.1)**4)):.20+.72*Math.exp(-((x+.95)**2/.32+(z-.25)**2/1.1))+.30*Math.exp(-((x-.9)**2/.45+(z-1.0)**2/.65))-.16*Math.exp(-((x-.25)**2/.25+(z-1.55)**2/.30));
  for(let y=h/2;y<top;y+=h){const p=[x,y,z];if(localBodies.some(b=>contains(b.solid,p.map((v,k)=>v-b.position[k]),h*.1)))continue;
   const row=Array(PARTICLE_WORDS).fill(0);row.splice(0,8,...p,config.density*h**3,0,0,0,h**3);particles.push(...row);
  }
 }
 return{config,bodies,particles:new Float32Array(particles),weatheredMass:0,history:[],conditioning,source:'direct-3d-material-volumes-v1'};
}
export function packVolumeBodies(bodies){
 const body=new Float32Array(bodies.length*BODY_WORDS),ints=new Uint32Array(body.buffer),planes=[],triangles=[],vertices=[],vertexBodies=[],convex=[],convexOwners=[];
 for(let i=0;i<bodies.length;i++){
  const b=bodies[i],j=i*BODY_WORDS,inv=inverse3(b.inertia);body.set([...b.position,b.anchored?0:1/b.mass,...b.rotation,...b.velocity,0,...b.omega,0],j);
  for(let k=0;k<3;k++)body.set([...inv.slice(k*3,k*3+3),0],j+16+k*4);
  const features=convexFeatures(b.solid);body[j+19]=convex.length/4;body[j+23]=features.vertices.length;for(const p of features.vertices){convex.push(...p,0);convexOwners.push(i);}body[j+27]=convex.length/4;body[j+35]=features.edges.length;for(const e of features.edges){convex.push(...e,0);convexOwners.push(i);}
  ints.set([planes.length/4,b.solid.planes.length,triangles.length/12,b.solid.positions.length/9],j+28);
  for(const p of b.solid.planes)planes.push(...p);
  let radius=0;
  for(let k=0;k<b.solid.positions.length;k+=3){const p=b.solid.positions.slice(k,k+3);radius=Math.max(radius,Math.hypot(...p));vertices.push(...p,0);vertexBodies.push(i);}
  for(let k=0;k<b.solid.positions.length;k+=9)for(let q=0;q<3;q++)triangles.push(...b.solid.positions.slice(k+q*3,k+q*3+3),0);
  body.set([radius,b.mass,b.volume,features.edges.length],j+32);body.set([...(b.restPosition??b.position),0],j+36);
 }
 return{body,planes:new Float32Array(planes),triangles:new Float32Array(triangles),vertices:new Float32Array(vertices),vertexBodies:new Uint32Array(vertexBodies),convex:new Float32Array(convex),convexOwners:new Uint32Array(convexOwners)};
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

// These fixture constraints hold the complete pose relative to the specimen.
// The surface mount is an interaction/annotation location, not a hinge or bond.
export function volumePoseAnchors(model,driveHeight=0){
 if(!Number.isFinite(driveHeight))throw Error('Invalid anchor drive height');
 
 return model.bodies.map((body,rock)=>{
  const face=body.solid.faces.reduce((a,b)=>a.normal[1]>b.normal[1]?a:b),mount=[0,1,2].map(k=>face.vertices.reduce((n,p)=>n+p[k],0)/face.vertices.length),rest=body.restPosition??body.position;
  const position=[...rest];position[1]+=driveHeight*Math.exp(-(rest[0]**2+rest[2]**2)/.75);
  const place=p=>rotate(body.rotation,p).map((v,k)=>v+position[k]);
  const reason=!body.anchored?'Released':!model.config.conditionContacts?'Enable starting contact preparation before release':null;
  return{id:'pose-anchor:'+body.id,bodyId:body.id,rock,kind:'pose-anchor',frame:'specimen',locks:{position:true,orientation:true},attached:body.anchored,canRelease:body.anchored&&!reason,reason,mount:[...mount],specimenPoint:body.anchored?place(mount):null,specimenFace:body.anchored?face.vertices.map(place):[]};
 });
}
