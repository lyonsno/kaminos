// Full export in transport-sized chunks: large HTTP post bodies also travel through
// Chromium DevTools events, where run03 hit Node's 512 MiB string ceiling.
export async function exportRaw(name, values, send=fetch) {
 const bytes=new Uint8Array(values.buffer,values.byteOffset,values.byteLength);
 for(let offset=0;offset<bytes.length;offset+=1024*1024) {
  const response=await send('/raw/'+name,{method:'POST',body:bytes.subarray(offset,offset+1024*1024),headers:{'X-Byte-Offset':String(offset)}});
  if(!response.ok)throw Error('Raw export failed '+name+' at '+offset);
 }
}
