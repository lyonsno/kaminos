import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const [out,executable,modulePath,url]=process.argv.slice(2);
if(!out)throw new Error('Explicit output required');fs.mkdirSync(path.dirname(out),{recursive:true});
const report={status:'running',phase:'setup',claim:'Synthetic native connectivity and resident contact migration conformance, not imported stone fracture or performance benchmark'},save=()=>fs.writeFileSync(out,JSON.stringify(report,null,2));save();let browser;
try{
 const effective=fs.realpathSync(executable);if(effective.includes('/Google Chrome.app/'))throw new Error('Independent browser required');report.sourceRevision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();report.executable=effective;
 const {chromium}=await import(pathToFileURL(modulePath));browser=await chromium.launch({executablePath:effective,headless:true,args:['--enable-automation','--enable-unsafe-webgpu','--use-gl=angle','--use-angle=metal']});report.browserVersion=browser.version();const page=await browser.newPage();await page.goto(url,{waitUntil:'domcontentloaded',timeout:0});report.effectiveUrl=page.url();if(page.url()!==url)throw new Error('Control route changed');
 report.sources={};for(const name of ['structural-material-solid-resident.js','structural-material-bounded-grip.js','structural-material-solid-topology.mjs']){const bytes=fs.readFileSync(name),r=await page.request.get(new URL('/'+name,url).href),loaded=await r.body(),sha=b=>createHash('sha256').update(b).digest('hex');if(!r.ok()||sha(bytes)!==sha(loaded))throw new Error('Loaded source mismatch: '+name);report.sources[name]=sha(bytes);}report.phase='native-controls';save();
 report.result=await page.evaluate(async()=>{
  const {prepareSolidTopology,packSolidTopology}=await import('/structural-material-solid-topology.mjs'),{createSolidResident}=await import('/structural-material-solid-resident.js'),{createBoundedResidentGrip}=await import('/structural-material-bounded-grip.js'),{materialComponents}=await import('/structural-material-solid-surface.mjs'),{contactPatch}=await import('/structural-material-stress-release.mjs');
  const adapter=await navigator.gpu.requestAdapter();if(!adapter||adapter.info.isFallbackAdapter)throw new Error('Native adapter required');const device=await adapter.requestDevice(),failures=[],uncaptured=[];device.addEventListener('uncapturederror',e=>uncaptured.push(e.error.message));
  const rest=[[0,0,0],[1,0,0],[0,1,0],[0,0,1]],model=prepareSolidTopology({status:'passed',route:'ftetwild-cpu-wildmeshing-0.4.1',positions:rest,tetrahedra:[[0,1,2,3]],volume:1/6},{kind:'graph',young:1000,damageLaw:'event-frozen-isotropic-degradation-v1'}),arrays=packSolidTopology(model),descriptor={kind:'graph',points:4,elements:1,bonds:6,colorCount:model.colorCount,constitutiveLayout:model.constitutiveLayout,bufferLayout:model.bufferLayout};let resident,grip;
  try{
   resident=await createSolidResident(device,descriptor,arrays);await resident.pin([0]);grip=await createBoundedResidentGrip(resident,Array.from(arrays.bonds));const controls=[];
   for(let mask=0;mask<64;mask++){
    const bonds=arrays.bonds.slice();for(let edge=0;edge<6;edge++)bonds[edge*4+2]=Number(!(mask&(1<<edge)));device.queue.writeBuffer(resident.bondBuffer(),0,bonds);await grip.begin(1,[1,0,0],2,1000);const labels=await grip.read(),state=await resident.read(),expected=materialComponents(4,Array.from(bonds));
    if(labels.components.some((v,i)=>v!==expected[i]))failures.push({mask,kind:'connectivity',actual:labels.components,expected});
    const patch=contactPatch(rest,[1,0,0],{components:expected,component:expected[1],radius:2,pinned:[true,false,false,false]}),weights=rest.map((_,i)=>state.diagnostics[i*24+23]);let error=0;for(let i=0;i<4;i++)error=Math.max(error,Math.abs(weights[i]-(patch.find(p=>p.index===i)?.weight??0)));
    if(error>2e-6)failures.push({mask,kind:'weights',error,weights,patch});controls.push({mask,labels:labels.components,weights,error});
   }
   device.queue.writeBuffer(resident.bondBuffer(),0,arrays.bonds);await grip.begin(1,[1,0,0],2,1000);const disconnected=arrays.bonds.map((v,i)=>i%4===2?0:v);device.queue.writeBuffer(resident.bondBuffer(),0,disconnected);await resident.movePatch([0,.1,0]);grip.update([0,.1,0]);const rebased=await resident.read();const weights=rest.map((_,i)=>rebased.diagnostics[i*24+23]);
   if(weights.some((v,i)=>Math.abs(v-Number(i===1))>2e-6)||Math.abs(rebased.residentGripOffset[1]-.1)>2e-6)failures.push({kind:'rebase',weights,offset:rebased.residentGripOffset});
   return{adapter:adapter.info,controls,rebased:{weights,offset:rebased.residentGripOffset},failures,uncaptured};
  }finally{grip?.dispose();resident?.dispose();device.destroy();}
 });if(report.result.failures.length||report.result.uncaptured.length)throw new Error('Native control mismatch');report.status='passed';report.phase='complete';save();
}catch(e){report.status='failed';report.failure={message:e.message,stack:e.stack};save();process.exitCode=1;}finally{if(browser){await browser.close();report.ownedChildExited=true;}save();console.log(JSON.stringify({status:report.status,phase:report.phase,out,failure:report.failure?.message}));}
