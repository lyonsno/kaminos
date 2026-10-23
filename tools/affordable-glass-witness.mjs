import fs from 'node:fs';
import assert from 'node:assert/strict';
const [url,out,expectedCommit,browserPath,playwrightPath,...flags]=process.argv.slice(2);
if(!url||!out||!expectedCommit||!browserPath||!playwrightPath)throw Error('Usage: node tools/affordable-glass-witness.mjs URL OUT COMMIT BROWSER PLAYWRIGHT [--negative-source]');
fs.mkdirSync(out,{recursive:true});
const report={ok:false,url,expectedCommit,browserPath,phase:'launch',errors:[],frames:[]};let browser,page;
try{
 const {chromium}=await import(playwrightPath);
 browser=await chromium.launch({executablePath:browserPath,headless:true,args:['--use-mock-keychain','--password-store=basic']});
 page=await browser.newPage({viewport:{width:1600,height:1100}});
 page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});page.on('response',r=>{if(r.status()>=400)report.errors.push(`${r.status()} ${r.url()}`);});
 report.phase='load';await page.goto(url);await page.waitForFunction(()=>window.kaminosWorkbenchExperiments?.state()?.id==='generated-glass');
 const read=()=>page.evaluate(()=>window.kaminosWorkbenchExperiments.read());
 const call=(op,arg)=>page.evaluate(({op,arg})=>window.kaminosWorkbenchExperiments.invoke(op,arg),{op,arg});
 report.runtime=await (await page.request.get(new URL('/api/runtime-config',url).href)).json();
 assert.equal(report.runtime.source.commit,flags.includes('--negative-source')?'wrong-source':expectedCommit);assert.equal(report.runtime.source.dirty,false);
 const initial=await read();assert.equal(initial.source,JSON.parse(new URL(url).searchParams.get('experiment_inputs')).url);assert.equal(initial.factor,4);assert.equal(initial.surfels.count,111189);assert.equal(initial.surfels.sourceCount,1428273);assert.equal(initial.fieldRegion,null);assert.equal(initial.rawMesh,undefined);assert.equal(initial.reference.route,'smooth-hollow-lathe');
 for(const factor of [4,2]){
  report.phase=`factor-${factor}`;
  await page.getByLabel('Surfel detail',{exact:true}).selectOption(String(factor));
  await page.waitForFunction(async f=>(await window.kaminosWorkbenchExperiments.read()).factor===f,factor);
  assert.equal((await read()).surfels.count,factor===4?111189:352016);
  for(const detail of [false,true]){
   await call(detail?'frameBottle':'frameWhole');
   for(const mode of ['off','glass']){
    await page.getByLabel('Nearest-wall reconstruction',{exact:true}).selectOption(mode);
    await page.waitForFunction(async m=>{const s=(await window.kaminosWorkbenchExperiments.read()).surfels;return s.reconstruction===(m!=='off')&&s.reconstructionScope==='glass';},mode);
    await page.waitForTimeout(500);
    const file=`factor-${factor}-${detail?'bottles':'whole'}-${mode}.png`;await page.screenshot({path:out+'/'+file});report.frames.push({file,state:await read()});
   }
  }
 }
 report.phase='finished-mesh';await call('setRepresentation','mesh');await page.waitForTimeout(500);await page.screenshot({path:out+'/finished-mesh-bottles.png'});report.frames.push({file:'finished-mesh-bottles.png',state:await read()});
 await call('setRepresentation','surfels');await call('setSurfelFactor',4);await call('frameWhole');
 report.phase='done';assert.equal(report.errors.length,0);report.ok=true;
}catch(error){report.error=String(error);try{report.lastState=await page?.evaluate(()=>window.kaminosWorkbenchExperiments?.read());}catch{}}finally{await browser?.close();fs.writeFileSync(out+'/report.json',JSON.stringify(report,null,2));}
console.log(JSON.stringify({ok:report.ok,phase:report.phase,frames:report.frames.length,errors:report.errors,error:report.error}));if(!report.ok)process.exitCode=1;
