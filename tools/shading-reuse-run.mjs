import fs from 'node:fs';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
import {launchBrowser} from './measure-lod-image-error.mjs';
const [origin,out,mode='conformance']=process.argv.slice(2);if(!origin||!out)throw Error('origin and output required');fs.mkdirSync(out,{recursive:true});
const report={status:'running',phase:'admission',origin,mode,source:import.meta.dirname+'/..',cases:[]};let browser;
const save=()=>fs.writeFileSync(out+'/report.json',JSON.stringify(report,null,2));save();
try{
 report.revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
 report.runtime=await(await fetch(origin+'/api/runtime-config')).json();
 const expected=fs.realpathSync(report.source);if(fs.realpathSync(report.runtime.source.repoRoot)!==expected)throw Error('wrong source checkout');
 report.sources={};for(const file of ['scene-gi.mjs','scene-shading-cache.mjs','lib/three.webgpu.js','tools/shading-reuse.html','scene-light-timing.mjs']){
 const local=fs.readFileSync(expected+'/'+file),served=Buffer.from(await(await fetch(origin+'/'+file)).arrayBuffer());if(!local.equals(served))throw Error('wrong served source '+file);report.sources[file]=createHash('sha256').update(local).digest('hex');}
 report.phase='browser';save();
 browser=await launchBrowser({executable:'/Users/noahlyons/Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell',args:['--enable-unsafe-webgpu','--use-angle=metal']});
 report.browser={executable:browser.executable,version:browser.version};
 const cases=mode==='measure'?[...Array(2)].flatMap((_,round)=>[1,16].flatMap(lights=>(round?[true,false]:[false,true]).map(reuse=>({round,lights,reuse})))):[{conformance:true}];
 for(const c of cases){report.phase=JSON.stringify(c);save();const query=c.conformance?'':'?'+new URLSearchParams({measure:'1',reuse:c.reuse?'1':'0',lights:c.lights});
  const page=await browser.openPage(origin+'/tools/shading-reuse.html'+query),stem='case-'+report.cases.length;
  if(page.png)fs.writeFileSync(out+'/'+stem+'.png',page.png);delete page.png;fs.writeFileSync(out+'/'+stem+'.json',JSON.stringify(page,null,2));
  if(page.title!=='done'||page.error)throw Error(page.error??'page did not complete');
  if(page.result?.backend!=='WebGPU'||page.result.errors.length||page.console.some(s=>s.startsWith('error:')||s.startsWith('exception:')))throw Error('native route failed: '+page.console.join('\n'));
  if(!c.conformance&&(page.result.reuse!==c.reuse||page.result.result.records.length!==24))throw Error('wrong effective case or partial samples');
  report.cases.push({...c,path:stem+'.json',state:page.result.state,result:c.conformance?page.result.results:page.result.result});save();
 }
 report.status='observed';report.phase='complete';
}catch(error){report.status='failed';report.error=String(error.stack??error);process.exitCode=1;}finally{await browser?.close();save();console.log(JSON.stringify({status:report.status,phase:report.phase,error:report.error,cases:report.cases.length}));}
