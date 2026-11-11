import {createMasonrySource} from './masonry-source.mjs';

export const stoneTransitionDefaults=Object.freeze({width:2.8,depth:2.8,height:.28,bevel:.04,margin:.08,relief:.025,jointDepth:.055,cells:12,seed:41,halo:1,referenceGap:.00005});
export function stoneTransitionRegion(uv,config=stoneTransitionDefaults){
 const local=uv.map((v,i)=>{const period=(i?config.depth:config.width)/2;const f=((v*2)%1+1)%1;return Math.min(f,1-f)*period;});
 const distance=Math.min(...local),band=Math.max(config.margin,config.bevel),weight=band===0?0:Math.max(0,1-distance/band);
 return {distance,weight:weight*weight,flat:distance>=Math.max(config.margin,config.bevel)};
}
export function createStoneTransitionSource(options={}){
 const config={...stoneTransitionDefaults,...options};
 if(!Number.isSafeInteger(config.cells)||config.cells<2||!Number.isSafeInteger(config.halo)||config.halo<0||!Number.isFinite(config.referenceGap)||config.referenceGap<=.00001||!['width','depth','height'].every(k=>Number.isFinite(config[k])&&config[k]>0)||!Number.isFinite(config.margin)||config.margin<0||!Number.isFinite(config.jointDepth)||config.jointDepth<0||config.jointDepth>config.height)throw Error('Invalid stone transition controls');
 const materials=[
  {name:'dressed stone',color:[.48,.43,.35],roughness:.88,metalness:0},
  {name:'relieved stone shoulder',color:[.41,.355,.28],roughness:.97,metalness:0},
  {name:'relieved stone corner',color:[.41,.355,.28],roughness:.97,metalness:0},
  {name:'continuous joint backing, authored not simulated mortar',color:[.24,.22,.18],roughness:.96,metalness:0},
 ];
 const triangles=[],stones=[];
 for(let z=0;z<2;z++)for(let x=0;x<2;x++){
  const source=createMasonrySource({width:config.width/2,depth:config.depth/2,height:config.height,bevel:config.bevel,margin:config.margin,relief:config.relief,cells:config.cells,seed:config.seed+z*2+x,sampling:'edge'});
  const id=`stone-${x}-${z}`,shift=p=>[p[0]+(x-.5)*config.width/2,p[1]-config.height/2,p[2]+(z-.5)*config.depth/2];
  for(const t of source.triangles)triangles.push({...t,a:shift(t.a),b:shift(t.b),c:shift(t.c),kind:'stone',identity:`${id}/${t.identity}`,stoneId:id});
  stones.push({id,source:source.config,center:[(x-.5)*config.width/2,0,(z-.5)*config.depth/2]});
 }
 const y=-config.jointDepth,a=[-config.width/2,y,-config.depth/2],b=[config.width/2,y,-config.depth/2],c=[config.width/2,y,config.depth/2],d=[-config.width/2,y,config.depth/2];
 const base=(a,b,c,uv,identity)=>({a,b,c,uv,reference:{a:[a[0],0,a[2]],b:[b[0],0,b[2]],c:[c[0],0,c[2]]},materialIndex:3,kind:'backing',identity});
 triangles.push(base(a,c,b,[[0,0],[1,1],[1,0]],'backing-0'),base(a,d,c,[[0,0],[0,1],[1,1]],'backing-1'));
 const central=triangles.slice();
 for(let z=-config.halo;z<=config.halo;z++)for(let x=-config.halo;x<=config.halo;x++)if(x||z)for(const t of central){const shift=p=>[p[0]+x*config.width,p[1],p[2]+z*config.depth];triangles.push({...t,a:shift(t.a),b:shift(t.b),c:shift(t.c),identity:`${t.identity}@${x},${z}`,halo:[x,z]});}
 return {schema:'kaminos.stone-transition-source.v1',config,triangles,materials,stones,referenceHeight:config.referenceGap,
  boundary:'periodic stone construction with finite repeated transport halo; stone shoulders join flat centers; tiny recorded reference gap avoids tracer self-hit rejection',
  representation:'existing authored stones and continuous backing; no simulated mortar, curved coverage model, or learned handoff claimed'};
}
