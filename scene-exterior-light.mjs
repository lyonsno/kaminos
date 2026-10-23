import {createVolumeGather} from './scene-volume-gather.mjs';

// Separate receiver coverage; fine emission coordinates and quality never
// change. Source-directed quadrature avoids missing the small distant flame.
export function createExteriorSmokeLight(device,{grid=8,refinement=4,beforeReplace=()=>{}}={}){
  const regions=new Map();let builds=0;
  function remove(name){const r=regions.get(name);if(r){beforeReplace();r.gather.destroy();regions.delete(name);}}
  return {
    encode(source,{geometry,revision,worldGeometry=true,directions,gain,sourceSoftness,environment,sceneLights}){
      const medium=source.exterior;
      if(!medium){for(const name of regions.keys())remove(name);return null;}
      for(const r of [medium,medium.middle])if(r&&(r.status!=='encoded'||r.generation!==source.generation||r.frame!==source.frame))throw Error('exterior transport requires same-generation region extinction');
      if(!medium.middle)remove('middle');
      const frames={};
      for(const [name,region] of [['world',medium],['middle',medium.middle]]){
        if(!region)continue;
        const key=JSON.stringify([revision,source.dimensions,region.localMin,region.localMax]);
        let current=regions.get(name);
        if(!current||current.key!==key){
          const next=createVolumeGather(device,{geometry,receivers:[],volumeGrid:grid,sourceDimensions:source.dimensions,
            receiverBounds:{lo:region.localMin,hi:region.localMax},smokeRefinement:refinement,directions,angularPattern:'source',worldGeometry,exteriorMedium:true,exteriorIntegrationGrid:grid});
          beforeReplace();current?.gather.destroy();current={key,gather:next};regions.set(name,current);builds++;
        }
        const {gather}=current;
        if(worldGeometry)gather.setGeometryTransforms(geometry.matrices);
        gather.setDirections(directions);
        const frame=gather.encode(source,{gain,sourceSoftness,environment,sceneLights});
        frames[name]={texture:gather.smoke,...frame,coverage:`${name}-material-bounds`,builds,
          extinction:{generation:region.generation,method:'region-split-midpoint-trilinear',stepLength:(region.localMax[0]-region.localMin[0])/grid,fineInterval:'excluded',overlap:'camera-two-middle-material-cells'},
          exteriorEmission:false,approximation:'coarse-receivers-and-exterior-medium; fine-source-emission-only'};
      }
      return {...frames.world,middle:frames.middle??null};
    },
    destroy(){for(const {gather} of regions.values())gather.destroy();regions.clear();},
  };
}
