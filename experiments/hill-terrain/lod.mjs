// A world-aligned subdivision of the simulation triangles. The visible collar
// remains continuous; only the allocation changes level. Shared samples keep
// their world coordinates when the camera moves.
export function detailLattice(config,{x,z,radius},resolution=193){
 if(!Number.isInteger(config.resolution)||config.resolution<2||!Number.isInteger(resolution)||resolution<3||resolution%2!==1||![config.width,config.length,radius].every(v=>Number.isFinite(v)&&v>0)||![x,z].every(Number.isFinite))throw Error('Finite terrain dimensions, focus and positive detail radius required');
 const coarse=[config.width/(config.resolution-1),config.length/(config.resolution-1)];
 // Reserve half a cell on either side for center snapping, so no requested
 // collar can fall outside the allocated mesh during a level transition.
 const requestedLevel=Math.floor(Math.log2((resolution-2)*Math.min(...coarse)/(2*radius)));
 const level=Math.max(0,requestedLevel);
 const spacing=coarse.map(v=>v/2**level);
 const center=[x,z].map((v,i)=>{const origin=-[config.width,config.length][i]/2;return origin+Math.round((v-origin)/spacing[i])*spacing[i];});
 return {level,spacing,center,refining:requestedLevel>=0};
}

// The center texel of a clamped 3x3 nearest-filtered alpha map is the hole;
// surrounding texels stay opaque. Texture transforms propagate through the
// renderer's ordinary color, shadow and GI override materials.
export function baseMaskTransform(config,{x,z,radius},active){
 if(!active)return [0,0,0,0];
 if(![config.width,config.length,radius].every(v=>Number.isFinite(v)&&v>0)||![x,z].every(Number.isFinite)||radius<=.055)throw Error('Finite terrain dimensions and positive mask footprint required');
 const span=6*(radius-.055);
 return [config.width/span,.5-(config.width*.5+x)/span,config.length/span,.5-(config.length*.5+z)/span];
}
