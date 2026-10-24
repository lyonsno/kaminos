// An explicitly synthetic teaching run. No model, inference timing or generated image claim.
export function inferenceFlameDemo(){
 const image=step=>{const width=32,height=32,rgba=[];for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const inside=Math.hypot(x-16,y-16)<(4+step*2),noise=((x*17+y*31)%19)/19;
  rgba.push(Math.round((inside?0.9:noise*.1)*255),Math.round((inside?.25+step*.1:noise*.1)*255),Math.round((inside?.1:noise*.15)*255),255);
 }return {width,height,rgba};};
 const events=[{atMs:0,type:'start'},{atMs:0,type:'stage',stage:'text'},{atMs:1800,type:'stage',stage:'denoise'}];
 for(let step=1;step<=4;step++){events.push({atMs:1800+step*2000,type:'progress',stage:'denoise',completed:step,total:4});events.push({atMs:2000+step*2000,type:'preview',step,steps:4,kind:'illustrated-demo',...image(step)});}
 events.push({atMs:10800,type:'stage',stage:'decode'},{atMs:13300,type:'stage',stage:'saving'},{atMs:14500,type:'complete'});
 return {schema:'kaminos.inference-recording.v1',runId:'illustrated-demo',source:{kind:'demo',label:'Illustrated demo · no inference'},status:'complete',durationMs:15500,events};
}
