import fs from 'node:fs';
import assert from 'node:assert/strict';
const [url,out,expectedCommit,browserPath,playwrightPath,...flags]=process.argv.slice(2);
if(!url||!out||!expectedCommit||!browserPath||!playwrightPath)throw Error('Usage: node tools/deferred-glass-witness.mjs URL OUT COMMIT BROWSER PLAYWRIGHT [--triage]');
fs.mkdirSync(out,{recursive:true});const report={ok:false,url,expectedCommit,browserPath,phase:'launch',errors:[],frames:[]};let browser,page;
try{
 const {chromium}=await import(playwrightPath);browser=await chromium.launch({executablePath:browserPath,headless:true,args:['--use-mock-keychain','--password-store=basic']});page=await browser.newPage({viewport:{width:1600,height:1100}});
 page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});page.on('response',r=>{if(r.status()>=400)report.errors.push(`${r.status()} ${r.url()}`);});
 report.phase='load';await page.goto(url);await page.waitForFunction(()=>window.kaminosWorkbenchExperiments?.state()?.id==='generated-glass');
 report.runtime=await (await page.request.get(new URL('/api/runtime-config',url).href)).json();assert.equal(report.runtime.source.commit,expectedCommit);assert.equal(report.runtime.source.dirty,false);
 const read=()=>page.evaluate(()=>window.kaminosWorkbenchExperiments.read()),call=(op,arg)=>page.evaluate(({op,arg})=>window.kaminosWorkbenchExperiments.invoke(op,arg),{op,arg});
 const initial=await read();assert.equal(initial.factor,4);assert.equal(initial.surfels.sourceCount,1428273);assert.equal(initial.source,JSON.parse(new URL(url).searchParams.get('experiment_inputs')).url);
 for(const factor of flags.includes('--triage')?[4]:[4,2]){
  await call('setSurfelFactor',factor);
  for(const representation of ['surfels','splats']){
   report.phase=`${factor}-${representation}`;
   await page.getByLabel('Surface representation',{exact:true}).selectOption(representation);await call('setRepresentation',representation);assert.equal((await read()).representation,representation);
   for(const detail of [false,true]){
    await call(detail?'frameBottle':'frameWhole');await page.waitForTimeout(800);const state=await read();assert.equal(state[representation].count,factor===4?111189:352016);if(representation==='splats'){assert.equal(state.splats.route,'deferred-surface-splats');assert.ok(state.splats.updates>0);}
    const file=`factor-${factor}-${representation}-${detail?'bottles':'whole'}.png`;await page.screenshot({path:out+'/'+file});report.frames.push({file,state});assert.equal(report.errors.length,0);
   }
  }
 }
 report.phase='done';report.ok=true;
}catch(e){report.error=String(e);try{report.lastState=await page?.evaluate(()=>window.kaminosWorkbenchExperiments?.read());await page?.screenshot({path:out+'/failure.png'});}catch{}}finally{await browser?.close();fs.writeFileSync(out+'/report.json',JSON.stringify(report,null,2));}
console.log(JSON.stringify({ok:report.ok,phase:report.phase,frames:report.frames.length,error:report.error,errors:report.errors}));if(!report.ok)process.exitCode=1;
