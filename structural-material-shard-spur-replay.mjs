import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const [out,executable,modulePath,url]=process.argv.slice(2);
if(!out)throw new Error('Explicit evidence directory required');fs.mkdirSync(out,{recursive:true});
const report={status:'running',phase:'input',argv:process.argv,inputs:[],states:[],errors:[]},save=()=>fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));save();let browser,page;
const determinant=F=>F[0][0]*(F[1][1]*F[2][2]-F[1][2]*F[2][1])-F[0][1]*(F[1][0]*F[2][2]-F[1][2]*F[2][0])+F[0][2]*(F[1][0]*F[2][1]-F[1][1]*F[2][0]);
const summarize=w=>{
 const current=Array.from({length:w.state.model.points},(_,i)=>w.state.state.slice(i*16+4,i*16+7)),rest=Array.from({length:current.length},(_,i)=>w.state.state.slice(i*16,i*16+3));
 const materialTravel=Math.max(...current.map((p,i)=>Math.hypot(...p.map((x,k)=>x-rest[i][k]))));let surfaceTravel=0,worst=null;
 for(const piece of w.pieces)for(let i=0;i<piece.geometry.indices.length;i++){const vertex=piece.geometry.indices[i],entry=piece.binding.entries[vertex],travel=Math.hypot(...piece.renderedPositions.slice(i*3,i*3+3).map((x,k)=>x-entry.point[k]));if(travel>surfaceTravel){surfaceTravel=travel;worst={piece:piece.id,vertex,weightL1:entry.weightL1,rankMeasure:entry.rankMeasure,ids:entry.ids,weights:entry.weights,rest:entry.point,current:piece.renderedPositions.slice(i*3,i*3+3)};}}
 return{steps:w.state.steps,events:w.events.length,pieces:w.pieces.length,materialTravel,surfaceTravel,amplification:materialTravel?surfaceTravel/materialTravel:0,minActiveJ:Math.min(...w.state.stresses.filter(s=>s.active).map(s=>determinant(s.F))),worst};
};
try{
 const effective=fs.realpathSync(executable);if(effective.includes('/Google Chrome.app/')||!/chrome-headless-shell$|\/Chromium$|Google Chrome for Testing$/.test(effective))throw new Error('Independent browser required');
 const {chromium}=await import(pathToFileURL(modulePath));report.sourceRevision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();report.sourceSha256=createHash('sha256').update(fs.readFileSync('structural-material-shard-view.js')).digest('hex');report.browser={executable:effective,version:execFileSync(effective,['--version'],{encoding:'utf8'}).trim()};save();
 browser=await chromium.launch({executablePath:effective,headless:true,args:['--enable-automation','--enable-unsafe-webgpu','--use-gl=angle','--use-angle=metal']});page=await browser.newPage({viewport:{width:1280,height:820}});page.on('pageerror',e=>{report.errors.push({message:e.message,stack:e.stack});save();});
 report.phase='browser';save();await page.goto(url,{waitUntil:'networkidle',timeout:0});report.effectiveUrl=page.url();if(report.effectiveUrl!==url)throw new Error('Effective route changed');await page.waitForFunction(()=>window.__stoneShards||document.getElementById('failure').textContent,{timeout:0});
 if(!await page.evaluate(()=>Boolean(window.__stoneShards)))throw new Error(await page.locator('#failure').textContent());
 const call=async expression=>{report.inputs.push({expression,at:new Date().toISOString()});save();return page.evaluate(expression);};
 await call('window.__stoneShards.pause(true)');await call('window.__stoneShards.settle()');
 const retain=async name=>{const w=await call('window.__stoneShards.witness()');if(w.phase!=='interactive'||w.identity.backend!=='webgpu'||w.identity.adapterFallback)throw new Error('Native interactive witness required');const file=name+'.json';fs.writeFileSync(path.join(out,file),JSON.stringify(w));const summary=summarize(w);report.states.push({name,file,...summary});save();await page.screenshot({path:path.join(out,name+'.png')});return w;};
 await retain('intact');report.phase='repeated-normal-injury';save();
 for(const [grip,x] of [.6,0,-.5].entries()){
  const w=await call('window.__stoneShards.witness()');let nearest;
  for(const p of w.pieces)for(let v=0;v<p.binding.entries.length;v++){const rest=p.binding.entries[v].point,score=(rest[0]-x)**2+rest[1]**2+(rest[2]-.3)**2;if(!nearest||score<nearest.score){const index=p.geometry.indices.indexOf(v);if(index>=0)nearest={pieceId:p.id,point:p.renderedPositions.slice(index*3,index*3+3),score};}}
  await call(`window.__stoneShards.pick(${nearest.pieceId},${JSON.stringify(nearest.point)})`);
  for(let step=1;step<=20;step++){await call(`window.__stoneShards.move([0,${step*.02},${step*.01}])`);await call('window.__stoneShards.advance()');await retain(`grip-${grip}-step-${step}`);}
  await call('window.__stoneShards.release()');for(let step=1;step<=10;step++){await call('window.__stoneShards.advance()');await retain(`grip-${grip}-release-${step}`);}
 }
 if(report.errors.length)throw new Error('Browser errors retained');report.status='passed';report.phase='complete';save();
}catch(e){report.status='failed';report.failure={message:e.message,stack:e.stack};if(page)try{fs.writeFileSync(path.join(out,'failure-state.json'),JSON.stringify(await page.evaluate(()=>window.__stoneShards?.witness())));await page.screenshot({path:path.join(out,'failure.png')});}catch(retention){report.retentionError=retention.message;}save();process.exitCode=1;}finally{if(browser){await browser.close();report.browser.ownedChildExited=true;}save();console.log(JSON.stringify({status:report.status,phase:report.phase,out,failure:report.failure?.message,worst:report.states.reduce((a,b)=>!a||b.surfaceTravel>a.surfaceTravel?b:a,null)}));}
