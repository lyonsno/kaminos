import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const [server,browserPath,playwrightPath,output,...flags]=process.argv.slice(2);
if(!server||!browserPath||!playwrightPath||!output)throw Error('Usage: node tools/surfel-surface-witness.mjs SERVER BROWSER PLAYWRIGHT OUT [--negative-empty]');
mkdirSync(output,{recursive:true});
const report={server,browserPath:resolve(browserPath),playwrightPath:resolve(playwrightPath),phase:'launch',errors:[]};let browser;
try{
 const {chromium}=await import(report.playwrightPath);
 browser=await chromium.launch({executablePath:report.browserPath,headless:true,args:['--use-mock-keychain','--password-store=basic']});
 const page=await browser.newPage();page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 report.phase='load';await page.goto(server+'/tests/fixtures/surfel-surface.html');await page.waitForFunction(()=>window.runSurfaceWitness);
 report.runtime=await (await page.request.get(server+'/api/runtime-config')).json();
 report.phase='render';report.result=flags.includes('--negative-empty')?null:await page.evaluate(()=>window.runSurfaceWitness());
 report.phase='assert';assert.equal(report.result?.backend,'WebGPU');assert.equal(report.result.results.length,3);
 for(const r of report.result.results){
  assert.equal(r.state.surface.updates,1);assert.equal(r.hostTransparent,false);
  for(const s of r.samples.slice(1))assert.ok(Number.isFinite(s[3])&&s[3]>0,'missing weighted samples');
  for(const [actual,expected] of [[r.normalized[0],[1,0,0]],[r.normalized[1],[0,0,1]],[r.normalized[2],[.25,0,.2]]])actual.forEach((v,i)=>assert.ok(Number.isFinite(v)&&Math.abs(v-expected[i])<.002,`got ${actual}, expected ${expected}`));
 }
 assert.equal(report.errors.length,0);report.ok=true;
}catch(error){report.ok=false;report.error=String(error);}finally{await browser?.close();writeFileSync(resolve(output,'report.json'),JSON.stringify(report,null,2));}
console.log(JSON.stringify(report));if(!report.ok)process.exitCode=1;
