// FileSystemDirectoryHandle sink. Same portable format as sequence-directory.mjs.
// Every close commits a file; only one frame and its decoded pixels are resident.
const json=v=>JSON.stringify(v,null,2),encode=v=>new TextEncoder().encode(v);
const sha=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
async function inspectPNG(bytes){
 if(bytes.length<24||[137,80,78,71,13,10,26,10].some((b,i)=>bytes[i]!==b))throw Error('Capture is not PNG');
 const bitmap=await createImageBitmap(new Blob([bytes],{type:'image/png'}));
 try{
  const canvas=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);const p=ctx.getImageData(0,0,bitmap.width,bitmap.height).data;
  let first=null,varying=false;
  for(let i=0;i<p.length;i+=4){if(!p[i+3])continue;const c=p[i]*65536+p[i+1]*256+p[i+2];if(first===null)first=c;else if(first!==c){varying=true;break;}}
  if(!varying)throw Error('Capture is empty or uniform');
  return {width:bitmap.width,height:bitmap.height};
 }finally{bitmap.close();}
}
export async function createBrowserSequenceSink(directory,{inspect=inspectPNG}={}){
 for await(const _ of directory.entries())throw Error('Sequence output directory must be empty');
 let manifest={schema:'kaminos.simulation-sequence.v1',status:'preparing',complete:false,completedFrames:0,lastTrustworthyFrame:null,startedAt:new Date().toISOString(),framesFile:'frames.jsonl'},dimensions=null,bytesWritten=0,ledgerSize=0;
 const write=async(name,data,{append=false}={})=>{
  const handle=await directory.getFileHandle(name,{create:true}),stream=await handle.createWritable({keepExistingData:append});
  try{if(append)await stream.seek(ledgerSize);await stream.write(data);await stream.close();if(append)ledgerSize+=encode(data).length;}catch(e){await stream.abort().catch(()=>{});throw e;}
 };
 const save=()=>write('sequence.json',json(manifest));
 await save();await write('frames.jsonl','');
 return {
  async begin(meta){manifest={...manifest,...meta,status:'running',phase:'begin'};await save();},
  async initial(meta){const text=json(meta);await write('initial.json',text);manifest={...manifest,initialFile:'initial.json',initialSha256:await sha(encode(text)),requestedFrames:meta.schedule.count};await save();},
  async frame({image,...frame}){
   if(!Number.isSafeInteger(frame.index)||frame.index!==manifest.completedFrames)throw Error('Sequence frame order differs');
   const bytes=new Uint8Array(image),file=`frame-${String(frame.index).padStart(8,'0')}.png`;
   await write(file,bytes);const entry={...frame,file,bytes:bytes.length,sha256:await sha(bytes),status:'unverified'};
   try{const actual=await inspect(bytes);if(dimensions&&(actual.width!==dimensions.width||actual.height!==dimensions.height))throw Error('Export dimensions changed');dimensions=actual;Object.assign(entry,actual,{status:'verified'});}
   catch(e){entry.failure=String(e);await write('frames.jsonl',JSON.stringify(entry)+'\n',{append:true});throw e;}
   await write('frames.jsonl',JSON.stringify(entry)+'\n',{append:true});bytesWritten+=bytes.length;manifest={...manifest,status:'running',phase:'frame-written',completedFrames:frame.index+1,lastTrustworthyFrame:frame.index,dimensions,bytesWritten};await save();
  },
  async finish(result){manifest={...manifest,...result,finishedAt:new Date().toISOString()};await save();},
 };
}
