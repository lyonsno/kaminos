// Keep displayed timing tied to the same span/progress/scales as compileScore.
const seconds=ms=>`${Number((ms/1000).toFixed(1))}s`;
export function describeLayerTiming({object,layer,timeScale=1,phase,stage,hasSuccessor=true}){
 const length=phase?phase.recordedEndMs-phase.startMs:null,scale=layer.scale*timeScale;
 if(object.kind==='state')return {basis:'hold',durationMs:null,interrupted:false,text:'Holds B through this phase.'};
 let basis,durationMs=null,interrupted=false,text;
 if(layer.timing==='progress'&&stage!=='complete'&&Number.isFinite(phase?.progress)){
  basis='observed-progress';const fraction=Math.max(0,Math.min(1,phase.progress/scale));interrupted=fraction<1;
  text=`Recorded progress: ${Math.round(phase.progress*100)}%. Response reached ${Math.round(fraction*100)}%.`;
 }else{
  const fitted=layer.timing==='phase'&&stage!=='complete'&&length!==null;
  basis=fitted?'phase':layer.timing==='progress'&&stage!=='complete'?'authored-fallback':'seconds';
  durationMs=(fitted?length:object.recipe.duration*1000)*scale;
  text=(basis==='authored-fallback'?'Progress unknown · using authored seconds. ':'')+(length!==null&&stage!=='complete'?`Recorded phase: ${seconds(length)}. `:'')+`Response: ${seconds(durationMs)}${stage==='complete'?' after inference.':'.'}`;
  interrupted=length!==null&&stage!=='complete'&&durationMs>length;
 }
 if(interrupted)text+=hasSuccessor?' Next phase interrupts it.':' Recording ends before this response finishes.';
 return {basis,durationMs,interrupted,text};
}
