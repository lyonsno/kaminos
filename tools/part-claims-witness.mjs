#!/usr/bin/env node
// Focused consumer witness. Keeps raw screenshots and operation returns on failure.
import {spawn} from 'node:child_process';
import {mkdirSync,writeFileSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {fluidBrowserLaunch} from '../finger-fluid-browser-launch.mjs';
import {verifyAuthoringServer} from '../scene-authoring-witness-identity.mjs';
import {assertRenderedEvidence} from './part-claims-witness-checks.mjs';
const args=Object.fromEntries(process.argv.slice(2).reduce((a,x,i,all)=>i%2?a:[...a,[x.slice(2),all[i+1]]],[]));
if(!args.out||!args.url||!process.env.KAMINOS_CHROME)throw Error('--out, --url and KAMINOS_CHROME required');
const out=resolve(args.out);mkdirSync(out,{recursive:true});
const report={requestedUrl:args.url,status:'running',phase:'launch',errors:[],console:[],checks:[],artifacts:[]};
const save=()=>writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2));save();
const check=(name,ok)=>{report.checks.push({name,ok});save();if(!ok)throw Error(name);};
const port=Number(args.port||9458),profile=mkdtempSync(join(tmpdir(),'kaminos-claims-'));
let browser,ws;const pending=new Map();let next=0;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const rpc=(method,params={})=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const r=await rpc('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result?.value;};
const screenshot=async name=>{const r=await rpc('Page.captureScreenshot',{format:'png'});writeFileSync(join(out,name+'.png'),Buffer.from(r.data,'base64'));report.artifacts.push(name+'.png');save();};
try{
 report.source=await verifyAuthoringServer({origin:args.url,repoRoot:process.cwd()});save();
 const launch=fluidBrowserLaunch({executable:process.env.KAMINOS_CHROME,debugPort:port,userDataDir:profile,width:1600,height:1100});report.launch=launch;save();
 browser=spawn(launch.executable,[...launch.args,'--headless=new'],{stdio:['ignore','ignore','pipe']});browser.stderr.on('data',b=>{report.stderr=(report.stderr||'')+b;});
 let tabs;for(let i=0;i<120;i++){try{tabs=await(await fetch(`http://127.0.0.1:${port}/json`)).json();if(tabs.some(t=>t.type==='page'))break;}catch{}await sleep(250);}
 if(!tabs?.some(t=>t.type==='page'))throw Error('Independent browser did not expose a CDP page');
 ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);if(m.error)p?.reject(Error(JSON.stringify(m.error)));else p?.resolve(m.result);}else if(m.method==='Runtime.exceptionThrown')report.errors.push(m.params);else if(m.method==='Runtime.consoleAPICalled'||m.method==='Log.entryAdded'){(report.console??=[]).push(m.params);}};
 report.browser=await rpc('Browser.getVersion');await rpc('Runtime.enable');await rpc('Log.enable');await rpc('Page.enable');
 await rpc('Page.navigate',{url:args.url});report.phase='load';save();
 if(args.diagnose){
 await evaluate(`import('/lib/three.webgpu.js').then(T=>{for(const name of ['ImageBitmapLoader','TextureLoader']){const original=T[name].prototype.load;T[name].prototype.load=function(url,ok,progress,bad){try{return original.call(this,url,ok,progress,error=>{console.error('Texture loader detail',name,String(error),error?.stack);bad?.(error);});}catch(error){console.error('Texture loader synchronous detail',name,String(error),error?.stack);throw error;}}}})`);
 await evaluate(`{const original=Response.prototype.blob;Response.prototype.blob=async function(){try{return await original.call(this);}catch(e){console.error('Response blob failed',this.url,String(e));throw e;}};const revoke=URL.revokeObjectURL;URL.revokeObjectURL=function(url){console.log('Blob revoked',url,new Error().stack);return revoke.call(this,url);};}`);
 }
 let state;for(let i=0;i<120;i++){state=await evaluate('window.kaminosWorkbenchExperiments?.state()');if(state?.id==='part-claims'&&state?.status!=='opening')break;await sleep(500);}
 report.state=state;report.initial=await evaluate('window.kaminosWorkbenchExperiments.read()');report.effectiveUrl=await evaluate('location.href');save();
 check('actual requested target loaded',report.initial?.targetUrl?.includes('elaborated-arm.glb'));
 check('four source parts',Object.keys(report.initial.parts).length===4);
 await sleep(1000);await screenshot('overlay');
 if(args.diagnose){await rpc('Page.navigate',{url:'chrome://blob-internals/'});await sleep(500);report.blobInternals=await evaluate('document.body.innerText');throw Error('Diagnostic-only run');}
 check('target PBR textures loaded',report.initial.targetMaterials.length>0&&report.initial.targetMaterials.every(m=>m.baseColor&&m.roughness&&m.metalness));
 report.phase='claim computation';save();
 report.computed=await evaluate("window.kaminosWorkbenchExperiments.invoke('compute')");
 check('all triangle claims completed',report.computed.status==='computed'&&report.computed.summary.triangles>0);
 await evaluate("window.kaminosWorkbenchExperiments.invoke('configure',{reference:false,targetOpacity:.25,claims:true})");await sleep(300);await screenshot('claims');
 await evaluate("window.kaminosWorkbenchExperiments.invoke('configure',{mode:'overlap'})");await sleep(300);await screenshot('overlap');
 await evaluate("window.kaminosWorkbenchExperiments.invoke('configure',{mode:'residual'})");await sleep(300);await screenshot('residual');
 const count=report.computed.summary.overlap;
 await evaluate("window.kaminosWorkbenchExperiments.invoke('configure',{mode:'claims',solo:'rod'})");await sleep(300);await screenshot('rod');
 report.solo=await evaluate('window.kaminosWorkbenchExperiments.read()');check('solo retains global overlap accounting',report.solo.summary.overlap===count);
 // Exercise the actual human control path, not only direct operations.
 await evaluate("document.querySelector('input[aria-label=\"Ghost opacity\"]').value='0.6';document.querySelector('input[aria-label=\"Ghost opacity\"]').dispatchEvent(new Event('input',{bubbles:true}))");
 await sleep(100);check('visible control applies',await evaluate('(async()=>(await window.kaminosWorkbenchExperiments.read()).referenceOpacity)()')===.6);
 report.recipe=await evaluate("window.kaminosWorkbenchExperiments.invoke('recipe')");report.phase='close and reopen';save();
 await evaluate('window.kaminosWorkbenchExperiments.close()');
 report.reopen=await evaluate(`window.kaminosWorkbenchExperiments.open('part-claims',${JSON.stringify(report.recipe)})`);
 report.reopened=await evaluate('window.kaminosWorkbenchExperiments.read()');
 check('recipe retains solo and opacity',report.reopened.solo==='rod'&&report.reopened.referenceOpacity===.6);
 check('reopen does not misrepresent cached claims',report.reopened.status==='not computed');
 check('reopen retains PBR textures',report.reopened.targetMaterials.length>0&&report.reopened.targetMaterials.every(m=>m.baseColor&&m.roughness&&m.metalness));
 await sleep(1000);await screenshot('reopened');assertRenderedEvidence(report);
 report.status='passed';report.phase='complete';save();
}catch(error){report.status='failed';report.error=error.stack;save();process.exitCode=1;if(ws?.readyState===1)try{await screenshot('failure');}catch{}}
finally{ws?.close();browser?.kill('SIGTERM');save();}
