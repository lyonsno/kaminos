import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

// Exercise the actual shared WGSL on a native device. A constant linear HDR
// texture makes all directions, including both poles, have the same result.
export function environmentPoleShader(coreSource) {
  const marker = 'const HDR_ENVIRONMENT_SAMPLING_WGSL = /* wgsl */`';
  const start = coreSource.indexOf(marker);
  assert.ok(start >= 0, 'shared environment sampler must exist');
  const end = coreSource.indexOf('`;', start + marker.length);
  assert.ok(end > start, 'shared environment sampler must be complete');
  return `
struct Params { hostFrameControls: vec4<f32> }
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var hdrEnvironmentTexture: texture_2d<f32>;
@group(0) @binding(2) var<storage, read_write> results: array<vec4<f32>, 6>;
${coreSource.slice(start + marker.length, end)}
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let directions = array<vec3<f32>, 6>(
    vec3<f32>(0, 1, 0), vec3<f32>(0, -1, 0),
    vec3<f32>(1, 0, 0), vec3<f32>(0, 0, 1),
    vec3<f32>(-1, 0.25, -1), vec3<f32>(0.01, 1, -0.01));
  results[id.x] = vec4<f32>(sampleEnvironment(directions[id.x]), 1.0);
}`;
}

export async function runEnvironmentPoleProbe(shader) {
  const adapter = await navigator.gpu.requestAdapter({powerPreference: 'high-performance'});
  if (!adapter) throw Error('No WebGPU adapter');
  const info = adapter.info;
  const device = await adapter.requestDevice();
  device.pushErrorScope('validation');
  const texture = device.createTexture({size: [2, 2], format: 'rgba32float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST});
  device.queue.writeTexture({texture}, new Float32Array([2,4,8,1, 2,4,8,1, 2,4,8,1, 2,4,8,1]), {bytesPerRow: 32}, [2,2]);
  const uniform = device.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
  device.queue.writeBuffer(uniform,0,new Float32Array([1,0,0,0]));
  const output = device.createBuffer({size:96,usage:GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC});
  const readback = device.createBuffer({size:96,usage:GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST});
  try {
    const module = device.createShaderModule({label:'actual-shared-HDR-pole-regression',code:shader});
    const compilation = await module.getCompilationInfo();
    if (compilation.messages.some(m => m.type === 'error')) throw Error(JSON.stringify(compilation.messages));
    const pipeline = device.createComputePipeline({layout:'auto',compute:{module,entryPoint:'main'}});
    const group = device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:uniform}},{binding:1,resource:texture.createView()},{binding:2,resource:{buffer:output}}]});
    const encoder = device.createCommandEncoder(), pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(6);pass.end();
    encoder.copyBufferToBuffer(output,0,readback,0,96);device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const bytes = new Uint32Array(readback.getMappedRange().slice(0));
    // Serialize raw bits first: JSON numbers would silently turn NaNs into null.
    const rawWords = Array.from(bytes);readback.unmap();
    const validation = await device.popErrorScope();
    return {backend:'webgpu_compute',adapter:{vendor:info.vendor,architecture:info.architecture,device:info.device,description:info.description,isFallbackAdapter:info.isFallbackAdapter},rawWords,validationError:validation?.message || null};
  } finally { texture.destroy();uniform.destroy();output.destroy();readback.destroy();device.destroy(); }
}

export function assertEnvironmentPoleProbe(result) {
  assert.equal(result?.backend,'webgpu_compute');
  assert.equal(result.validationError,null);
  assert.match(JSON.stringify(result.adapter),/apple/i,'this conformance witness requires native Apple WebGPU');
  assert.equal(result.adapter.isFallbackAdapter,false,'native adapter identity must explicitly reject fallback');
  assert.equal(result.rawWords?.length,24,'complete six-direction readback');
  for (const word of result.rawWords) assert.ok(Number.isInteger(word) && word >= 0 && word <= 0xffffffff,'raw f32 bits');
  const values = new Float32Array(new Uint32Array(result.rawWords).buffer);
  for (let i=0;i<6;i++) for (let j=0;j<4;j++) {
    const expected=[1.44,2.88,5.76,1][j];
    assert.ok(Number.isFinite(values[i*4+j]) && Math.abs(values[i*4+j]-expected)<0.0001,`direction ${i} channel ${j}: ${values[i*4+j]} != ${expected}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  environmentPoleShader(readFileSync(new URL('../finger-fluid-webgpu-core.js',import.meta.url),'utf8'));
  const good={backend:'webgpu_compute',adapter:{vendor:'apple',isFallbackAdapter:false},validationError:null,rawWords:Array.from(new Uint32Array(new Float32Array(Array.from({length:6},()=>[1.44,2.88,5.76,1]).flat()).buffer))};
  assertEnvironmentPoleProbe(good);
  for (const value of [undefined, null, 'true', 1]) {
    const adapter={...good.adapter};
    if(value===undefined) delete adapter.isFallbackAdapter;
    else adapter.isFallbackAdapter=value;
    assert.throws(()=>assertEnvironmentPoleProbe({...good,adapter}),/native adapter identity/);
  }
  for(const changed of [{backend:'cpu'},{adapter:{vendor:'google',description:'SwiftShader'}},{adapter:{vendor:'apple',isFallbackAdapter:true}},{validationError:'failed'},{rawWords:[]},{rawWords:good.rawWords.slice(4)},{rawWords:good.rawWords.map((v,i)=>i===0?0x7fc00000:v)},{rawWords:good.rawWords.map((v,i)=>i===0?0:v)}]) assert.throws(()=>assertEnvironmentPoleProbe({...good,...changed}));
  console.log('HDR pole witness rejects fallback, partial, zero and nonfinite samples; native GPU execution required for sampler conformance');
}
