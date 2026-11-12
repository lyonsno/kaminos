import * as C from './node_modules/cannon-es/dist/cannon-es.js';
import {INGREDIENTS} from './granular-preparation.mjs';
const random=seed=>()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
// One cell is at least the largest sum of two body radii. Every possible
// finite-body contact is in this cell or one of its 26 neighbours.
export class PairGrid extends C.Broadphase{
 constructor(bodies,planes){super();this.grains=bodies;this.planes=planes;this.cell=2*bodies.reduce((r,b)=>Math.max(r,b.boundingRadius),0);}
 collisionPairs(world,p1,p2){const cells=new Map(),h=this.cell;for(const b of this.grains){if(b.aabbNeedsUpdate)b.updateAABB();const k=[b.position.x,b.position.y,b.position.z].map(x=>Math.floor(x/h)),key=k.join(',');let c=cells.get(key);if(!c)cells.set(key,c={k,rows:[]});c.rows.push(b);}
 const pair=(a,b)=>{if(!this.needBroadphaseCollision(a,b))return;const r=a.boundingRadius+b.boundingRadius;if(a.position.distanceSquared(b.position)<r*r){p1.push(a);p2.push(b);}};
 for(const {k,rows}of cells.values()){
  for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++)pair(rows[i],rows[j]);
  for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++){if(x<0||x===0&&y<0||x===0&&y===0&&z<=0)continue;const other=cells.get([k[0]+x,k[1]+y,k[2]+z].join(','));if(other)for(const a of rows)for(const b of other.rows)pair(a,b);}
  for(const b of rows)for(const p of this.planes){if(this.needBroadphaseCollision(b,p)){// plane normal points into the tray
   const n=new C.Vec3(0,0,1);p.quaternion.vmult(n,n);if(b.position.vsub(p.position).dot(n)<=b.boundingRadius){p1.push(b);p2.push(p);}
  }}
 }
 }
}
export function makePairBed({count=4096,seed=41,width,dt=1/120,friction=.6,separation=.65}={}){
 if(!Number.isSafeInteger(count)||count<1||!Number.isSafeInteger(seed)||!(dt>0&&Number.isFinite(dt))||!(separation>0&&separation<1.5)||!(friction>=0&&Number.isFinite(friction)))throw Error('Invalid pair bed configuration');
 const rng=random(seed),world=new C.World({gravity:new C.Vec3(0,-50,0)}),bodies=[],ingredients=[],planes=[];let solidVolume=0;
 world.collisionMatrix=new C.ObjectCollisionMatrix();world.collisionMatrixPrevious=new C.ObjectCollisionMatrix();
 world.solver.iterations=10;world.defaultContactMaterial.friction=friction;world.defaultContactMaterial.restitution=.01;world.defaultContactMaterial.contactEquationStiffness=1e4;world.defaultContactMaterial.contactEquationRelaxation=4;
 for(let i=0;i<count;i++){
  const r=.38*(.8+.4*rng()),s=r*(.85+.15*rng()),distance=r*separation,overlap=r+s-distance;
  const lens=Math.PI*overlap**2*(distance**2+2*distance*(r+s)-3*(r-s)**2)/(12*distance),volume=4*Math.PI/3*(r**3+s**3)-lens;
  // Equal overlapping spheres have exact symmetric COM. Unequal lobe mass
  // weighting is an explicit compound-density approximation in this assay.
  const f=s**3/(r**3+s**3),offsets=[[-distance*f,0,0],[distance*(1-f),0,0]],body=new C.Body({mass:volume,linearDamping:.15,angularDamping:.2,allowSleep:true,sleepSpeedLimit:.03,sleepTimeLimit:.3});
  body.addShape(new C.Sphere(r),new C.Vec3(...offsets[0]));body.addShape(new C.Sphere(s),new C.Vec3(...offsets[1]));body.quaternion.setFromEuler(rng()*Math.PI*2,rng()*Math.PI*2,rng()*Math.PI*2);body.userData={grain:i};bodies.push(body);ingredients.push({id:i,spheres:[{center:offsets[0],radius:r},{center:offsets[1],radius:s}],volume,mass:volume,materialIndex:rng()<.22?2:rng()<.25?0:1});solidVolume+=volume;
 }
 const metresPerUnit=Math.cbrt(2.65e-7/solidVolume);width??=.024/metresPerUnit;if(!(width>4&&Number.isFinite(width)))throw Error('Tray must exceed four particle units');
 const maxR=bodies.reduce((r,b)=>Math.max(r,b.boundingRadius),0),spacing=2*maxR*1.015,side=Math.floor((width-2*maxR)/spacing)+1;
 if(side<1)throw Error('Particles do not fit');
 for(let i=0;i<count;i++){const b=bodies[i],x=i%side,z=Math.floor(i/side)%side,y=Math.floor(i/(side*side));b.position.set((x-(side-1)/2)*spacing,maxR+y*spacing,(z-(side-1)/2)*spacing);b.aabbNeedsUpdate=true;world.addBody(b);}
 const wall=(p,n)=>{const b=new C.Body({mass:0,shape:new C.Plane()});b.position.set(...p);b.quaternion.setFromVectors(new C.Vec3(0,0,1),new C.Vec3(...n));world.addBody(b);planes.push(b);};wall([0,0,0],[0,1,0]);wall([-width/2,0,0],[1,0,0]);wall([width/2,0,0],[-1,0,0]);wall([0,0,-width/2],[0,0,1]);wall([0,0,width/2],[0,0,-1]);
 world.broadphase=new PairGrid(bodies,planes);
 const configuration={count,seed,width,dt,friction,separation,metresPerUnit,solidVolume,units:'particle-scaled length; numerical relaxation time',massModel:'union volume for mass; Cannon compound bounding-box inertia and lobe-weighted centre approximation'};
 return {world,bodies,configuration,step(){world.step(dt);},snapshot(){return {schema:'kaminos.granular-pair.v1',route:'cannon-es-0.20.0-cpu/rigid-sphere-pairs/spatial-grid',configuration,ingredients,grains:bodies.map((b,id)=>({id,position:b.position.toArray(),quaternion:b.quaternion.toArray(),velocity:b.velocity.toArray(),angularVelocity:b.angularVelocity.toArray()}))};},dispose(){for(const b of [...world.bodies])world.removeBody(b);}};
}
export function pairSource(snapshot){
 if(snapshot?.schema!=='kaminos.granular-pair.v1'||snapshot.route!=='cannon-es-0.20.0-cpu/rigid-sphere-pairs/spatial-grid'||snapshot.grains?.length!==snapshot.configuration?.count||snapshot.ingredients?.length!==snapshot.grains.length)throw Error('Complete analytical pair snapshot required');
 const scale=2.4/snapshot.configuration.width,spheres=[],q=new C.Quaternion();
 for(const row of snapshot.grains){const g=snapshot.ingredients[row.id];q.set(...row.quaternion);for(const s of g.spheres){const p=q.vmult(new C.Vec3(...s.center));spheres.push({center:p.toArray().map((v,k)=>(v+row.position[k])*scale),radius:s.radius*scale,materialIndex:g.materialIndex});}}
 const y=-.01,w=1.22,triangles=[{a:[-w,y,-w],b:[w,y,w],c:[w,y,-w],materialIndex:0},{a:[-w,y,-w],b:[-w,y,w],c:[w,y,w],materialIndex:0}];
 return {schema:'kaminos.analytical-pair-source.v1',config:{count:snapshot.grains.length,route:snapshot.route},spheres,triangles,materials:INGREDIENTS};
}
