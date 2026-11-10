// Live numeric editing with local drafts and the shared number-drag gesture.
export function bindParticleNumber({input,read,apply,onError,onAccepted,delay=150}){
 let timer=null,version=0,disposed=false,dirty=false,left=false;
 const cancel=()=>{clearTimeout(timer);timer=null;};
 const restore=()=>{const v=read();input.value=Number.isFinite(v)?String(v):'';};
 const discard=()=>{dirty=false;restore();onAccepted();};
 async function flush({leaving=false}={}){
  cancel();if(disposed||!dirty)return;const revision=++version;
  if(!input.value.trim()){if(leaving||left)discard();return;}
  const value=Number(input.value);dirty=false;
  try{await apply(value);if(!disposed&&revision===version)onAccepted();}
  catch(error){if(!disposed&&revision===version){dirty=true;onError(error);if(leaving||left)discard();}}
 }
 const edit=()=>{cancel();version++;dirty=true;left=false;if(input.classList.contains('scrubbing'))void flush();else timer=setTimeout(()=>void flush(),delay);};
 const leave=()=>{left=true;void flush({leaving:true});};
 const key=event=>{if(event.key==='Enter'){void flush({leaving:true});}if(event.key==='Escape'){cancel();version++;discard();}};
 input.addEventListener('input',edit);input.addEventListener('change',leave);input.addEventListener('blur',leave);input.addEventListener('keydown',key);
 return {dispose(){disposed=true;cancel();version++;input.removeEventListener('input',edit);input.removeEventListener('change',leave);input.removeEventListener('blur',leave);input.removeEventListener('keydown',key);}};
}
