// kaminos-test: manual — tiny native material conformance, no performance measurement.
import fs from 'node:fs/promises';
import {spawn,execFileSync} from 'node:child_process';
import net from 'node:net';
import assert from 'node:assert/strict';
const [out]=process.argv.slice(2);assert(out,'Caller-owned output required');await fs.mkdir(out,{recursive:true});
const report={status:'running',phase:'launch',root:process.cwd(),commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),dirty:execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim(),errors:[]};
const save=()=>fs.writeFile(out+'/report.json',JSON.stringify(report,null,2));await save();let context,server,log;
try{
 const socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));const origin='http://127.0.0.1:'+port;
 log=await fs.open(out+'/server.log','a');server=spawn('python3',['-u','serve.py',String(port)],{env:{...process.env,KAMINOS_BIND_HOST:'127.0.0.1'},stdio:['ignore',log.fd,log.fd]});
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
}catch(error){report.status='failed';report.error=error.stack;process.exitCode=1;}finally{await context?.close();server?.kill('SIGTERM');await log?.close();await save();console.log(JSON.stringify({status:report.status,phase:report.phase,error:report.error,out}));}
