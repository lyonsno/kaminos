import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

const [url,out,modulePath,executable,settingsJson]=process.argv.slice(2);
const settings=settingsJson?JSON.parse(settingsJson):{envelope:.05,spacing:.1,budgetSeconds:5};
if(!url||!out||!modulePath||!executable)throw Error('URL OUTPUT PLAYWRIGHT_MODULE INDEPENDENT_CHROMIUM required');
if(fs.realpathSync(executable).includes('/Applications/Google Chrome.app/'))throw Error('Independent Chromium required');
fs.mkdirSync(out,{recursive:true});
const report={status:'running',phase:'launch',requestedUrl:url,settings,executable:fs.realpathSync(executable),messages:[],httpErrors:[],checks:[],sourceFiles:{}};
for(const file of ['mechanical-proxy-tool.mjs','mechanical-proxy-core.mjs','mechanical_proxy.py','mechanical_proxy_backend.py'])report.sourceFiles[file]=createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const save=()=>fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));save();
let browser;
try{
 const {chromium}=await import(pathToFileURL(modulePath));
 browser=await chromium.launchPersistentContext(path.join(out,'profile'),{executablePath:executable,headless:true,viewport:{width:1560,height:1050},args:['--enable-unsafe-webgpu','--use-gl=angle','--use-angle=metal','--use-mock-keychain','--password-store=basic']});
 const page=browser.pages()[0]??await browser.newPage();page.on('console',m=>{if(m.type()==='error')report.messages.push({type:'console',text:m.text(),location:m.location()});});page.on('pageerror',e=>report.messages.push({type:'pageerror',text:String(e)}));page.on('response',r=>{if(r.status()>=400)report.httpErrors.push({url:r.url(),status:r.status()});});
 await page.goto(url,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.kaminosAssetSmokeLinkDebugState?.().status==='loaded'&&window.kaminosMechanicalProxy);
 report.effectiveUrl=page.url();report.server=await(await page.request.get(new URL('/api/workbench-experiments',url).href)).json();report.link=await page.evaluate(()=>window.kaminosAssetSmokeLinkDebugState());
 if(report.link.requestedPath!==new URL(url).searchParams.get('mesh_path'))throw Error('Wrong source asset');
 await page.evaluate(()=>window.kaminosMechanicalProxy.open());
 report.phase='generate';save();
 report.submission=await page.evaluate(value=>window.kaminosMechanicalProxy.generate(value),settings);save();
 await page.waitForFunction(()=>{const value=window.kaminosMechanicalProxy.read();return value.status==='passed'?Boolean(value.resultFacts):['failed','cancelled','over-budget'].includes(value.status);},null,{timeout:0});
 report.result=await page.evaluate(()=>window.kaminosMechanicalProxy.read());
 if(report.result.status!=='passed')throw Error('Mechanical proxy did not complete: '+JSON.stringify(report.result));
 report.phase='views';save();
 for(const interior of ['section','slab','surface']){
  await page.evaluate(view=>window.kaminosMechanicalProxy.setSection({interior:view,axis:2,offset:.5,width:.05}),interior);await page.waitForTimeout(700);await page.screenshot({path:path.join(out,interior+'.png')});
 }
 report.views=await page.evaluate(()=>{const p=window.kaminosMechanicalProxy;const before=p.read();p.selectElement(0);return{before,selected:p.read()};});
 if(report.views.selected.selectedTet!==0)throw Error('Element selection failed');
 report.kept=await page.evaluate(()=>window.kaminosMechanicalProxy.keep());
 report.reopened=await page.evaluate(async()=>{const p=window.kaminosMechanicalProxy;p.close();return p.open();});
 if(report.reopened.resultId!==report.result.resultId)throw Error('Kept result did not reopen');
 report.checks=['exact asset route','actual tetrahedral result','section/slab/surface','element selection','keep/reopen'];
 report.hostResiduals=report.messages.filter(m=>m.type==='console'&&new URL(m.location?.url??url).pathname==='/api/volume-cockpit-layouts');
 const errors=report.messages.filter(m=>!report.hostResiduals.includes(m));
 if(errors.length)throw Error('Browser errors: '+JSON.stringify(errors));
 report.status='passed';report.phase='complete';
}catch(error){report.status='failed';report.error={message:error.message,stack:error.stack};process.exitCode=1;}
finally{if(browser)await browser.close();report.browserClosed=true;save();}
console.log(JSON.stringify({status:report.status,phase:report.phase,out,error:report.error?.message}));
