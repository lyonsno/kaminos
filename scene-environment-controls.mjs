export const ENVIRONMENT_CONTROL_FIELDS=Object.freeze({
 intensity:'env-intensity-slider',rotation:'env-rotation-slider',backgroundBlur:'env-blur-slider',
 backgroundBrightness:'env-bg-brightness',backgroundContrast:'env-bg-contrast',showBackground:'show-env-bg',
});
export const ENVIRONMENT_LEGACY_FIELDS=Object.freeze({exposure:'exposure-slider',...ENVIRONMENT_CONTROL_FIELDS});
export function environmentLegacySettings(state){
 const value=state.read();return {...Object.fromEntries(Object.entries(ENVIRONMENT_LEGACY_FIELDS).map(([key,id])=>[id,key==='showBackground'?value[key]:String(value[key])])),environmentRecipes:value.recipes,environmentName:value.name};
}
// One-way projection of accepted values plus explicit input admission. A draft
// stays in its focused editor until commit; it is never a persistence input.
export function bindSceneEnvironmentControls({state,document,onError=()=>{},onAccepted=()=>{}}){
 const controls=Object.fromEntries(Object.entries(ENVIRONMENT_CONTROL_FIELDS).map(([key,id])=>[key,document.getElementById(id)]));
 const stops=[];let editing=null;
 function sync(){
  const value=state.read();
  for(const [key,control] of Object.entries(controls)){
   if(!control)continue;
   if(key==='showBackground')control.checked=value[key];
   else {
    control.min=String(Math.min(Number(control.min||0),value[key]));
    control.max=String(Math.max(Number(control.max||value[key]),value[key]));control.step='any';
    if(control!==editing&&document.activeElement!==control)control.value=String(value[key]);
    const id=ENVIRONMENT_CONTROL_FIELDS[key],output=document.getElementById(id.endsWith('-slider')?id.replace('-slider','-val'):id+'-val');
    if(output)output.textContent=value[key].toFixed(key==='intensity'||key==='rotation'?1:2);
   }
  }
  for(const id of ['blur-row','env-backdrop-controls']){const node=document.getElementById(id);if(node)node.style.display=value.showBackground?'':'none';}
 }
 for(const [key,control] of Object.entries(controls)){
  if(!control)continue;
  const input=()=>{
   if(key!=='showBackground'&&!control.value.trim())return;
   editing=control;
   try{state.patch({[key]:key==='showBackground'?control.checked:Number(control.value)});onAccepted();}catch(error){onError(error);}
   finally{editing=null;}
  };
  const commit=()=>{editing=null;const value=state.read()[key];if(key==='showBackground')control.checked=value;else control.value=String(value);sync();};
  const type=key==='showBackground'?'change':'input';control.addEventListener(type,input);control.addEventListener('change',commit);control.addEventListener('blur',commit);
  stops.push(()=>{control.removeEventListener(type,input);control.removeEventListener('change',commit);control.removeEventListener('blur',commit);});
 }
 const stop=state.subscribe(sync);sync();return {sync,dispose(){stop();for(const stop of stops)stop();}};
}
