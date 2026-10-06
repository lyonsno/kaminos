import assert from 'node:assert/strict';
import * as fpn from '../src/sam-image-fpn-neck-phase-program.js';
import { readFileSync } from 'node:fs';
import { createLinearDispatch, defineComputeKernel, WEBGPU_SHADER_STAGE } from '../src/runtime-primitives.js';
import { createSamRangePhaseRuntime } from '../src/sam-range-phase-program.js';
import { defineWebGpuPhaseProgram } from '../src/phase-program.js';

assert.equal(typeof fpn.createSamFpnConvolutionRanges, 'function', 'image neck must partition complete convolution work');
for (const [total, channels, kernel] of [[1, 4, 1], [133, 7, 3], [288 * 288 * 256, 256, 3], [2 * 145 * 143 * 256, 256, 3]]) {
  const ranges = fpn.createSamFpnConvolutionRanges(total, channels, kernel, 64);
  let end = 0;
  for (const range of ranges) {
    assert.equal(range.start, end);
    assert.ok(range.count > 0);
    assert.ok(range.dispatch.every(d => d <= 64));
    assert.ok(range.dispatch.reduce((a, b) => a * b, 64) >= range.count);
    end += range.count;
  }
  assert.equal(end, total);
}
for (const args of [[0, 256, 3], [10, 0, 3], [10, 256, 0], [2 ** 32, 256, 3], [10, 1.5, 3]]) {
  assert.throws(() => fpn.createSamFpnConvolutionRanges(...args), /positive|u32/);
}
const source = readFileSync(new URL('../src/sam-image-fpn-neck-phase-program.js', import.meta.url), 'utf8');
assert.match(source, /const CONV2D_RANGE_WGSL = createConv2dWgsl\(true\)/);
assert.match(source, /if \(local_index >= output_range\.output_count\) \{ return; \}/);
assert.match(source, /let index = output_range\.output_start \+ local_index;/);
assert.match(source, /const ranges = createSamFpnConvolutionRanges\(totalOutput, spec\.inChannels, spec\.kernelSize, maxComputeWorkgroupsPerDimension\)/);
const trackingStart = source.indexOf('async function runSam31TrackingNeckPhaseProgramRoute');
assert.ok(trackingStart > 0);
const imagePart = source.slice(source.indexOf('export async function runSam3ImageFpnNeckPhaseProgramRoute'), trackingStart);
assert.match(imagePart, /code: CONV2D_RANGE_WGSL/);
assert.match(imagePart, /resource: rangeUniform/);
const trackingPart = source.slice(trackingStart);
assert.doesNotMatch(trackingPart, /CONV2D_RANGE_WGSL|createSamFpnConvolutionRanges/);
const shaderFunction = source.slice(source.indexOf('function createConv2dWgsl('), source.indexOf('const CONV2D_WGSL ='));
const shader = new Function(`${shaderFunction}; return createConv2dWgsl;`)();
assert.equal(shader(true).replace('struct OutputRange { output_start: u32, output_count: u32, };\n@group(0) @binding(5) var<uniform> output_range: OutputRange;', '')
  .replace('let local_index = gid.x + gid.y * dispatch_grid.x * 64u;\n  if (local_index >= output_range.output_count) { return; }\n  let index = output_range.output_start + local_index;', 'let index = gid.x + gid.y * dispatch_grid.x * 64u;'), shader(false));
