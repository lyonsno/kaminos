import {LIVE_LOG_GAS_EXPANSION_RATIO} from './live-log-heat-core.mjs';
export const LOG_GAS_SOURCE_IDENTITY='kaminos.log.gpu-gas-source.v1';

const RESOLVE=`
struct Grid { dims:vec4<u32> }
@group(0) @binding(0) var<storage,read_write> sums:array<atomic<u32>>;
@group(0) @binding(1) var source:texture_storage_3d<rg32float,write>;
@group(0) @binding(2) var<uniform> grid:Grid;
@compute @workgroup_size(4,4,4)
fn resolve(@builtin(global_invocation_id) c:vec3<u32>){
  if(any(c>=grid.dims.xyz)){return;}
  let i=(c.x+grid.dims.x*(c.y+grid.dims.y*c.z))*2u;
  let fuel=bitcast<f32>(atomicLoad(&sums[i]));
  let thermal=bitcast<f32>(atomicLoad(&sums[i+1u]));
  var temperature=0.0;if(fuel>0.0){temperature=thermal/fuel;}
  textureStore(source,vec3<i32>(c),vec4<f32>(fuel,temperature,0.0,0.0));
}`;

export async function createLogGasSourceGpu({device,dimensions}){
  const [x,y,z]=dimensions;
  if(!dimensions.every(n=>Number.isInteger(n)&&n>0))throw Error('Invalid gas source dimensions');
  const owned=[];let disposed=false,enabled=true,steps=0;
  try{
    const texture=device.createTexture({label:'wood gas supply and temperature',dimension:'3d',size:dimensions,format:'rg32float',usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});owned.push(texture);
    const accumulation=device.createBuffer({label:'wood gas surface accumulation',size:x*y*z*8,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});owned.push(accumulation);
    const grid=device.createBuffer({label:'wood gas grid',size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});owned.push(grid);device.queue.writeBuffer(grid,0,new Uint32Array([x,y,z,0]));
    const module=device.createShaderModule({label:'wood gas resolve',code:RESOLVE});
    const info=await module.getCompilationInfo();if(info.messages.some(m=>m.type==='error'))throw Error('Wood gas WGSL: '+info.messages.map(m=>m.message).join('; '));
    const pipeline=await device.createComputePipelineAsync({label:'wood gas source resolve',layout:'auto',compute:{module,entryPoint:'resolve'}});
    const group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:accumulation}},{binding:1,resource:texture.createView()},{binding:2,resource:{buffer:grid}}]});
    const descriptor={identity:LOG_GAS_SOURCE_IDENTITY,device,texture,dimensions:[...dimensions]};
    function reset(){
      if(disposed)throw Error('Wood gas source disposed');
      device.queue.writeBuffer(accumulation,0,new Uint32Array(x*y*z*2));
      const row=Math.ceil(x*8/256)*256;
      device.queue.writeTexture({texture},new Uint8Array(row*y*z),{bytesPerRow:row,rowsPerImage:y},dimensions);steps=0;
    }
    reset();
    return {descriptor,accumulation,get enabled(){return enabled;},
      setEnabled(value){if(typeof value!=='boolean')throw Error('Wood fuel feed requires a boolean');enabled=value;},
      begin(encoder){if(disposed)throw Error('Wood gas source disposed');encoder.clearBuffer(accumulation);},
      resolve(encoder){const pass=encoder.beginComputePass({label:'wood gas source resolve'});pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(Math.ceil(x/4),Math.ceil(y/4),Math.ceil(z/4));pass.end();steps++;},
      reset,read:()=>({identity:LOG_GAS_SOURCE_IDENTITY,enabled,steps,dimensions:[...dimensions],runtimeReadbacks:0,source:'finite-local-wood-fuel',units:'gas-volume-turnover-per-reference-step-and-temperature',expansionRatio:LIVE_LOG_GAS_EXPANSION_RATIO}),
      dispose(){if(disposed)return;disposed=true;for(const resource of owned)resource.destroy();},
    };
  }catch(error){for(const resource of owned)resource.destroy();throw error;}
}
