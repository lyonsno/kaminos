// Rest-pose editing is independent of motion playback and generated skin.
import {referenceJoints,measureSkeleton} from './skeleton-proportions.mjs';
const vector=v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite);
export function validateRestPlan(input) {
 if(input?.schema!=='kaminos.complete-creature-joints.v0'||!Array.isArray(input.joints)||!input.joints.length)throw Error('A complete-creature joint plan is required');
 const p=structuredClone(input),by=new Map(p.joints.map(j=>[j.name,j]));
 if(by.size!==p.joints.length||p.joints.some(j=>typeof j.name!=='string'||!j.name.trim()||!vector(j.head)||!vector(j.tail)||!Array.isArray(j.matrix)||j.matrix.length!==4||j.matrix.some(r=>!Array.isArray(r)||r.length!==4||!r.every(Number.isFinite))))throw Error('Invalid joint names, coordinates or matrices');
 if(p.joints.filter(j=>!j.parent).length!==1)throw Error('Exactly one root is required');
 if(p.rest_authoring?.symmetry){const s=p.rest_authoring.symmetry,used=new Set();if(s.axis!==0||!Array.isArray(s.pairs)||s.pairs.some(pair=>!Array.isArray(pair)||pair.length!==2||pair[0]===pair[1]||pair.some(n=>!by.has(n)||used.has(n))||(pair.forEach(n=>used.add(n)),false)))throw Error('Invalid explicit source symmetry pairs');}
 for(const j of p.joints){const seen=new Set([j.name]);let parent=j.parent;while(parent){if(seen.has(parent)||!by.has(parent))throw Error('Invalid parent or cyclic tree');seen.add(parent);parent=by.get(parent).parent;}
  if(j.parent&&Math.hypot(...j.head.map((v,k)=>v-by.get(j.parent).head[k]))<1e-8)throw Error('A joint edge cannot collapse: '+j.name);
 }
 return p;
}
export function withRestHeads(plan,heads) {
 const p=validateRestPlan(plan);
 if(!heads||Object.keys(heads).length!==p.joints.length||p.joints.some(j=>!Object.hasOwn(heads,j.name)||!vector(heads[j.name])))throw Error('Every joint requires exactly one finite head');
 for(const j of p.joints){const next=heads[j.name],delta=next.map((v,k)=>v-j.head[k]);if(delta.every(v=>v===0))continue;
  j.head=[...next];j.tail=j.tail.map((v,k)=>v+delta[k]);j.matrix=j.matrix.map((r,k)=>k<3?[...r.slice(0,3),next[k]]:[...r]);j.retained=false;
 }
 return validateRestPlan(p);
}
export function restHeads(plan){return Object.fromEntries(plan.joints.map(j=>[j.name,[...j.head]]));}
export function restJointPartner(plan,name){
 const pairs=plan.rest_authoring?.symmetry?.pairs;
 if(pairs){const pair=pairs.find(p=>p.includes(name));return pair?.find(n=>n!==name)??null;}
 return name.includes('-left-')?name.replace('-left-','-right-'):name.includes('-right-')?name.replace('-right-','-left-'):null;
}
export function moveRestJoint(plan, {name, position, mirror=false, descendants=false}={}) {
 const p=validateRestPlan(plan),by=new Map(p.joints.map(j=>[j.name,j]));
 if(!by.has(name)||!vector(position)||typeof mirror!=='boolean'||typeof descendants!=='boolean')throw Error('Choose a joint and three finite coordinates');
 const heads=restHeads(p),delta=position.map((v,k)=>v-heads[name][k]);
 const partner=restJointPartner(p,name);
 if(mirror&&!partner)delta[0]=0;
 const moves=new Map([[name,delta]]);
 if(mirror&&partner){if(!by.has(partner))throw Error('Mirrored joint is absent: '+partner);moves.set(partner,delta.map((v,k)=>k===0?-v:v));}
 const shift=(root,d)=>{for(const j of p.joints){let affected=j.name===root;for(let parent=j.parent;descendants&&parent;parent=by.get(parent).parent)if(parent===root)affected=true;
   if(affected)heads[j.name]=heads[j.name].map((v,k)=>v+d[k]);}};
 for(const [root,d]of moves)shift(root,d);
 return withRestHeads(p,heads);
}
export function authoredRestPlan(plan,{baselineSha256,displayMatrix,reference=null,view=null,referenceDisplay=null,scene=null,proportionAtlas=null}={}){
 const p=validateRestPlan(plan);
 if(!/^[a-f0-9]{64}$/i.test(baselineSha256??'')||!Array.isArray(displayMatrix)||displayMatrix.length!==16||!displayMatrix.every(Number.isFinite))throw Error('Source digest and explicit display frame required');
 p.authority='Authored rest-joint candidate; source sculpt unchanged; not a generated or anatomically certified motion';
 if(referenceDisplay!==null&&(!['off','side','overlay'].includes(referenceDisplay.mode)||!['x','z'].includes(referenceDisplay.axis)||typeof referenceDisplay.baseline!=='boolean'))throw Error('Invalid reference display');
 p.rest_authoring={schema:'kaminos.rest-skeleton-authoring.v1',baselineSha256,displayMatrix:[...displayMatrix],reference:structuredClone(reference),view:structuredClone(view),referenceDisplay:structuredClone(referenceDisplay)};
 if(plan.rest_authoring?.symmetry)p.rest_authoring.symmetry=structuredClone(plan.rest_authoring.symmetry);
 if(proportionAtlas!==null)p.rest_authoring.proportionAtlas=structuredClone(proportionAtlas);
 if(scene!==null){
  if(scene.referenceVisible!==undefined&&typeof scene.referenceVisible!=='boolean')throw Error('Invalid reference visibility');
  for(const key of ['skeleton','reference']){const pose=scene[key];if(pose===null&&key==='reference')continue;if(!pose||!['position','rotation','scale'].every(k=>vector(pose[k]))||pose.scale.some(v=>Math.abs(v)<1e-10))throw Error('Invalid skeleton scene transform');}
  p.rest_authoring.scene=structuredClone(scene);
 }
 return p;
}

