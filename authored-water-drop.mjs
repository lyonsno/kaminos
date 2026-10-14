import {Euler,Vector3} from './lib/three.core.js';
import {createFingerFluidBoxReference} from './finger-fluid-box-fixtures.mjs';
const clone=value=>structuredClone(value);
const DEFAULT_BOUNDS={min:[-2,-1,-2],max:[2,3,2]};
export function normalizeAuthoredWaterDrop(value={}) {
 const width=value.width??.5,samplesPerUnit=value.samplesPerUnit??48;
 if(!Number.isFinite(width)||width<=0)throw Error('Drop width must be positive and finite');
 if(!Number.isFinite(samplesPerUnit)||samplesPerUnit<=0)throw Error('Drop samples per unit must be positive and finite');
 const n=width*samplesPerUnit;
 if(!Number.isSafeInteger(Math.round(n))||Math.abs(n-Math.round(n))>1e-9||n<1)throw Error('Drop width × samples per unit must be a whole number of samples');
 const container=value.container===null?null:clone(value.container??DEFAULT_BOUNDS);
 const bounds=container??clone(value.worldBounds??DEFAULT_BOUNDS);
 for(const key of ['min','max'])if(!Array.isArray(bounds[key])||bounds[key].length!==3||!bounds[key].every(Number.isFinite))throw Error('Drop world bounds require finite min and max vectors');
 if(bounds.min.some((v,k)=>v>=bounds.max[k]))throw Error('Drop world bounds must have positive extents');
 return {width,samplesPerUnit,container,...(container===null?{worldBounds:bounds}:{})};
}
export function describeAuthoredWaterDrop(drop,pose) {
 const settings=normalizeAuthoredWaterDrop(drop),scale=pose.scale[0],width=settings.width*scale,n=Math.round(settings.width*settings.samplesPerUnit),count=n**3;
 if(!Number.isFinite(scale)||scale<=0||pose.scale.some(v=>v!==scale))throw Error('Drop requires positive uniform source scale');
 if(!Number.isSafeInteger(count)||count*16>0xffffffff)throw Error('Drop population exceeds typed-array capacity');
 const spacing=width/n,volume=spacing**3,baseVolume=(64*Math.PI/315)*.185**3/24.3;
 return {settings,samplesAcross:n,particleCount:count,width,spacing,particleVolume:volume,worldVolume:width**3,particleVolumeScale:volume/baseVolume,supportRadius:.185*Math.cbrt(volume/baseVolume),collisionRadius:.5*spacing,bounds:clone(settings.container??settings.worldBounds),containerEnabled:settings.container!==null};
}
export function createAuthoredWaterDrop(drop,pose) {
 const d=describeAuthoredWaterDrop(drop,pose);
 // Owner's lattice and packing; transform both initial and predicted positions.
 const fixture=createFingerFluidBoxReference({resolution:d.samplesAcross,blockWidth:1}),population=fixture.population,data=population.particleData;
 const rotation=new Euler(...pose.rotation),position=new Vector3(),origin=new Vector3(...pose.position);
 for(let i=0;i<d.particleCount;i++){
  const o=i*16;position.set(data[o],data[o+1]-.9,data[o+2]).multiplyScalar(d.width).applyEuler(rotation).add(origin);
  for(let k=0;k<3;k++)if(position.getComponent(k)<d.bounds.min[k]+d.collisionRadius||position.getComponent(k)>d.bounds.max[k]-d.collisionRadius)throw Error('Initial water must fit the explicit world bounds');
  data.set(position.toArray(),o);data.set(position.toArray(),o+4);
 }
 const planes=[];for(let k=0;k<3;k++)for(const side of ['min','max']){const normal=[0,0,0];normal[k]=side==='min'?1:-1;planes.push({normal,offset:normal[k]*d.bounds[side][k]});}
 return {...d,population:{...population,particleVolumeScale:d.particleVolumeScale,worldVolume:d.worldVolume,representedVolume:d.particleCount*d.particleVolumeScale,fixture:'authored_drop',source:'authored_scene_pose_regular_finite_lattice_no_recycling'},box:{schema:'kaminos.fluid-reference-box.v1',bounds:d.bounds,planes,collisionRadius:d.collisionRadius,collisions:d.containerEnabled}};
}
