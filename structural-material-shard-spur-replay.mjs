import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {summarizeShardReplay} from './structural-material-shard-spur-evidence.mjs';
const [out,executable,modulePath,url]=process.argv.slice(2);
if(!out)throw new Error('Explicit evidence directory required');fs.mkdirSync(out,{recursive:true});
const report={status:'running',phase:'input',argv:process.argv,inputs:[],states:[],errors:[]},save=()=>fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));save();let browser,page;
try{
 const effective=fs.realpathSync(executable);if(effective.includes('/Google Chrome.app/')||!/chrome-headless-shell$|\/Chromium$|Google Chrome for Testing$/.test(effective))throw new Error('Independent browser required');
 const {chromium}=await import(pathToFileURL(modulePath));report.sourceRevision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();report.sources={};for(const name of ['structural-material-shard-view.js','structural-material-component-transport.mjs','structural-material-component-affine.mjs','structural-material-shard-evidence.mjs','structural-material-shard-spur-evidence.mjs','structural-material-shard-spur-replay.mjs','structural-material-solid-resident.js','structural-material-solid-fragments.mjs','structural-material-solid-surface.mjs','structural-material-stress-release.mjs','structural-material-shard-render.js','structural-material-arch-stones.js'])report.sources[name]=createHash('sha256').update(fs.readFileSync(name)).digest('hex');report.sourceSha256=report.sources['structural-material-shard-view.js'];report.browser={executable:effective,version:execFileSync(effective,['--version'],{encoding:'utf8'}).trim()};save();
 browser=await chromium.launch({executablePath:effective,headless:true,args:['--enable-automation','--enable-unsafe-webgpu','--use-gl=angle','--use-angle=metal']});page=await browser.newPage({viewport:{width:1280,height:820}});page.on('pageerror',e=>{report.errors.push({message:e.message,stack:e.stack});save();});
 report.phase='browser';save();await page.goto(url,{waitUntil:'networkidle',timeout:0});report.effectiveUrl=page.url();if(report.effectiveUrl!==url)throw new Error('Effective route changed');await page.waitForFunction(()=>window.__stoneShards||document.getElementById('failure').textContent,{timeout:0});
 if(!await page.evaluate(()=>Boolean(window.__stoneShards)))throw new Error(await page.locator('#failure').textContent());
 const call=async expression=>{report.inputs.push({expression,at:new Date().toISOString()});save();return page.evaluate(expression);};
 await call('window.__stoneShards.pause(true)');await call('window.__stoneShards.settle()');
 const retain=async name=>{const w=await call('window.__stoneShards.witness()');const file=name+'.json';fs.writeFileSync(path.join(out,file),JSON.stringify(w));report.lastRawWitness=file;save();const summary=summarizeShardReplay(w);report.states.push({name,file,...summary});save();await page.screenshot({path:path.join(out,name+'.png')});return w;};
 await retain('intact');report.phase='repeated-normal-injury';save();
 for(const [grip,x] of [.6,0,-.5].entries()){
  const w=await call('window.__stoneShards.witness()');let nearest;
  for(const p of w.pieces)for(let v=0;v<p.binding.entries.length;v++){const rest=p.binding.entries[v].point,score=(rest[0]-x)**2+rest[1]**2+(rest[2]-.3)**2;if(!nearest||score<nearest.score){const index=p.geometry.indices.indexOf(v);if(index>=0)nearest={pieceId:p.id,point:p.renderedPositions.slice(index*3,index*3+3),score};}}
  await call(`window.__stoneShards.pick(${nearest.pieceId},${JSON.stringify(nearest.point)})`);
  for(let step=1;step<=20;step++){await call(`window.__stoneShards.move([0,${step*.02},${step*.01}])`);await call('window.__stoneShards.advance()');await retain(`grip-${grip}-step-${step}`);}
  await call('window.__stoneShards.release()');for(let step=1;step<=10;step++){await call('window.__stoneShards.advance()');await retain(`grip-${grip}-release-${step}`);}
 }
 if(report.errors.length)throw new Error('Browser errors retained');for(const [name,digest]of Object.entries(report.sources))if(createHash('sha256').update(fs.readFileSync(name)).digest('hex')!==digest)throw new Error(`Replay source changed: ${name}`);report.status='passed';report.phase='complete';save();
}catch(e){report.status='failed';report.failure={message:e.message,stack:e.stack};if(page)try{fs.writeFileSync(path.join(out,'failure-state.json'),JSON.stringify(await page.evaluate(()=>window.__stoneShards?.witness())));await page.screenshot({path:path.join(out,'failure.png')});}catch(retention){report.retentionError=retention.message;}save();process.exitCode=1;}finally{if(browser){await browser.close();report.browser.ownedChildExited=true;}save();console.log(JSON.stringify({status:report.status,phase:report.phase,out,failure:report.failure?.message,worst:report.states.reduce((a,b)=>!a||b.surfaceTravel>a.surfaceTravel?b:a,null)}));}
