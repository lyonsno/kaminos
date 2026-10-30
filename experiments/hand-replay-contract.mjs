const vector=v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite);
export function validateExport(receipt,generation){
  if(receipt?.status!=='observed')throw Error('export unavailable or failed');
  if(!generation||receipt.generation!==generation)throw Error('export generation mismatch');
}
export function validateReplay(data,receipt,generation){
  if(receipt!==undefined){validateExport(receipt,generation);if(data.generation!==generation)throw Error('sequence generation mismatch');}
  if(data.schema!=='hand-state.teacher-replay.v1'||!data.models?.length||!data.frames?.length)throw Error('invalid replay');
  if(data.models.some(m=>!m.id||!/^[a-f0-9]{64}$/.test(m.checkpointSha256)))throw Error('model identity missing');
  if(new Set(data.models.map(m=>m.id)).size!==data.models.length)throw Error('duplicate model');
  const ids=new Set();let previous=-Infinity;
  for(const f of data.frames){
    if(!f.captureId||ids.has(f.captureId))throw Error('duplicate or missing capture');ids.add(f.captureId);
    if(!Number.isFinite(f.timeMs)||f.timeMs<previous||!f.image)throw Error('invalid source time/image');previous=f.timeMs;
    if(f.hands?.length!==data.models.length)throw Error('incomplete model comparison');
    for(const h of f.hands){
      if(h.status==='observed'){
        if(h.vertices?.length!==778||h.joints?.length!==21||!h.vertices.every(vector)||!h.joints.every(vector))throw Error('invalid geometry');
      }else if(!['missing','ambiguous'].includes(h.status)||!h.reason)throw Error('unexplained missing output');
    }
  }
  return data;
}
export function frameAtTime(frames,t){
  let lo=0,hi=frames.length;
  while(lo<hi){const mid=(lo+hi)>>1;if(frames[mid].timeMs<=t)lo=mid+1;else hi=mid;}
  return Math.max(0,lo-1);
}
export function ballisticArc(origin,direction,speed=1,floor=-.25){
  const length=Math.hypot(...direction);
  if(!vector(origin)||!vector(direction)||length<1e-10||!Number.isFinite(speed)||speed<=0||floor>=origin[1])throw Error('invalid ballistic direction or floor');
  const v=direction.map(x=>x*speed/length),g=9.81;
  const duration=(v[1]+Math.sqrt(v[1]*v[1]+2*g*(origin[1]-floor)))/g;
  // Fixed rendering tessellation; analytic motion and endpoint are unchanged.
  return Array.from({length:49},(_,i)=>{const t=duration*i/48;return [origin[0]+v[0]*t,origin[1]+v[1]*t-.5*g*t*t,origin[2]+v[2]*t];});
}
