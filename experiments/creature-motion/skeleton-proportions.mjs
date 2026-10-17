// Explicit semantic correspondence; no inference of anatomy from joint names.
const vec=v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite);
const sub=(a,b)=>a.map((v,i)=>v-b[i]),length=a=>Math.hypot(...a),distance=(a,b)=>length(sub(a,b));
const mean=a=>a.reduce((x,y)=>x+y,0)/a.length;
function checkProfile(profile){
 const chain=c=>Array.isArray(c)&&c.length>=3&&c.every(x=>typeof x==='string'&&x)&&new Set(c).size===c.length;
 if(profile?.schema!=='kaminos.quadruped-correspondence.v1'||typeof profile.id!=='string'||!profile.id||typeof profile.authority!=='string'||!profile.authority||!Array.isArray(profile.trunk)||profile.trunk.length!==2||profile.trunk.some(x=>typeof x!=='string')||!['fore','hind'].every(l=>['left','right'].every(s=>chain(profile[l]?.[s]))))throw Error('Invalid explicit correspondence chains');
}
const angle=(a,b)=>{const den=length(a)*length(b);return den<1e-10?null:Math.acos(Math.max(-1,Math.min(1,a.reduce((s,v,i)=>s+v*b[i],0)/den)))*180/Math.PI;};
export function referenceJoints(reference){
 const n=reference?.jointNames?.length;
 if(!n||new Set(reference.jointNames).size!==n||reference.parents?.length!==n||reference.positions?.length!==n*3||!reference.positions.every(Number.isFinite)||reference.parents.filter(p=>p===-1).length!==1||reference.parents.some((p,i)=>!Number.isInteger(p)||p< -1||p>=i))throw Error('Invalid reference skeleton');
 return reference.jointNames.map((name,i)=>({name,parent:reference.parents[i]===-1?null:reference.jointNames[reference.parents[i]],head:reference.positions.slice(i*3,i*3+3)}));
}
export function measureSkeleton(skeleton,profile){
 const joints=skeleton?.joints??referenceJoints(skeleton),by=new Map(joints.map(j=>[j.name,j]));
 if(!joints.length||by.size!==joints.length||joints.some(j=>typeof j.name!=='string'||!j.name||!vec(j.head)||j.parent&&!by.has(j.parent)))throw Error('Invalid skeleton origins or graph');
 for(const j of joints){const seen=new Set([j.name]);let p=j.parent;while(p){if(seen.has(p))throw Error('Cyclic skeleton graph');seen.add(p);p=by.get(p).parent;}}
 const result={schema:'kaminos.skeleton-proportions.v1',status:'unsupported',profile:profile?.id??null,authority:profile?.authority??'No explicit semantic correspondence',features:[],missing:[]};
 if(!profile){result.missing.push('No explicit semantic correspondence');return result;}
 checkProfile(profile);
 const point=name=>{const p=by.get(name)?.head;if(!p)result.missing.push('Missing landmark: '+name);return p;};
 const trunk=profile.trunk.map(point);
 if(trunk.some(p=>!p)){result.status='partial';return result;}
 const trunkLength=distance(...trunk);if(trunkLength<1e-10)throw Error('Degenerate trunk length');
 result.trunk={landmarks:[...profile.trunk],length:trunkLength};
 const add=(id,label,value,unit,joints)=>{if(!Number.isFinite(value))throw Error('Nonfinite proportion: '+id);result.features.push({id,label,value,unit,joints:[...new Set(joints)]});};
 const limbs={};
 for(const limb of ['fore','hind']){
  limbs[limb]=[];
  for(const side of ['left','right']){
   const names=profile[limb][side],points=names.map(point);let valid=points.every(Boolean);const segments=[];
   if(valid)for(let i=1;i<names.length;i++){
    let child=by.get(names[i]),total=0;const ancestor=names[i-1];
    while(child.parent&&child.name!==ancestor){const parent=by.get(child.parent);total+=distance(child.head,parent.head);child=parent;}
    if(child.name!==ancestor||total<1e-10){result.missing.push('Unsupported chain: '+names[i-1]+' → '+names[i]);valid=false;break;}
    segments.push(total);
   }
   limbs[limb].push({names,points,segments,valid});
  }
  const both=limbs[limb],label=limb==='fore'?'Forelimb':'Hindlimb',starts=both.map(x=>x.points[0]);
  if(starts.every(Boolean))add(limb==='fore'?'shoulderWidth':'hipWidth',limb==='fore'?'Shoulder width / trunk':'Hip width / trunk',distance(...starts)/trunkLength,'ratio',both.map(x=>x.names[0]));
  if(both.every(x=>x.valid)){
   const reaches=both.map(x=>x.segments.reduce((a,b)=>a+b,0));
   add(limb+'Reach',label+' chain / trunk',mean(reaches)/trunkLength,'ratio',both.flatMap(x=>x.names));
   add(limb+'ProximalFraction',label+' first segment / chain',mean(both.map((x,i)=>x.segments[0]/reaches[i])),'ratio',both.flatMap(x=>x.names));
   const bends=both.map(x=>{const a=sub(x.points[0],x.points[1]),b=sub(x.points[2],x.points[1]),den=length(a)*length(b);if(den<1e-10)return null;return Math.acos(Math.max(-1,Math.min(1,a.reduce((s,v,i)=>s+v*b[i],0)/den)))*180/Math.PI;});
   if(bends.every(Number.isFinite))add(limb+'Bend',label+' first rest bend',mean(bends),'degrees',both.flatMap(x=>x.names.slice(0,3)));
   else result.missing.push('Degenerate '+limb+' rest bend');
   add(limb+'Asymmetry',label+' L/R chain difference',Math.abs(reaches[0]-reaches[1])/mean(reaches),'fraction',both.flatMap(x=>x.names));
   // Three-landmark profiles do not assert that their terminal segment is a foot.
   if(both.every(x=>x.names.length>=4)){
    const directions=both.map(x=>angle(sub(x.points.at(-1),x.points.at(-2)),sub(trunk[1],trunk[0])));
    if(directions.every(Number.isFinite))add(limb+'FootForward',label+' terminal / trunk forward',mean(directions),'degrees',both.flatMap(x=>x.names.slice(-2)));
    else result.missing.push('Degenerate '+limb+' terminal direction');
   }
  }
 }
 const value=id=>result.features.find(f=>f.id===id),ratio=(id,label,a,b)=>{if(value(a)&&value(b)){if(value(b).value<1e-10){result.missing.push('Degenerate denominator: '+b);return;}add(id,label,value(a).value/value(b).value,'ratio',[...value(a).joints,...value(b).joints]);}};
 ratio('shoulderHipRatio','Shoulder / hip width','shoulderWidth','hipWidth');ratio('foreHindRatio','Fore / hind chain reach','foreReach','hindReach');
 result.status=result.missing.length?'partial':'measured';return result;
}
export function compareSkeletons(candidate,reference){
 const ids=[...new Set([...candidate.features,...reference.features].map(x=>x.id))],by=(m,id)=>m.features.find(x=>x.id===id);
 return {schema:'kaminos.skeleton-proportion-comparison.v1',candidate,reference,rows:ids.map(id=>{const a=by(candidate,id),b=by(reference,id),delta=a&&b?a.value-b.value:null;return {id,label:(a??b).label,unit:(a??b).unit,candidate:a?.value??null,reference:b?.value??null,delta,relativeDelta:delta!==null&&Math.abs(b.value)>1e-10&&b.unit==='ratio'?delta/b.value:null,joints:a?.joints??[]};})};
}