// The atlas supplies explicit chains; name conventions here only pair the
// observed exemplar's side labels, never infer anatomical chains.
export function referenceRestPlan(reference){
 const joints=referenceJoints(reference),names=new Set(joints.map(j=>j.name));
 if(!/^[a-f0-9]{64}$/i.test(reference.source?.sha256??''))throw Error('Reference source digest required');
 const pairs=[];
 for(const name of names){const other=name.includes('_L_')?name.replace('_L_','_R_'):name.endsWith('_L')?name.slice(0,-2)+'_R':null;if(other&&names.has(other))pairs.push([name,other]);}
 const plan={schema:'kaminos.complete-creature-joints.v0',source_exemplar:{id:reference.id,label:reference.label,source:structuredClone(reference.source)},joints:joints.map(j=>{
  const child=joints.find(c=>c.parent===j.name),tail=child?[...child.head]:j.head.map((v,k)=>v+(k===1?.025:0));
  return {...j,tail,matrix:[[1,0,0,j.head[0]],[0,1,0,j.head[1]],[0,0,1,j.head[2]],[0,0,0,1]]};
 }),rest_authoring:{symmetry:{axis:0,pairs}}};
 return validateRestPlan(plan);
}
const sub=(a,b)=>a.map((v,i)=>v-b[i]),add=(a,b)=>a.map((v,i)=>v+b[i]),mul=(a,s)=>a.map(v=>v*s),dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),norm=a=>Math.hypot(...a);
const unit=a=>{const n=norm(a);if(n<1e-10)throw Error('Degenerate semantic body frame');return mul(a,1/n);};
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
function shapeContext(plan,profile){
 const measured=measureSkeleton(plan,profile);if(measured.status!=='measured')throw Error('Semantic editing needs complete explicit chains: '+measured.missing.join('; '));
 const by=new Map(plan.joints.map(j=>[j.name,j])),point=name=>{if(!by.has(name))throw Error('Missing semantic landmark: '+name);return by.get(name).head;},origin=point(profile.trunk[0]),forward=unit(sub(point(profile.trunk[1]),origin));
 const span=sub(point(profile.fore.left[0]),point(profile.fore.right[0])),lateral=unit(sub(span,mul(forward,dot(span,forward)))),up=unit(cross(forward,lateral));
 const branch=root=>plan.joints.filter(j=>{let name=j.name;while(name){if(name===root)return true;name=by.get(name).parent;}return false;}).map(j=>j.name);
 return {measured,by,point,origin,forward,lateral,up,branch,length:measured.trunk.length};
}
export function restShapeValues(plan,profile,part){
 const c=shapeContext(plan,profile);if(part==='trunk')return {length:c.length};if(!['fore','hind'].includes(part))throw Error('Unknown semantic body part');
 const chains=['left','right'].map(side=>profile[part][side]),starts=chains.map(chain=>c.point(chain[0])),center=mul(add(...starts),.5),relative=sub(center,c.origin);
 // Segment operations use actual origin edges. Refuse skipped helper joints
 // rather than claiming that changing a chord adjusts that path's length.
 for(const chain of chains)for(let i=1;i<chain.length;i++)if(c.by.get(chain[i]).parent!==chain[i-1])throw Error('Segment editing needs adjacent declared landmarks');
 const lengths=chains.map(chain=>chain.slice(1).map((name,i)=>norm(sub(c.point(name),c.point(chain[i]))))),totals=lengths.map(a=>a.reduce((s,v)=>s+v,0));
 return {width:dot(sub(starts[0],starts[1]),c.lateral)/c.length,height:dot(relative,c.up)/c.length,forward:dot(relative,c.forward)/c.length,reach:(totals[0]+totals[1])/2/c.length,proximalFraction:(lengths[0][0]/totals[0]+lengths[1][0]/totals[1])/2,segments:lengths[0].map((v,i)=>(v+lengths[1][i])/2/c.length)};
}
export function shapeRestPlan(input,profile,{part,property,value,index,pin='pelvis'}={}){
 const plan=validateRestPlan(input);if(!Number.isFinite(value))throw Error('Finite proportion required');
 const c=shapeContext(plan,profile),heads=restHeads(plan),values=restShapeValues(plan,profile,part);
 const shift=(root,delta)=>{for(const name of c.branch(root))heads[name]=add(heads[name],delta);};
 if(part==='trunk'){
  if(property!=='length'||value<=0||!['pelvis','front','feet'].includes(pin))throw Error('Positive trunk factor and explicit pelvis/front/feet pin required');
  const delta=c.length*(value-1),fixed=pin==='front'?1:0;
  const limbRoots=['fore','hind'].flatMap(l=>['left','right'].map(s=>profile[l][s][0])),owned=new Map();
  for(const root of limbRoots)for(const name of c.branch(root))owned.set(name,root);
  const planted=new Set(pin==='feet'?['fore','hind'].flatMap(l=>['left','right'].flatMap(s=>profile[l][s].slice(-2).flatMap(c.branch))):[]);
  for(const j of plan.joints){if(planted.has(j.name))continue;const p=c.point(owned.get(j.name)??j.name),t=Math.max(0,Math.min(1,dot(sub(p,c.origin),c.forward)/c.length));heads[j.name]=add(j.head,mul(c.forward,delta*(t-fixed)));}
 }else{
  const roots=['left','right'].map(s=>profile[part][s][0]);
  if(['width','height','forward'].includes(property)){
   if(property==='width'&&value<=0)throw Error('Positive girdle width required');
   roots.forEach((root,i)=>shift(root,mul(property==='width'?c.lateral:property==='height'?c.up:c.forward,(value-values[property])*c.length*(property==='width'?(i===0?.5:-.5):1))));
  }else if(property==='reach'){
   if(value<=0)throw Error('Positive limb reach required');
   const factor=value/values.reach;for(const root of roots)for(const name of c.branch(root))heads[name]=add(c.point(root),mul(sub(c.point(name),c.point(root)),factor));
  }else if(property==='segment'||property==='proximalFraction'){
   if(property==='segment'&&(!Number.isInteger(index)||index<0||index>=values.segments.length||value<=0))throw Error('Existing segment and positive length required');
   if(property==='proximalFraction'&&(value<=0||value>=1))throw Error('First segment fraction must be between zero and one');
   for(const side of ['left','right']){const chain=profile[part][side],lengths=chain.slice(1).map((name,i)=>norm(sub(c.point(name),c.point(chain[i])))),total=lengths.reduce((s,v)=>s+v,0);
    for(let i=0;i<lengths.length;i++){
     const desired=property==='segment'?(i===index?lengths[i]*(value/values.segments[i]):lengths[i]):i===0?total*value:lengths[i]*(total*(1-value)/(total-lengths[0]));
     shift(chain[i+1],mul(unit(sub(c.point(chain[i+1]),c.point(chain[i]))),desired-lengths[i]));
    }
   }
  }else throw Error('Unknown semantic proportion operation');
 }
 return withRestHeads(plan,heads);
}
