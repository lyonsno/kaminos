// kaminos-test: manual — tiny native material conformance, no performance measurement.
import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {nativeCheckPort,nativeCheckSpawn} from './native-check-runtime.mjs';
import assert from 'node:assert/strict';
const [out]=process.argv.slice(2);assert(out,'Caller-owned output required');await fs.mkdir(out,{recursive:true});
const report={status:'running',phase:'source-identity',root:process.cwd(),errors:[]};
const save=()=>fs.writeFile(out+'/report.json',JSON.stringify(report,null,2));await save();let context,server,log;
try{
 report.commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();report.dirty=execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim();report.phase='launch';await save();
 const port=await nativeCheckPort();const origin='http://127.0.0.1:'+port;
 log=await fs.open(out+'/server.log','a');server=await nativeCheckSpawn('python3',['-u','serve.py',String(port)],{env:{...process.env,KAMINOS_BIND_HOST:'127.0.0.1'},stdio:['ignore',log.fd,log.fd]});
 const {setTimeout:pause}=await import('node:timers/promises');for(;;){try{const r=await fetch(origin+'/api/runtime-config');if(r.ok){report.runtime=await r.json();break;}}catch{}if(server.exitCode!==null)throw Error('Native check server stopped');await pause(100);}
 assert.equal(report.runtime.source.repoRoot,report.root);assert.equal(report.runtime.source.commit,report.commit);
 report.browser=process.env.KAMINOS_TEST_BROWSER;assert(report.browser&&!report.browser.includes('/Google Chrome.app/'),'Independent browser required');
 const {chromium}=await import(process.env.KAMINOS_TEST_PLAYWRIGHT);context=await chromium.launchPersistentContext(out+'/profile',{executablePath:report.browser,headless:true,viewport:{width:200,height:160},args:['--enable-unsafe-webgpu','--use-angle=metal','--use-mock-keychain','--password-store=basic']});
 const page=context.pages()[0];page.setDefaultTimeout(0);page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 report.phase='native-render';await save();await page.goto(origin+'/tests/neural-appearance-render-native.html');await page.waitForFunction(()=>window.neuralAppearanceResult);
 report.result=await page.evaluate(()=>window.neuralAppearanceResult);await page.screenshot({path:out+'/native.png'});
 await page.evaluate(()=>window.neuralAppearanceDispose?.());
 assert.equal(report.result.status,'passed',report.result.error);assert.match(JSON.stringify(report.result.identity.adapter),/apple/i);assert.deepEqual(report.errors,[]);
 report.status='passed';report.phase='complete';
}catch(error){report.status='failed';report.error=error.stack;process.exitCode=1;}finally{try{await context?.close();}catch(error){report.cleanupError=error.stack;report.status='failed';process.exitCode=1;}server?.kill('SIGTERM');try{await log?.close();}catch(error){report.logCleanupError=error.stack;report.status='failed';process.exitCode=1;}await save();console.log(JSON.stringify({status:report.status,phase:report.phase,error:report.error,out}));}