export function validateProportionAtlas(atlas){
 if(atlas===null||atlas===undefined)return null;
 if(atlas.schema!=='kaminos.skeleton-proportion-atlas.v1'||!Array.isArray(atlas.references)||!atlas.references.length||new Set(atlas.references.map(r=>r.id)).size!==atlas.references.length||!atlas.references.some(r=>r.id===atlas.activeReference))throw Error('Invalid proportion atlas references');
 if(!atlas.profile)throw Error('Atlas candidate needs explicit correspondence');
 checkProfile(atlas.profile);
 for(const r of atlas.references){if(typeof r.id!=='string'||!r.id||typeof r.label!=='string'||!r.label||!r.source||typeof r.source.path!=='string'||!/^[a-f0-9]{64}$/i.test(r.source.sha256??'')||!r.profile)throw Error('Atlas reference identity and correspondence required');referenceJoints(r);checkProfile(r.profile);}
 return structuredClone(atlas);
}
export function measureProportionAtlas(plan,atlas){
 atlas=validateProportionAtlas(atlas,plan);
 if(!atlas)return {status:'unsupported',reason:'No proportion atlas supplied'};
 const measured=(s,p)=>{try{return measureSkeleton(s,p);}catch(error){return {schema:'kaminos.skeleton-proportions.v1',status:'unmeasurable',profile:p.id,authority:p.authority,features:[],missing:[error.message]};}};
 const candidate=measured(plan,atlas.profile),references=atlas.references.map(r=>({id:r.id,label:r.label,source:r.source,comparison:compareSkeletons(candidate,measured(r,r.profile))}));
 return {schema:'kaminos.skeleton-proportion-atlas-measurement.v1',status:candidate.status,activeReference:atlas.activeReference,authority:'Descriptive rest geometry; not anatomical validity or measured motion support',candidate,references};
}
