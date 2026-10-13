// Creature-owned byte admission. The shared URL loader consumes exactly these
// bytes, not a second fetch of a mutable source URL. Tokens are transient, never
// part of the durable recipe, and live only during serialized reconstruction.
const prepared=new Map();
const digest=bytes=>crypto.subtle.digest('SHA-256',bytes).then(buffer=>Array.from(new Uint8Array(buffer),v=>v.toString(16).padStart(2,'0')).join(''));
export function validateCreatureTransform(value) {
 for(const [name,size] of [['position',3],['quaternion',4],['scale',3]])
  if(!Array.isArray(value?.[name])||value[name].length!==size||!value[name].every(Number.isFinite))throw Error(`Creature transform ${name} is invalid`);
 if(Math.abs(Math.hypot(...value.quaternion)-1)>1e-6)throw Error('Creature transform quaternion is not normalized');
 return structuredClone(value);
}
function selfContainedGlb(bytes) {
 const view=new DataView(bytes);
 if(bytes.byteLength<20||view.getUint32(0,true)!==0x46546c67||view.getUint32(4,true)!==2||view.getUint32(8,true)!==bytes.byteLength||view.getUint32(16,true)!==0x4e4f534a)throw Error('Creature body requires a complete GLB v2');
 const end=20+view.getUint32(12,true);if(end>bytes.byteLength)throw Error('Creature GLB JSON chunk is incomplete');
 const json=JSON.parse(new TextDecoder().decode(bytes.slice(20,end)));
 for(const resource of [...(json.buffers??[]),...(json.images??[])])
  if(resource.uri&&!resource.uri.startsWith('data:'))throw Error('Creature body content identity requires embedded GLB resources');
}
async function prepare(asset,expected) {
 if(expected!==undefined&&!/^[a-f0-9]{64}$/i.test(expected))throw Error('Creature body digest is invalid');
 const response=await fetch(asset,{cache:'no-store'});
 if(!response.ok)throw Error(`Creature body fetch failed: ${response.status}`);
 const bytes=await response.arrayBuffer(),bodySha256=await digest(bytes);
 if(expected!==undefined&&bodySha256!==expected.toLowerCase())throw Error('Creature body content digest differs from retained identity');
 selfContainedGlb(bytes);
 const url=URL.createObjectURL(new Blob([bytes],{type:'model/gltf-binary'}));let released=false;
 return {asset,url,bodySha256,release(){if(!released){released=true;URL.revokeObjectURL(url);}}};
}
export async function acquireCreatureBody(inputs) {
 if(inputs._bodyToken!==undefined){
  const body=prepared.get(inputs._bodyToken);prepared.delete(inputs._bodyToken);
  if(!body||body.asset!==inputs.asset||body.bodySha256!==inputs.body_sha256)throw Error('Creature prepared body identity is invalid');
  // The existing shared entry writes these same inputs into its return URL.
  // Consume the transient transport field before that callback can persist it.
  delete inputs._bodyToken;
  return body;
 }
 return prepare(inputs.asset,inputs.body_sha256);
}
export async function prepareCreatureReopen(recipe) {
 validateCreatureTransform(recipe.inputs.transform);
 if(!/^[a-f0-9]{64}$/i.test(recipe.inputs.body_sha256??''))throw Error('Retained creature body identity is unverified');
 // Reject changed content before entry.open disposes the current experiment.
 const body=await prepare(recipe.inputs.asset,recipe.inputs.body_sha256),token=crypto.randomUUID();prepared.set(token,body);return token;
}
export function releaseCreatureReopen(token){const body=prepared.get(token);prepared.delete(token);body?.release();}
export async function reopenPreparedCreature(entry,recipe,token) {
 const body=prepared.get(token);
 if(!body||body.asset!==recipe.inputs.asset||body.bodySha256!==recipe.inputs.body_sha256)throw Error('Creature prepared body identity is invalid');
 try{return await entry.open(recipe.id,{...recipe.inputs,_bodyToken:token});}
 finally{prepared.delete(token);body.release();}
}
export async function reopenVerifiedCreature(entry,recipe) {return reopenPreparedCreature(entry,recipe,await prepareCreatureReopen(recipe));}
