// Returned hinge meshes are immutable authored values. Mutable pose/connection
// metadata is copied independently; public reads and scene JSON still include
// the complete geometry. Native history keeps its own small references.
const retained=new WeakMap(),partIds=new WeakMap(),bodyIds=new WeakMap();let nextPartId=0,nextBodyId=0;
function freeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}
// Only privately owned values are cached; mutable imports must be read again.
export function retainHingeParts(parts){let owned=retained.get(parts);if(!owned){owned=freeze(structuredClone(parts));retained.set(owned,owned);partIds.set(owned,++nextPartId);}return owned;}
// Called on the normalizer’s already detached domain fields.
export function retainBodyGeometry(value){if(!bodyIds.has(value)){freeze(value);bodyIds.set(value,++nextBodyId);}return value;}
export function mechanismMetadata(value){
 const source={...value};if(value.attachments)source.attachments=value.attachments.map(a=>{if(!a.hardware?.parts)return a;const hardware={...a.hardware};delete hardware.parts;return {...a,hardware};});
 return structuredClone(source);
}
export function copyMechanism(value){const result=mechanismMetadata(value);for(const [i,a]of (value.attachments??[]).entries())if(a.hardware?.parts)result.attachments[i].hardware.parts=retainHingeParts(a.hardware.parts);return result;}
export function mechanismIdentity(value){return JSON.stringify(value,(_,v)=>partIds.has(v)?{'@retainedHingeParts':partIds.get(v)}:bodyIds.has(v)?{'@retainedBodyGeometry':bodyIds.get(v)}:v);}
