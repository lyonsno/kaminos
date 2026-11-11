import * as CANNON from './node_modules/cannon-es/dist/cannon-es.js';
import {EARTH_STRUCTURE_SCHEMA,seedEarthStructure,bondKind,bondProfile} from './earth-structure.mjs';

export const EARTH_SCHEMA='kaminos.earth-specimen.v1';
export const EARTH_MATERIALS=[
 {name:'fine compacted earth',color:[.19,.105,.047],roughness:.94,metalness:0},
 {name:'dark mineral grit',color:[.085,.071,.049],roughness:.69,metalness:0},
 {name:'warm mineral grit',color:[.31,.235,.14],roughness:.79,metalness:0},
 {name:'pale mineral grit',color:[.47,.40,.28],roughness:.84,metalness:0},
 {name:'dry earthy aggregate',color:[.235,.13,.055],roughness:.97,metalness:0},
 {name:'dense earthy aggregate',color:[.155,.080,.034],roughness:.91,metalness:0},
];
const phi=(1+Math.sqrt(5))/2;
export const GRIT_VERTICES=[[-1,phi,0],[1,phi,0],[-1,-phi,0],[1,-phi,0],[0,-1,phi],[0,1,phi],[0,-1,-phi],[0,1,-phi],[phi,0,-1],[phi,0,1],[-phi,0,-1],[-phi,0,1]].map(p=>p.map(x=>x/Math.hypot(1,phi)));
export const GRIT_FACES=[[0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],[1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],[3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],[4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1]];
const finite=(x,label,min=0)=>{if(!Number.isFinite(x)||x<min)throw Error(`Invalid ${label}`);return x;};
const integer=(x,label,min=0)=>{if(!Number.isSafeInteger(x)||x<min)throw Error(`Invalid ${label}`);return x;};
const vector=(a,n,label)=>{if(!Array.isArray(a)||a.length!==n||!a.every(Number.isFinite))throw Error(`Invalid ${label}`);return a;};
function configuration(input={}){
 const c={seed:41,width:.42,columns:10,layers:4,grains:24,density:1450,cohesion:2.5,friction:.72,plasticYield:.075,plasticRate:8,breakStrain:.5,iterations:12,dt:1/180,clodStrength:8,interfaceStrength:.22,gritBinding:1.2,...input};
 c.clodCount=input.clodCount??Math.max(1,Math.round(c.columns*c.columns/12));integer(c.clodCount,'clod count');if(c.clodCount>c.columns*c.columns*(c.layers-Math.floor(c.layers/2)))throw Error('Clod count exceeds upper-bed support inventory');
 integer(c.seed,'seed');integer(c.columns,'columns',3);integer(c.layers,'layers',2);integer(c.grains,'grains');integer(c.iterations,'iterations',1);
 for(const key of ['width','density','dt'])finite(c[key],key,Number.MIN_VALUE);
 for(const key of ['cohesion','friction','plasticYield','plasticRate','breakStrain','clodStrength','interfaceStrength','gritBinding'])finite(c[key],key);
 return c;
}
export function checkedEarthSnapshot(s){
 if(s?.schema!==EARTH_SCHEMA)throw Error('Invalid earth snapshot schema');
 const c=configuration({...s.config,...(!s.structure?{clodCount:0}:{})});finite(s.time,'time');integer(s.steps,'steps');
 if(!Array.isArray(s.particles)||s.particles.length!==c.columns*c.columns*c.layers)throw Error('Invalid particle inventory');
 if(!Array.isArray(s.grit)||s.grit.length!==c.grains||!Array.isArray(s.bonds))throw Error('Invalid grit or bond inventory');
 for(const p of [...s.particles,...s.grit]){vector(p.position,3,'position');vector(p.velocity,3,'velocity');vector(p.quaternion,4,'quaternion');if(Math.abs(Math.hypot(...p.quaternion)-1)>1e-5)throw Error('Invalid quaternion norm');vector(p.angularVelocity,3,'angular velocity');finite(p.mass,'mass',Number.MIN_VALUE);if(p.radii)vector(p.radii,3,'radii').forEach(r=>finite(r,'radius',Number.MIN_VALUE));else finite(p.radius,'radius',Number.MIN_VALUE);}
 for(const g of s.grit)if(!Number.isSafeInteger(g.materialIndex)||g.materialIndex<1||g.materialIndex>3)throw Error('Invalid grit material');
 const expectedBonds=[[1,0,0],[0,1,0],[0,0,1],[1,1,0],[-1,1,0],[0,1,1],[0,1,-1],[1,0,1],[-1,0,1]].reduce((n,[x,y,z])=>n+(c.columns-Math.abs(x))*(c.layers-y)*(c.columns-Math.abs(z)),0);
 if(s.bonds.length!==expectedBonds)throw Error('Incomplete bond inventory');
 const pairs=new Set();
 for(const b of s.bonds){const pair=`${Math.min(b.a,b.b)},${Math.max(b.a,b.b)}`;if(pairs.has(pair))throw Error('Duplicate bond');pairs.add(pair);integer(b.a,'bond index');integer(b.b,'bond index');if(b.a===b.b||b.a>=s.particles.length||b.b>=s.particles.length||typeof b.active!=='boolean')throw Error('Invalid bond endpoints');finite(b.rest,'bond length',Number.MIN_VALUE);finite(b.initial,'initial bond length',Number.MIN_VALUE);}
 if(s.structure){
  if(s.structure.schema!==EARTH_STRUCTURE_SCHEMA||!Array.isArray(s.structure.clods)||s.structure.clods.length!==c.clodCount)throw Error('Invalid earth structure inventory');
  for(const [i,clod]of s.structure.clods.entries()){if(clod.id!==i+1||!Number.isSafeInteger(clod.seedParticle)||clod.seedParticle<0||clod.seedParticle>=s.particles.length)throw Error('Invalid clod identity');vector(clod.radii,3,'clod radii').forEach(r=>finite(r,'clod radius',Number.MIN_VALUE));}
  for(const p of s.particles){integer(p.clodId,'clod id');if(p.clodId>c.clodCount)throw Error('Unknown clod');vector(p.referencePosition,3,'material reference position');}
  for(const b of s.bonds)if(b.kind!==bondKind(s.particles[b.a],s.particles[b.b]))throw Error('Bond kind differs from material ancestry');
  if(!Array.isArray(s.embeddings)||s.embeddings.length!==s.grit.length*4)throw Error('Incomplete grit embedding inventory');
  const counts=new Int32Array(s.grit.length),pairs=new Set();for(const e of s.embeddings){integer(e.grain,'grain index');integer(e.particle,'embedding particle');const key=`${e.grain}:${e.particle}`;if(e.grain>=s.grit.length||e.particle>=s.particles.length||pairs.has(key)||typeof e.active!=='boolean')throw Error('Invalid grit embedding');pairs.add(key);counts[e.grain]++;finite(e.rest,'embedding length',Number.MIN_VALUE);finite(e.initial,'initial embedding length',Number.MIN_VALUE);}if([...counts].some(n=>n!==4))throw Error('Each grain requires four retained embedding rows');
 }else if(s.embeddings!==undefined||s.particles.some(p=>p.clodId!==undefined)||s.bonds.some(b=>b.kind!==undefined))throw Error('Structured earth requires its structure identity');
 return structuredClone({...s,config:c});
}
function initialSnapshot(c){
 let state=c.seed>>>0;const rand=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return(state+.5)/4294967296;};
 const spacing=c.width/c.columns,radius=spacing*.34;
 const particles=[],bonds=[],grit=[];
 const body=(position,mass)=>({position,velocity:[0,0,0],angularVelocity:[0,0,0],quaternion:[0,0,0,1],mass});
 for(let y=0;y<c.layers;y++)for(let z=0;z<c.columns;z++)for(let x=0;x<c.columns;x++){
  const px=(x+.5-c.columns/2)*spacing,pz=(z+.5-c.columns/2)*spacing;
  const hill=spacing*.55*Math.exp(-((px+.065)**2+(pz-.03)**2)/.018);
  particles.push({...body([px+(rand()-.5)*spacing*.17,radius+y*spacing*.82+hill+(rand()-.5)*spacing*.13,pz+(rand()-.5)*spacing*.17],c.density*spacing**3*.58),radius});
 }
 const index=(x,y,z)=>(y*c.columns+z)*c.columns+x;
 const offsets=[[1,0,0],[0,1,0],[0,0,1],[1,1,0],[-1,1,0],[0,1,1],[0,1,-1],[1,0,1],[-1,0,1]];
 for(let y=0;y<c.layers;y++)for(let z=0;z<c.columns;z++)for(let x=0;x<c.columns;x++)for(const [dx,dy,dz]of offsets){
  if(x+dx<0||x+dx>=c.columns||y+dy>=c.layers||z+dz<0||z+dz>=c.columns)continue;
  const a=index(x,y,z),b=index(x+dx,y+dy,z+dz),rest=Math.hypot(...particles[a].position.map((v,k)=>v-particles[b].position[k]));
  bonds.push({a,b,rest,initial:rest,active:true});
 }
 for(let i=0;i<c.grains;i++){
  const r=spacing*(.29+rand()*.50),radii=[r*(.8+rand()*.5),r*(.55+rand()*.35),r*(.8+rand()*.5)];
  const q=new CANNON.Quaternion();q.setFromEuler(rand(),rand()*6.28,rand());
  grit.push({...body([(rand()-.5)*(c.width-4*r),(c.layers-.1)*spacing*.82+rand()*spacing*.5,(rand()-.5)*(c.width-4*r)],2400*4*Math.PI/3*radii.reduce((a,b)=>a*b,1)),quaternion:q.toArray(),radii,materialIndex:1+i%3});
 }
 return seedEarthStructure({schema:EARTH_SCHEMA,config:c,time:0,steps:0,particles,grit,bonds});
}

