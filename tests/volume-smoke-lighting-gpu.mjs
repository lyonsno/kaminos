// Compile the actual consumer variants on a caller-selected native Dawn route.
// This is pipeline compatibility evidence, not a visual or frame-budget claim.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const [dawnPath,out]=process.argv.slice(2);
assert(dawnPath&&out,'usage: node tests/volume-smoke-lighting-gpu.mjs <Dawn module> <output>');
mkdirSync(out,{recursive:true});
const report={phase:'source',passed:false,cases:[],dawnPath:resolve(dawnPath)};
const save=()=>writeFileSync(resolve(out,'report.json'),JSON.stringify(report,null,2));
save();let gpu,device;
try {
  report.source={root:resolve(new URL('..',import.meta.url).pathname),revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
    hashes:Object.fromEntries(['volume-core.js','volume-smoke-lighting.mjs','tests/volume-smoke-lighting-selection.mjs'].map(f=>[f,createHash('sha256').update(readFileSync(new URL('../'+f,import.meta.url))).digest('hex')]))};
  const {shaderVariants}=await import('./volume-smoke-lighting-selection.mjs');
  report.phase='adapter';save();
  const {create,globals}=await import(pathToFileURL(resolve(dawnPath)));Object.assign(globalThis,globals);
  gpu=create(['backend=metal']);const adapter=await gpu.requestAdapter();assert(adapter,'Metal adapter required');
  report.adapter={vendor:adapter.info.vendor,architecture:adapter.info.architecture,description:adapter.info.description};
  assert.match(adapter.info.vendor,/apple/i,'fallback/non-Apple route cannot satisfy this witness');
  device=await adapter.requestDevice({requiredLimits:{maxStorageBuffersPerShaderStage:adapter.limits.maxStorageBuffersPerShaderStage,maxSampledTexturesPerShaderStage:adapter.limits.maxSampledTexturesPerShaderStage}});
  for(const {route,enabled,code} of shaderVariants()) {
    report.phase=`compile-${route}-outer-${enabled}`;save();
    writeFileSync(resolve(out,`${route}-${enabled}.wgsl`),code);
    const module=device.createShaderModule({code});
    const errors=[...(await module.getCompilationInfo()).messages].filter(m=>m.type==='error').map(m=>m.message);
    assert.deepEqual(errors,[]);
    await device.createRenderPipelineAsync({layout:'auto',vertex:{module,entryPoint:'vs'},fragment:{module,entryPoint:'fs',constants:{GRID:32,GRID_Y:32,TRANSPARENT_CANVAS:0,LEAN_STOCK_RAYMARCH:false},targets:[{format:'rgba8unorm'}]},primitive:{topology:'triangle-list'}});
    report.cases.push({route,outer:enabled,pipelineCreated:true,sha256:createHash('sha256').update(code).digest('hex')});save();
  }
  report.phase='complete';report.passed=true;
}catch(error){report.error=error.stack;process.exitCode=1;}
finally{device?.destroy();save();}
