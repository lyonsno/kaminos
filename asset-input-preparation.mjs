// Byte acquisition has no renderer dependency. Decoding and publication stay with
// the ordinary GLTF loader after the lighting owner has released the renderer.
export async function readAssetBytes(input,{fetch:request=globalThis.fetch,signal,progress=()=>{}}={}){
 if(typeof input!=='string'){
  const bytes=await input.arrayBuffer();progress({loadedBytes:bytes.byteLength,totalBytes:bytes.byteLength});return bytes;
 }
 const response=await request(input,{signal});
 if(!response.ok)throw Error(`Mesh source HTTP ${response.status}`);
 if(!response.body?.getReader)return response.arrayBuffer();
 const reader=response.body.getReader(),chunks=[];let length=0;
 const header=response.headers.get('content-length'),total=header==null?undefined:Number(header);
 try{for(;;){const {done,value}=await reader.read();if(done)break;chunks.push(value);length+=value.byteLength;progress({loadedBytes:length,totalBytes:total});}}
 finally{reader.releaseLock();}
 const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}return bytes.buffer;
}
