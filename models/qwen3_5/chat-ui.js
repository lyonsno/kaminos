import { loadChatExample, withChatAdmission } from './chat-browser.js';
const $=id=>document.getElementById(id), query=new URLSearchParams(location.search);
let runtime=null, active=null, loading=false, controller=null;
const history=[];
const admissions=[];
let admissionState=null;
async function admitted(work,signal){
 try { const held=await withChatAdmission({signal,onAdmitted:lease=>{admissionState=lease;status('Starting model work…');},post:async body=>{
  const r=await fetch('/api/gpu-lease',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data=await r.json();if(!r.ok)throw Error(data.error??'GPU admission unavailable');return data;
 },onWait:w=>status(`Waiting for GPU · ${w.position?'queue position '+w.position:'another run is active'}`),
 unsettledWork:async()=>runtime?.model.active||runtime?.model.loading?['chat model']:[]},work);
 admissions.push(held.lease);return held.result;
 }catch(e){if(e.lease??e.greenroomHandback)admissions.push(e.lease??e.greenroomHandback);throw e;}
}
async function modelSettings(){
 if(query.has('manifest'))return {manifestUrl:new URL(query.get('manifest'),location.href),manifestSha256:query.get('sha'),modelUrl:new URL(query.get('model')??'/model/',location.href)};
 const r=await fetch('/api/runtime-config');if(!r.ok)throw Error('Kaminos model configuration unavailable');const c=await r.json(),m=c.qwen35;
 if(!m?.mounted)throw Error(c.modelAvailability?.qwen35?.reason??'Native Qwen model is not installed.');
 return {manifestUrl:new URL(m.manifestUrl,location.href),manifestSha256:m.manifestSha256,modelUrl:new URL(m.modelUrl.replace(/\/$/,'')+'/',location.href)};
}
function status(text,error=false){$('status').textContent=(admissionState?.status==='unconfigured'?'No GPU queue configured · ':'')+text;$('status').classList.toggle('error',error);}
function controls(){const busy=loading||Boolean(active);$('load').disabled=busy||Boolean(runtime);$('system').disabled=busy;$('send').disabled=busy||!runtime;$('reset').disabled=busy||!runtime;$('unload').disabled=busy||!runtime;$('stop').disabled=!busy;$('mode').disabled=busy||!runtime?.model.delta;$('rank').disabled=busy||!runtime?.model.delta;}
function message(role,text){const article=document.createElement('article');article.className=role;const name=document.createElement('strong');name.textContent=role;const body=document.createElement('div');body.textContent=text;article.append(name,body);$('conversation').append(article);return body;}
async function load(){if(loading||runtime)throw Error('Model already loaded or loading');loading=true;controller=new AbortController();controls();status('Loading model weights…');
 try{const settings=await modelSettings();await admitted(async()=>{runtime=await loadChatExample({...settings,systemPrompt:$('system').value,signal:controller.signal,onProgress:p=>status(`Loading model weights · ${p.loaded??p.completed??''} ${p.total?'/ '+p.total:''}`)});return runtime;},controller.signal);if(runtime.identity.delta){$('delta-controls').hidden=false;$('rank').max=String(runtime.identity.delta.maxRank);$('rank').value=String(runtime.identity.delta.rank);$('mode').value='off';}
 status(`Model loaded · ${runtime.identity.capacity.toLocaleString()} token context · ${(runtime.identity.loadMs/1000).toFixed(2)} s loading`);return runtime.identity;}
 catch(e){status(String(e.message??e),true);throw e;}finally{loading=false;controller=null;controls();}}
async function send(text,options={}){if(!runtime||active)throw Error('Load the model and finish the current turn first');controller=new AbortController();message('user',text);const body=message('assistant','');status('Reading your message…');
 const record={user:text,assistant:'',status:'running',modelIdentity:structuredClone(runtime.identity),systemPrompt:runtime.chat.snapshot().systemPrompt};history.push(record);
 active=(async()=>{try{const limit=$('limit').value;const result=await admitted(()=>runtime.chat.send({text,...(limit?{maxNewTokens:Number(limit)}:{}),...options,signal:controller.signal,onText:(_,full)=>{body.textContent=full;record.assistant=full;status('Generating…');}}),controller.signal);
 record.status='complete';record.result=result;const u=result.usage;status(`${(u.totalMs/1000).toFixed(2)} s · ${u.reusedInputTokens} input tokens reused, ${u.evaluatedInputTokens} evaluated · ${result.tokenIds.length} reply tokens · ${result.finishReason}${u.firstTokenMs===null?'':` · first token ${(u.firstTokenMs/1000).toFixed(2)} s`}`);return result;
 }catch(e){if(e.result){record.status='complete-handback-failed';record.result=e.result;record.assistant=e.result.text;body.textContent=e.result.text;record.error=String(e.message??e);status(`Response completed and added to the conversation; ${record.error}`,true);throw e;}record.status=e.name==='AbortError'?'stopped':'failed';record.error=String(e.message??e);status(`${record.status}: ${record.error}. This partial turn is saved here but has not been added to the model’s conversation.`,true);throw e;}
 finally{active=null;controller=null;controls();}})();controls();return active;}
async function reset(){if(active||loading)throw Error('Stop the active turn first');loading=true;controls();try{await runtime?.chat.reset({systemPrompt:$('system').value});$('conversation').replaceChildren();status('New conversation with the current system instruction. Model weights remain loaded.');}finally{loading=false;controls();}}
async function unload(){if(active||loading)throw Error('Stop the active turn first');loading=true;controls();try{await runtime?.dispose();runtime=null;$('delta-controls').hidden=true;status('Model unloaded.');}finally{loading=false;controls();}}
async function setMode({enabled=$('mode').value==='on',rank=Number($('rank').value)}={}){
 if(active||loading||!runtime?.model.delta)throw Error('Finish model work before switching adapter mode');
 if(!Number.isSafeInteger(rank)||rank<1||rank>runtime.model.delta.maxRank)throw Error('Rank must be within the extracted adapter capacity');
 const changed=runtime.model.delta.enabled!==enabled||(enabled&&runtime.model.delta.rank!==rank);
 loading=true;controls();try{if(changed)await runtime.chat.reset({systemPrompt:$('system').value});const result=await runtime.model.setDeltaMode({enabled,rank});runtime.identity.delta={...runtime.identity.delta,enabled,rank};$('mode').value=enabled?'on':'off';$('rank').value=String(rank);if(changed)$('conversation').replaceChildren();status(`${enabled?'BFL adapter':'Base Qwen'} · ${changed?'new conversation':'conversation retained'} · weights retained`);return result;}finally{loading=false;controls();}
}
$('mode').onchange=$('rank').onchange=()=>setMode().catch(e=>status(e.message,true));
$('load').onclick=()=>load().catch(()=>{});$('reset').onclick=()=>reset().catch(e=>status(e.message,true));$('unload').onclick=()=>unload().catch(e=>status(e.message,true));$('stop').onclick=()=>controller?.abort('Stopped');
$('form').onsubmit=e=>{e.preventDefault();const text=$('message').value;if(!text.trim())return;$('message').value='';send(text).catch(()=>{});};
$('export').onclick=()=>{const blob=new Blob([JSON.stringify({identity:runtime?.identity??null,history,conversation:runtime?.chat.snapshot()??null,admissions},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='kaminos-conversation.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),0);};
window.qwenChat={load,send,reset,unload,setMode,stop:()=>controller?.abort('Stopped'),snapshot:()=>({history:structuredClone(history),identity:runtime?.identity??null,conversation:runtime?.chat.snapshot()??null,errors:runtime?.errors??[],admissions:structuredClone(admissions)}),get runtime(){return runtime;}};
window.addEventListener('pagehide',()=>{controller?.abort('Page closed');void runtime?.dispose();});
