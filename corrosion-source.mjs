import {restoreCorrosion,corrosionSummary} from './coating-corrosion.mjs';
const linear=v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4;
const color=hex=>[hex>>16&255,hex>>8&255,hex&255].map(v=>linear(v/255));
export function createCorrosionSource(retained,{width=2.4,showSubstrate=false,snapshot=0}={}){
 if(!Number.isFinite(width)||width<=0||typeof showSubstrate!=='boolean'||!Number.isSafeInteger(snapshot)||snapshot<0)throw Error('Invalid corrosion source presentation');
 const s=restoreCorrosion(retained),n=s.config.resolution,c=s.config,triangles=[];
 const materials=[{color:color(0x747a7c),roughness:.35,metalness:1},
  {color:color(0x4c2a1c),roughness:.92,metalness:0},
  {color:color(0x89502b),roughness:.93,metalness:0},
  {color:color(0xaf703c),roughness:.96,metalness:0},
  {color:color(0x527c82),roughness:.34,metalness:0},
  {color:color(0x354c4f),roughness:.65,metalness:0}];
 const quad=(a,b,d,e,materialIndex,identity)=>{triangles.push({a,b,c:d,materialIndex,identity:identity+':0'},{a,b:d,c:e,materialIndex,identity:identity+':1'});};
 const index=(x,y)=>((y+n)%n)*n+(x+n)%n;
 const sample=(a,x,y)=>{let v=0;for(const j of [index(x,y),index(x-1,y),index(x,y-1),index(x-1,y-1)])v+=a[j];return v*.25;};
 const steel=(x,y)=>-c.metalScale*sample(s.metalLoss,x,y);
 const oxide=(x,y)=>steel(x,y)+c.metalScale*c.oxideExpansion*sample(s.rustIron,x,y)/(1-c.oxidePorosity);
 const film=(x,y)=>Math.max(sample(s.filmHeight,x,y),oxide(x,y)+c.filmThickness);
 const point=(x,y,h)=>[(x/n-.5)*width,h*width,(y/n-.5)*width];
 const corners=(x,y,h)=>[[x,y],[x,y+1],[x+1,y+1],[x+1,y]].map(([u,v])=>point(u,v,h(u,v)));
 for(let y=0;y<n;y++)for(let x=0;x<n;x++){
  const i=index(x,y),id=`${x}:${y}`;quad(...corners(x,y,steel),0,'steel:'+id);
  if(s.rustIron[i]>0)quad(...corners(x,y,oxide),s.rustIron[i]<.04?3:s.rustIron[i]<.2?2:1,'oxide:'+id);
  if(!s.opening[i]&&!showSubstrate){
   const top=corners(x,y,film),back=top.map(p=>[p[0],p[1]-c.filmThickness*width,p[2]]);
   quad(...top,4,'paint-top:'+id);quad(...[back[3],back[2],back[1],back[0]],5,'paint-back:'+id);
   const adjacent=[[x-1,y],[x,y+1],[x+1,y],[x,y-1]];
   for(let e=0;e<4;e++)if(s.opening[index(...adjacent[e])])quad(top[e],back[e],back[(e+1)%4],top[(e+1)%4],5,`paint-edge:${id}:${e}`);
  }
 }
 const referenceHeight=triangles.reduce((v,t)=>Math.max(v,t.a[1],t.b[1],t.c[1]),-Infinity)+.005;
 return {schema:'kaminos.corrosion-derived-source.v1',config:{width,depth:width,showSubstrate,snapshot},triangles,materials,referenceHeight,
  process:corrosionSummary(s),boundary:'Periodic formation fields, finite source tile. No periodic ray transport or learned material yet.',
  geometryModel:'State-derived pitted metal, oxide height field and two-sided small-slope coating; no cracked/curling free sheets or resolved oxide microporosity'};
}
