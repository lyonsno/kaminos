export async function readNdjsonResult(response,{isProgress,isResult,onProgress,missingResult}) {
  const contentType=response.headers.get('Content-Type')??'';
  if(!contentType.includes('application/x-ndjson')||!response.body)return response.json();
  const reader=response.body.getReader(),decoder=new TextDecoder();
  let buffer='',result=null;
  function take(line){
    if(!line.trim())return;
    const event=JSON.parse(line);
    if(isProgress(event))onProgress?.(event);
    else if(isResult(event))result=event;
  }
  try{
    while(true){
      const {value,done}=await reader.read();
      if(done)break;
      buffer+=decoder.decode(value,{stream:true});
      const lines=buffer.split(/\r?\n/);
      buffer=lines.pop();
      for(const line of lines)take(line);
    }
    take(buffer+decoder.decode());
    if(result===null)throw Error(missingResult);
    return result;
  }finally{
    reader.releaseLock();
  }
}
