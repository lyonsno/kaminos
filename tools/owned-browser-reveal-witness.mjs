import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import net from 'node:net';
import {createOwnedBrowserReveal,greenroomProcessStarts,macBrowserForeground} from './owned-browser-reveal.mjs';

const output=path.resolve(process.argv[2]);await fs.mkdir(output,{recursive:true});
const report={status:'starting',phase:'preflight',route:'actual retained CFT page/private socket/native PID; no simulator or GPU scene',repoRoot:path.resolve(import.meta.dirname,'..'),executable:process.env.CHROME_EXECUTABLE,receipts:[]};
const save=()=>fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
let server,browser,service,primaryError;
try{
  await save();assert.ok(process.env.CHROME_EXECUTABLE&&!process.env.CHROME_EXECUTABLE.includes('/Applications/Google Chrome.app/'),'independent browser required');
  const {chromium}=await import(pathToFileURL(path.resolve(process.env.PLAYWRIGHT_MODULE)));
  report.phase='launch';await save();server=await chromium.launchServer({executablePath:process.env.CHROME_EXECUTABLE,headless:false,args:['--window-size=900,650']});
  browser=await chromium.connect(server.wsEndpoint());const page=await browser.newPage();
  await page.goto('data:text/html,<title>Owned session reveal</title><body style="background:%232b2b2b;color:white;font:24px sans-serif;padding:48px"><h1>Same owned session</h1><input id="state" value="Retained operator edit"><p>No simulator running</p></body>');
  await page.locator('#state').fill('Operator edit survives reveal');
  const binding={request_id:randomUUID(),request_digest:'native-witness',job_id:'cpu-only-witness',url:page.url()};
  service=await createOwnedBrowserReveal({page,browser,browserPid:server.process().pid,binding,
    readStarts:pids=>greenroomProcessStarts(process.env.GREENROOM_PYTHON,pids),record:receipt=>report.receipts.push(receipt)});
  report.identity=service.identity;report.browserVersion=browser.version();
  const exchange=action=>new Promise((resolve,reject)=>{
    const request={schema:'gpu-greenroom.application-reveal-request.v1',action,call_id:randomUUID(),...binding,reveal:service.identity};
    const socket=net.connect(service.identity.socket_path);let response='';socket.on('error',reject);socket.on('connect',()=>socket.write(JSON.stringify(request)+'\n'));
    socket.on('data',value=>response+=value);socket.on('end',()=>resolve(JSON.parse(response)));
  });
  // Hide this exact native application, not another app or another owner's page.
  const {commandJson}=await import('./owned-browser-reveal.mjs');
  report.phase='obscured';await commandJson('/usr/bin/osascript',['-l','JavaScript','-e',`ObjC.import('AppKit'); function run(argv) { var app=$.NSRunningApplication.runningApplicationWithProcessIdentifier(Number(argv[0])); return JSON.stringify({hidden:Boolean(app.hide)}); }`,String(server.process().pid)]);
  const before=await macBrowserForeground(server.process().pid);report.before=before;assert.equal(before.foreground,false,'witness must first obscure its own browser');
  const inspected=await exchange('inspect');assert.equal(inspected.error,undefined);assert.equal((await macBrowserForeground(server.process().pid)).foreground,false,'inspect must not reveal');
  report.phase='reveal';await save();
  for(let i=0;i<2;i++){
    const receipt=await exchange('reveal');assert.equal(receipt.error,undefined,receipt.error);assert.equal(receipt.foreground,true);
    assert.equal(browser.contexts().flatMap(context=>context.pages()).length,1);
    assert.equal(await page.locator('#state').inputValue(),'Operator edit survives reveal');
  }
  await page.screenshot({path:path.join(output,'revealed.png')});
  await page.close();const expired=await exchange('reveal');assert.match(expired.error,/ended/);assert.equal(expired.foreground,undefined);
  report.status='passed';report.phase='complete';
}catch(error){primaryError=error;report.status='failed';report.error=String(error.stack||error);}
finally{
  const errors=[];
  for(const dispose of [()=>service?.dispose(),()=>browser?.close(),()=>server?.close()])try{await dispose();}catch(error){errors.push(String(error));}
  report.shutdownErrors=errors;report.finishedAt=new Date().toISOString();await save();
  if(primaryError)throw primaryError;if(errors.length)throw Error(errors.join('\n'));
}
