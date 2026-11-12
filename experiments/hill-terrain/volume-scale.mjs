// Hill's interactive construction envelope. Byte estimates cover the buffers
// and the CPU arrays that dominate this path, not free memory on the machine.
export const DEFAULT_PILE_SCALE=Object.freeze({width:6.72,depth:7.68,height:4.32,cell:.12,spacing:.075,rocks:100,freeRocks:0});
const MiB=1024**2;
const CONSTRUCTION_BYTES=512*MiB;
export function pileScaleConfig(input){
 const scale={...DEFAULT_PILE_SCALE,...input};
 for(const key of Object.keys(scale))if(!Object.hasOwn(DEFAULT_PILE_SCALE,key))throw Error('Unknown scale setting '+key);
 for(const key of ['width','depth','height','cell','spacing'])if(!Number.isFinite(scale[key])||scale[key]<=0)throw Error(key+' must be positive');
 if(!Number.isSafeInteger(scale.rocks)||scale.rocks<1||!Number.isSafeInteger(scale.freeRocks)||scale.freeRocks<0||scale.freeRocks>scale.rocks)throw Error('Choose whole rock counts: at least one rock and zero to that many initially released');
 const dimensions=[scale.width,scale.height,scale.depth].map(w=>Math.ceil(w/scale.cell-1e-9));
 const extent=dimensions.map(n=>n*scale.cell);
 return{scale,dimensions,extent,origin:[-extent[0]/2,-3*scale.cell,-extent[2]/2]};
}
export function volumeSurfaceCapacity(dimensions){
 const cubes=dimensions.reduce((n,v)=>n*(v-1),1);
 return{cubes,maxVertices:cubes*36,surfaceBufferBytes:cubes*36*16};
}
export function scaleAllocation(config,limits){
 const {dimensions,scale}=config,{cubes,maxVertices,surfaceBufferBytes}=volumeSurfaceCapacity(dimensions);
 const gridCells=dimensions.reduce((n,v)=>n*v,1);
 const limit=Math.min(limits?.maxStorageBufferBindingSize??CONSTRUCTION_BYTES,limits?.maxBufferSize??CONSTRUCTION_BYTES);
 if(!Number.isSafeInteger(surfaceBufferBytes)||surfaceBufferBytes>limit)throw Error('Soil surface buffer exceeds the '+Math.floor(limit/MiB)+' MiB storage binding limit');
 if(gridCells>64*(limits?.maxComputeWorkgroupsPerDimension??65535))throw Error('Grid exceeds the compute dispatch limit');
 const extent=dimensions.map(n=>n*config.cell);
 const bounds=[extent[0]-Math.max(.72,4.2*config.cell),extent[2]-Math.max(.78,4.2*config.cell)];
 if(!scale)return{gridCells,cubes,maxVertices,surfaceBufferBytes};
 // Even one fully weighted particle must fit the signed fixed-point
 // grid accumulator used by p2g. This is a necessary, not sufficient, bound.
 if(config.density*config.spacing**3>=2048||config.density*config.cell**3>=2048)throw Error('Grid cell or particle mass exceeds the fixed-point transfer range');
 if(bounds.some(w=>w<=config.spacing)||config.pileSoilHeight<=config.spacing/2)throw Error('Soil region is too small for the requested particle spacing');
 const particleCapacity=bounds.reduce((n,w)=>n*Math.ceil(w/config.spacing),Math.ceil(config.pileSoilHeight/config.spacing));
 const particles=particleCapacity*144;
 const pairs=scale.rocks*(scale.rocks-1)/2;
 const graphBytes=Math.ceil((32+8*scale.rocks)/16)*16+Math.max(1,pairs)*352;
 if(!Number.isSafeInteger(particles)||particles>limit)throw Error('Soil particle upper bound exceeds the storage binding limit');
 if(!Number.isSafeInteger(graphBytes)||graphBytes>limit)throw Error('Rock contact arena exceeds the storage binding limit');
 // Both Three CPU attributes and device buffers exist for the surface, and
 // typed material samples are retained on CPU as well as uploaded to the GPU.
 const majorBytes=4*surfaceBufferBytes+2*particles+graphBytes+gridCells*16;
 if(majorBytes>CONSTRUCTION_BYTES)throw Error('Requested surface, soil and contact allocation exceeds the interactive '+(CONSTRUCTION_BYTES/MiB)+' MiB construction budget');
 return{gridCells,cubes,maxVertices,surfaceBufferBytes,extent,bounds,particleCapacity,graphBytes,majorBytes,dt:config.dt};
}
