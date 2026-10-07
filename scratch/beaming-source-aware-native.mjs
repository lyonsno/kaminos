import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
const [url,out]=process.argv.slice(2);
const guided=process.argv.includes('--guided');
const modulePath=process.argv.includes('--scattering')?'/scratch/beaming-scattering-gpu.mjs':'/scratch/beaming-source-aware-gpu.mjs';
await fs.mkdir(out,{recursive:true});
const report={status:'running',phase:'launch',url,modulePath,source:{root:process.cwd(),revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),dirty:execFileSync('git',['status','--porcelain'],{encoding:'utf8'})},errors:[]};
const save=()=>fs.writeFile(out+'/report.json',JSON.stringify(report,null,2));
await save();let browser;
try {
  const {chromium}=await import(process.env.KAMINOS_PLAYWRIGHT_MODULE||'/Users/noahlyons/.local/state/kaminos/beaming-browser-deps-1007/node_modules/playwright/index.mjs');
  report.executable='/Users/noahlyons/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
  browser=await chromium.launch({headless:true,executablePath:report.executable,args:['--enable-unsafe-webgpu','--use-angle=metal']});
  const page=await browser.newPage();
  page.on('pageerror',e=>report.errors.push(String(e)));
  await page.goto(new URL('/api/runtime-config',url).href);
  report.runtime=await page.evaluate(()=>JSON.parse(document.body.innerText));
  if(report.runtime.source.repoRoot!==report.source.root||report.runtime.source.commit!==report.source.revision||report.runtime.source.dirty||report.source.dirty)throw new Error('native source route differs from requested clean revision');
  report.phase='native-production-kernel';await save();
  report.result=await page.evaluate(async({path,guided})=>{const m=await import(path);return m.checkSourceAwareGPU({guided});},{path:modulePath,guided});
  if(guided&&(!report.result.outputs?.length||report.result.outputs.some(o=>o.metadata.angularPattern!=='guided'||o.metadata.samplingLaw!=='emitter-envelope-mixture-solid-angle-v1'||!o.metadata.sourceGuide)))throw new Error('requested guided native route missing or replaced');
  if(report.result.status!=='passed'||report.errors.length)throw new Error(report.result.error||report.errors.join('\n'));
  report.status='passed';report.phase='complete';
}catch(e){report.status='failed';report.error=String(e);process.exitCode=1;}
finally{await save();await browser?.close();}
console.log(JSON.stringify({status:report.status,phase:report.phase,error:report.error,out}));
