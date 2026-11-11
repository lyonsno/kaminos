// The spatial controls are authored in mm; the source contract remains metres.
export const controlDefinitions=[
 {key:'bevel',label:'Corner rounding',unit:'mm',step:.5,scale:1000,max:140},
 {key:'margin',label:'Rich margin width',unit:'mm',step:1,scale:1000,max:300},
 {key:'relief',label:'Margin relief',unit:'mm',step:.5,scale:1000,max:100},
 {key:'seed',label:'Source seed',step:1,scale:1,integer:true},
 {key:'displayCells',label:'Display divisions',step:1,scale:1,min:2,max:128,integer:true},
 {key:'cells',label:'Integral source divisions',step:1,scale:1,min:2,max:128,integer:true},
];
export function controlValue(key,value){
 const d=controlDefinitions.find(d=>d.key===key);if(!d||!Number.isFinite(value))throw Error('Invalid masonry control');
 const n=Math.max(d.min??0,value);return (d.integer?Math.round(n):n)/d.scale;
}
export function displayValue(key,value){return value*controlDefinitions.find(d=>d.key===key).scale;}
// Fixed coalescing windows give live progress during a continuous drag rather
// than postponing every rebuild until input finally becomes quiet.
export function createLiveMasonryEdits({apply,onError=()=>{},delayMs=80,setTimer=setTimeout,clearTimer=clearTimeout}){
 let timer=null,pending={},tail=Promise.resolve(),disposed=false;
 const flush=()=>{
  if(timer!==null){clearTimer(timer);timer=null;}
  if(disposed||!Object.keys(pending).length)return tail;
  const patch=pending;pending={};
  tail=tail.then(()=>disposed?undefined:apply(patch)).catch(onError);return tail;
 };
 return {schedule(patch){if(disposed)return;Object.assign(pending,patch);if(timer===null)timer=setTimer(flush,delayMs);},flush,dispose(){disposed=true;pending={};if(timer!==null)clearTimer(timer);timer=null;}};
}
