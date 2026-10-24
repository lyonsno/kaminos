// Shared by the browser witness and deterministic replay tests.
export function checkRefinement(before,after,selected){
 if(before.labels.length!==after.labels.length)throw Error('Refinement lost source faces');
 const groups=new Map();for(let i=0;i<after.labels.length;i++){const id=after.labels[i],old=before.labels[i];if(groups.has(id)&&groups.get(id)!==old)throw Error('Finer here merged inherited groups');groups.set(id,old);}
 const nodes=before.hierarchy.nodes,inside=id=>{while(id!==null){if(id===selected)return true;id=nodes[id].parent;}return false;};
 let saturated=true,changed=0;
 for(let i=0;i<before.labels.length;i++){
  const a=before.partition.parts[before.labels[i]].nodeId,b=after.partition.parts[after.labels[i]].nodeId,finest=before.hierarchy.faceOwners[i];
  if(inside(finest)){if(a!==finest)saturated=false;}else if(a!==b)throw Error('Refinement changed an outside face');
  if(a!==b)changed++;
 }
 if(saturated&&changed)throw Error('Saturated refinement changed grouping');
 if(!saturated&&after.partition.parts.length<=before.partition.parts.length)throw Error('Inherited refinement did not expose finer parts');
 return {status:saturated?'saturated':'refined',selected,changedTriangles:changed};
}

export function checkBoundaryChange(before,after,key,{requireChange=true}={}){
 if(before.triangleCount!==after.triangleCount||after.labels.length!==before.triangleCount)throw Error('Missing source triangle ownership during boundary edit');
 const a=before.candidateBranches.find(c=>c.key===key&&c.status==='included'),b=after.candidateBranches.find(c=>c.key===key&&c.status==='included');
 if(!a||!b)throw Error('Selected attachment boundary is missing');
 const old=new Set(a.faces),now=new Set(b.faces),changed=a.faces.filter(f=>!now.has(f)).length+b.faces.filter(f=>!old.has(f)).length;
 if(requireChange&&!changed)throw Error('Attachment boundary did not move');
 let preserved=0;
 for(const c of before.candidateBranches){if(c.status!=='included'||c.key===key||c.faces.every(f=>old.has(f)))continue;
  const next=after.candidateBranches.find(n=>n.key===c.key&&n.status==='included');
  if(!next||JSON.stringify(next.faces)!==JSON.stringify(c.faces))throw Error(`Changed neighboring attachment ${c.key}`);preserved++;
 }
 return {changedTriangles:changed,preservedOtherCuts:preserved};
}
