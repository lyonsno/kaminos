import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

const [url,out,modulePath,executable,settingsJson]=process.argv.slice(2);
const settings=settingsJson?JSON.parse(settingsJson):{envelope:.05,spacing:.1,budgetSeconds:5};
if(!url||!out||!modulePath||!executable)throw Error('URL OUTPUT PLAYWRIGHT_MODULE INDEPENDENT_CHROMIUM required');
if(fs.realpathSync(executable).includes('/Applications/Google Chrome.app/'))throw Error('Independent Chromium required');
fs.mkdirSync(out,{recursive:true});
const report={status:'running',phase:'launch',requestedUrl:url,settings,executable:fs.realpathSync(executable),messages:[],httpErrors:[],checks:[],pixels:{},sourceFiles:{}};
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
 report.before=await page.evaluate(()=>window.kaminosMechanicalProxy.read());
 report.phase='generate';save();
 for(const key of ['envelope','spacing','budgetSeconds'])await page.locator(`[data-mp="${key}"]`).fill(String(settings[key]));
 await page.locator('[data-mp="generate"]').click();
 await page.waitForFunction(()=>{const value=window.kaminosMechanicalProxy.read();return !document.querySelector('[data-mp="generate"]').disabled&&(value.status==='passed'?Boolean(value.resultFacts):['failed','cancelled','over-budget'].includes(value.status));},null,{timeout:0});
 report.result=await page.evaluate(()=>window.kaminosMechanicalProxy.read());
 if(report.result.status!=='passed')throw Error('Mechanical proxy did not complete: '+JSON.stringify(report.result));
 report.phase='views';save();
 const pixelCheck=async(name)=>{
  const buffer=await page.locator('#kaminos-host-renderer-canvas').screenshot({path:path.join(out,name+'-canvas.png')});
  report.pixels[name]=await page.evaluate(async base64=>{const img=new Image();img.src='data:image/png;base64,'+base64;await img.decode();const canvas=document.createElement('canvas');canvas.width=img.width;canvas.height=img.height;const context=canvas.getContext('2d');context.drawImage(img,0,0);const pixels=context.getImageData(0,0,canvas.width,canvas.height).data;const colors=new Set();let teal=0;for(let i=0;i<pixels.length;i+=4){const [r,g,b]=pixels.slice(i,i+3);colors.add(`${r>>4}/${g>>4}/${b>>4}`);if(g>r*1.08&&b>r*1.08)teal++;}return{width:canvas.width,height:canvas.height,colors:colors.size,teal};},buffer.toString('base64'));
  if(report.pixels[name].colors<8||report.pixels[name].teal<20)throw Error('Proxy canvas is blank or expected proxy pixels are missing: '+name);
 };
 for(const interior of ['section','slab','surface']){
  await page.locator('[data-mp="interior"]').selectOption(interior);await page.waitForTimeout(700);await page.screenshot({path:path.join(out,interior+'.png')});await pixelCheck(interior);
 }
 await page.locator('[data-mode="original"]').click();await page.waitForTimeout(300);await page.screenshot({path:path.join(out,'original.png')});
 await page.locator('[data-mode="overlay"]').click();await page.waitForTimeout(300);await page.screenshot({path:path.join(out,'overlay.png')});
 await page.locator('[data-mode="proxy"]').click();await page.locator('[data-mp="interior"]').selectOption('section');
 await page.locator('[data-mp="offset"]').evaluate(el=>{el.value='0.25';el.dispatchEvent(new Event('input',{bubbles:true}));});await page.waitForTimeout(300);await page.screenshot({path:path.join(out,'section-quarter.png')});
 await page.locator('[data-mp="offset"]').evaluate(el=>{el.value='0.75';el.dispatchEvent(new Event('input',{bubbles:true}));});await page.waitForTimeout(300);await page.screenshot({path:path.join(out,'section-three-quarter.png')});
 report.views=await page.evaluate(()=>{const p=window.kaminosMechanicalProxy;const before=p.read();p.selectElement(0);return{before,selected:p.read()};});
 if(report.views.selected.selectedTet!==0)throw Error('Element selection failed');
 await page.locator('[data-mp="keep"]').click();await page.waitForFunction(()=>document.querySelector('[data-mp="status"]').textContent==='Kept');report.kept=await page.evaluate(()=>window.kaminosMechanicalProxy.read());
 report.reopened=await page.evaluate(async()=>{const p=window.kaminosMechanicalProxy;p.close();return p.open();});
 if(report.reopened.resultId!==report.result.resultId)throw Error('Kept result did not reopen');
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(500);await page.locator('[data-mp="interior"]').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,'mobile.png')});await pixelCheck('mobile');
 report.mobile=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,controls:[...document.querySelectorAll('#mechanical-proxy-tool input,#mechanical-proxy-tool select,#mechanical-proxy-tool button')].map(el=>({name:el.dataset.mp??el.dataset.mode,width:el.getBoundingClientRect().width,scrollWidth:el.scrollWidth,clientWidth:el.clientWidth}))}));
 if(report.mobile.scrollWidth>report.mobile.width)throw Error('Mobile document overflows');
 report.checks=['exact asset route','actual tetrahedral result','ordinary generate and view controls','section/slab/surface pixels','original/overlay','movable section plane','element selection','ordinary keep/reopen','mobile canvas and document'];
 report.hostResiduals=report.messages.filter(m=>m.type==='console'&&new URL(m.location?.url??url).pathname==='/api/volume-cockpit-layouts');
 const errors=report.messages.filter(m=>!report.hostResiduals.includes(m));
 if(errors.length)throw Error('Browser errors: '+JSON.stringify(errors));
 report.status='passed';report.phase='complete';
}catch(error){report.status='failed';report.error={message:error.message,stack:error.stack};process.exitCode=1;}
finally{if(browser)await browser.close();report.browserClosed=true;save();}
console.log(JSON.stringify({status:report.status,phase:report.phase,out,error:report.error?.message}));
