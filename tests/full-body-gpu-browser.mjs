// kaminos-test: browser — small native compute conformance, not the shared-scene handoff
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const args=Object.fromEntries(process.argv.slice(2).reduce((a,v,i,l)=>i%2?a:[...a,[v,l[i+1]]],[]));
for(const name of ['--out','--origin','--repo-root','--chrome','--playwright'])assert.ok(args[name],name);
const out=args['--out'];await fs.mkdir(out,{recursive:true});await assert.rejects(fs.access(out+'/report.json'));
const report={status:'running',phase:'inputs',requested:args,errors:[]};const save=()=>fs.writeFile(out+'/report.json',JSON.stringify(report,null,2));await save();let browser,page;
try{
 report.runtime=await(await fetch(args['--origin']+'/api/runtime-config')).json();assert.equal(report.runtime.source.repoRoot,args['--repo-root']);
 const {chromium}=await import(pathToFileURL(args['--playwright']));browser=await chromium.launch({executablePath:args['--chrome'],headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal','--use-mock-keychain','--password-store=basic']});report.browserVersion=browser.version();
 page=await browser.newPage({viewport:{width:800,height:600}});await page.route('**/favicon.ico',r=>r.fulfill({status:204}));page.on('console',m=>{if(m.type()==='error'){report.errors.push(m.text());void fs.appendFile(out+'/console.log',m.text()+'\n');}});page.on('pageerror',e=>{report.errors.push(String(e));void fs.appendFile(out+'/console.log',String(e)+'\n');});
 await page.goto(args['--origin']+'/docs/workbench-common-main.md');await page.setContent('<script type="importmap">{"imports":{"three/webgpu":"/lib/three.webgpu.js"}}</script>');report.phase='native-compute';await save();
 report.result=await page.evaluate(async()=>{
  const THREE=await import('/lib/three.webgpu.js'),{createFullBodyRuntime}=await import('/experiments/creature-motion/full-body-runtime.mjs'),{createGpuSkinDeformer}=await import('/experiments/creature-motion/gpu-skin-deformer.mjs');
  document.body.replaceChildren();const renderer=new THREE.WebGPURenderer({antialias:true});renderer.setSize(800,600);document.body.append(renderer.domElement);await renderer.init();
  if(!renderer.backend.isWebGPUBackend)throw Error('Native WebGPU unavailable');
  const gpuErrors=[],shaders=[];renderer.backend.device.addEventListener('uncapturederror',e=>gpuErrors.push(e.error.message));
  const compute=renderer.compute.bind(renderer);renderer.compute=(nodes,...args)=>{const result=compute(nodes,...args);if(!shaders.length)for(const node of nodes)shaders.push(renderer._nodes.getForCompute(node).computeShader);return result;};
  const I=[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]],data={manifest:{bones:[{name:'pelvis',parent:null,restMatrix:I}],channels:['fixed','pelvis'],vertices:4,triangles:2},rest:new Float32Array([0,0,0,1,0,0,0,1,0,1,1,.2]),triangles:new Uint32Array([0,1,2,1,3,2]),weights:new Float32Array([.5,.5,.2,.8,.9,.1,.4,.6])};
  const runtime=createFullBodyRuntime({THREE,...data,deformerFactory:createGpuSkinDeformer}),scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(50,800/600,.01,100);scene.add(runtime.group,new THREE.HemisphereLight(0xffffff,0x444444,3));camera.position.set(2,2,5);camera.lookAt(1,.5,0);
  const results=[];
  try{for(const angle of [0,.7,3.3,-3.3]){
   runtime.bones.get('pelvis').position.set(1,.2,-.1);runtime.bones.get('pelvis').quaternion.setFromAxisAngle(new THREE.Vector3(0,0,1),angle);runtime.update();renderer.render(scene,camera);
   const gpu=await runtime.readGpuGeometry(),cpu=runtime.syncCpuGeometry();results.push({angle,gpu:{positions:Array.from(gpu.positions),normals:Array.from(gpu.normals)},cpu:{positions:Array.from(cpu.attributes.position.array),normals:Array.from(cpu.attributes.normal.array)},state:runtime.read()});
  }await renderer.backend.device.queue.onSubmittedWorkDone();if(gpuErrors.length)throw Error(gpuErrors.join('\n'));return {backend:'webgpu',results,gpuErrors,shaders};
  }finally{runtime.dispose();renderer.dispose();}
 });
 await save();for(const r of report.result.results)for(const key of ['positions','normals']){assert.equal(r.gpu[key].length,12);let max=0;for(let i=0;i<12;i++){assert.ok(Number.isFinite(r.gpu[key][i]));max=Math.max(max,Math.abs(r.gpu[key][i]-r.cpu[key][i]));}assert.ok(max<.00002,key+' differs: '+max);r[key+'MaxError']=max;}
 assert.deepEqual(report.errors,[]);await page.screenshot({path:out+'/native-compute.png'});report.status='passed';
}catch(e){report.status='failed';report.failure=String(e.stack??e);process.exitCode=1;if(page)try{await page.screenshot({path:out+'/failure.png'});}catch{}}
finally{await browser?.close();report.browserClosed=true;await save();console.log(JSON.stringify({status:report.status,phase:report.phase,failure:report.failure,errors:report.errors}));}
