import * as THREE from '../lib/three.webgpu.js';
import {createLiveLogHeatGpu} from '../live-log-heat-gpu.mjs';
import {createGpuSceneSolidProducer} from '../scene-solid-gpu.mjs';

export function checkedRegionalAdapter(adapter){
 const info=adapter?.info,fallback=info?.isFallbackAdapter??adapter?.isFallbackAdapter;
 if(!adapter||fallback!==false||info?.vendor!=='apple')throw Error('Verified native Apple regional material probe required');
 return {vendor:info.vendor,description:info.description??null,isFallbackAdapter:fallback};
}

// Small numerical consumer check. It does not render or claim a live scene.
export async function probeRegionalHeat(){
 const adapter=await navigator.gpu.requestAdapter();
 const identity=checkedRegionalAdapter(adapter);
 const device=await adapter.requestDevice(),owned=[],errors=[];let field,solids;
 device.addEventListener('uncapturederror',e=>errors.push(e.error.message));
 const backendCache=new WeakMap(),renderer={backend:{device,get(key){if(!backendCache.has(key))backendCache.set(key,{});return backendCache.get(key);}}};
 const mesh=new THREE.Mesh(new THREE.BoxGeometry(.4,.4,.4),new THREE.MeshStandardMaterial());mesh.geometry.computeBoundingBox();
 const buffer=(label,data)=>{const b=device.createBuffer({label,size:data.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC});owned.push(b);device.queue.writeBuffer(b,0,data);return b;};
 async function read(b){const s=device.createBuffer({size:b.size,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});try{const e=device.createCommandEncoder();e.copyBufferToBuffer(b,0,s,0,b.size);device.queue.submit([e.finish()]);await s.mapAsync(GPUMapMode.READ);return Array.from(new Float32Array(s.getMappedRange()));}finally{s.unmap();s.destroy();}}
 try{
  field=await createLiveLogHeatGpu({renderer,mesh,bounds:mesh.geometry.boundingBox,disintegrate:true});
  const owners=Uint32Array.from({length:16**3},(_,i)=>i%16>=8?1:0);
  const data=new Float32Array(32),setPose=x=>{data.set(new THREE.Matrix4().elements);data.set(new THREE.Matrix4().makeTranslation(x,0,0).elements,16);};
  setPose(.7);const matrices=buffer('Probe current region poses',data);field.setRegionMotion({device,owners,matrices,count:2});
  const fluid=new Float32Array(32**3*16);for(let i=0;i<32**3;i++)if(i%32>=26)fluid[i*16+5]=4;
  const source=buffer('Probe transported heat',fluid);solids=createGpuSceneSolidProducer(device,{grid:32});const collision=solids.texture;
  const frame={device,fluid:source,collision,dimensions:[32,32,32],allocationId:'regional-thermal-probe',simStepCount:0,dt:1/60,transform:{translate:[0,0,0],scale:1}};
  function encodeSolids(encoder){solids.update([{id:'material',object:mesh}],frame.transform,{grid:32,gridHeight:32},{materialMasks:[field.materialMask('material')]});solids.encode(encoder);}
  device.pushErrorScope('validation');
  for(let i=0;i<60;i++){frame.simStepCount=i;const e=device.createCommandEncoder();encodeSolids(e);field.encode(e,frame);device.queue.submit([e.finish()]);}
  const material=await read(field.residentState().after),summary={leftPeak:0,rightPeak:0,rightFuelLost:0};
  for(let i=0;i<owners.length;i++){if(!material.slice(i*8,i*8+8).every(Number.isFinite))throw Error('Nonfinite regional material');const key=owners[i]?'rightPeak':'leftPeak';summary[key]=Math.max(summary[key],material[i*8]);if(owners[i])summary.rightFuelLost+=1-material[i*8+5];}
  const heatedValidation=await device.popErrorScope();if(heatedValidation)throw Error(heatedValidation.message);
  if(summary.leftPeak>1e-6||summary.rightPeak<1||summary.rightFuelLost<=0)throw Error('Regional heat failed: '+JSON.stringify(summary));
  // Gas follows a subsequent pose without clearing or copying the material field.
  setPose(-.7);device.queue.writeBuffer(matrices,0,data);
  const sums=buffer('Probe gas accumulation',new Float32Array(32**3*2));device.pushErrorScope('validation');
  const e=device.createCommandEncoder();encodeSolids(e);field.encodeGasSource(e,frame,{enabled:true,accumulation:sums});device.queue.submit([e.finish()]);
  const gas=await read(sums);let total=0,negative=0,positive=0;
  for(let i=0;i<32**3;i++){const value=gas[i*2];if(!Number.isFinite(value)||value<0)throw Error('Invalid deposited gas');total+=value;if(i%32<16)negative+=value;else positive+=value;}
  const gasValidation=await device.popErrorScope();if(gasValidation)throw Error(gasValidation.message);
  if(total<=0||positive>1e-6||negative!==total)throw Error('Gas did not follow the moved region: '+JSON.stringify({total,negative,positive}));
  device.pushErrorScope('validation');
  solids.update([{id:'material',object:mesh}],frame.transform,{grid:32,gridHeight:32},{materialMasks:[field.materialMask('material')]});
  const solidEncoder=device.createCommandEncoder();solids.encode(solidEncoder);device.queue.submit([solidEncoder.finish()]);
  const obstruction=await solids.snapshot(),solidSummary={movedCells:0,staleCells:0};
  obstruction.cells.forEach((value,i)=>{if(value&&i%32<10)solidSummary.movedCells++;if(value&&i%32>=17)solidSummary.staleCells++;});
  const solidValidation=await device.popErrorScope();if(solidValidation)throw Error(solidValidation.message);
  if(!obstruction.valid||!solidSummary.movedCells||solidSummary.staleCells)throw Error('Material obstruction did not follow the moved region: '+JSON.stringify(solidSummary));
  if(errors.length)throw Error(errors.join('\n'));
  return {adapter:identity,fallback:identity.isFallbackAdapter,dimensions:frame.dimensions,materialGrid:[16,16,16],steps:field.read().steps,summary,gas:{total,negative,positive},solidSummary,obstruction:{...obstruction,cells:Array.from(obstruction.cells)},material,gasAccumulation:gas,owners:Array.from(owners),poses:Array.from(data),errors};
 }finally{solids?.destroy();field?.dispose();mesh.geometry.dispose();mesh.material.dispose();for(const r of owned)r.destroy();device.destroy();}
}
