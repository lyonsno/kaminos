import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {verifyAuthoringServer} from '../scene-authoring-witness-identity.mjs';
import {fluidBrowserLaunch} from '../finger-fluid-browser-launch.mjs';
const args=new Map();for(let i=2;i<process.argv.length;i+=2)args.set(process.argv[i],process.argv[i+1]);
const out=resolve(args.get('--out'));mkdirSync(out,{recursive:true});
const report={status:'running',phase:'source',requested:{url:args.get('--url'),repo:args.get('--repo')},errors:[]};
const save=()=>writeFileSync(resolve(out,'report.json'),JSON.stringify(report,null,2));save();
let browser;
try{
 report.identity=await verifyAuthoringServer({origin:args.get('--url'),repoRoot:resolve(args.get('--repo'))});
 report.sources={};
 for(const name of ['ash/refinement-gpu.mjs','ash/refinement-plan.mjs','ash/refinement-shader.mjs','ash/refinement-surface.mjs','tools/ash-refinement-conformance.html']){
  const response=await fetch(new URL(name,args.get('--url')));assert.ok(response.ok,'source unavailable '+name);
  const remote=Buffer.from(await response.arrayBuffer()),local=readFileSync(resolve(args.get('--repo'),name));
  const hash=data=>createHash('sha256').update(data).digest('hex');
  assert.equal(hash(remote),hash(local),'served source differs '+name);report.sources[name]=hash(remote);
 }
 report.phase='browser';save();
 report.launch=fluidBrowserLaunch({executable:args.get('--browser'),debugPort:0,userDataDir:resolve(out,'profile'),width:640,height:480});
 const {chromium}=await import(args.get('--playwright'));
 browser=await chromium.launchPersistentContext(resolve(out,'profile'),{executablePath:report.launch.executable,headless:true,viewport:{width:640,height:480},args:['--use-mock-keychain','--password-store=basic','--enable-unsafe-webgpu','--disable-gpu-sandbox','--use-angle=metal']});
 const page=browser.pages()[0];page.on('pageerror',error=>report.errors.push(String(error)));page.on('console',message=>{if(message.type()==='error')report.errors.push(message.text());});
 await page.goto(new URL('tools/ash-refinement-conformance.html',args.get('--url')).href);
 await page.waitForFunction(()=>typeof window.runRefinedAsh==='function');report.phase='kernel';save();
 report.result=await page.evaluate(mode=>window.runRefinedAsh(mode),args.get('--mode')??'random');
 assert.equal(report.result.backend,'webgpu-coarse-fine-ash');assert.deepEqual(report.result.failures,[]);assert.deepEqual(report.errors,[]);
 report.phase='capture';save();await page.screenshot({path:resolve(out,'surface.png')});
 report.status='passed';report.phase='complete';
}catch(error){report.status='failed';report.error=String(error.stack??error);process.exitCode=1;}
finally{try{await browser?.close();report.browserClosed=true;}catch(error){report.cleanupError=String(error);report.status='failed';report.browserClosed=false;process.exitCode=1;}finally{save();console.log(JSON.stringify({status:report.status,phase:report.phase,error:report.error,report:resolve(out,'report.json')}));}}
