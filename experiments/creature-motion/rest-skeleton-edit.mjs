// Rest-pose editing is independent of motion playback and generated skin.
const vector=v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite);
export function validateRestPlan(input) {
 if(input?.schema!=='kaminos.complete-creature-joints.v0'||!Array.isArray(input.joints)||!input.joints.length)throw Error('A complete-creature joint plan is required');
 const p=structuredClone(input),by=new Map(p.joints.map(j=>[j.name,j]));
 if(by.size!==p.joints.length||p.joints.some(j=>typeof j.name!=='string'||!j.name.trim()||!vector(j.head)||!vector(j.tail)||!Array.isArray(j.matrix)||j.matrix.length!==4||j.matrix.some(r=>!Array.isArray(r)||r.length!==4||!r.every(Number.isFinite))))throw Error('Invalid joint names, coordinates or matrices');
 if(p.joints.filter(j=>!j.parent).length!==1)throw Error('Exactly one root is required');
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
export function moveRestJoint(plan, {name, position, mirror=false, descendants=false}={}) {
 const p=validateRestPlan(plan),by=new Map(p.joints.map(j=>[j.name,j]));
 if(!by.has(name)||!vector(position)||typeof mirror!=='boolean'||typeof descendants!=='boolean')throw Error('Choose a joint and three finite coordinates');
 const heads=restHeads(p),delta=position.map((v,k)=>v-heads[name][k]);
 const partner=name.includes('-left-')?name.replace('-left-','-right-'):name.includes('-right-')?name.replace('-right-','-left-'):null;
 if(mirror&&!partner)delta[0]=0;
 const moves=new Map([[name,delta]]);
 if(mirror&&partner){if(!by.has(partner))throw Error('Mirrored joint is absent: '+partner);moves.set(partner,delta.map((v,k)=>k===0?-v:v));}
 const shift=(root,d)=>{for(const j of p.joints){let affected=j.name===root;for(let parent=j.parent;descendants&&parent;parent=by.get(parent).parent)if(parent===root)affected=true;
   if(affected)heads[j.name]=heads[j.name].map((v,k)=>v+d[k]);}};
 for(const [root,d]of moves)shift(root,d);
 return withRestHeads(p,heads);
}
export function authoredRestPlan(plan,{baselineSha256,displayMatrix,reference=null,view=null,referenceDisplay=null,scene=null}={}){
 const p=validateRestPlan(plan);
 if(!/^[a-f0-9]{64}$/i.test(baselineSha256??'')||!Array.isArray(displayMatrix)||displayMatrix.length!==16||!displayMatrix.every(Number.isFinite))throw Error('Source digest and explicit display frame required');
 p.authority='Authored rest-joint candidate; source sculpt unchanged; not a generated or anatomically certified motion';
 if(referenceDisplay!==null&&(!['off','side','overlay'].includes(referenceDisplay.mode)||!['x','z'].includes(referenceDisplay.axis)||typeof referenceDisplay.baseline!=='boolean'))throw Error('Invalid reference display');
 p.rest_authoring={schema:'kaminos.rest-skeleton-authoring.v1',baselineSha256,displayMatrix:[...displayMatrix],reference:structuredClone(reference),view:structuredClone(view),referenceDisplay:structuredClone(referenceDisplay)};
 if(scene!==null){
  if(scene.referenceVisible!==undefined&&typeof scene.referenceVisible!=='boolean')throw Error('Invalid reference visibility');
  for(const key of ['skeleton','reference']){const pose=scene[key];if(pose===null&&key==='reference')continue;if(!pose||!['position','rotation','scale'].every(k=>vector(pose[k]))||pose.scale.some(v=>Math.abs(v)<1e-10))throw Error('Invalid skeleton scene transform');}
  p.rest_authoring.scene=structuredClone(scene);
 }
 return p;
}
