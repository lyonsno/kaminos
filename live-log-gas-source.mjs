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
  let [x,y,z]=dimensions;
  if(dimensions.length!==3||!dimensions.every(n=>Number.isInteger(n)&&n>0))throw Error('Invalid gas source dimensions');
  const owned=[];let disposed=false,enabled=true,steps=0;
  try{
    let texture,accumulation,group;
    const grid=device.createBuffer({label:'wood gas grid',size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});owned.push(grid);device.queue.writeBuffer(grid,0,new Uint32Array([x,y,z,0]));
    const module=device.createShaderModule({label:'wood gas resolve',code:RESOLVE});
    const info=await module.getCompilationInfo();if(info.messages.some(m=>m.type==='error'))throw Error('Wood gas WGSL: '+info.messages.map(m=>m.message).join('; '));
    const pipeline=await device.createComputePipelineAsync({label:'wood gas source resolve',layout:'auto',compute:{module,entryPoint:'resolve'}});
    const descriptor={identity:LOG_GAS_SOURCE_IDENTITY,device,texture:null,dimensions:[]};
    function resize(next){
      if(disposed)throw Error('Wood gas source disposed');
      if(!Array.isArray(next)||next.length!==3||!next.every(n=>Number.isInteger(n)&&n>0))throw Error('Invalid gas source dimensions');
      if(next.every((n,i)=>n===descriptor.dimensions[i]))return;
      let nextTexture,nextAccumulation;
      try{
        nextTexture=device.createTexture({label:'wood gas supply and temperature',dimension:'3d',size:next,format:'rg32float',usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
        nextAccumulation=device.createBuffer({label:'wood gas surface accumulation',size:next[0]*next[1]*next[2]*8,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
        const nextGroup=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:nextAccumulation}},{binding:1,resource:nextTexture.createView()},{binding:2,resource:{buffer:grid}}]});
        texture?.destroy();accumulation?.destroy();texture=nextTexture;accumulation=nextAccumulation;group=nextGroup;
        dimensions=[...next];[x,y,z]=dimensions;descriptor.texture=texture;descriptor.dimensions=[...dimensions];
        device.queue.writeBuffer(grid,0,new Uint32Array([x,y,z,0]));reset();
      }catch(error){if(nextTexture!==texture)nextTexture?.destroy();if(nextAccumulation!==accumulation)nextAccumulation?.destroy();throw error;}
    }
    function reset(){
      if(disposed)throw Error('Wood gas source disposed');
      device.queue.writeBuffer(accumulation,0,new Uint32Array(x*y*z*2));
      const row=Math.ceil(x*8/256)*256;
      device.queue.writeTexture({texture},new Uint8Array(row*y*z),{bytesPerRow:row,rowsPerImage:y},dimensions);steps=0;
    }
    resize(dimensions);
    return {descriptor,get accumulation(){return accumulation;},get enabled(){return enabled;},resize,
      setEnabled(value){if(typeof value!=='boolean')throw Error('Wood fuel feed requires a boolean');enabled=value;},
      begin(encoder){if(disposed)throw Error('Wood gas source disposed');encoder.clearBuffer(accumulation);},
      resolve(encoder){const pass=encoder.beginComputePass({label:'wood gas source resolve'});pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(Math.ceil(x/4),Math.ceil(y/4),Math.ceil(z/4));pass.end();steps++;},
      reset,read:()=>({identity:LOG_GAS_SOURCE_IDENTITY,enabled,steps,dimensions:[...dimensions],runtimeReadbacks:0,source:'finite-local-wood-fuel',units:'gas-volume-turnover-per-reference-step-and-temperature',expansionRatio:LIVE_LOG_GAS_EXPANSION_RATIO}),
      dispose(){if(disposed)return;disposed=true;texture.destroy();accumulation.destroy();for(const resource of owned)resource.destroy();},
    };
  }catch(error){for(const resource of owned)resource.destroy();throw error;}
}
