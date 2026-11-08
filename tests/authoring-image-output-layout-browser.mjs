// kaminos-test: browser - actual Generate installers, no model or GPU inference.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {startServer,launchChrome,sourceIdentity} from '../models/flux2-klein/cdp-harness.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const out=process.env.KAMINOS_OUTPUT_LAYOUT_DIR;
assert.ok(out,'KAMINOS_OUTPUT_LAYOUT_DIR is required');await fs.mkdir(out,{recursive:true});
const report={route:'production Generate installer composition; saved-image fixture, no inference',source:sourceIdentity(root),phase:'environment',ok:false};
const write=()=>fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
await write();let server,browser;
try{
 const executable=process.env.KAMINOS_BROWSER;
 assert.ok(executable&&!executable.includes('/Google Chrome.app/'),'independent KAMINOS_BROWSER required');
 report.executable=await fs.realpath(executable);await fs.access(report.executable);
 report.phase='server';await write();const hosted=await startServer({'/':root});server=hosted.server;report.origin=hosted.origin;
 report.phase='browser';await write();browser=await launchChrome(report.executable,[],report);
 report.phase='installers';await write();await browser.navigate(`${report.origin}/tests/authoring-image-output-layout.html`,'!!window.outputTest');
 report.installed=await browser.evaluate('window.outputTest');assert.equal(report.installed.ok,true,report.installed.error);
 assert.equal(report.installed.parent,'asset-step-image');
 report.views=[];
 for(const width of [1440,390]){
  await browser.send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width===390});
  await browser.evaluate("document.querySelector('.asset-caller-outputs').scrollIntoView({block:'center'})");
  await browser.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  const geometry=await browser.evaluate(`(()=>{const host=document.querySelector('.asset-caller-outputs'),canvas=host.querySelector('canvas'),button=host.querySelector('button:last-child'),box=button.getBoundingClientRect();return{connected:host.isConnected,rect:canvas.getBoundingClientRect().toJSON(),viewHit:button.contains(document.elementFromPoint(box.x+box.width/2,box.y+box.height/2)),pixel:[...canvas.getContext('2d').getImageData(100,100,1,1).data]};})()`);
  assert.ok(geometry.connected&&geometry.rect.width>0&&geometry.rect.height>0,'output is visible after layout');
  assert.equal(geometry.rect.height,160,'production output styles are applied');
  assert.ok(geometry.viewHit,'View control is reachable in the scrolled output area');
  assert.ok(geometry.pixel[3]>0,'retained output has visible pixels');
  const shot=await browser.send('Page.captureScreenshot',{format:'png'});assert.ok(shot.result?.data,'screenshot returned');
  await fs.writeFile(path.join(out,`${width}.png`),Buffer.from(shot.result.data,'base64'));report.views.push({width,...geometry});await write();
 }
 report.ok=true;report.phase='done';
}catch(error){report.error=String(error.stack||error);}
finally{
 if(browser)await browser.close();else if(report.ownedBrowserPid&&!report.browserExit)process.kill(report.ownedBrowserPid,'SIGTERM');
 if(server)await new Promise(resolve=>server.close(resolve));await write();
}
console.log(JSON.stringify({ok:report.ok,error:report.error,out}));
process.exit(report.ok?0:1);
