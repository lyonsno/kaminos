const schema='kaminos.material-photo-example.v1';
const roles=['albedo','roughness','metallic','orm'];
const encode=typed=>{
  const bytes=new Uint8Array(typed.buffer,typed.byteOffset,typed.byteLength);
  let text='';for(let i=0;i<bytes.length;i+=4096)text+=String.fromCharCode(...bytes.subarray(i,i+4096));
  return btoa(text);
};
function decode(text,Type,length){
  if(typeof text!=='string')throw Error('Missing example channel');
  const bytes=Uint8Array.from(atob(text),char=>char.charCodeAt(0));
  if(bytes.byteLength!==length*Type.BYTES_PER_ELEMENT)throw Error('Invalid example channel length');
  return new Type(bytes.buffer);
}
function dimensions(width,height){
  if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<2||height<2)throw Error('Invalid example dimensions');
  return width*height;
}
function validateProvenance(value){
  if(value?.source!=='included-example'||!value.inputKey||!value.revision||value.record?.status!=='done'||!value.record.moge?.weights||!value.record.supermat?.identity){
    throw Error('Included example requires completed model output provenance');
  }
}
// Display packs retain exact depth/normal floats and the RGBA maps the viewer
// consumes. Float decoder planes remain in the generation evidence, not this download.
export function encodeExample({depth,output,provenance}){
  validateProvenance(provenance);
  const result={schema,provenance,geometrySize:[depth.width,depth.height],materialSize:[output.width,output.height],
    depth:encode(depth.depth),normals:encode(depth.normals),maps:Object.fromEntries(roles.map(role=>[role,encode(output.maps[role].data)]))};
  decodeExample(result,provenance.inputKey);
  return result;
}
export function decodeExample(pack,inputKey){
  if(pack?.schema!==schema)throw Error('Unknown included example format');
  validateProvenance(pack.provenance);
  if(pack.provenance.inputKey!==inputKey)throw Error('Included example input does not match photograph');
  const [width,height]=pack.geometrySize??[],count=dimensions(width,height);
  const [mw,mh]=pack.materialSize??[],pixels=dimensions(mw,mh);
  const depth={width,height,depth:decode(pack.depth,Float32Array,count),normals:decode(pack.normals,Float32Array,count*3)};
  const maps={};
  for(const role of roles){if(!pack.maps?.[role])throw Error(`Missing example map ${role}`);maps[role]={width:mw,height:mh,data:decode(pack.maps[role],Uint8ClampedArray,pixels*4)};}
  if(depth.normals.some(value=>!Number.isFinite(value))||!depth.depth.some(value=>Number.isFinite(value)&&value>0))throw Error('Invalid example geometry');
  return {depth,output:{width:mw,height:mh,maps},provenance:pack.provenance};
}
const pending=new Map();
export async function loadIncludedExample(sample,inputKey){
  if(!['orb','celebration','bag'].includes(sample))return null;
  if(!pending.has(sample))pending.set(sample,(async()=>{
    const response=await fetch(new URL(`./examples/${sample}.json.gz`,import.meta.url));
    if(!response.ok)throw Error(`Included example HTTP ${response.status}`);
    return new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).json();
  })().catch(error=>{pending.delete(sample);throw error;}));
  const pack=await pending.get(sample);
  if(pack.provenance?.sample!==sample||pack.provenance?.size!==512)throw Error('Wrong included example');
  return decodeExample(pack,inputKey);
}
