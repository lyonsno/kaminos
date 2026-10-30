// Saved-data diagnostics and display transforms; source coordinates remain unchanged.
const distance=(a,b)=>Math.hypot(...a.map((x,k)=>x-b[k]));
export function palmWidth(hand){return hand?.status==='observed'?distance(hand.joints[5],hand.joints[17]):null;}
export function displayScales(hands,reference,mode){
 if(!['predicted','palm'].includes(mode))throw Error('unknown display scale');
 const width=palmWidth(hands[reference]);
 return hands.map(h=>{if(mode==='predicted')return 1;const w=palmWidth(h);return width>1e-10&&w>1e-10?width/w:null;});
}
export function validateGuide(guide,catalog,catalogHash){
 if(guide?.schema!=='hand-state.replay-guide.v1'||guide.generation!==catalog.generation||guide.catalogSha256!==catalogHash)throw Error('guide source mismatch');
 if(!guide.moments?.length||new Set(guide.moments.map(m=>m.id)).size!==guide.moments.length)throw Error('invalid guide moments');
 for(const m of guide.moments){
  if(!m.id||!m.title||!m.question||!catalog.sequences[m.sequence]||![m.start,m.end,m.frame,m.finger].every(Number.isInteger)||m.start<0||m.end<m.start||m.frame<m.start||m.frame>m.end||m.finger<0||m.finger>4||typeof m.loop!=='boolean')throw Error('invalid guide moment');
 }
 return guide;
}
export function validateMoment(moment,data){
 if(!data.frames[moment.end])throw Error('moment outside recording');
 for(const key of ['start','end','frame'])if(data.frames[moment[key]].captureId!==moment.captures?.[key])throw Error('moment capture mismatch');
}
export function deformationTrace(data,start,end,finger,modelIndices){
 const joint=1+4*finger;
 const series=modelIndices.map(mi=>{
  const points=data.frames.slice(start,end+1).map((frame,i)=>{const h=frame.hands[mi],width=palmWidth(h);const value=width>1e-10?distance(h.joints[joint],h.joints[joint+1])/width:null;return {frame:start+i,timeMs:frame.timeMs,value};});
  const values=points.map(p=>p.value).filter(v=>v!==null&&Number.isFinite(v)).sort((a,b)=>a-b),n=values.length;
  const median=n?(values[Math.floor((n-1)/2)]+values[Math.floor(n/2)])/2:null;
  return {model:data.models[mi].id,label:data.models[mi].label,points:points.map(p=>({...p,percent:median>1e-10&&p.value!==null?p.value/median*100:null})),rangePercent:n>1&&median>1e-10?(values.at(-1)-values[0])/median*100:null};
 });
 return {start,end,finger,series};
}
export function loopTime(frames,start,end,time){
 const from=frames[start].timeMs,to=frames[end].timeMs;
 const tail=end+1<frames.length?frames[end+1].timeMs-to:end>start?to-frames[end-1].timeMs:0;
 const duration=to-from+tail;
 if(duration<=0)return from;
 return from+((time-from)%duration+duration)%duration;
}
