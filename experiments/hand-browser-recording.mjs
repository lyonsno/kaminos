export function startHandRecording({canvas,write,MediaRecorder=globalThis.MediaRecorder}){
  const mimeType=['video/webm;codecs=vp9','video/webm'].find(type=>MediaRecorder?.isTypeSupported(type));
  if(!mimeType)throw Error('Rendered hand recording requires WebM recording support');
  const stream=canvas.captureStream();let recorder;
  try{recorder=new MediaRecorder(stream,{mimeType});}catch(error){stream.getTracks().forEach(t=>t.stop());throw error;}
  let tail=Promise.resolve(),part=0,failure=null,stopping;
  recorder.ondataavailable=event=>{
    if(!event.data.size)return;
    const index=part++;
    tail=tail.then(()=>write(event.data,index)).catch(error=>{failure??=error;});
  };
  recorder.onerror=event=>{failure??=event.error??Error('Rendered hand recording failed');};
  recorder.start(1000);
  return {mimeType:recorder.mimeType,check(){if(failure)throw failure;},stop(){
    stopping??=(async()=>{
      try{
        if(recorder.state!=='inactive')await new Promise(resolve=>{recorder.onstop=resolve;recorder.stop();});
        await tail;if(failure)throw failure;
        return {mimeType:recorder.mimeType,parts:part};
      }finally{stream.getTracks().forEach(t=>t.stop());}
    })();return stopping;
  }};
}
