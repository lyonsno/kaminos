const digest=bytes=>crypto.subtle.digest('SHA-256',bytes).then(value=>Array.from(new Uint8Array(value),b=>b.toString(16).padStart(2,'0')).join(''));
export function mountedImageSource(source) {
  const url=new URL(source,location.href);
  if(url.origin!==location.origin||!((url.pathname==='/api/read'&&url.searchParams.get('root')&&url.searchParams.get('path'))||(url.pathname==='/api/job-output'&&url.searchParams.get('job_id')&&url.searchParams.get('file'))))throw Error('Generation source must be a mounted image asset');
  return url;
}
export function validateImagePreparation(value,original) {
  const prepared=value?.prepared;
  if(value?.schema!=='kaminos.image-preparation.v1'||value.status!=='complete'||value.original?.source!==original.source||value.original?.sha256!==original.sha256||!/^[a-f0-9]{64}$/.test(original.sha256)||!['input-alpha','rembg-u2net-cpu'].includes(value.route)||!prepared?.source?.startsWith('/api/read?root=image-preparations&path=')||!/^[a-f0-9]{64}$/.test(prepared.sha256)||!Number.isInteger(prepared.width)||!Number.isInteger(prepared.height)||!(prepared.width>0&&prepared.height>0)||!Number.isInteger(value.foregroundPixels)||value.foregroundPixels<1)throw Error('Image preparation returned a different or incomplete input');
  if(value.route==='rembg-u2net-cpu'&&(!/^[a-f0-9]{64}$/.test(value.model?.sha256)||value.providers?.length!==1||value.providers[0]!=='CPUExecutionProvider'))throw Error('Background removal did not use the declared CPU model');
  return value;
}
export function createImagePreparation({request=fetch}={}) {
  return async(input,{signal}={})=>{
    mountedImageSource(input.source);
    const response=await request(input.source,{signal});if(!response.ok)throw Error(`Source image HTTP ${response.status}`);
    const bytes=await response.arrayBuffer(),sha256=await digest(bytes);
    const original={source:input.source,sha256};
    const result=await request('/api/prepare-image?'+new URLSearchParams({source:input.source,name:input.name||input.label||'image.png',sha256}),{method:'POST',body:bytes,signal});
    const value=await result.json();if(!result.ok)throw Error(value.error||`Image preparation HTTP ${result.status}`);
    return validateImagePreparation(value,original);
  };
}
