// Pose equivalence permits rebuilding cached collision representations on restore.
export const sameAshCollisionPoses=(a,b)=>{
  if(!Array.isArray(a)||!Array.isArray(b)||!a.length||!b.length)return false;
  const byId=list=>{const map=new Map();for(const m of list){if(!m||typeof m.key!=='string'||!Array.isArray(m.matrix)||m.matrix.length!==16)return null;const id=m.key.split(':')[0];if(!map.has(id))map.set(id,[]);map.get(id).push(m.matrix);}return map;};
  const ma=byId(a),mb=byId(b);if(!ma||!mb||ma.size!==mb.size)return false;
  for(const [id,matsB] of mb){const matsA=ma.get(id);if(!matsA)return false;for(const mb0 of matsB)if(!matsA.some(ma0=>ma0.every((v,i)=>Math.abs(v-mb0[i])<1e-6)))return false;for(const ma0 of matsA)if(!matsB.some(mb0=>mb0.every((v,i)=>Math.abs(v-ma0[i])<1e-6)))return false;}
  return true;
 };