// CPU physical preparation for a small material specimen. Cannon supplies contact,
// friction and reciprocal rigid motion; yielding distance bonds supply a deliberately
// simple cohesive aggregate model. This is not a calibrated continuum soil law.
export class EarthSpecimen {
 constructor(config={},snapshot=null){
  const s=snapshot?checkedEarthSnapshot(snapshot):initialSnapshot(configuration(config));
  this.config=s.config;this.structure=s.structure;this.time=s.time;this.steps=s.steps;this.disposed=false;
  const w=this.world=new CANNON.World({gravity:new CANNON.Vec3(0,-9.81,0)});
  w.allowSleep=false;w.solver.iterations=this.config.iterations;w.solver.tolerance=1e-7;
  w.broadphase=new CANNON.SAPBroadphase(w);
  w.defaultContactMaterial.friction=this.config.friction;w.defaultContactMaterial.restitution=0;
  w.defaultContactMaterial.contactEquationStiffness=1e6;
  const base=new CANNON.Body({mass:0,shape:new CANNON.Plane()});base.quaternion.setFromEuler(-Math.PI/2,0,0);w.addBody(base);
  const half=this.config.width/2;
  for(const [axis,sign]of [[0,1],[0,-1],[2,1],[2,-1]]){
   const wall=new CANNON.Body({mass:0,shape:new CANNON.Plane()});
   wall.quaternion.setFromVectors(new CANNON.Vec3(0,0,1),new CANNON.Vec3(axis===0?-sign:0,0,axis===2?-sign:0));wall.position.set(axis===0?sign*half:0,0,axis===2?sign*half:0);w.addBody(wall);
  }
  const make=(row,shape)=>{const b=new CANNON.Body({mass:row.mass,shape,linearDamping:.35,angularDamping:.4,allowSleep:false});b.position.set(...row.position);b.velocity.set(...row.velocity);b.angularVelocity.set(...row.angularVelocity);b.quaternion.set(...row.quaternion);w.addBody(b);return b;};
  this.particles=s.particles.map(row=>({...row,body:make(row,new CANNON.Sphere(row.radius))}));
  this.grit=s.grit.map(row=>({...row,body:make(row,new CANNON.ConvexPolyhedron({vertices:GRIT_VERTICES.map(p=>new CANNON.Vec3(...p.map((v,k)=>v*row.radii[k]))),faces:GRIT_FACES}))}));
  this.bonds=s.bonds.map(row=>{const constraint=new CANNON.DistanceConstraint(this.particles[row.a].body,this.particles[row.b].body,row.rest,bondProfile(this.config,row.kind).force);constraint.collideConnected=true;if(row.active)w.addConstraint(constraint);return {...row,constraint};});
  this.embeddings=(s.embeddings??[]).map(row=>{const constraint=new CANNON.DistanceConstraint(this.grit[row.grain].body,this.particles[row.particle].body,row.rest,this.config.cohesion*this.config.gritBinding);constraint.collideConnected=true;if(row.active)w.addConstraint(constraint);return {...row,constraint};});
  this.tool=new CANNON.Body({type:CANNON.Body.KINEMATIC,mass:0});this.tool.addShape(new CANNON.Sphere(.08));this.tool.collisionResponse=false;this.tool.position.y=10;w.addBody(this.tool);
 }
 static fromSnapshot(snapshot){return new EarthSpecimen({},snapshot);}
 advance(seconds,{tool=null,report=true}={}){
  if(this.disposed)throw Error('Earth specimen disposed');finite(seconds,'duration');
  if(tool){vector(tool.position,3,'tool position');finite(tool.radius,'tool radius',Number.MIN_VALUE);if(tool.velocity)vector(tool.velocity,3,'tool velocity');}
  if(seconds===0)return report?this.state():undefined;
  this.tool.collisionResponse=!!tool;
  if(tool){this.tool.position.set(...tool.position);this.tool.velocity.set(...(tool.velocity??[0,0,0]));if(this.tool.shapes[0].radius!==tool.radius){this.tool.shapes[0].radius=tool.radius;this.tool.shapes[0].updateBoundingSphereRadius();this.tool.updateBoundingRadius();}this.tool.aabbNeedsUpdate=true;}
  const count=Math.ceil(seconds/this.config.dt),dt=seconds/count;
  for(let i=0;i<count;i++){
   this.world.step(dt);
   for(const bond of this.bonds){
    if(!bond.active)continue;
    const d=this.particles[bond.a].body.position.distanceTo(this.particles[bond.b].body.position);
    const profile=bondProfile(this.config,bond.kind);
    if(d>bond.initial*(1+profile.breakStrain)){
     this.world.removeConstraint(bond.constraint);bond.active=false;
    }else if(Math.abs(d-bond.rest)>bond.rest*profile.yield){
     const lower=this.particles[bond.a].radius+this.particles[bond.b].radius;
     bond.rest=Math.max(lower,bond.rest+(d-bond.rest)*(1-Math.exp(-this.config.plasticRate*dt)));bond.constraint.distance=bond.rest;
    }
   }
   for(const embedding of this.embeddings)if(embedding.active&&this.grit[embedding.grain].body.position.distanceTo(this.particles[embedding.particle].body.position)>embedding.initial*(1+this.config.breakStrain)){
    this.world.removeConstraint(embedding.constraint);embedding.active=false;
   }
   this.time+=dt;this.steps++;
  }
  this.tool.collisionResponse=false;this.tool.velocity.set(0,0,0);
  return report?this.state():undefined;
 }
 setMaterial(values){
  if(!values||typeof values!=='object'||Array.isArray(values)||Object.keys(values).some(k=>!['cohesion','friction','plasticYield','plasticRate','breakStrain','clodStrength','interfaceStrength','gritBinding'].includes(k)))throw Error('Invalid material parameter');
  const next=configuration({...this.config,...values});
  this.config=next;this.world.defaultContactMaterial.friction=next.friction;
  for(const b of this.bonds)for(const e of b.constraint.equations){const force=bondProfile(next,b.kind).force;e.minForce=-force;e.maxForce=force;}
  for(const b of this.embeddings)for(const e of b.constraint.equations){e.minForce=-next.cohesion*next.gritBinding;e.maxForce=next.cohesion*next.gritBinding;}
  return this.state();
 }
 state(){const ys=this.particles.map(p=>p.body.position.y);return {schema:EARTH_SCHEMA,time:this.time,steps:this.steps,particles:this.particles.length,grains:this.grit.length,mass:this.particles.reduce((s,p)=>s+p.mass,0),top:Math.max(...ys),meanHeight:ys.reduce((s,y)=>s+y,0)/ys.length,activeBonds:this.bonds.filter(b=>b.active).length,brokenBonds:this.bonds.filter(b=>!b.active).length,plasticCompression:this.bonds.reduce((s,b)=>s+Math.max(0,b.initial-b.rest),0),backend:'cannon-es-0.20.0-cpu',boundary:'bounded tray; no periodic dynamics',material:'contacting spheres with yielding cohesive distance bonds; dynamic convex grit',structure:{clods:this.structure?.clods.length??0,clodParticles:this.particles.filter(p=>p.clodId>0).length,matrixParticles:this.particles.filter(p=>!p.clodId).length,brokenInterfaces:this.bonds.filter(b=>b.kind==='interface'&&!b.active).length,brokenInteriors:this.bonds.filter(b=>b.kind==='clod'&&!b.active).length,embeddedGrains:new Set(this.embeddings.filter(b=>b.active).map(b=>b.grain)).size,brokenEmbeddings:this.embeddings.filter(b=>!b.active).length}};}
 snapshot(){const row=p=>{const {body,...rest}=p;return {...rest,position:body.position.toArray(),velocity:body.velocity.toArray(),quaternion:body.quaternion.toArray(),angularVelocity:body.angularVelocity.toArray()};};return {schema:EARTH_SCHEMA,config:{...this.config},time:this.time,steps:this.steps,particles:this.particles.map(row),grit:this.grit.map(row),bonds:this.bonds.map(({constraint,...r})=>({...r})),...(this.structure?{structure:structuredClone(this.structure),embeddings:this.embeddings.map(({constraint,...r})=>({...r}))}:{})};}
 dispose(){if(this.disposed)return;this.disposed=true;for(const b of [...this.world.bodies])this.world.removeBody(b);for(const c of [...this.world.constraints])this.world.removeConstraint(c);}
}
