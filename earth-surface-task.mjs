import {createEarthTeacherSource} from './earth-surface.mjs';
// Grid work is admitted before sampling. Surface storage is charged against
// actual emitted triangles in the worker, not against solid interior voxels.
export function planEarthSurface(snapshot,resolution,{maxBufferSize=Infinity,heapBytes=Infinity,maxGridCells=Infinity}={}){
 if(!Number.isSafeInteger(resolution)||resolution<2)throw Error('Surface detail must be an integer of at least 2');
 const {width,columns}=snapshot.config,spacing=width/columns;
 let top=-Infinity;for(const p of snapshot.particles)top=Math.max(top,p.position[1]);
 const span=width+2*spacing,height=top+spacing*3.32;
 const ny=Math.ceil(height/(span/resolution)),cells=resolution*resolution*ny,points=(resolution+1)**2*(ny+1),gridBytes=points*4;
 if(!Number.isSafeInteger(cells)||cells>maxGridCells||gridBytes>heapBytes)throw Error(`Requested surface is too large for interactive reconstruction (${cells.toLocaleString()} grid cells; allowance ${maxGridCells.toLocaleString()}). Use a smaller detail value; the specimen is unchanged.`);
 // Conservative transient storage per emitted JS triangle, cloned result and
 // GPU positions/normals. This is an estimate, not a measured heap formula.
 const maxTriangles=Math.floor(Math.min(maxBufferSize/36,(heapBytes-gridBytes)/640));
 if(maxTriangles<1)throw Error('No surface storage available; the specimen is unchanged');
 return {resolution,cells,points,gridBytes,maxTriangles};
}
export function createEarthSurfaceTask({WorkerType=globalThis.Worker,limits=()=>({}),persistent=false}={}){
 let active=null,disposed=false,resident=null,serial=0;
 const cancel=()=>{const task=active;active=null;resident?.terminate();resident=null;task?.reject(Object.assign(Error('Surface reconstruction stopped; previous surface retained'),{name:'AbortError'}));};
 return {
  async build(snapshot,resolution,{halo=0}={}){
   if(disposed)throw Error('Surface builder disposed');
   const plan=planEarthSurface(snapshot,resolution,limits());if(active)cancel();
   if(!WorkerType)return createEarthTeacherSource({snapshot,resolution,halo,maxTriangles:plan.maxTriangles});
   return new Promise((resolve,reject)=>{
    const worker=resident??new WorkerType(new URL('./earth-surface-worker.mjs',import.meta.url),{type:'module',name:persistent?'earth-live-surface':'earth-surface'}),id=++serial,task={worker,reject};resident=worker;active=task;
    const finish=(error,value)=>{if(active!==task)return;active=null;if(!persistent||error){worker.terminate();resident=null;}error?reject(error):resolve(value);};
    worker.onmessage=({data})=>{if(data.id!==id)return;data.error?finish(Error(data.error)):finish(null,data.source);};
    worker.onerror=event=>finish(Error(event.message||'Surface worker failed'));
    worker.onmessageerror=()=>finish(Error('Surface worker result could not be read'));
    try{worker.postMessage({id,snapshot,resolution,halo,maxTriangles:plan.maxTriangles});}catch(error){finish(error);}
   });
  },cancel,dispose(){disposed=true;cancel();},get pending(){return !!active;}
 };
}
const prepared=new WeakMap();
export function rememberEarthSurface(source){prepared.set(source.config.snapshot,{source,fingerprint:JSON.stringify(source.config)});return source;}
export function preparedEarthSurface(config){const entry=prepared.get(config.snapshot);return entry&&entry.fingerprint===JSON.stringify(config)?entry.source:null;}
