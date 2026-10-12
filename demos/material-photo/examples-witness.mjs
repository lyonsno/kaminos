import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {parseArgs} from 'node:util';
import {createHash} from 'node:crypto';
import {validateLayoutFrame} from './layout-checks.js';

const {values}=parseArgs({options:Object.fromEntries(['repo-root','expected-commit','chrome','playwright-module','url','output'].map(key=>[key,{type:'string'}]))});
const out=path.resolve(values.output??'example-display-witness');
const report={status:'failed',phase:'arguments',requested:values,route:'real included outputs; native WebGPU display; no inference',frames:[],requests:[],errors:[]};
const save=async()=>{await fs.mkdir(out,{recursive:true});await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));};
let browser;
try{
  await save();for(const key of ['repo-root','expected-commit','chrome','playwright-module','url','output'])if(!values[key])throw Error(`--${key} required`);
  const root=await fs.realpath(values['repo-root']),git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
  report.source={root,commit:git(['rev-parse','HEAD'])};
  if(report.source.commit!==values['expected-commit']||git(['status','--porcelain','--','demos/material-photo']))throw Error('Exact clean source required');
  const executable=await fs.realpath(values.chrome);if(executable.includes('/Applications/Google Chrome.app/'))throw Error('Independent Chrome required');
  const {chromium}=await import(values['playwright-module']);browser=await chromium.launch({executablePath:executable,headless:true,args:['--enable-unsafe-webgpu']});
  report.browser={executable,version:browser.version()};
  const page=await browser.newPage({viewport:{width:1440,height:900}});page.setDefaultTimeout(0);page.setDefaultNavigationTimeout(0);
  page.on('request',r=>report.requests.push(r.url()));page.on('pageerror',e=>report.errors.push(String(e)));
  const sourceReads=[],observed={};
  const names=['index.html','main.js','style.css','included-examples.js','comparison-viewer.js','viewer.js'];
  page.on('response',r=>{const u=new URL(r.url()),n=path.basename(u.pathname);if(names.includes(n)&&u.href===new URL(n,values.url).href)sourceReads.push(r.body().then(b=>{observed[n]=createHash('sha256').update(b).digest('hex');}));});
  const start=performance.now();report.phase='arrival';await save();await page.goto(values.url);
  await page.waitForFunction(()=>['included','error','loaded'].includes(window.__materialPhoto?.status)&&!document.getElementById('run').disabled);
  if(await page.evaluate(()=>window.__materialPhoto.status)!=='included')throw Error('No included result on arrival');
  report.arrivalMs=performance.now()-start;
  await Promise.all(sourceReads);
  for(const n of names)if(observed[n]!==createHash('sha256').update(await fs.readFile(path.join(root,'demos/material-photo',n))).digest('hex'))throw Error(`Wrong served ${n}`);
  report.browserSources=observed;
  const settle=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  for(const key of ['orb','celebration','bag']){
    await page.locator(`[data-sample=${key}]`).click();
    await page.waitForFunction(key=>window.__materialPhoto.status==='included'&&window.__materialPhoto.example?.sample===key,key);await settle();
    if(await page.evaluate(()=>window.__materialPhoto.runs.length)!==0)throw Error('Example browsing ran inference');
    for(const [width,height]of [[1440,900],[390,844]]){
      report.phase=`${key}-${width}`;await save();await page.setViewportSize({width,height});await settle();
      const frame=await page.evaluate(()=>{
        const hit=id=>{const e=document.getElementById(id),r=e.getBoundingClientRect(),at=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return e===at||e.contains(at);};
        const stage=document.querySelector('.stage').getBoundingClientRect();
        return{width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth,tuningHit:hit('tuning-toggle'),runHit:hit('run'),open:false,stage:{width:stage.width,height:stage.height},
          tiles:[...document.querySelectorAll('[data-tile]')].filter(t=>!t.hidden).map(t=>{const s=t.querySelector('.view-surface').getBoundingClientRect(),l=t.querySelector('button').getBoundingClientRect(),r=t.getBoundingClientRect();return{mode:t.dataset.tile,bottom:r.bottom,surface:{width:s.width,height:s.height,right:s.right,bottom:s.bottom},label:{top:l.top,bottom:l.bottom}};})};
      });validateLayoutFrame(frame);
      const file=path.join(out,`${key}-${width}.png`),bytes=await page.screenshot({path:file});
      const pixels=await page.evaluate(async uri=>{
        const b=await createImageBitmap(await(await fetch(uri)).blob()),c=new OffscreenCanvas(b.width,b.height),ctx=c.getContext('2d');ctx.drawImage(b,0,0);b.close();
        const {pixelSummary}=await import('./photo-contracts.js');
        return [...document.querySelectorAll('.view-surface')].map(e=>{const r=e.getBoundingClientRect(),w=Math.floor(r.width),h=Math.floor(r.height);return pixelSummary(ctx.getImageData(Math.floor(r.x),Math.floor(r.y),w,h).data,w,h);});
      },'data:image/png;base64,'+bytes.toString('base64'));
      if(pixels.some(p=>p.range<=12))throw Error('Blank included result');
      report.frames.push({sample:key,...frame,file,pixels});await save();
    }
  }
  await page.setViewportSize({width:1440,height:900});await settle();
  const before=await page.evaluate(()=>window.__materialPhotoActions.presentation());
  const box=await page.locator('[data-canvas=materials]').boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+50,box.y+box.height/2+20);await page.mouse.up();await settle();
  const moved=await page.evaluate(()=>window.__materialPhotoActions.presentation());
  if(JSON.stringify(before.camera.orbit)===JSON.stringify(moved.camera.orbit))throw Error('Included output cannot orbit');
  const ring=await page.locator('#light-ring').boundingBox();await page.mouse.click(ring.x+ring.width/2,ring.y+ring.height/2);await settle();
  report.interaction={before:before.light,after:await page.evaluate(()=>window.__materialPhotoActions.presentation().light),frame:path.join(out,'interactive.png')};await page.screenshot({path:report.interaction.frame});
  if(JSON.stringify(report.interaction.before)===JSON.stringify(report.interaction.after))throw Error('Included output cannot relight');
  const weights=report.requests.filter(url=>/weights|\.bin(?:\?|$)|\.safetensors/.test(url));
  if(weights.length)throw Error(`Browsing loaded model weights: ${JSON.stringify(weights)}`);
  report.finalState=await page.evaluate(()=>window.__materialPhoto);
  if(report.errors.length||report.finalState.gpuErrors?.length)throw Error('Browser errors');
  if(git(['rev-parse','HEAD'])!==report.source.commit)throw Error('Source moved');
  report.phase='complete';report.status='passed';
}catch(error){report.error=error.stack??String(error);process.exitCode=1;}
finally{await browser?.close();await save();console.log(JSON.stringify({status:report.status,phase:report.phase,error:report.error,report:path.join(out,'report.json')}));}
