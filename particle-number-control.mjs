// Live numeric editing with local drafts and the shared number-drag gesture.
export function bindParticleNumber({input,read,apply,onError,onAccepted,delay=150}){
 let timer=null,version=0,disposed=false;
 const cancel=()=>{clearTimeout(timer);timer=null;};
 const restore=()=>{const v=read();input.value=Number.isFinite(v)?String(v):'';};
 async function flush({leaving=false}={}){
  cancel();if(disposed)return;const revision=++version;
  if(!input.value.trim()){if(leaving)restore();return;}
  const value=Number(input.value);
  try{await apply(value);if(!disposed&&revision===version)onAccepted();}
  catch(error){if(!disposed&&revision===version){onError(error);if(leaving)restore();}}
 }
 const edit=()=>{cancel();version++;if(input.classList.contains('scrubbing'))void flush();else timer=setTimeout(()=>void flush(),delay);};
 const leave=()=>void flush({leaving:true});
 const key=event=>{if(event.key==='Enter'){void flush({leaving:true});}if(event.key==='Escape'){cancel();version++;restore();}};
 input.addEventListener('input',edit);input.addEventListener('change',leave);input.addEventListener('blur',leave);input.addEventListener('keydown',key);
 return {dispose(){disposed=true;cancel();version++;input.removeEventListener('input',edit);input.removeEventListener('change',leave);input.removeEventListener('blur',leave);input.removeEventListener('keydown',key);}};
}
