import {createBrowserPromptHelper} from './browser-backend.mjs';
// A runtime's orphaned async rejection must not strand the outer load promise.
self.addEventListener('unhandledrejection',event=>postMessage({type:'error',value:String(event.reason?.stack||event.reason)}));
self.onmessage=async({data})=>{
 let helper,result,error;
 try{
  helper=await createBrowserPromptHelper({modelUrl:data.modelUrl,onProgress:value=>postMessage({type:'progress',value})});
  result=await helper.expand({prompt:data.prompt,images:data.images,onText:value=>postMessage({type:'text',value})});
 }catch(failure){error=String(failure?.stack||failure);}
 finally{try{await helper?.dispose();}catch(failure){error=String(failure?.stack||failure);}}
 postMessage(error?{type:'error',value:error}:{type:'complete',value:result});
};
