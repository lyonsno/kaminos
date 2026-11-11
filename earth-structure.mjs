// Coarse material organization, not individual primary soil grains.
export const EARTH_STRUCTURE_SCHEMA='kaminos.earth-structure.v1';
export function bondKind(a,b){return a.clodId>0&&a.clodId===b.clodId?'clod':a.clodId!==b.clodId?'interface':'matrix';}
export function bondProfile(c,kind){
 const scale=kind==='clod'?c.clodStrength:kind==='interface'?c.interfaceStrength:1;
 return {force:c.cohesion*scale,yield:c.plasticYield*(kind==='clod'?2:1),breakStrain:c.breakStrain*(kind==='interface'?.35:kind==='clod'?.7:1)};
}
export function seedEarthStructure(snapshot,fields=null){
 const {config:c,particles,bonds,grit}=snapshot,spacing=c.width/c.columns;
 let seed=(c.seed^0x9e3779b9)>>>0;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return(seed+.5)/2**32;};
 const candidates=particles.map((_,i)=>i).filter(i=>Math.floor(i/(c.columns*c.columns))>=Math.floor(c.layers/2));
 const chosen=[],clods=[];
 for(let id=1;id<=c.clodCount;id++){
  if(fields){const f=fields[id-1];let index=0,best=Infinity;for(const [i,p]of particles.entries()){const d=p.position.reduce((n,v,k)=>n+(v-f.center[k])**2,0);if(d<best){index=i;best=d;}}clods.push({...structuredClone(f),seedParticle:index});continue;}
  let index;
  if(!chosen.length)index=candidates[Math.floor(random()*candidates.length)];
  else {let best=-Infinity;for(const i of candidates){if(chosen.includes(i))continue;const p=particles[i].position;const d=Math.min(...chosen.map(j=>particles[j].position.reduce((n,v,k)=>n+(v-p[k])**2,0)));if(d>best){best=d;index=i;}}}
  if(index===undefined)throw Error('Clod count exceeds available upper-bed support samples');
  chosen.push(index);clods.push({id,seedParticle:index,radii:[spacing*(1.35+random()*.65),spacing*(.9+random()*.5),spacing*(1.35+random()*.65)]});
 }
 for(const [index,p]of particles.entries()){p.referencePosition=[...p.position];let closest=1;p.clodId=0;for(const clod of (index<c.columns*c.columns?[]:clods)){const center=clod.center??particles[clod.seedParticle].position;const d=p.position.reduce((n,v,k)=>n+((v-center[k])/clod.radii[k])**2,0);if(d<closest){closest=d;p.clodId=clod.id;}}}
 for(const b of bonds)b.kind=bondKind(particles[b.a],particles[b.b]);
 // Four center-distance tethers couple reciprocal translation; contact/friction
 // still supplies the grit rotation. This is not a rigid embedded weld.
 const embeddings=[];
 for(const [grain,g]of grit.entries()){
  const neighbors=particles.map((p,particle)=>({particle,d:Math.hypot(...p.position.map((v,k)=>v-g.position[k]))})).sort((a,b)=>a.d-b.d||a.particle-b.particle).slice(0,4);
  for(const {particle,d}of neighbors)embeddings.push({grain,particle,rest:d,initial:d,active:true});
 }
 return {...snapshot,structure:{schema:EARTH_STRUCTURE_SCHEMA,clods},embeddings};
}

// A broken interior bond can divide a clod into multiple material fragments.
// Original ancestry is retained; connectivity determines density blending.
export function earthFragments(snapshot){
 const parent=Int32Array.from(snapshot.particles,(_,i)=>i),find=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};
 for(const b of snapshot.bonds)if(b.active&&b.kind==='clod'){const a=find(b.a),c=find(b.b);parent[Math.max(a,c)]=Math.min(a,c);}
 return snapshot.particles.map((p,i)=>p.clodId>0?find(i)+1:0);
}
