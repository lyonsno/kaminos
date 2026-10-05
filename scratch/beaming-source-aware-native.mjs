import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
const [url,out]=process.argv.slice(2);
await fs.mkdir(out,{recursive:true});
const report={status:'running',phase:'launch',url,source:{root:process.cwd(),revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),dirty:execFileSync('git',['status','--porcelain'],{encoding:'utf8'})},errors:[]};
const save=()=>fs.writeFile(out+'/report.json',JSON.stringify(report,null,2));
await save();let browser;
try {
  const {chromium}=await import('/private/tmp/beaming-smoke-deps-1001/node_modules/playwright/index.mjs');
  report.executable='/Users/noahlyons/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
  browser=await chromium.launch({headless:true,executablePath:report.executable,args:['--enable-unsafe-webgpu','--use-angle=metal']});
  const page=await browser.newPage();
  page.on('pageerror',e=>report.errors.push(String(e)));
  await page.goto(new URL('/api/runtime-config',url).href);
  report.runtime=await page.evaluate(()=>JSON.parse(document.body.innerText));
  report.phase='native-production-kernel';await save();
  report.result=await page.evaluate(async()=>{const m=await import('/scratch/beaming-source-aware-gpu.mjs');return m.checkSourceAwareGPU();});
  if(report.result.status!=='passed'||report.errors.length)throw new Error(report.result.error||report.errors.join('\n'));
  report.status='passed';report.phase='complete';
}catch(e){report.status='failed';report.error=String(e);process.exitCode=1;}
finally{await save();await browser?.close();}
console.log(JSON.stringify({status:report.status,phase:report.phase,error:report.error,out}));
