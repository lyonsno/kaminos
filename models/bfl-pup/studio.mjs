import {createPagePromptHelper} from './page-helper.mjs';
const $=id=>document.getElementById(id);
const modelUrl=new URLSearchParams(location.search).get('model')||'/models/bfl-pup-onnx';
let references=[],busy=false,controller=null,lastResult=null,leaseId=null,releaseOwed=null;
async function leasePost(body){
 const response=await fetch('/api/gpu-lease',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 if(!response.ok)throw Error(`GPU coordination HTTP ${response.status}`);
 return response.json();
}
function status(text,error=false){$('status').textContent=text;$('status').className=error?'error':'';}
function controls(){
 $('expand').disabled=busy||!$('prompt').value.trim();$('images').disabled=busy;
 $('cancel').hidden=!busy;$('prompt').readOnly=busy;$('output').readOnly=busy;
 $('copy').disabled=!$('output').value.trim();
}
function paintReferences(){
 $('refs').replaceChildren();$('mode').textContent=references.length?'Image edit':'Scene caption';
 for(const [index,item]of references.entries()){
  const figure=document.createElement('figure'),image=document.createElement('img'),caption=document.createElement('figcaption'),remove=document.createElement('button');
  image.src=item.url;image.alt=`Reference ${index+1}: ${item.file.name}`;caption.textContent=item.file.name;
  remove.textContent='×';remove.title=`Remove ${item.file.name}`;remove.disabled=busy;
  remove.onclick=()=>{URL.revokeObjectURL(item.url);references.splice(index,1);paintReferences();};
  figure.append(image,caption,remove);$('refs').append(figure);
 }
}
$('prompt').value=sessionStorage.getItem('kaminos-pup-browser-prompt')||'';
$('prompt').oninput=()=>{try{sessionStorage.setItem('kaminos-pup-browser-prompt',$('prompt').value);}catch{}controls();};
$('output').oninput=controls;
$('images').onchange=()=>{
 const added=Array.from($('images').files);$('images').value='';
 if(references.length+added.length>10){status('BFL supports up to 10 reference images.',true);return;}
 references.push(...added.map(file=>({file,url:URL.createObjectURL(file)})));paintReferences();
};
$('cancel').onclick=()=>controller?.abort(Error('Prompt expansion cancelled.'));
$('copy').onclick=async()=>{try{await navigator.clipboard.writeText($('output').value);status('Expanded prompt copied.');}catch(error){status('Clipboard unavailable; select and copy the expanded text.',true);}};
async function expand(){
 if(busy||!$('prompt').value.trim())return;
 busy=true;controller=new AbortController();lastResult=null;$('output').value='';$('timing').textContent='';controls();paintReferences();
 let helper=null,phase='loading';const started=performance.now();
 const timer=setInterval(()=>{$('timing').textContent=`${((performance.now()-started)/1000).toFixed(1)} s elapsed`;},100);
 status('Requesting the shared GPU…');
 try{
  if(releaseOwed){await leasePost({action:'release',leaseId:releaseOwed,reason:'retry prior settled prompt handback'});releaseOwed=null;}
  helper=createPagePromptHelper({modelUrl,post:leasePost,onWait:wait=>{phase='waiting';status(`Waiting for the shared GPU${wait.heldBy?.length?': '+wait.heldBy.join(', '):''}`);},onLease:lease=>{phase='expanding';leaseId=lease.status==='held'?lease.leaseId:null;$('coordination').textContent=lease.status==='unconfigured'?'Shared GPU coordination is unavailable on this server. Other jobs may run at the same time.':'Uses the shared GPU when available; releases the model after each request.';},onProgress:event=>{
   const label=event.phase==='processor'?'Loading the text and image processor…':'Loading the prompt model…';
   status(event.progress?`${label} ${Math.round(event.progress)}%`:label);
  }});
  phase='expanding';
  const result=await helper.expand({prompt:$('prompt').value,images:references.map(item=>item.url),signal:controller.signal,onText:text=>{
   status('Expanding your request…');$('output').value=text;
  }});
  lastResult=result;$('output').value=result.text;
  status(result.partial?'The helper reached its output limit. The partial text is editable.':'Expanded prompt complete. Edit it before using it in Generate.',result.partial);
  $('timing').textContent=`${(result.generationMs/1000).toFixed(1)} s generation · ${(result.totalMs/1000).toFixed(1)} s total`;
 }catch(error){
  lastResult={...(error.result||{}),status:'failed',phase,error:String(error),modelUrl,partialText:$('output').value,greenroomHandback:error.greenroomHandback};
  const message=String(error?.message||error).split('\n')[0].replace(/^(Error:\s*)+/,'');
  status(/Model provenance HTTP/.test(message)?message.replace('Model provenance','Could not load the prompt model ·'):message,true);
  $('timing').textContent=`Stopped after ${((performance.now()-started)/1000).toFixed(1)} s`;
 }finally{
  clearInterval(timer);
  try{await helper?.dispose();}catch(error){status(`Could not release the prompt model: ${error.message}`,true);}
  $('details').textContent=JSON.stringify(lastResult,null,2);
  const handback=lastResult?.greenroomHandback;
  if(handback?.state==='release-failed')releaseOwed=handback.leaseId;
  else if(lastResult?.gpuLease?.releaseError&&lastResult.gpuLease.state!=='kept-blocking')releaseOwed=lastResult.gpuLease.leaseId;
  leaseId=null;busy=false;controller=null;controls();paintReferences();
 }
}
$('expand').onclick=expand;
$('prompt').onkeydown=event=>{if((event.metaKey||event.ctrlKey)&&event.key==='Enter'){event.preventDefault();expand();}};
window.addEventListener('pagehide',()=>{controller?.abort(Error('Page closed.'));for(const id of [leaseId,releaseOwed])if(id)navigator.sendBeacon?.('/api/gpu-lease',new Blob([JSON.stringify({action:'release',leaseId:id,reason:'prompt page closed'})],{type:'application/json'}));for(const item of references)URL.revokeObjectURL(item.url);});
controls();window.pupStudio={expand,get result(){return lastResult;},get busy(){return busy;}};
