import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {parseArgs} from 'node:util';
import {verifyAuthoringServer} from './scene-authoring-witness-identity.mjs';
import {decodeScreenshotPngRgb} from './screenshot-png-rgb.mjs';
const options={...Object.fromEntries(['root','origin','out','chrome','playwright','source-report'].map(k=>[k,{type:'string'}])),native:{type:'boolean',default:false}};
// Recover the caller's destination before strict parsing can reject another argument.
const loose=parseArgs({strict:false,allowPositionals:true,options:{out:{type:'string'}}}).values;
const out=path.resolve(typeof loose.out==='string'?loose.out:'photo-scene-witness'),report={status:'failed',phase:'arguments',requestedArgs:process.argv.slice(2),errors:[],observations:{}};
let v;
const hash=b=>createHash('sha256').update(b).digest('hex');
let browser,page;
const save=async()=>{await fs.mkdir(out,{recursive:true});await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));};
try{
  await save();v=parseArgs({options}).values;report.requested=v;
  report.route=v.native?'native page inference through ordinary Generate/Add/save':'retained native arrays through ordinary Generate/Add/save; no inference';
  for(const key of ['root','origin','out','chrome','playwright'])assert.ok(v[key],`--${key} required`);
  assert.ok(v.native?!v['source-report']:v['source-report'],'choose native inference OR a retained source report');
  report.phase='source';report.server=await verifyAuthoringServer({origin:v.origin,repoRoot:v.root});
  report.sourceHashes={};for(const file of ['authoring-material-photo.mjs','models/material-photo/photograph-glb.js','authoring-trellis-generation.mjs','authoring-assets.mjs','authoring-generate-layout.mjs']){
    const local=await fs.readFile(path.join(v.root,file)),served=Buffer.from(await(await fetch(v.origin+'/'+file)).arrayBuffer());
    assert.equal(hash(served),hash(local),`wrong served ${file}`);report.sourceHashes[file]=hash(local);
  }
  const producerBytes=v.native?null:await fs.readFile(v['source-report']);
  const producer=producerBytes?JSON.parse(producerBytes):null,raw=producer?.application?.raw?.baseline;
  if(producer)report.producer={path:path.resolve(v['source-report']),sha256:hash(producerBytes),source:producer.source,input:producer.input??null,status:producer.status,phase:producer.phase};
  if(!v.native)assert.ok(raw,'native baseline required');report.raw={};const buffers={};
  for(const role of v.native?[]:['geometry-points','geometry-normals','image','albedo','orm']){
    const item=raw[role];assert.ok(item,`missing ${role}`);const bytes=await fs.readFile(item.file);
    assert.equal(bytes.length,item.byteLength);assert.equal(hash(bytes),item.sha256);buffers[role]=bytes;report.raw[role]=item;
  }
  const executable=await fs.realpath(v.chrome);assert.ok(!executable.includes('/Applications/Google Chrome.app/'),'independent browser required');
  const {chromium}=await import(v.playwright);
  browser=await chromium.launch({executablePath:executable,headless:true,args:['--use-mock-keychain','--password-store=basic']});
  report.browser={executable,version:browser.version()};page=await browser.newPage({viewport:{width:1440,height:1000}});
  page.setDefaultTimeout(0);page.setDefaultNavigationTimeout(0);page.on('pageerror',e=>report.errors.push(String(e)));
  const entry=await fs.readFile(path.join(v.root,'index.html'),'utf8'),marker='window.kaminosSceneObjectDebugState = function() {';
  assert.equal(entry.split(marker).length,2,'scene observation injection point changed');
  const inspectedEntry=entry.replace(marker,'window.__photoWitnessObject = id => workingScene.objects.find(row => row.id === id)?.object;\n'+marker);
  report.sceneObservationModule={sourceSha256:hash(entry),effectiveSha256:hash(inspectedEntry),change:'Expose existing imported object for readback and temporary visibility control only'};
  await page.route(url=>url.origin===new URL(v.origin).origin&&['/','/index.html'].includes(url.pathname),route=>route.fulfill({body:inspectedEntry,contentType:'text/html'}));
  // Replay replaces only the native page adapter. Controller, export, persistence and scene entry are real.
  if(!v.native){
  const module=await fs.readFile(path.join(v.root,'authoring-material-photo.mjs'),'utf8');
  const shim=module.replace('export function createPagePhotographer(', 'function nativePagePhotographer(')+`
export function createPagePhotographer(){return async ({image,size,onProgress})=>{
 const manifest=await (await fetch('/__photo_witness/manifest')).json();
 const read=async role=>{const row=manifest[role],bytes=await(await fetch('/__photo_witness/'+role)).arrayBuffer();return {...row,data:new globalThis[row.type](bytes)};};
 const points=await read('geometry-points'),normals=await read('geometry-normals');
 const result={depth:{width:points.width,height:points.height,points:points.data,normals:normals.data},image:await read('image'),maps:{albedo:await read('albedo'),orm:await read('orm')}};
 if(size!==result.maps.albedo.width)throw Error('Replay resolution mismatch');
 const response=await fetch(image.source),source=await response.arrayBuffer();
 const bitmap=await createImageBitmap(new Blob([source]));
 const canvas=new OffscreenCanvas(bitmap.width,bitmap.height),context=canvas.getContext('2d');context.drawImage(bitmap,0,0);bitmap.close();
 const pixels=context.getImageData(0,0,canvas.width,canvas.height).data;
 if(canvas.width!==result.image.width||canvas.height!==result.image.height||pixels.length!==result.image.data.length||pixels.some((value,i)=>value!==result.image.data[i]))throw Error('Replay input mismatch: selected photograph differs from retained native input');
 onProgress({stage:'materials',phase:'exporting'});
 const generation={schema:'kaminos.asset-generation.v1',runId:'retained-native-photo-witness-'+crypto.randomUUID(),route:'retained-native-arrays',input:{source:image.source,sha256:await sha256(source),rgbaSha256:manifest.image.sha256},settings:{materialSize:size},receiptValidation:{ok:true,by:'retained-native-witness',checks:['raw-array-sha256','original-image-rgba-equality','replay-resolution','embedded-glb']}};
 return {glb:await photographGlb(result,{name:'Backpack - retained native output',receipt:generation}),generation,label:'Backpack - retained native output'};
};}
`;
  report.replayModule={sourceSha256:hash(module),effectiveSha256:hash(shim)};
  await page.route('**/authoring-material-photo.mjs',route=>route.fulfill({body:shim,contentType:'text/javascript'}));
  await page.route('**/__photo_witness/*',route=>{
    const role=new URL(route.request().url()).pathname.split('/').at(-1);
    return role==='manifest'?route.fulfill({json:raw}):buffers[role]?route.fulfill({body:buffers[role],contentType:'application/octet-stream'}):route.abort();
  });
  }
  report.phase='arrival';await save();await page.goto(v.origin+'/?workspace=authoring');
  await page.waitForFunction(()=>window.kaminosAssets&&window.kaminosSceneAuthoring&&window.__kaminosCompositionSetup?.status!=='failed');
  await page.evaluate(()=>window.kaminosAssets.open('generate'));
  await page.locator('#asset-mesh-model').selectOption('material-photo');await page.locator('#asset-photo-size').selectOption('512');
  assert.equal(await page.locator('#asset-photo-size-row').isVisible(),true);
  report.before=await page.evaluate(()=>window.kaminosSceneObjectDebugState());
  await page.evaluate(()=>window.kaminosAssets.select({kind:'image',source:'/demos/material-photo/images/bag.webp',name:'Backpack.webp'}));
  assert.equal(await page.locator('#asset-preparation-status').textContent(),'Original photograph');
  report.phase='generate';await save();
  report.result=await page.evaluate(()=>window.kaminosAssets.generate());
  assert.ok(report.result?.source);assert.equal(report.result.generation.route,v.native?'moge-supermat.material-photograph.webgpu.v0':'retained-native-arrays');
  if(v.native){report.host=await page.evaluate(async()=>{const host=await window.kaminosAppGpu();return {snapshot:host.snapshot(),unsettledRuns:host.unsettledRuns()};});assert.deepEqual(report.host.unsettledRuns,[]);}
  assert.deepEqual(await page.evaluate(()=>window.kaminosSceneObjectDebugState()),report.before,'generation must not insert');
  report.phase='add';await save();
  report.id=await page.evaluate(result=>window.kaminosAssets.add({...result,kind:'mesh'}),report.result);
  assert.ok(report.id);await page.evaluate(()=>window.kaminosAssets.close());
  await page.evaluate(()=>window.kaminosFrameSelected());
  const settle=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await settle();
  report.inserted=await page.evaluate(()=>window.kaminosSceneObjectDebugState());
  assert.equal(report.inserted.length,report.before.length+1);
  const shot=async name=>{
    const observed=await page.evaluate(id=>{
      const object=window.__photoWitnessObject(id),meshes=[];
      object?.traverse(child=>{if(child.isMesh){let visible=true;for(let node=child;node;node=node.parent)visible&&=node.visible!==false;
        meshes.push({visible,maps:(Array.isArray(child.material)?child.material:[child.material]).map(m=>({albedo:!!m?.map?.isTexture,metalness:!!m?.metalnessMap?.isTexture,roughness:!!m?.roughnessMap?.isTexture}))});}});
      return {visible:object?.visible===true,meshes};
    },report.id);
    assert.ok(observed.visible&&observed.meshes.some(m=>m.visible),'photograph is not visible');
    assert.ok(observed.meshes.every(m=>m.maps.length&&m.maps.every(t=>t.albedo&&t.metalness&&t.roughness)),'imported photograph lost material texture maps');
    await settle();await page.screenshot({path:path.join(out,name+'.png')});
    // Element screenshots include overlaid DOM; read the rendered bitmap itself.
    const capture=async suffix=>{
      const url=await page.evaluate(()=>{
        window.__kaminosRenderSceneForInspection();
        return document.querySelector('#kaminos-host-renderer-canvas').toDataURL('image/png');
      });
      assert.ok(url.startsWith('data:image/png;base64,'),'renderer capture returned no PNG');
      const bytes=Buffer.from(url.slice('data:image/png;base64,'.length),'base64');
      await fs.writeFile(path.join(out,name+suffix+'.png'),bytes);return decodeScreenshotPngRgb(bytes);
    };
    const shown=await capture('-canvas');
    let hidden;
    try{
      await page.evaluate(id=>{window.__photoWitnessObject(id).visible=false;window._kaminosDirty();},report.id);await settle();
      hidden=await capture('-hidden');
    }finally{await page.evaluate(id=>{window.__photoWitnessObject(id).visible=true;window._kaminosDirty();},report.id);await settle();}
    assert.equal(hidden.width,shown.width);assert.equal(hidden.height,shown.height);
    let changedPixels=0;for(let i=0;i<shown.width*shown.height;i++){
      if([0,1,2].some(c=>Math.abs(shown.pixels[i*shown.channels+c]-hidden.pixels[i*hidden.channels+c])>=16))changedPixels++;
    }
    assert.ok(changedPixels>Math.max(16,shown.width*shown.height*.001),'photograph contributes no visible canvas pixels');
    report.observations[name]={...observed,changedPixels,canvasPixels:shown.width*shown.height};return hash(shown.pixels);
  };
  report.front=await shot('front');
  report.phase='history';await page.evaluate(()=>window.kaminosSceneEdits.undo());
  assert.equal((await page.evaluate(()=>window.kaminosSceneObjectDebugState())).length,report.before.length);
  await page.evaluate(()=>window.kaminosSceneEdits.redo());
  assert.ok((await page.evaluate(()=>window.kaminosSceneObjectDebugState())).some(x=>x.id===report.id));
  await page.evaluate(id=>{window.kaminosSetSceneObjectTransform(id,{rotation:[0,.4,0]});window.kaminosFrameSelected();},report.id);
  report.oblique=await shot('oblique');assert.notEqual(report.front,report.oblique);
  report.pose=(await page.evaluate(()=>window.kaminosSceneObjectDebugState())).find(x=>x.id===report.id).transform;
  report.phase='save';await save();
  report.saved=await page.evaluate(id=>window.saveSceneAs({result:true,name:'Material Photograph - '+id}),report.id);
  assert.ok(report.saved?.url,'save returned no restore URL');
  report.phase='reopen';await page.goto(report.saved.url);await page.waitForFunction(id=>window.kaminosSceneObjectDebugState?.().some(x=>x.id===id),report.id);
  report.reopened=(await page.evaluate(()=>window.kaminosSceneAuthoring.read().objects)).find(x=>x.id===report.id);
  assert.deepEqual(report.reopened.transform,report.pose);assert.equal(report.reopened.generation?.runId,report.result.generation.runId);
  await shot('reopened');
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>window.kaminosFrameSelected());await shot('mobile');
  assert.deepEqual(report.errors,[]);report.status='passed';report.phase='complete';
}catch(error){report.error=String(error.stack??error);process.exitCode=1;if(page)await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});}
finally{await browser?.close();await save();console.log(JSON.stringify({status:report.status,phase:report.phase,error:report.error,out}));}
