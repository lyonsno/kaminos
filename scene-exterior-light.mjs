import {createVolumeGather} from './scene-volume-gather.mjs';

// Receiver coverage is independent of material allocation and Fine source
// coordinates. Source-directed quadrature covers the source inside Fine.
export function createExteriorSmokeLight(device,{grid=8,refinement=4,receiverCoverage=null,beforeReplace=()=>{}}={}){
  function coverage(value){
    if(value===null)return null;
    if(![value?.lo,value?.hi].every(v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite))||value.hi.some((v,a)=>v<=value.lo[a]))throw Error('ordered finite receiver coverage required');
    if(!Number.isFinite(value.pitch)||value.pitch<=0)throw Error('positive finite receiver pitch required');
    const dimensions=value.hi.map((v,a)=>Math.ceil((v-value.lo[a])/value.pitch));
    return {localMin:[...value.lo],localMax:value.lo.map((v,a)=>v+dimensions[a]*value.pitch),dimensions,pitch:value.pitch};
  }
  let nearCoverage=coverage(receiverCoverage);
  const regions=new Map();let builds=0;
  function remove(name){const r=regions.get(name);if(r){beforeReplace();r.gather.destroy();regions.delete(name);}}
  return {
    setReceiverCoverage(value){nearCoverage=coverage(value);},
    encode(source,{geometry,revision,worldGeometry=true,directions,gain,sourceSoftness,environment,sceneLights,fineReceiverGrid=16}){
      const medium=source.exterior;
      if(!medium){for(const name of regions.keys())remove(name);return null;}
      for(const r of [medium,medium.middle])if(r&&(r.status!=='encoded'||r.generation!==source.generation||r.frame!==source.frame))throw Error('exterior transport requires same-generation region extinction');
      if(!medium.middle&&!nearCoverage)remove('middle');
      const frames={};
      const near=nearCoverage??medium.middle;
      const fineHi=source.dimensions.map(n=>-1+2*n/source.dimensions[0]);
      const margin=Number.isFinite(medium.handoffMargin)?Math.min(.60,Math.max(.05,medium.handoffMargin)):null;
      const fineBlend=margin!==null?Math.max(.02+Math.max(.04,.4/.36*margin),(.02+Math.max(.04,.26/.36*margin))*(fineHi[1]+1)):2/fineReceiverGrid;
      for(const [name,region] of [['world',medium],['middle',near]]){
        if(!region)continue;
        // Keep cubic receiver cells and exact physical coverage. In particular,
        // the default middle region is 3 by 5 by 3, not the fine box's 2:1 shape.
        const dims=region.dimensions;
        if(!Array.isArray(dims)||dims.length!==3||!dims.every(n=>Number.isInteger(n)&&n>0))throw Error('region material dimensions required');
        const gcd=(a,b)=>b?gcd(b,a%b):a;
        const widthUnit=dims[0]/dims.reduce(gcd);
        const regionGrid=name==='middle'&&nearCoverage?dims[0]:Math.ceil(grid/widthUnit)*widthUnit;
        const exclude=name==='world'&&near?{lo:near.localMin,hi:near.localMax,blendWidth:nearCoverage?.pitch??(near.localMax[0]-near.localMin[0])/grid}:{lo:[-1,-1,-1],hi:fineHi,blendWidth:fineBlend};
        const key=JSON.stringify([revision,source.dimensions,region.localMin,region.localMax,regionGrid,exclude]);
        let current=regions.get(name);
        if(!current||current.key!==key){
          const next=createVolumeGather(device,{geometry,receivers:[],volumeGrid:regionGrid,sourceDimensions:source.dimensions,
            receiverBounds:{lo:region.localMin,hi:region.localMax},smokeRefinement:refinement,directions,angularPattern:'source',worldGeometry,exteriorMedium:true,exteriorIntegrationGrid:grid,receiverExclusion:exclude});
          beforeReplace();current?.gather.destroy();current={key,gather:next};regions.set(name,current);builds++;
        }
        const {gather}=current;
        if(worldGeometry)gather.setGeometryTransforms(geometry.matrices);
        gather.setDirections(directions);
        const frame=gather.encode(source,{gain,sourceSoftness,environment,sceneLights});
        frames[name]={texture:gather.smoke,...frame,coverage:name==='middle'&&nearCoverage?'independent-near-receivers':`${name}-material-bounds`,builds,
          extinction:{generation:medium.generation,method:'region-split-midpoint-trilinear',stepLength:(medium.localMax[0]-medium.localMin[0])/grid,fineInterval:'physical-blend-in-fine-source',overlap:'camera-two-middle-material-cells'},
          exteriorEmission:false,approximation:'coarse-receivers-and-exterior-medium; fine-source-emission-only'};
      }
      return {...frames.world,builds,...(Number.isFinite(medium.handoffMargin)?{handoffMargin:medium.handoffMargin}:{}),middle:frames.middle??null};
    },
    destroy(){for(const {gather} of regions.values())gather.destroy();regions.clear();},
  };
}
