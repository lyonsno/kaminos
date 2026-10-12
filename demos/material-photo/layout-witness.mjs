import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {parseArgs} from 'node:util';
import {validateLayoutFrame} from './layout-checks.js';

const {values}=parseArgs({options:Object.fromEntries(['repo-root','expected-commit','output','chrome','playwright-module','reference','url'].map(name=>[name,{type:'string'}]))});
const out=path.resolve(values.output??'material-layout-witness');
const report={status:'failed',phase:'arguments',requested:values,frames:[],errors:[],route:'native WebGPU UI; retained SuperMat maps and synthetic depth; no inference timing or numerical claim'};
let browser;
const save=async()=>{await fs.mkdir(out,{recursive:true});await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));};
try{
  await save();
  for(const name of ['repo-root','expected-commit','chrome','playwright-module','reference','url'])if(!values[name])throw Error(`--${name} required`);
  const root=await fs.realpath(values['repo-root']),git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
  report.source={root,commit:git(['rev-parse','HEAD'])};
  if(report.source.commit!==values['expected-commit']||git(['status','--porcelain','--','demos/material-photo']))throw Error('Exact clean layout source required');
  const reference=JSON.parse(await fs.readFile(values.reference,'utf8'));
  if(reference.status!=='passed')throw Error('Retained inference reference did not pass');
  const episode=reference.episodes.find(row=>row.source==='Metal & glow'&&row.requestedSize===512);
  if(!episode?.rawEvidence)throw Error('Missing retained orb maps');
  const files={};report.reference={file:values.reference,source:reference.source,channels:{}};
  for(const name of ['albedo','roughness','metallic','orm']){
    const row=episode.rawEvidence[name],bytes=await fs.readFile(row.file);
    if(bytes.length!==row.width*row.height*4||createHash('sha256').update(bytes).digest('hex')!==row.sha256)throw Error(`Retained ${name} drift`);
    files[name]=bytes;report.reference.channels[name]=row;
  }
  const executable=await fs.realpath(values.chrome);
  if(executable.includes('/Applications/Google Chrome.app/'))throw Error('GUI Chrome is not an isolated executable');
  const {chromium}=await import(values['playwright-module']);
  browser=await chromium.launch({executablePath:executable,headless:true,args:['--enable-unsafe-webgpu']});
  report.browser={executable,version:browser.version()};
  const page=await browser.newPage({viewport:{width:1440,height:857}});
  page.setDefaultTimeout(0);page.setDefaultNavigationTimeout(0);
  page.on('pageerror',error=>report.errors.push(String(error)));
  const identity={...episode.state.identity.supermat,layoutReplay:true};
  // Interception is confined to this isolated browser. Operator server serves
  // unmodified producers; the report names the replay rather than fresh inference.
  await page.route('**/moge-producer.js',route=>route.fulfill({contentType:'text/javascript',body:`
    export class MoGeInference {async init(){this.useRealWeights=true;this.weightsSource='local';}async dispose(){}
    async run(){const width=64,height=64,depth=new Float32Array(width*height),normals=new Float32Array(width*height*3);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=y*width+x,u=(x/(width-1)-.5)*2,v=(y/(height-1)-.5)*2;
    depth[i]=1-.15*Math.exp(-3*(u*u+v*v));normals.set([u*.3,v*.3,-1],i*3);}return {width,height,depth,normals};}}
  `}));
  await page.route('**/supermat-route.js',route=>route.fulfill({contentType:'text/javascript',body:`
    export const SUPERMAT_ROUTE_ID='supermat.image-to-pbr.webgpu-local.v0';
    export const superMatDeviceOptions=async()=>({});
    export async function createSuperMatAdapter(){return {identity:${JSON.stringify(identity)},async run({size}){
    if(size!==512)throw Error('Layout replay supports retained512 only');const maps={};
    for(const name of ['albedo','roughness','metallic','orm'])maps[name]={width:512,height:512,data:new Uint8ClampedArray(await(await fetch('/__layout-fixture/'+name)).arrayBuffer())};
    return {width:512,height:512,maps,timings:{},dutyCount:0,layoutReplay:true};}};}
  `}));
  await page.route('**/__layout-fixture/*',route=>{
    const name=new URL(route.request().url()).pathname.split('/').at(-1);
    return files[name]?route.fulfill({contentType:'application/octet-stream',body:files[name]}):route.abort();
  });
  report.phase='page';await save();await page.goto(values.url);
  const source=await(await fetch(new URL('main.js',values.url))).text();
  if(source!==await fs.readFile(path.join(root,'demos/material-photo/main.js'),'utf8'))throw Error('Wrong served source');
  await page.waitForFunction(()=>window.__materialPhoto?.status==='loaded');
  await page.evaluate(()=>window.__materialPhotoActions.infer());
  if(await page.evaluate(()=>window.__materialPhoto.status)!=='done')throw Error('Display replay failed');
  const settle=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  for(const width of [1440,2048,1000,390]){
    await page.setViewportSize({width,height:width===390?844:width===2048?1280:857});await settle();
    for(const open of [false,true]){
      if(await page.locator('#controls').isVisible()!==open)await page.locator('#tuning-toggle').click();
      await settle();
      const frame=await page.evaluate(()=>{
        const hit=id=>{const e=document.getElementById(id),r=e.getBoundingClientRect(),at=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return e===at||e.contains(at);};
        const stage=document.querySelector('.stage').getBoundingClientRect();
        return {width:innerWidth,height:innerHeight,layout:document.getElementById('scene').dataset.layout,overflow:document.documentElement.scrollWidth>innerWidth,
        tuningHit:hit('tuning-toggle'),runHit:hit('run'),stage:{width:stage.width,height:stage.height},
        tiles:[...document.querySelectorAll('[data-tile]')].filter(tile=>!tile.hidden).map(tile=>{const s=tile.querySelector('.view-surface').getBoundingClientRect(),l=tile.querySelector('button').getBoundingClientRect(),r=tile.getBoundingClientRect();
        return{mode:tile.dataset.tile,bottom:r.bottom,surface:{width:s.width,height:s.height,right:s.right,bottom:s.bottom},label:{top:l.top,bottom:l.bottom}};})};
      });
      validateLayoutFrame(frame);
      const image=path.join(out,`comparison-${width}-${open?'tuning':'full'}.png`),bytes=await page.screenshot({path:image});
      const pixels=await page.evaluate(async({uri,tiles})=>{
        const bitmap=await createImageBitmap(await(await fetch(uri)).blob()),canvas=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=canvas.getContext('2d');
        ctx.drawImage(bitmap,0,0);bitmap.close();
        return tiles.map(tile=>{const data=ctx.getImageData(Math.floor(tile.left),Math.floor(tile.top),Math.floor(tile.width),Math.floor(tile.height)).data;let low=255,high=0;
        for(let i=0;i<data.length;i++)if(i%4!==3){low=Math.min(low,data[i]);high=Math.max(high,data[i]);}return{low,high,range:high-low};});
      },{uri:'data:image/png;base64,'+bytes.toString('base64'),tiles:await page.locator('.view-surface').evaluateAll(elements=>elements.map(e=>{const r=e.getBoundingClientRect();return{left:r.left,top:r.top,width:r.width,height:r.height};}))});
      if(pixels.some(pixel=>pixel.range<=12))throw Error('Blank rendered pane');
      report.frames.push({...frame,open,image,pixels});await save();
    }
  }
  await page.setViewportSize({width:1440,height:857});await settle();
  const orbit=await page.evaluate(()=>window.__materialPhotoActions.presentation().camera.orbit);
  const ring=await page.locator('#light-ring').boundingBox();
  await page.mouse.click(ring.x+ring.width/2,ring.y+ring.height/2);await settle();
  const center=await page.evaluate(()=>window.__materialPhotoActions.presentation());
  if(Math.hypot(center.light.x,center.light.y)>.02||JSON.stringify(center.camera.orbit)!==JSON.stringify(orbit))throw Error('Light center restricted or changed orbit');
  report.centerLight=center.light;
  const canvas=await page.locator('[data-canvas=original]').boundingBox();
  await page.mouse.move(canvas.x+canvas.width/2,canvas.y+canvas.height/2);await page.mouse.down();
  await page.mouse.move(canvas.x+canvas.width/2+40,canvas.y+canvas.height/2+20);await page.mouse.up();await settle();
  report.rotated=await page.evaluate(()=>window.__materialPhotoActions.presentation().comparison);
  const orbits=Object.values(report.rotated.views).map(view=>view.camera.orbit);
  if(JSON.stringify(orbits[0])===JSON.stringify(orbit)||orbits.some(value=>JSON.stringify(value)!==JSON.stringify(orbits[0])))throw Error('Orbit did not move all views together');
  await page.screenshot({path:path.join(out,'rotated-comparison.png')});
  await page.locator('[data-focus=materials]').click();await settle();
  if(await page.locator('[data-tile]:visible').count()!==1)throw Error('Focus did not enlarge one view');
  await page.screenshot({path:path.join(out,'focused-materials.png')});
  if(report.errors.length||await page.evaluate(()=>window.__materialPhoto.gpuErrors?.length??0))throw Error('Browser/GPU error');
  if(git(['rev-parse','HEAD'])!==report.source.commit)throw Error('Source moved during layout witness');
  report.status='passed';report.phase='complete';
}catch(error){report.error=String(error.stack??error);process.exitCode=1;}
finally{await browser?.close();await save();console.log(JSON.stringify({status:report.status,phase:report.phase,error:report.error,report:path.join(out,'report.json')}));}
