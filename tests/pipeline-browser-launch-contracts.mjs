import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const url = new URL('../pipeline-ui-browser-launch.mjs', import.meta.url);
assert.ok(await fs.access(url).then(()=>true,()=>false), 'Pipeline mesh witness must use the exercised native viewport launch contract.');
const { pipelineUiBrowserLaunch, pipelineViewportErrors } = await import(url);
const config={executable:'/independent/Google Chrome for Testing',debugPort:63236,userDataDir:'/owned/profile',
  width:2048,height:1180,realpath:p=>p};
const launch=pipelineUiBrowserLaunch(config);
assert.equal(launch.executable,config.executable);
assert.ok(launch.args.includes('--headless=new'));
assert.ok(launch.args.includes('--enable-unsafe-webgpu'));
assert.ok(launch.args.includes('--enable-features=Vulkan,UseSkiaRenderer'));
assert.equal(launch.args.at(-1),'about:blank');
assert.throws(()=>pipelineUiBrowserLaunch({...config,executable:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}),/operator Chrome/);
// Observed actual CFT153 viewport compiler failure; floor+gizmo remained
// nonblank even while these real material pipelines were invalid.
const observed={method:'Runtime.consoleAPICalled',params:{type:'error',args:[{type:'string',
  value:'THREE.WebGPURenderer: Render pipeline creation failed (renderPipeline_TRELLIS2 learned PBR_127): An error occurred while generating Tint IR\nerror: swizzle view instruction still has usages after lowering'}]}};
assert.equal(pipelineViewportErrors([observed]).length,1);
assert.equal(pipelineViewportErrors([{...observed,params:{...observed.params,args:[{description:'THREE.WebGPURenderer: Uncaptured WebGPU GPUValidationError: Invalid RenderPipeline'}]}}]).length,1);
assert.equal(pipelineViewportErrors([{method:'Runtime.consoleAPICalled',params:{type:'log',args:[{value:'mesh selected'}]}}]).length,0);
const source=await fs.readFile(new URL('../pipeline-ui-witness.mjs',import.meta.url),'utf8'),
  start=source.indexOf('async function publishWitness('),end=source.indexOf('\nasync function wait(',start);
assert.ok(start>=0&&end>start);
let published;const exitCode=process.exitCode;
const publish=new Function('args','writeFile','browser','chrome','pipelineId','expectedArtifactRole',
  'runtimeConsoleEvents','pipelineViewportErrors','console',source.slice(start,end)+'\nreturn publishWitness;')(
  new Map([['report','/owned/report.json']]),async(_p,bytes)=>{published=JSON.parse(bytes);},launch,
  config.executable,'trellis-image-to-mesh-webgpu-v0','textured-mesh',[observed],pipelineViewportErrors,{log(){},error(){}});
await publish({ok:true,screenshotProbe:{visiblePixels:1000000}});
process.exitCode=exitCode;
assert.equal(published.ok,false,'A nonblank floor/gizmo must not hide the observed mesh compiler failure.');
assert.equal(published.viewportErrors.length,1);
console.log('Effective native mesh viewport flags and actual observed render errors are recorded; compiler failure cannot close a mesh witness.');
