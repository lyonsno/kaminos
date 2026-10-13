import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {parseArgs} from 'node:util';
import {createHash} from 'node:crypto';
import {validateLayoutFrame} from './layout-checks.js';
import {validateEpisode} from './witness-checks.js';

const {values}=parseArgs({options:{...Object.fromEntries(['repo-root','expected-commit','chrome','playwright-module','url','output','site-root','image','hosted-weights','manifest-sha256'].map(key=>[key,{type:'string'}])),generate:{type:'boolean',default:false}}});
const out=path.resolve(values.output??'example-display-witness');
const report={status:'failed',phase:'arguments',requested:values,route:'real included outputs; native WebGPU display; no inference',frames:[],requests:[],errors:[]};
const save=async()=>{await fs.mkdir(out,{recursive:true});await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));};
let browser;
try{
  await save();for(const key of ['repo-root','expected-commit','chrome','playwright-module','url','output'])if(!values[key])throw Error(`--${key} required`);
  const root=await fs.realpath(values['repo-root']),git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
  report.source={root,commit:git(['rev-parse','HEAD'])};
  if(report.source.commit!==values['expected-commit']||git(['status','--porcelain','--','demos/material-photo']))throw Error('Exact clean source required');
  if(values.image&&!values.generate)throw Error('Uploaded image requires --generate');
  if(values['hosted-weights']&&new URL(values.url).searchParams.has('weights'))throw Error('Hosted witness refuses a weight override');
  const executable=await fs.realpath(values.chrome);if(executable.includes('/Applications/Google Chrome.app/'))throw Error('Independent Chrome required');
  const {chromium}=await import(values['playwright-module']);browser=await chromium.launch({executablePath:executable,headless:true});
  report.browser={executable,version:browser.version(),args:[]};
  const page=await browser.newPage({viewport:{width:1440,height:900}});page.setDefaultTimeout(0);page.setDefaultNavigationTimeout(0);
  report.hostedRequests=[];
  page.on('request',r=>{report.requests.push(r.url());if(values['hosted-weights']&&r.url().startsWith(values['hosted-weights'])){
    const headers=r.headers();report.hostedRequests.push({url:r.url(),credentials:!!(headers.authorization||headers.cookie)});
  }});page.on('pageerror',e=>report.errors.push(String(e)));
  const sourceReads=[],observed={};
  const names=['index.html','main.js','style.css','included-examples.js','comparison-viewer.js','viewer.js'];
  page.on('response',r=>{const u=new URL(r.url()),n=path.basename(u.pathname);if(names.includes(n)&&u.href===new URL(n,values.url).href)sourceReads.push(r.body().then(b=>{observed[n]=createHash('sha256').update(b).digest('hex');}));});
  const start=performance.now();report.phase='arrival';await save();await page.goto(values.url);
  await page.waitForFunction(()=>['included','error','loaded'].includes(window.__materialPhoto?.status)&&!document.getElementById('run').disabled);
  if(await page.evaluate(()=>window.__materialPhoto.status)!=='included')throw Error('No included result on arrival');
  report.arrivalMs=performance.now()-start;
  await Promise.all(sourceReads);
  const servedDemo=values['site-root']?path.join(await fs.realpath(values['site-root']),'inference-kit','material-photo'):path.join(root,'demos','material-photo');
  for(const n of names)if(observed[n]!==createHash('sha256').update(await fs.readFile(path.join(servedDemo,n))).digest('hex'))throw Error(`Wrong served ${n}`);
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
  if(values.generate){
    report.route='real included outputs during fresh live WebGPU generation';report.phase='generation-loading';await save();
    let hosted=null;
    if(values['hosted-weights']){
      const packageInfo=await page.evaluate(async base=>{
        const deployment=await import('./deployment.js');
        if(!deployment.GENERATION_AVAILABLE||deployment.SUPERMAT_WEIGHTS_URL!==base)throw Error('Wrong effective hosted deployment');
        const response=await fetch(new URL('package.json',base));if(!response.ok)throw Error('Hosted manifest HTTP '+response.status);
        const bytes=await response.arrayBuffer(),digest=await crypto.subtle.digest('SHA-256',bytes);
        return{sha256:[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join(''),value:JSON.parse(new TextDecoder().decode(bytes))};
      },values['hosted-weights']);
      if(!values['manifest-sha256']||packageInfo.sha256!==values['manifest-sha256'])throw Error('Wrong hosted manifest bytes');
      const pack=packageInfo.value;
      if(pack.schema!=='supermat.browser-weight-package.v0'||pack.status!=='succeeded'||pack.resources.some(row=>!row.chunks))throw Error('Incompatible hosted chunk package');
      hosted={base:values['hosted-weights'],revision:pack.revision,files:pack.resources.flatMap(row=>Object.values(row.chunks.files))};
      report.hosted={...hosted,manifestSha256:packageInfo.sha256};
    }
    let source='Backpack';
    if(values.image){
      const file=await fs.realpath(values.image);source=path.basename(file);
      report.input={file,source,sha256:createHash('sha256').update(await fs.readFile(file)).digest('hex')};
      await page.locator('#file').setInputFiles(file);
      await page.waitForFunction(source=>window.__materialPhoto.source===source&&['loaded','error','cached'].includes(window.__materialPhoto.status),source);
      if(await page.evaluate(()=>window.__materialPhoto.status)!=='loaded')throw Error('Upload did not select a fresh image');
    }
    report.selectedSize=await page.locator('#material-size').inputValue();await save();
    const materialBefore=await page.evaluate(()=>window.__materialPhotoActions.presentation().physicalbaseline.activeMaterial?.mapUUID);
    await page.locator('#run').click();
    await page.waitForFunction(()=>window.__materialPhoto.job?.message?.includes('loading')||window.__materialPhoto.job?.status==='error');
    report.loading=await page.evaluate(()=>({state:window.__materialPhoto,presentation:window.__materialPhotoActions.presentation()}));
    if(report.loading.state.job.status!=='running'||(!values.image&&report.loading.presentation.physicalbaseline.activeMaterial.mapUUID!==materialBefore))throw Error('Loading did not preserve the displayed material');
    await page.screenshot({path:path.join(out,'during-loading.png')});
    await page.locator('[data-sample=orb]').click();
    await page.waitForFunction(()=>window.__materialPhoto.status==='included'&&window.__materialPhoto.example?.sample==='orb');
    const orbitBox=await page.locator('[data-canvas=materials]').boundingBox();
    const orbitBefore=await page.evaluate(()=>window.__materialPhotoActions.presentation().camera.orbit);
    await page.mouse.move(orbitBox.x+orbitBox.width/2,orbitBox.y+orbitBox.height/2);await page.mouse.down();
    await page.mouse.move(orbitBox.x+orbitBox.width/2+40,orbitBox.y+orbitBox.height/2+15);await page.mouse.up();await settle();
    report.during=await page.evaluate(()=>({state:window.__materialPhoto,presentation:window.__materialPhotoActions.presentation()}));
    if(report.during.state.job?.status!=='running'||report.during.state.job.source!==source||JSON.stringify(orbitBefore)===JSON.stringify(report.during.presentation.camera.orbit))throw Error('No live generation/browsing overlap');
    await page.screenshot({path:path.join(out,'during-browsing.png')});await save();
    report.phase='generation-completion';await save();
    await page.waitForFunction(()=>window.__materialPhoto.runs.length===1);
    report.completion=await page.evaluate(()=>window.__materialPhoto);await save();
    if(report.completion.job?.status!=='done'||report.completion.source!=='Metal & glow'||report.completion.status!=='included')throw Error('Generation failed or stole displayed example');
    await page.locator('#view-result').click();await page.waitForFunction(()=>window.__materialPhoto.status==='done');
    report.generated=await page.evaluate(()=>window.__materialPhoto);validateEpisode(report.generated,source,Number(report.selectedSize),hosted?{...hosted,requests:report.hostedRequests}:null);
    await page.screenshot({path:path.join(out,'generated-result.png')});
  }
  report.finalState=await page.evaluate(()=>window.__materialPhoto);
  if(report.errors.length||report.finalState.gpuErrors?.length)throw Error('Browser errors');
  if(git(['rev-parse','HEAD'])!==report.source.commit)throw Error('Source moved');
  report.phase='complete';report.status='passed';
}catch(error){report.error=error.stack??String(error);process.exitCode=1;}
finally{await browser?.close();await save();console.log(JSON.stringify({status:report.status,phase:report.phase,error:report.error,report:path.join(out,'report.json')}));}
