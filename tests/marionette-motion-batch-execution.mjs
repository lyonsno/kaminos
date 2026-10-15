// kaminos-test: node
// Explicit mocked harness controls, not GPU, image or gait evidence.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {run as currentRun} from '../tools/marionette-motion-batch.mjs';
import {publishMotionView} from '../tools/marionette-motion-view.mjs';

const base=await fs.mkdtemp(path.join(os.tmpdir(),'marionette-harness-fake-')),repo=path.resolve('.');
let run=currentRun;
if(process.env.SOURCE_REF){
 // Only substitute dependency acquisition and delays, not retention/admission logic.
 let src=execFileSync('git',['show',`${process.env.SOURCE_REF}:tools/marionette-motion-batch.mjs`],{encoding:'utf8'});
 src=src.replace("'../models/flux2-klein/cdp-harness.mjs'",JSON.stringify(pathToFileURL(path.join(repo,'models/flux2-klein/cdp-harness.mjs')).href));
 src=src.replace('export async function run() {','export async function run({argv,launch,serve,pause}) {').replace('const args=process.argv.slice(2)','const args=argv');
 src=src.replace("path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')",JSON.stringify(repo));
 src=src.replace('await startServer(', 'await serve(').replace('await launchChrome(', 'await launch(');
 src=src.replaceAll('await new Promise(r=>setTimeout(r,500))','await pause(500)').replaceAll('await new Promise(r=>setTimeout(r,167))','await pause(167)');
 src=src.replace('if(process.argv[1]===fileURLToPath(import.meta.url))await run();','');
 run=(await import(`data:text/javascript;base64,${Buffer.from(src).toString('base64')}`)).run;
}
const failures=[];
for(const kind of ['cfg','rejected','missing-input','wrong-seed','missing-seed','failed-rerun']){
 const root=path.join(base,kind),bundle=path.join(root,'bundle'),out=path.join(root,'output');await fs.mkdir(bundle,{recursive:true});
 if(kind!=='missing-input')await fs.writeFile(path.join(bundle,'demo.json'),JSON.stringify({skeleton:{name:'Fixture',joints:2,parents:[-1,0],jointNames:['root','hand'],fps:30},assetCondSha256:'a'.repeat(64)}));
 const cases=[{text:'An object walks forward.',seed:1,cfgScale:4},...(kind==='rejected'?[{text:'An object trots forward.',seed:2}]:[])];
 const casePath=path.join(root,'cases.json');await fs.writeFile(casePath,JSON.stringify(cases));
 const context=vm.createContext({window:{__unimateDemo:{phase:'ready'}},Array,Float32Array,Promise});
 context.window.__unimateDemoInstance={hasTextEncoder:()=>true,generate:async options=>({motion:{frames:60,joints:2,positions:new Float32Array(360).fill(1),localRotations:new Float32Array(480).fill(1),rootTranslation:new Float32Array(180).fill(1),rootFacing:new Float32Array(240).fill(1),offsets:new Float32Array(6).fill(1)},features:new Float32Array(kind==='rejected'&&options.seed===1?1:1440).fill(1),prompt:options.text,seed:kind==='wrong-seed'?999:kind==='missing-seed'?undefined:options.seed,textEncoder:'browser T5',cooperative:true,cfgScale:options.cfgScale??3,sampling:'dopri5-valid-joints',wallMs:1,evaluations:1,steps:[],frameStats:{frames:1}})};
 let error;
 try{await run({argv:['--out',out,'--bundle',bundle,'--weights',bundle,'--t5',bundle,'--cases',casePath,'--chrome','fake'],serve:async()=>({origin:'http://fake',server:{close(){}}}),launch:async()=>({navigate:async()=>{},send:async()=>({result:{data:Buffer.from('fake—not PNG evidence').toString('base64')}}),evaluate:async expression=>vm.runInContext(expression,context),close:async()=>{}}),pause:async()=>{}});}catch(e){error=e;}
 if(kind==='failed-rerun'){
  assert.ifError(error);
  const prior=await publishMotionView({reportPath:path.join(out,'report.json'),origin:'http://mock-view',fetchImpl:async url=>{const u=new URL(url);if(u.pathname==='/api/roots')return {ok:true,json:async()=>({fixture:{path:root,exists:true}})};if(u.pathname==='/api/workbench-experiments')return {ok:true,json:async()=>({modules:['/experiments/creature-motion/skeleton.experiment.mjs']})};const body=await fs.readFile(path.join(root,u.searchParams.get('path')));return {ok:true,arrayBuffer:async()=>body};}});
  assert.equal(prior.status,'link-verified',prior.error);assert.ok(prior.url);
  await fs.writeFile(path.join(bundle,'demo.json'),'{malformed');
  try{await run({argv:['--out',out,'--bundle',bundle,'--weights',bundle,'--t5',bundle,'--cases',casePath,'--chrome','fake']});}catch(e){error=e;}
 }
 try{
  const report=JSON.parse(await fs.readFile(path.join(out,'report.json'),'utf8'));
  if(kind==='cfg'){assert.ifError(error);const raw=JSON.parse(await fs.readFile(path.join(out,'00/motion.json'),'utf8'));assert.equal(raw.cfgScale,4);assert.equal(raw.sampling,'dopri5-valid-joints');assert.equal(report.view.status,'files-only');assert.equal(JSON.parse(await fs.readFile(path.join(out,'view.json'))).entries.length,1);}
  else if(kind==='rejected'){assert.ok(error);assert.equal(report.status,'failed');const raw=JSON.parse(await fs.readFile(path.join(out,'00/motion.raw.json'),'utf8'));assert.equal(raw.features.length,1);assert.equal(report.cases[0].validation,'rejected');assert.equal(report.cases[1].validation,'accepted-schema');}
  else if(kind==='wrong-seed'||kind==='missing-seed'){
   assert.ok(error,'effective seed must not be replaced by the request');assert.equal(report.status,'failed');assert.equal(report.cases[0].validation,'rejected');
   const raw=JSON.parse(await fs.readFile(path.join(out,'00/motion.raw.json'),'utf8'));assert.equal(raw.seed,kind==='wrong-seed'?999:undefined);await assert.rejects(fs.access(path.join(out,'00/motion.json')));
  }
  else{assert.ok(error);assert.equal(report.status,'failed');assert.equal(report.phase,'inputs');assert.match(report.error,kind==='missing-input'?/ENOENT/:/JSON/);}
  if(report.status==='failed'){const publication=JSON.parse(await fs.readFile(path.join(out,'view-publication.json')));assert.equal(publication.status,'unavailable');assert.equal(publication.url,null);assert.equal(publication.generationFailure.phase,report.phase);assert.equal(publication.generationFailure.error,report.error);}
  console.log(`${kind}: pass`);
 }catch(e){failures.push(`${kind}: ${e.message}`);}
}
console.log(`Mock-only evidence retained at ${base}`);
assert.deepEqual(failures,[]);
