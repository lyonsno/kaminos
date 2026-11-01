import { loadChatExample } from './chat-browser.js';
const $=id=>document.getElementById(id), query=new URLSearchParams(location.search);
let runtime=null, active=null, loading=false, controller=null;
const history=[];
function status(text,error=false){$('status').textContent=text;$('status').classList.toggle('error',error);}
function controls(){const busy=loading||Boolean(active);$('load').disabled=busy||Boolean(runtime);$('system').disabled=busy||Boolean(runtime);$('send').disabled=busy||!runtime;$('reset').disabled=busy||!runtime;$('unload').disabled=busy||!runtime;$('stop').disabled=!busy;}
function message(role,text){const article=document.createElement('article');article.className=role;const name=document.createElement('strong');name.textContent=role;const body=document.createElement('div');body.textContent=text;article.append(name,body);$('conversation').append(article);return body;}
async function load(){if(loading||runtime)throw Error('Model already loaded or loading');loading=true;controller=new AbortController();controls();status('Loading model weights…');
 try{runtime=await loadChatExample({manifestUrl:new URL(query.get('manifest')??'/manifest/weights.json',location.href),manifestSha256:query.get('sha'),modelUrl:new URL(query.get('model')??'/model/',location.href),systemPrompt:$('system').value,signal:controller.signal,onProgress:p=>status(`Loading model weights · ${p.loaded??p.completed??''} ${p.total?'/ '+p.total:''}`)});status(`Model loaded · ${runtime.identity.capacity.toLocaleString()} token context · ${(runtime.identity.loadMs/1000).toFixed(2)} s loading`);return runtime.identity;}
 catch(e){status(String(e.message??e),true);throw e;}finally{loading=false;controller=null;controls();}}
async function send(text,options={}){if(!runtime||active)throw Error('Load the model and finish the current turn first');controller=new AbortController();message('user',text);const body=message('assistant','');status('Reading your message…');
 const record={user:text,assistant:'',status:'running'};history.push(record);
 active=(async()=>{try{const limit=$('limit').value;const result=await runtime.chat.send({text,...(limit?{maxNewTokens:Number(limit)}:{}),...options,signal:controller.signal,onText:(_,full)=>{body.textContent=full;record.assistant=full;status('Generating…');}});
 record.status='complete';record.result=result;const u=result.usage;status(`${(u.totalMs/1000).toFixed(2)} s · ${u.reusedInputTokens} input tokens reused, ${u.evaluatedInputTokens} evaluated · ${result.tokenIds.length} reply tokens · ${result.finishReason}${u.firstTokenMs===null?'':` · first token ${(u.firstTokenMs/1000).toFixed(2)} s`}`);return result;
 }catch(e){record.status=e.name==='AbortError'?'stopped':'failed';record.error=String(e.message??e);status(`${record.status}: ${record.error}. This partial turn is saved here but has not been added to the model’s conversation.`,true);throw e;}
 finally{active=null;controller=null;controls();}})();controls();return active;}
async function reset(){if(active||loading)throw Error('Stop the active turn first');await runtime?.chat.reset();$('conversation').replaceChildren();status('New conversation. Model weights remain loaded.');}
async function unload(){if(active||loading)throw Error('Stop the active turn first');const old=runtime;runtime=null;controls();await old?.dispose();status('Model unloaded.');}
$('load').onclick=()=>load().catch(()=>{});$('reset').onclick=()=>reset().catch(e=>status(e.message,true));$('unload').onclick=()=>unload().catch(e=>status(e.message,true));$('stop').onclick=()=>controller?.abort('Stopped');
$('form').onsubmit=e=>{e.preventDefault();const text=$('message').value;if(!text.trim())return;$('message').value='';send(text).catch(()=>{});};
$('export').onclick=()=>{const blob=new Blob([JSON.stringify({identity:runtime?.identity??null,history,conversation:runtime?.chat.snapshot()??null},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='kaminos-conversation.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),0);};
window.qwenChat={load,send,reset,unload,stop:()=>controller?.abort('Stopped'),snapshot:()=>({history:structuredClone(history),identity:runtime?.identity??null,conversation:runtime?.chat.snapshot()??null,errors:runtime?.errors??[]}),get runtime(){return runtime;}};
window.addEventListener('pagehide',()=>{controller?.abort('Page closed');void runtime?.dispose();});