const block = imagePart.match(/const runKernel = async \([^]*?\n    \};/)[0];
const tensors = { x: {name:'x'}, y: {name:'y'}, w: {name:'w'}, b: {name:'b'}, convDims: {update(){}} };
const kernels = {conv2d:{code:shader(false), bindings:['input','weight','bias','output','convDims'].map((name,i)=>({name,resource:`${i===4?'uniform':'tensor'}:${name}`}))}};
let program;
const runtime = {createUniformBuffer: spec=>spec, defineProgram: spec=>defineWebGpuPhaseProgram(spec,{runtime:{defineComputeKernel: spec=>spec}}), async runProgram(value){program=value;} };
// This extraction captures range construction; pipeline reuse is exercised by
// sam-range-phase-program-contracts with the real phase-program resolver.
const constructRun = new Function('tensors','shape','convDimsValues','dispatchFor','kernels','runtime','metadata','createSamFpnConvolutionRanges','maxComputeWorkgroupsPerDimension','CONV2D_RANGE_WGSL','WEBGPU_SHADER_STAGE','createSamRangePhaseRuntime', `${block}; return runKernel;`);
const run = constructRun(tensors,{batch:1},()=>({}),(_name,total)=>createLinearDispatch(total,{workgroupSize:64}),kernels,runtime,{},fpn.createSamFpnConvolutionRanges,65535,shader(true),WEBGPU_SHADER_STAGE, runtime => runtime);
await run({name:'fpn-neck-proj2-0',kernel:'conv2d',inputTensor:'x',outputTensor:'y',weightTensor:'w',biasTensor:'b',inShape:{},outShape:{height:288,width:288,channels:256},spec:{inChannels:256,kernelSize:3}});
let end = 0;
for(const phase of program.phases){
  const range=phase.kernel.bindings[5].resource.values;
  assert.equal(range.output_start,end);
  end+=range.output_count;
  assert.equal(phase.kernel.bindings[0].resource,tensors.x);
  assert.equal(phase.kernel.bindings[3].resource,tensors.y);
  assert.equal(phase.yieldAfter,true);
}
assert.equal(end,288*288*256);
assert.equal(program.phases[0].name,'fpn-neck-proj2-0');
async function productionHostConstruction(facade) {
  let pipelines = 0, bindGroups = 0, captured;
  const device = {
    createBindGroupLayout: descriptor => ({ descriptor }),
    createPipelineLayout: descriptor => ({ descriptor }),
    createBindGroup(descriptor) { bindGroups++; return { descriptor }; },
  };
  const hostTensors = Object.fromEntries(Object.entries(tensors).map(([name, value]) => [name, { ...value, buffer: { name }, byteLength: 16 }]));
  const hostRuntime = {
    device,
    createUniformBuffer: spec => ({ ...spec, buffer: { values: spec.values }, byteLength: 16 }),
    defineComputeKernel: spec => defineComputeKernel(spec, { device,
      getShaderModule: (name, code) => ({ name, code }),
      getComputePipeline(name, descriptor) { pipelines++; return { name, descriptor }; },
    }),
    defineProgram(spec) { return defineWebGpuPhaseProgram(spec, { runtime: hostRuntime }); },
    async runProgram(value) { captured = value; },
  };
  const hostRun = constructRun(hostTensors, { batch: 1 }, () => ({}), (_name, total) => createLinearDispatch(total, { workgroupSize: 64 }),
    kernels, hostRuntime, {}, fpn.createSamFpnConvolutionRanges, 65535, shader(true), WEBGPU_SHADER_STAGE, facade);
  await hostRun({ name: 'fpn-neck-proj2-0', kernel: 'conv2d', inputTensor: 'x', outputTensor: 'y', weightTensor: 'w', biasTensor: 'b',
    inShape: {}, outShape: { height: 288, width: 288, channels: 256 }, spec: { inChannels: 256, kernelSize: 3 } });
  assert.equal(captured.phases.length, 46, 'actual native-shape FPN production expansion');
  let end = 0;
  for (const phase of captured.phases) {
    const entries = phase.kernel.bindGroup.descriptor.entries;
    const range = entries[5].resource.buffer.values;
    assert.equal(range.output_start, end);
    end += range.output_count;
    assert.equal(entries[0].resource.buffer, hostTensors.x.buffer);
    assert.equal(entries[3].resource.buffer, hostTensors.y.buffer);
    assert.equal(phase.yieldAfter, true);
  }
  assert.equal(end, 288 * 288 * 256);
  assert.equal(new Set(captured.phases.map(phase => phase.kernel.bindGroup)).size, 46);
  return { pipelines, bindGroups };
}
assert.deepEqual(await productionHostConstruction(runtime => runtime), { pipelines: 46, bindGroups: 46 }, 'ordinary route exposes repeated production setup');
assert.deepEqual(await productionHostConstruction(createSamRangePhaseRuntime), { pipelines: 1, bindGroups: 46 }, 'FPN production ranges reuse one executable body');
console.log('SAM FPN complete convolution ranges and production 46-to-1 pipeline setup passed');
