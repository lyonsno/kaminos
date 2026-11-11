import {createEarthTeacherSource} from './earth-surface.mjs';
// Conservative admission for the actual single-mesh GPU buffer and available JS
// heap. It rejects before sampling; it never silently lowers requested detail.
export function planEarthSurface(snapshot,resolution,{maxBufferSize=Infinity,heapBytes=Infinity}={}){
 if(!Number.isSafeInteger(resolution)||resolution<2)throw Error('Surface detail must be an integer of at least 2');
 const {width,columns}=snapshot.config,spacing=width/columns;
 let top=-Infinity;for(const p of snapshot.particles)top=Math.max(top,p.position[1]);
 const span=width+2*spacing,height=top+spacing*3.32;
 const ny=Math.ceil(height/(span/resolution)),cells=resolution*resolution*ny,points=(resolution+1)**2*(ny+1);
 const triangles=cells*12+snapshot.grit.length*20,positionBytes=triangles*9*4;
 // Includes normals, retained JS triangle arrays/identities and a structured clone.
 const estimatedPeakBytes=points*4+triangles*640;
 if(!Number.isSafeInteger(cells)||positionBytes>maxBufferSize||estimatedPeakBytes>heapBytes)throw Error(`Requested surface is too large for interactive reconstruction (${cells.toLocaleString()} cells; estimated peak ${(estimatedPeakBytes/2**20).toFixed(0)} MiB). Use a smaller detail value; the specimen is unchanged.`);
 return {resolution,cells,points,estimatedPeakBytes,positionBytes};
}
export function createEarthSurfaceTask({WorkerType=globalThis.Worker,limits=()=>({})}={}){
 let active=null,disposed=false;
 const cancel=()=>{if(!active)return;const task=active;active=null;task.worker.terminate();task.reject(Object.assign(Error('Surface reconstruction stopped; previous surface retained'),{name:'AbortError'}));};
 return {
  async build(snapshot,resolution){
   if(disposed)throw Error('Surface builder disposed');
   planEarthSurface(snapshot,resolution,limits());cancel();
   if(!WorkerType)return createEarthTeacherSource({snapshot,resolution,halo:0});
   return new Promise((resolve,reject)=>{
    const worker=new WorkerType(new URL('./earth-surface-worker.mjs',import.meta.url),{type:'module'}),task={worker,reject};active=task;
    const finish=(error,value)=>{if(active!==task)return;active=null;worker.terminate();error?reject(error):resolve(value);};
    worker.onmessage=({data})=>data.error?finish(Error(data.error)):finish(null,data.source);
    worker.onerror=event=>finish(Error(event.message||'Surface worker failed'));
    worker.onmessageerror=()=>finish(Error('Surface worker result could not be read'));
    worker.postMessage({snapshot,resolution});
   });
  },cancel,dispose(){disposed=true;cancel();},get pending(){return !!active;}
 };
}
