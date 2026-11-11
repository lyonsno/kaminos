// Material-domain support for the existing two-by-two stone construction.
export function stoneHandoffQuads(config,{collar=.04}={}){
 if(!config||![config.width,config.depth].every(v=>Number.isFinite(v)&&v>0)||![config.margin,config.bevel].every(v=>Number.isFinite(v)&&v>=0))throw Error('Stone handoff requires positive dimensions and nonnegative widths');
 if(!Number.isFinite(collar)||collar<0)throw Error('Nonnegative handoff collar required');
 const extent=Math.max(config.margin,config.bevel)+collar;
 const cuts=size=>[...new Set([0,.5,1,...[0,.5,1].flatMap(v=>[v-extent/size,v+extent/size]).filter(v=>v>0&&v<1)])].sort((a,b)=>a-b);
 const us=cuts(config.width),vs=cuts(config.depth),quads=[];
 for(let j=0;j<vs.length-1;j++)for(let i=0;i<us.length-1;i++){
  const u=(us[i]+us[i+1])/2,v=(vs[j]+vs[j+1])/2;
  const d=(x,size)=>Math.min(((x*2)%1)/2,(1-(x*2)%1)/2)*size;
  if(Math.min(d(u,config.width),d(v,config.depth))<extent)quads.push([us[i],vs[j],us[i+1],vs[j+1]]);
 }
 return {quads,extent,areaFraction:quads.reduce((s,[a,b,c,d])=>s+(c-a)*(d-b),0)};
}
