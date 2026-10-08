import Module from 'manifold-3d';
import {INTERIOR_CUT_ROUTE} from './structural-material-interior-cut.mjs';

export async function createPlaneFractureSurface(geometry,{sourceSha256,wasm:provided}={}){
 if(!Number.isInteger(geometry?.numProp)||geometry.numProp<3||!Array.isArray(geometry.properties)||!geometry.properties.length||geometry.properties.length%geometry.numProp||!geometry.properties.every(Number.isFinite)||!Array.isArray(geometry.indices)||!geometry.indices.length||geometry.indices.length%3||!geometry.indices.every(i=>Number.isInteger(i)&&i>=0&&i<geometry.properties.length/geometry.numProp))throw new Error('Complete finite oriented source geometry required');
 const wasm=provided??await Module();if(!provided)wasm.setup();const {Mesh,Manifold}=wasm,sourceId=Manifold.reserveIDs(1);
 const mesh=new Mesh({numProp:geometry.numProp,vertProperties:Float32Array.from(geometry.properties),triVerts:Uint32Array.from(geometry.indices),runIndex:Uint32Array.from([0,geometry.indices.length]),runOriginalID:Uint32Array.from([sourceId])});mesh.merge();
 const solid=new Manifold(mesh),volume=solid.volume();if(!(Number.isFinite(volume)&&volume>0)){solid.delete();throw new Error('Positive source solid required for event surfaces');}
 let pieces=[{id:0,solid,halfspaces:[]}],nextId=1,epoch=0,disposed=false,accepted=null;const events=[],replays=new Map();
 const transmission=bonds=>bonds.filter((_,i)=>i%4<3),same=(a,b)=>a.length===b.length&&a.every((value,i)=>value===b[i]);
 const serialize=piece=>{const mesh=piece.solid.getMesh(),exterior=[];for(let run=0;run<mesh.runOriginalID.length;run++)for(let tri=mesh.runIndex[run]/3;tri<mesh.runIndex[run+1]/3;tri++)exterior[tri]=mesh.runOriginalID[run]===sourceId;
  return{id:piece.id,volume:piece.solid.volume(),halfspaces:structuredClone(piece.halfspaces),geometry:{numProp:mesh.numProp,properties:Array.from(mesh.vertProperties),indices:Array.from(mesh.triVerts),exterior}};};
 const witness=()=>({route:'kaminos.event-surface.plane-cut.manifold-3.5.4.v0',sourceSha256,material:accepted&&structuredClone(accepted.material),epoch,volume,pieces:pieces.map(serialize),events:structuredClone(events),claim:'Event-time geometry follows supplied released transmission; caller selects plane; not stress-generation or fragment dynamics proof'});
 return{witness,
  interiorChildren(){return[nextId,nextId+1];},
  stageInteriorCut(event){
   if(disposed)throw new Error('Fracture surface disposed');const {id,normal,offset,targetPieceId,cut,material,kind}=event??{},r=cut?.receipt,target=pieces.find(p=>p.id===targetPieceId);
   if(typeof id!=='string'||!id||replays.has(id)||kind!=='component-tensile-interior-cut-v0'||!target||!material?.runId||material.kind!=='graph'||material.sourceSha256!==sourceSha256)throw new Error('Identified interior cut and material source required');
   if(r?.route!==INTERIOR_CUT_ROUTE||r.targetDomain!==targetPieceId||JSON.stringify(r.children)!==JSON.stringify([nextId,nextId+1])||JSON.stringify(r.normal)!==JSON.stringify(normal)||r.offset!==offset||!Array.isArray(normal)||Math.abs(Math.hypot(...normal)-1)>1e-6)throw new Error('Surface plane differs from actual interior cut');
   if(!(r.volumeBefore>0&&r.volumeAfter>0)||Math.abs(r.volumeBefore-r.volumeAfter)>r.volumeBefore*1e-8||!r.childVolumes?.every(v=>v>0))throw new Error('Interior cut must conserve volume');
   if(!Array.isArray(cut.mesh?.domains)||!cut.mesh.domains.includes(nextId)||!cut.mesh.domains.includes(nextId+1)||cut.mesh.domains.includes(targetPieceId)||cut.nodeDomains?.some((d,i)=>cut.mesh.tetrahedra.every((ids,t)=>!ids.includes(i)||cut.mesh.domains[t]!==d)))throw new Error('Interior fragments lack supported material ownership');
   const effective=normal.map(Math.fround),length=Math.hypot(...effective),split=target.solid.splitByPlane(effective,Math.fround(offset)/length),created=[...split],volumes=split.map(p=>p.volume()),atEpoch=epoch,atId=nextId;
   if(!volumes.every(v=>Number.isFinite(v)&&v>0)||Math.abs(volumes[0]+volumes[1]-target.solid.volume())>volume*1e-6){split.forEach(p=>p.delete());throw new Error('Interior cut does not conserve visible solid');}
   const additions=split.map((solid,side)=>({id:atId+side,solid,halfspaces:[...target.halfspaces,{normal:effective,offset:Math.fround(offset),side:side===0?1:-1,event:id}]})),staged=pieces.flatMap(p=>p===target?additions:[p]);let closed=false;
   try{const result=staged.map(serialize);return{pieces:result,
    commit(){if(closed)throw new Error('Interior surface transaction closed');if(epoch!==atEpoch||nextId!==atId)throw new Error('Stale interior surface transaction');pieces=staged;nextId+=2;epoch++;closed=true;target.solid.delete();accepted={material:{...material}};events.push({id,kind,material:{...material},normal:effective,offset:Math.fround(offset),epoch,targetPieceId,interior:structuredClone(r)});replays.set(id,JSON.stringify(r));},
    abort(){if(!closed){created.forEach(p=>p.delete());closed=true;}}
   };}catch(e){created.forEach(p=>p.delete());throw e;}
  },
  cut(event){
   if(disposed)throw new Error('Fracture surface disposed');const {id,normal,offset,rest,before,after,route,kind,material,targetPieceId,targetNodes}=event??{};
   if(typeof id!=='string'||!id||route!=='kaminos.deformable-material.colored-vbd.webgpu.v0'||typeof kind!=='string'||!kind||!Array.isArray(normal)||normal.length!==3||!normal.every(Number.isFinite)||Math.abs(Math.hypot(...normal)-1)>1e-6||!Number.isFinite(offset))throw new Error('Explicit identified material event and unit plane required');
   if(typeof material?.runId!=='string'||!material.runId||!['graph','pmb'].includes(material.kind))throw new Error('Explicit material identity required for surface event');
   const identity={runId:material.runId,kind:material.kind,sourceSha256:material.sourceSha256??null};
   if(identity.sourceSha256!==null&&sourceSha256!==undefined&&identity.sourceSha256!==sourceSha256)throw new Error('Surface and material identity source disagree');
   const fingerprint=JSON.stringify({normal,offset,rest,before,after,route,kind,material:identity,targetPieceId,targetNodes});
   if(replays.has(id)){if(replays.get(id)!==fingerprint)throw new Error('Material event identity reused for different cut');return{replayed:true,witness:witness()};}
   if(!Array.isArray(rest)||!rest.length||!rest.every(p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite))||!Array.isArray(before)||!Array.isArray(after)||before.length!==after.length||!before.length||before.length%4)throw new Error('Complete before/after material transmission required');
   let targetSet=null;
   if(targetPieceId!==undefined||targetNodes!==undefined){
    const target=pieces.find(p=>p.id===targetPieceId);
    if(!target||!Array.isArray(targetNodes)||!targetNodes.length||new Set(targetNodes).size!==targetNodes.length||!targetNodes.every(i=>Number.isInteger(i)&&i>=0&&i<rest.length))throw new Error('Existing target piece and complete material nodes required');
    targetSet=new Set(targetNodes);
    const inside=p=>target.halfspaces.every(h=>h.side*(h.normal.reduce((s,v,k)=>s+v*Math.fround(p[k]),0)-h.offset)>=0);
    if(rest.some((p,i)=>inside(p)!==targetSet.has(i)))throw new Error('Target material nodes disagree with selected surface piece');
   }
   if(accepted){
    if(identity.runId!==accepted.material.runId||identity.kind!==accepted.material.kind||identity.sourceSha256!==accepted.material.sourceSha256)throw new Error('Surface material identity changed; construct a new surface for a new material run');
    if(!same(rest.flat(),accepted.rest.flat()))throw new Error('Surface rest identity changed');
    if(!same(transmission(before),accepted.transmission))throw new Error('Surface event does not continue accepted material history');
   }
   const effectiveNormal=normal.map(Math.fround),effectiveOffset=Math.fround(offset),distance=p=>p.reduce((sum,v,a)=>sum+effectiveNormal[a]*Math.fround(v),-effectiveOffset);let brokenAdded=0;
   for(let i=0;i<before.length;i+=4){const [a,b,alive]=before.slice(i,i+3);if(!Number.isInteger(a)||!Number.isInteger(b)||a<0||b<0||a>=rest.length||b>=rest.length||![0,1].includes(alive)||after[i]!==a||after[i+1]!==b||![0,1].includes(after[i+2]))throw new Error('Stable material bond identity/liveness required');
    if(targetSet&&alive&&targetSet.has(a)!==targetSet.has(b))throw new Error('Target material is not a released component');
    const crosses=distance(rest[a])*distance(rest[b])<0&&(!targetSet||targetSet.has(a)&&targetSet.has(b)),expected=alive&& !crosses?1:0;if(after[i+2]!==expected)throw new Error('Surface plane disagrees with released transmission');if(alive&&!expected)brokenAdded++;
   }
   if(!brokenAdded)throw new Error('No newly released transmission; refuse a picture-only cut');
   const staged=[],created=[],replaced=[],length=Math.hypot(...effectiveNormal);let cursor=nextId;
   try{
    for(const piece of pieces){if(targetPieceId!==undefined&&piece.id!==targetPieceId){staged.push(piece);continue;}const split=piece.solid.splitByPlane(effectiveNormal,effectiveOffset/length);created.push(...split);const volumes=split.map(p=>p.volume());
     if(volumes.every(v=>Number.isFinite(v)&&v>0)){
      if(Math.abs(volumes[0]+volumes[1]-piece.solid.volume())>volume*1e-6)throw new Error('Event cut did not conserve source volume');
      split.forEach((solid,side)=>staged.push({id:cursor++,solid,halfspaces:[...piece.halfspaces,{normal:effectiveNormal,offset:effectiveOffset,side:side===0?1:-1,event:id}]}));replaced.push(piece);
     }else{split.forEach(p=>{p.delete();created.splice(created.indexOf(p),1);});staged.push(piece);}
    }
    if(!replaced.length)throw new Error('Released transmission did not intersect the visible solid');
    const stagedVolume=staged.reduce((sum,p)=>sum+p.solid.volume(),0);if(Math.abs(stagedVolume-volume)>volume*1e-6)throw new Error('Fragment collection lost source volume');
    staged.forEach(serialize);pieces=staged;nextId=cursor;epoch++;replaced.forEach(p=>p.solid.delete());accepted={material:identity,rest:structuredClone(rest),transmission:transmission(after)};events.push({id,kind,material:identity,normal:effectiveNormal,offset:effectiveOffset,brokenAdded,epoch,...(targetPieceId===undefined?{}:{targetPieceId,targetNodes:[...targetNodes]})});replays.set(id,fingerprint);return{replayed:false,witness:witness()};
   }catch(error){for(const solid of created)solid.delete();throw error;}
  },
  dispose(){if(!disposed){pieces.forEach(p=>p.solid.delete());disposed=true;}}
 };
}
