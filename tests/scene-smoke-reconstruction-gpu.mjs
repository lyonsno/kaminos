import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {DISTRIBUTED_SMOKE_WGSL} from '../scene-volume-gather.mjs';
import {buildSmokeReconstructionCells} from '../scene-smoke-reconstruction.mjs';
import {buildTriangleVisibility} from '../scene-light-visibility.mjs';

const out = process.argv[2];
assert.ok(out, 'caller must name evidence output directory');
await fs.mkdir(out, {recursive:true});
const executable = '/Users/noahlyons/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const report = {status:'running', phase:'launch', executable, playwrightModule:process.env.PLAYWRIGHT_MODULE, shaderHash:createHash('sha256').update(DISTRIBUTED_SMOKE_WGSL).digest('hex'), checks:[]};
const save = () => fs.writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
await save();
let browser;
try {
  assert.ok(report.playwrightModule, 'caller must name PLAYWRIGHT_MODULE');
  const {chromium} = await import(report.playwrightModule);
  await fs.access(executable);
  browser = await chromium.launch({executablePath:executable, headless:true, args:['--enable-unsafe-webgpu','--use-angle=metal']});
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:18531/api/runtime-config');
  report.runtime = await page.evaluate(() => JSON.parse(document.body.innerText));
  report.phase = 'gpu-contracts'; await save();
  const fixture = triangles => {
    const packed=buildTriangleVisibility(triangles).packGpu();
    const cells=buildSmokeReconstructionCells(packed,[2,4,2]);
    return {bins:Array.from(cells.words),triangles:Array.from(packed.triangles)};
  };
  const plane = fixture([{a:[0,-2,-2],b:[0,4,-2],c:[0,4,2]},{a:[0,-2,-2],b:[0,4,2],c:[0,-2,2]}]);
  const oblique = fixture([{a:[.7,-2,-2],b:[-1.1,4,-2],c:[-1.1,4,2]},{a:[.7,-2,-2],b:[-1.1,4,2],c:[.7,-2,2]}]);
  const corners=Array.from({length:8},(_,i)=>[(i&1)?.1:-.1,(i&2)?1.1:.9,(i&4)?.1:-.1]);
  const faces=[[0,1,3,2],[4,6,7,5],[0,4,5,1],[2,3,7,6],[0,2,6,4],[1,5,7,3]];
  const cage=fixture(faces.flatMap(([a,b,c,d])=>[{a:corners[a],b:corners[b],c:corners[c]},{a:corners[a],b:corners[c],c:corners[d]}]));
  report.fixtures={plane,oblique,cage};
  await fs.writeFile(`${out}/shader.wgsl`,DISTRIBUTED_SMOKE_WGSL);
  report.signal = await page.evaluate(async ({shader,fixtures}) => {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter || adapter.isFallbackAdapter) throw new Error('native WebGPU adapter required');
    const info = {vendor:adapter.info.vendor, architecture:adapter.info.architecture, device:adapter.info.device, description:adapter.info.description, isFallbackAdapter:adapter.isFallbackAdapter};
    if (/swiftshader/i.test(JSON.stringify(info))) throw new Error('software fallback is not native evidence');
    const device = await adapter.requestDevice();
    const errors = []; device.addEventListener('uncapturederror', e => errors.push(String(e.error)));
    device.pushErrorScope('validation');
    const dims = [2,4,2], binsDims = dims.map(n=>n+1), binsCount = binsDims.reduce((a,b)=>a*b);
    const values = new Float32Array(2*4*2*4);
    for (let z=0;z<2;z++) for(let y=0;y<4;y++) for(let x=0;x<2;x++) values.set([1.5+x,2.5+y,3.5+z,1],4*(x+2*(y+4*z)));
    const texture = device.createTexture({dimension:'3d', size:dims, format:'rgba32float', usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
    device.queue.writeTexture({texture},values,{bytesPerRow:32,rowsPerImage:4},dims);
    const queries = [[-.25,1.25,.1],[-1,-1,-1],[1,3,1],[0,3.01,0]];
    const empty = new Uint32Array(binsCount*2);
    const triangles = new Float32Array(fixtures.plane.triangles);
    const code = shader.replaceAll('@group(2)', '@group(0)') + `
      @group(0) @binding(3) var<storage,read> queries:array<vec4<f32>>;
      @group(0) @binding(4) var<storage,read_write> result:array<vec4<f32>>;
      @compute @workgroup_size(1) fn test(@builtin(global_invocation_id) id:vec3<u32>){result[id.x]=vec4<f32>(distributedMeanIncident(queries[id.x].xyz),1.0);}`;
    const module = device.createShaderModule({code});
    const diagnostics = await module.getCompilationInfo();
    if (diagnostics.messages.some(m=>m.type==='error')) throw new Error(JSON.stringify(diagnostics.messages));
    const layout=device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:'unfilterable-float',viewDimension:'3d'}},
      ...[1,2,3,4].map(binding=>({binding,visibility:GPUShaderStage.COMPUTE,buffer:{type:binding===4?'storage':'read-only-storage'}}))]});
    const pipeline=await device.createComputePipelineAsync({layout:device.createPipelineLayout({bindGroupLayouts:[layout]}),compute:{module,entryPoint:'test'}});
    async function run(bins, data=values, positions=queries, triangleData=triangles) {
      device.queue.writeTexture({texture},data,{bytesPerRow:32,rowsPerImage:4},dims);
      const resources=[];
      const buffer=(data,usage)=>{const b=device.createBuffer({size:Math.max(16,data.byteLength),usage:usage|GPUBufferUsage.COPY_DST});device.queue.writeBuffer(b,0,data);resources.push(b);return b;};
      const inputs=[bins,triangleData,new Float32Array(positions.flatMap(p=>[...p,0]))].map(d=>buffer(d,GPUBufferUsage.STORAGE));
      const result=device.createBuffer({size:positions.length*16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});resources.push(result);
      const readback=device.createBuffer({size:positions.length*16,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});resources.push(readback);
      const group=device.createBindGroup({layout,entries:[{binding:0,resource:texture.createView()},...inputs.map((b,i)=>({binding:i+1,resource:{buffer:b}})),{binding:4,resource:{buffer:result}}]});
      const encoder=device.createCommandEncoder();const pass=encoder.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(positions.length);pass.end();encoder.copyBufferToBuffer(result,0,readback,0,positions.length*16);device.queue.submit([encoder.finish()]);
      await readback.mapAsync(GPUMapMode.READ);const answer=Array.from(new Float32Array(readback.getMappedRange()));
      for(const b of resources)b.destroy();return answer;
    }
    const linear=await run(empty);
    const split=new Float32Array(values.length);
    for(let z=0;z<2;z++)for(let y=0;y<4;y++)for(let x=0;x<2;x++)split.set([x?100:2,x?100:2,x?100:2,1],4*(x+2*(y+4*z)));
    const wall=await run(new Uint32Array(fixtures.plane.bins),split,[[-.1,1,0],[.1,1,0]]);
    const obliqueValues=new Float32Array(values.length);
    for(let z=0;z<2;z++)for(let y=0;y<4;y++)for(let x=0;x<2;x++){
      const v=(-.5+x)+.3*(-.5+y)<.1?2:100;obliqueValues.set([v,v,v,1],4*(x+2*(y+4*z)));
    }
    const oblique=await run(new Uint32Array(fixtures.oblique.bins),obliqueValues,[[0,0,0],[.2,0,0]],new Float32Array(fixtures.oblique.triangles));
    const blocked=await run(new Uint32Array(fixtures.cage.bins),values,[[0,1,0]],new Float32Array(fixtures.cage.triangles));
    const validation=await device.popErrorScope();
    texture.destroy();device.destroy();
    return {adapter:info, dimensions:dims,queries,linear,wall,oblique,blocked,validation:validation?.message??null,errors};
  }, {shader:DISTRIBUTED_SMOKE_WGSL,fixtures:report.fixtures});
  await save();
  assert.equal(report.signal.validation,null);
  assert.deepEqual(report.signal.errors,[]);
  assert.equal(report.signal.linear.length,16,'complete raw numerical output required');
  const expect=(name,actual,expected)=>{assert.equal(actual.length,expected.length);actual.forEach((v,i)=>assert.ok(Number.isFinite(v)&&Math.abs(v-expected[i])<1e-5,`${name}[${i}] expected ${expected[i]}, got ${v}`));report.checks.push(name);};
  expect('linear full-height reconstruction',report.signal.linear.slice(0,3),[1.75,4.25,4.1]);
  expect('lower boundary',report.signal.linear.slice(4,7),[1.5,2.5,3.5]);
  expect('upper boundary',report.signal.linear.slice(8,11),[2.5,5.5,4.5]);
  expect('outside support',report.signal.linear.slice(12,15),[0,0,0]);
  expect('wall blocks interpolation',report.signal.wall,[2,2,2,1,100,100,100,1]);
  expect('oblique wall blocks interpolation',report.signal.oblique,[2,2,2,1,100,100,100,1]);
  expect('no visible receiver contributes zero',report.signal.blocked,[0,0,0,1]);
  report.status='passed';report.phase='complete';
} catch(error) {report.status='failed';report.error=String(error.stack||error);process.exitCode=1;}
finally {await save();await browser?.close();}
console.log(JSON.stringify({status:report.status,phase:report.phase,checks:report.checks,error:report.error,evidence:`${out}/report.json`}));
