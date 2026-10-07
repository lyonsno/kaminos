import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn,execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { materialConformanceCases,inspectMaterialEvaluation } from './structural-material-solid-conformance.mjs';
import { prepareSolidTopology,packSolidTopology } from './structural-material-solid-topology.mjs';
import { inspectResidentEvaluation,inspectResidentCoverage,retainMaterialProbe } from './structural-material-solid-resident-evidence.mjs';

const [outputInput,executableInput,exercise='energy',preparedRootInput,candidate='both']=process.argv.slice(2);
if(!outputInput)throw new Error('usage: node structural-material-solid-native.mjs OUTPUT.json INDEPENDENT_BROWSER [energy|resident|imported] [PREPARED_ROOT] [both|graph|pmb]');
const root=path.dirname(fileURLToPath(import.meta.url)),output=path.resolve(outputInput),hash=b=>createHash('sha256').update(b).digest('hex');
const report={status:'running',phase:'preflight',root,argv:process.argv,exercise,requestedCandidate:candidate,sources:{},errors:[],checks:[],lastTrustworthyEvidence:'invocation',claim:exercise==='imported'?'Imported-interior resident load/transmission controls; explicit cut, not stress-generated shards':exercise==='resident'?'Tiny resident load/damage controls, not stress-generated crack surfaces':'Prescribed-position material energy/force conformance only, not dynamics or crack surfaces'};
fs.mkdirSync(path.dirname(output),{recursive:true});const save=()=>fs.writeFileSync(output,JSON.stringify(report,null,2));save();
let server,child,socket,stderr='',nextId=0;const pending=new Map(),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++nextId;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));return result.result.value;};
const probe=`import {evaluateSolidMaterial} from './structural-material-solid-kernels.js';
import {createSolidResident} from './structural-material-solid-resident.js';
window.__solidProbe={route:'kaminos.material-probe.native.v0',url:location.href,runId:crypto.randomUUID(),status:'running',phase:'adapter',errors:[],progress:{sequence:0,phase:'adapter'}};
const progress=phase=>{const p=window.__solidProbe;p.progress={sequence:p.progress.sequence+1,phase,at:new Date().toISOString()};};
try{
 const adapter=await navigator.gpu?.requestAdapter();if(!adapter||adapter.info.isFallbackAdapter)throw new Error('Native nonfallback WebGPU adapter required');
 const device=await adapter.requestDevice();const p=window.__solidProbe;
 device.lost.then(info=>{if(info.reason!=='destroyed'){p.gpuLoss={reason:info.reason,message:info.message};p.failure={message:'GPU device lost',...p.gpuLoss};p.status='failed';progress('gpu-device-lost');}});
 p.identity={backend:'webgpu',adapterFallback:adapter.info.isFallbackAdapter,vendor:adapter.info.vendor,architecture:adapter.info.architecture,device:adapter.info.device,description:adapter.info.description,limits:{maxStorageBufferBindingSize:device.limits.maxStorageBufferBindingSize}};
 device.addEventListener('uncapturederror',e=>p.errors.push({name:e.error.name,message:e.error.message}));
 p.phase='evaluation';p.results=[];const groups=await(await fetch('/inputs.json')).json();
 for(const group of groups){progress('energy-'+group.kind);const result=await evaluateSolidMaterial(device,group);p.results.push(result);}
 const inverted={kind:'graph',positions:[[0,0,0],[-1,0,0],[0,1,0],[0,0,1]],indices:[[0,1,2,3]],parameters:groups[0].parameters.slice(0,1),coefficients:groups[0].coefficients.slice(0,1)};
 p.inversion={rejected:false};try{await evaluateSolidMaterial(device,inverted);}catch(error){p.inversion={rejected:true,message:error.message};}
 inverted.coefficients=[Array.from({length:6},()=>Array(6).fill(0))];p.disconnected=await evaluateSolidMaterial(device,inverted);
 const resident=await(await fetch('/resident-inputs.json')).json();p.resident=[];p.effectiveCandidates=resident.map(input=>input.descriptor.kind);
 for(const input of resident){
  progress('resident-'+input.descriptor.kind+'-inputs');const arrays={};
  if(input.arrays)for(const [name,values] of Object.entries(input.arrays))arrays[name]=['state','parameters','coefficients'].includes(name)?Float32Array.from(values):Uint32Array.from(values);
  else for(const [name,entry] of Object.entries(input.buffers)){const bytes=await(await fetch('/resident-buffers/'+entry.filename)).arrayBuffer();const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');if(bytes.byteLength!==entry.byteLength||digest!==entry.sha256)throw new Error('Effective resident buffer differs: '+name);arrays[name]=entry.type==='Float32Array'?new Float32Array(bytes):new Uint32Array(bytes);}
  const start=performance.now(),kind=input.descriptor.kind;progress('resident-'+kind+'-initialize');const model=await createSolidResident(device,input.descriptor,arrays,{onProgress:phase=>progress(kind+'/'+phase)}),stages=[],timings=[];const options={timeStep:1/60,iterations:12,lineSearchTrials:8,gravity:0,damping:.98,floor:-10};
  const result={kind,stages,timings};p.resident.push(result);let stepIndex=0;
  const step=async()=>{progress(kind+'/step-'+(++stepIndex)+'-submitted');const start=performance.now();await model.step(options);timings.push(performance.now()-start);progress(kind+'/step-'+stepIndex+'-completed');};
  stages.push({name:'rest',state:await model.read()});progress(kind+'/rest-retained');await model.pin(input.supports);await model.grip(input.grip.index,input.grip.target,100000);
  for(let i=0;i<8;i++)await step();stages.push({name:'loaded',state:await model.read()});progress(kind+'/loaded-retained');
  await model.damagePlane([1,0,0],.5);stages.push({name:'damaged',state:await model.read()});progress(kind+'/damaged-retained');
  for(let i=0;i<4;i++)await step();stages.push({name:'post-damage',state:await model.read()});progress(kind+'/post-damage-retained');
  await model.release();await step();stages.push({name:'released',state:await model.read()});progress(kind+'/released-retained');model.dispose();result.totalMilliseconds=performance.now()-start;
 }
 await device.queue.onSubmittedWorkDone();p.phase='complete';p.status=p.failure||p.errors.length?'failed':'passed';progress('complete');device.destroy();
}catch(error){window.__solidProbe.status='failed';window.__solidProbe.failure={message:error.message,stack:error.stack};progress('failed');}
`;
try{
 if(!['energy','resident','imported'].includes(exercise))throw new Error('Unknown material exercise');
 if(!['both','graph','pmb'].includes(candidate))throw new Error('Explicit material candidate must be both, graph or pmb');
 const executable=fs.realpathSync(executableInput);if(executable.includes('/Google Chrome.app/')||!/chrome-headless-shell$|\/Chromium$|Google Chrome for Testing$/.test(executable))throw new Error('Independent browser required');
 report.browser={executable,version:execFileSync(executable,['--version'],{encoding:'utf8'}).trim()};
 report.sourceRevision=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
 for(const name of ['structural-material-solid-native.mjs','structural-material-solid-kernels.js','structural-material-solid-reference.mjs','structural-material-solid-conformance.mjs','structural-material-solid-resident-evidence.mjs',...(exercise!=='energy'?['structural-material-solid-resident.js','structural-material-solid-topology.mjs']:[])])report.sources[name]=hash(fs.readFileSync(path.join(root,name)));
 const cases=materialConformanceCases(),groups=['graph','pmb'].map(kind=>{
  const group={kind,positions:[],indices:[],parameters:[],coefficients:[]};
  for(const test of cases.filter(c=>c.input.kind===kind)){const offset=group.positions.length;group.positions.push(...test.input.positions);group.indices.push(...test.input.indices.map(ids=>ids.map((v,i)=>i<(kind==='graph'?4:2)?v+offset:v)));group.parameters.push(...test.input.parameters);if(kind==='graph')group.coefficients.push(...test.input.coefficients);}
  return group;
 });
 let residentModels=exercise==='resident'?['graph','pmb'].map(kind=>prepareSolidTopology({status:'passed',route:'ftetwild-cpu-wildmeshing-0.4.1',positions:[[0,0,0],[1,0,0],[0,1,0],[0,0,1]],tetrahedra:[[0,1,2,3]],volume:1/6},{kind,young:1000,poisson:.25,density:1000,horizon:1.5})):[];
 let residentInputs=residentModels.map(model=>({descriptor:{kind:model.kind,points:model.positions.length,elements:model.elements.length,bonds:model.bonds.length,colorCount:model.colorCount},supports:[0,2,3],grip:{index:1,target:[1.05,.02,.03]},arrays:Object.fromEntries(Object.entries(packSolidTopology(model)).map(([name,array])=>[name,Array.from(array)]))}));
 const preparedBuffers=new Map();
 if(exercise==='imported'){
  if(!preparedRootInput)throw new Error('Imported resident exercise requires explicit prepared root');const preparedRoot=fs.realpathSync(preparedRootInput),bytes=fs.readFileSync(path.join(preparedRoot,'report.json')),prepared=JSON.parse(bytes);
  if(prepared.status!=='passed'||prepared.models.length!==2||new Set(prepared.models.map(m=>m.kind)).size!==2)throw new Error('Complete passed paired material preparation required');
  const meshBytes=fs.readFileSync(prepared.input),mesh=JSON.parse(meshBytes);if(hash(meshBytes)!==prepared.inputSha256||mesh.status!=='passed')throw new Error('Effective interior differs from prepared source');
  report.prepared={root:preparedRoot,manifestSha256:hash(bytes),inputSha256:prepared.inputSha256,sourceSha256:prepared.sourceSha256,models:prepared.models};residentModels=[];residentInputs=[];
  for(const descriptor of prepared.models){const arrays={};for(const [name,entry] of Object.entries(descriptor.buffers)){if(path.basename(entry.filename)!==entry.filename)throw new Error('Prepared buffer must be a leaf path');const data=fs.readFileSync(path.join(preparedRoot,entry.filename));if(data.byteLength!==entry.byteLength||hash(data)!==entry.sha256||!['Float32Array','Uint32Array'].includes(entry.type))throw new Error('Prepared buffer identity mismatch: '+name);preparedBuffers.set(entry.filename,data);const Type=entry.type==='Float32Array'?Float32Array:Uint32Array;arrays[name]=new Type(data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength));}
   const positions=mesh.positions,masses=positions.map((_,i)=>arrays.state[i*16+3]),bonds=Array.from({length:descriptor.bonds},(_,i)=>Array.from(arrays.bonds.slice(i*4,i*4+2))),elements=Array.from({length:descriptor.elements},(_,i)=>Array.from(arrays.elements.slice(i*4,i*4+4))),elementBonds=descriptor.kind==='graph'?elements.map((_,i)=>Array.from(arrays.elementBonds.slice(i*8,i*8+6))):[];
   const minX=Math.min(...positions.map(p=>p[0])),maxX=Math.max(...positions.map(p=>p[0])),supports=positions.flatMap((p,i)=>p[0]<minX+.03?[i]:[]);let index=0;positions.forEach((p,i)=>{if(p[0]>positions[index][0])index=i;});
   const target=positions[index].map((v,a)=>v+(a===0?.003:0));residentModels.push({kind:descriptor.kind,positions,masses,volumes:masses.map(m=>m/descriptor.material.density),bonds,elements,elementBonds,material:descriptor.material});residentInputs.push({descriptor,buffers:descriptor.buffers,supports,grip:{index,target},bounds:{minX,maxX}});
  }
 }
 if(candidate!=='both'){residentModels=residentModels.filter(model=>model.kind===candidate);residentInputs=residentInputs.filter(input=>input.descriptor.kind===candidate);}report.effectiveCandidates=residentModels.map(model=>model.kind);
 report.cases=cases;report.inputGroups=groups;report.residentInputs=residentInputs;save();
 server=createServer((req,res)=>{
  const route=new URL(req.url,'http://localhost').pathname;res.setHeader('cache-control','no-store');
  if(route==='/'){res.setHeader('content-type','text/html');res.end('<!doctype html><title>Kaminos Material Numerical Probe</title><script type="module" src="/probe.js"></script>');return;}
  if(route==='/probe.js'){res.setHeader('content-type','text/javascript');res.end(probe);return;}
  if(route==='/inputs.json'){res.setHeader('content-type','application/json');res.end(JSON.stringify(groups));return;}
  if(route==='/resident-inputs.json'){res.setHeader('content-type','application/json');res.end(JSON.stringify(residentInputs));return;}
  if(route.startsWith('/resident-buffers/')&&preparedBuffers.has(route.slice(18))){res.end(preparedBuffers.get(route.slice(18)));return;}
  if(['/structural-material-solid-kernels.js','/structural-material-solid-resident.js'].includes(route)){res.setHeader('content-type','text/javascript');res.end(fs.readFileSync(path.join(root,route.slice(1))));return;}
  res.writeHead(404).end();
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));report.requestedUrl=`http://127.0.0.1:${server.address().port}/`;
 report.phase='browser-launch';report.browser.profile=fs.mkdtempSync(path.join(os.tmpdir(),'kaminos-solid-'));save();
 child=spawn(executable,['--headless=new','--enable-automation','--no-first-run','--no-default-browser-check','--enable-unsafe-webgpu','--use-gl=angle','--use-angle=metal','--remote-debugging-port=0',`--user-data-dir=${report.browser.profile}`,'about:blank'],{stdio:['ignore','pipe','pipe']});report.browser.pid=child.pid;child.stderr.on('data',d=>stderr+=d);child.on('exit',(code,signal)=>{report.browser.exit={code,signal,at:new Date().toISOString(),cleanupRequested:report.browser.cleanupRequested===true};save();});
 const endpoint=path.join(report.browser.profile,'DevToolsActivePort');while(!fs.existsSync(endpoint)){if(child.exitCode!==null)throw new Error(`Browser exited: ${stderr}`);await sleep(50);}
 const port=fs.readFileSync(endpoint,'utf8').split('\n')[0],targets=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();report.browser.target=targets.find(t=>t.type==='page');socket=new WebSocket(report.browser.target.webSocketDebuggerUrl);await new Promise((r,j)=>{socket.addEventListener('open',r,{once:true});socket.addEventListener('error',j,{once:true});});
 socket.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.method==='Runtime.exceptionThrown'){report.errors.push(m.params.exceptionDetails);save();}if(m.id){const p=pending.get(m.id);pending.delete(m.id);if(p)m.error?p.reject(new Error(JSON.stringify(m.error))):p.resolve(m.result);}});
 socket.addEventListener('close',()=>{for(const p of pending.values())p.reject(new Error('CDP disconnected'));pending.clear();});
 await send('Runtime.enable');const command=await send('Browser.getBrowserCommandLine');report.browser.runtimeCommand=command;if(fs.realpathSync(command.arguments[0])!==executable)throw new Error('Effective browser differs from owned independent executable');
 report.phase='native-evaluation';save();await send('Page.navigate',{url:report.requestedUrl});
 const signals=path.join(path.dirname(output),path.basename(output,path.extname(output))+'-signals');report.probeSignalDirectory=signals;fs.mkdirSync(signals,{recursive:true});const retain=observed=>{if(!observed)return;const bytes=Buffer.from(JSON.stringify(observed)),digest=hash(bytes),target=path.join(signals,`${digest}.json`);if(!fs.existsSync(target)){const fd=fs.openSync(target,'wx');try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}if(retainMaterialProbe(report,observed,{requestedUrl:report.requestedUrl,path:target,sha256:digest}))save();};
 let observed;while(true){observed=await evaluate('window.__solidProbe');retain(observed);if(observed&&observed.status!=='running')break;if(report.errors.length)throw new Error(JSON.stringify(report.errors));if(child.exitCode!==null)throw new Error('Owned browser exited during material evaluation');await sleep(100);}
 report.observed=observed;report.effectiveUrl=await evaluate('location.href');save();
 if(report.effectiveUrl!==report.requestedUrl||observed.status!=='passed'||observed.identity.backend!=='webgpu'||observed.identity.adapterFallback!==false)throw new Error(`Native material route failed: ${JSON.stringify(observed.failure??observed.identity)}`);
 report.phase='comparison';
 for(const kind of ['graph','pmb']){const result=observed.results.find(r=>r.kind===kind);let offset=0;
  for(const test of cases.filter(c=>c.input.kind===kind)){const count=test.input.indices.length,partial={...result,count,values:result.values.slice(offset,offset+count*result.stride)},errors=inspectMaterialEvaluation(test,partial);report.checks.push({name:test.name,passed:errors.length===0,errors});offset+=count*result.stride;}
  if(offset!==result.values.length)throw new Error('Unexpected or partial GPU output');
 }
 report.checks.push({name:'live inversion rejected without disabling disconnected elements',passed:observed.inversion.rejected&&observed.inversion.message.includes('valid deformation domain')&&observed.disconnected.values.every(v=>v===0)});
 const coverage=inspectResidentCoverage(residentModels,observed.resident);report.checks.push({name:'all requested resident candidates and stages returned',passed:coverage.length===0,errors:coverage});if(coverage.length)throw new Error('Resident coverage incomplete');
 for(const result of observed.resident){
  const model=residentModels.find(m=>m.kind===result.kind);for(const stage of result.stages){const errors=inspectResidentEvaluation(model,stage.state);report.checks.push({name:result.kind+'-'+stage.name+'-resident-energy-gradient',passed:errors.length===0,errors});}
  const states=Object.fromEntries(result.stages.map(s=>[s.name,s.state])),at=(state,i)=>state.state.slice(i*16+4,i*16+7),broken=state=>state.bonds.filter((v,i)=>i%4===2&&v===0).length;
  const input=residentInputs.find(i=>i.descriptor.kind===result.kind),index=input.grip.index;
  report.checks.push({name:result.kind+'-load-comes-from-grip-not-prescribed-field',passed:Math.hypot(...at(states.loaded,index).map((v,a)=>v-model.positions[index][a]))>(exercise==='imported'?1e-4:.01)&&input.supports.every(i=>at(states.loaded,i).every((v,a)=>Math.abs(v-model.positions[i][a])<1e-6))});
  report.checks.push({name:result.kind+'-damage-and-unload-retain-state',passed:(exercise==='imported'?broken(states.damaged)>0:broken(states.damaged)===3)&&broken(states.released)===broken(states.damaged)&&states.released.steps===13&&states.released.grip===null&&states.released.damageEpoch===1});
 }
 for(const [name,digest] of Object.entries(report.sources))if(hash(fs.readFileSync(path.join(root,name)))!==digest)throw new Error(`Source changed during native conformance: ${name}`);
 if(report.checks.some(c=>!c.passed)||report.errors.length)throw new Error('Material conformance predicates failed');
 report.status='passed';report.phase='complete';report.lastTrustworthyEvidence='Native energy/force outputs matched all reference cases';save();
}catch(error){report.status='failed';report.failure={message:error.message,stack:error.stack};save();process.exitCode=1;}
finally{socket?.close();if(child&&child.exitCode===null){report.browser.cleanupRequested=true;child.kill('SIGTERM');await new Promise(r=>child.once('close',r));}if(server)await new Promise(r=>server.close(r));report.browser??={};report.browser.stderr=stderr;report.browser.ownedChildExited=child?.exitCode!==null;save();console.log(JSON.stringify({status:report.status,phase:report.phase,output,failure:report.failure?.message}));}
