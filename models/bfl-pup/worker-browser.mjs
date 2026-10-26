import {createBrowserPromptHelper} from './browser-backend.mjs';
let helper=null,activeRequest=null;
const send=(type,value,requestId=activeRequest)=>postMessage({type,value,requestId});
self.addEventListener('unhandledrejection',event=>send('error',String(event.reason?.stack||event.reason)));
self.onmessage=async({data})=>{
 if(activeRequest!==null){send('error','The prompt worker is already generating.',data.requestId);return;}
 activeRequest=data.requestId;let result,error;
 try{
  helper??=await createBrowserPromptHelper({modelUrl:data.modelUrl,onProgress:value=>send('progress',value)});
  result=await helper.expand({prompt:data.prompt,images:data.images,onText:value=>send('text',value)});
 }catch(failure){error=String(failure?.stack||failure);}
 finally{if(error||!data.keepLoaded){try{await helper?.dispose();}catch(failure){error=String(failure?.stack||failure);}helper=null;}}
 send(error?'error':'complete',error||result);activeRequest=null;
};
