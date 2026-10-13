// kaminos-test: helper — imported local GLB byte fixture; not a standalone test
// Local byte-admission fixture, not GLTF-loader or browser evidence. Existing
// actual-Three tests deliberately supply their own registered root/clip.
const json=new TextEncoder().encode('{"asset":{"version":"2.0"}}  ');
export const bytes=new Uint8Array(20+json.length);const view=new DataView(bytes.buffer);
view.setUint32(0,0x46546c67,true);view.setUint32(4,2,true);view.setUint32(8,bytes.length,true);
view.setUint32(12,json.length,true);view.setUint32(16,0x4e4f534a,true);bytes.set(json,20);
const original=globalThis.fetch;
globalThis.fetch=async(input,options)=>typeof input==='string'&&input.startsWith('/')?new Response(bytes):original(input,options);
export const bodySha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
