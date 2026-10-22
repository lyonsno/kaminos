import {createVolumeGather} from './scene-volume-gather.mjs';

// Separate receiver coverage; fine emission coordinates and quality never
// change. Source-directed quadrature avoids missing the small distant flame.
export function createExteriorSmokeLight(device,{grid=8,refinement=4,beforeReplace=()=>{}}={}){
  let gather=null,key=null,builds=0;
  return {
    encode(source,{geometry,revision,worldGeometry=true,directions,gain,sourceSoftness,environment,sceneLights}){
      const medium=source.exterior;
      if(!medium){if(gather){beforeReplace();gather.destroy();gather=null;key=null;}return null;}
      if(medium.status!=='encoded'||medium.generation!==source.generation||medium.frame!==source.frame)throw Error('exterior transport requires same-generation world extinction');
      const nextKey=JSON.stringify([revision,source.dimensions,medium.localMin,medium.localMax]);
      if(!gather||key!==nextKey){
        const next=createVolumeGather(device,{geometry,receivers:[],volumeGrid:grid,sourceDimensions:source.dimensions,
          receiverBounds:{lo:medium.localMin,hi:medium.localMax},smokeRefinement:refinement,directions,angularPattern:'source',worldGeometry,exteriorMedium:true});
        beforeReplace();gather?.destroy();gather=next;key=nextKey;builds++;
      }
      if(worldGeometry)gather.setGeometryTransforms(geometry.matrices);
      gather.setDirections(directions);
      const frame=gather.encode(source,{gain,sourceSoftness,environment,sceneLights});
      return {texture:gather.smoke,...frame,coverage:'world-material-bounds',builds,
        extinction:{generation:medium.generation,method:'coarse-midpoint-trilinear',stepLength:(medium.localMax[0]-medium.localMin[0])/grid,fineInterval:'excluded'},
        exteriorEmission:false,approximation:'coarse-receivers-and-exterior-medium; fine-source-emission-only'};
    },
    destroy(){gather?.destroy();gather=null;key=null;},
  };
}
