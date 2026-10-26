// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
const witness=readFileSync(new URL('../material-photo-scene-witness.mjs',import.meta.url),'utf8');
const hash=b=>createHash('sha256').update(b).digest('hex');
test('ordinary repaint proof rejects a stopped frame loop even when inspection draws still work',async()=>{
  const start=witness.indexOf('const repaint=async (name,action)=>');
  assert.ok(start>=0,'navigation recovery requires a passive repaint observer');
  const code=witness.slice(start,witness.indexOf('\n  report.front=',start));
  let inspectionDraws=0,camera=0;
  const window={kaminosViewportShadingDebugState:()=>({lastRender:{sceneFrameCount:1}}),__kaminosRenderSceneForInspection(){inspectionDraws++;}};
  const document={querySelector:()=>({toDataURL:()=> 'data:image/png;base64,AAAA'})};
  const page={evaluate:async fn=>fn()};
  const repaint=new Function('page','window','document','settle','hash','path','out','assert','fs',code+';return repaint;')(
    page,window,document,async()=>{},hash,path,'unused',assert,{writeFile:async()=>{}});
  await assert.rejects(repaint('orbit',async()=>{camera++;}),/ordinary scene.*frame/i);
  assert.equal(camera,1);assert.equal(inspectionDraws,0,'inspection rendering cannot rescue a failed ordinary-frame observation');
});
test('photograph scene witness writes a failure before browser setup on missing inputs',()=>{
  const source=new URL('../material-photo-scene-witness.mjs',import.meta.url);
  assert.ok(existsSync(source),'scene witness missing');
  const out=mkdtempSync(join(tmpdir(),'photo-scene-witness-'));
  const run=spawnSync(process.execPath,[source.pathname,'--out',out],{encoding:'utf8'});
  assert.notEqual(run.status,0);
  const report=JSON.parse(readFileSync(join(out,'report.json')));
  assert.equal(report.status,'failed');assert.equal(report.phase,'arguments');assert.match(report.error,/required/);
});
test('unknown arguments also preserve a failure at the requested output',()=>{
  const out=mkdtempSync(join(tmpdir(),'photo-scene-arguments-'));
  const run=spawnSync(process.execPath,[new URL('../material-photo-scene-witness.mjs',import.meta.url).pathname,'--out',out,'--unknown-option'],{encoding:'utf8'});
  assert.notEqual(run.status,0);assert.ok(existsSync(join(out,'report.json')),'argument failure lost its report');
  const report=JSON.parse(readFileSync(join(out,'report.json')));
  assert.equal(report.phase,'arguments');assert.match(report.error,/unknown-option/);
});
for(const matches of [false,true])test(`replay ${matches?'accepts the matching':'rejects a different'} original photograph`,async()=>{
  const start=witness.indexOf('export function createPagePhotographer(){');
  const code=witness.slice(start,witness.indexOf('\n`;',start)).replace('export function','function');
  const retained=new Uint8Array([1,2,3,255]),selected=matches?retained:new Uint8Array([9,8,7,255]);
  const raw=Object.fromEntries(['geometry-points','geometry-normals','image','albedo','orm'].map(role=>[role,{width:1,height:1,type:'Uint8Array',sha256:hash(retained)}]));
  let exported=false;
  const fetch=async url=>({json:async()=>raw,arrayBuffer:async()=>retained.buffer,blob:async()=>({})});
  const factory=new Function('fetch','photographGlb','sha256','crypto','createImageBitmap','OffscreenCanvas',code+';return createPagePhotographer();')(
    fetch,async()=>{exported=true;return new Uint8Array();},async b=>hash(new Uint8Array(b)),{randomUUID:()=> 'test'},
    async()=>({width:1,height:1,close(){}}),class {constructor(width,height){this.width=width;this.height=height;}getContext(){return {drawImage(){},getImageData(){return {data:selected};}};}});
  const result=factory({image:{source:'/selected.webp'},size:1,onProgress(){}});
  if(matches){assert.equal((await result).generation.input.rgbaSha256,hash(retained));assert.equal(exported,true);}
  else {await assert.rejects(result,/Replay input mismatch/);assert.equal(exported,false,'mismatched image must not reach export');}
});
for(const defect of ['invisible','missing maps','no pixel contribution'])test(`scene observation rejects ${defect} despite a nonblank environment`,async()=>{
  const start=witness.indexOf('const shot=async name=>');
  const code=witness.slice(start,witness.indexOf('\n  report.front=',start));
  const texture=defect==='missing maps'?null:{isTexture:true};
  const material={map:texture,metalnessMap:texture,roughnessMap:texture};
  const object={visible:defect!=='invisible',traverse(cb){cb({isMesh:true,visible:true,material});}};
  const window={__photoWitnessObject:()=>object,_kaminosDirty(){},__kaminosRenderSceneForInspection(){}};
  const document={querySelector:()=>({toDataURL:()=> 'data:image/png;base64,AAEA'})};
  const page={evaluate:async(fn,arg)=>fn(arg),screenshot:async()=>Buffer.from('page'),locator:()=>({screenshot:async()=>Buffer.from('environment')})};
  const shot=new Function('page','window','document','settle','decodeScreenshotPngRgb','hash','path','out','assert','report','fs',code+';return shot;')(
    page,window,document,async()=>{},()=>({pixels:new Uint8Array([0,255,0]),width:1,height:1,channels:3}),hash,path,'unused',assert,{id:'photo',observations:{}},{writeFile:async()=>{}});
  await assert.rejects(shot('front'),defect==='invisible'?/visible/:defect==='missing maps'?/map|texture/i:/visible canvas pixels/);
});
test('changing DOM overlays cannot satisfy the photograph rotation comparison',async()=>{
  const start=witness.indexOf('const shot=async name=>');
  const code=witness.slice(start,witness.indexOf('\n  report.front=',start));
  const texture={isTexture:true},material={map:texture,metalnessMap:texture,roughnessMap:texture};
  const object={visible:true,traverse(cb){cb({isMesh:true,visible:true,material});}};
  let overlay=0,draws=0;
  const pixels=()=>Buffer.alloc(100*3,object.visible?90:0);
  const window={__photoWitnessObject:()=>object,_kaminosDirty(){},__kaminosRenderSceneForInspection(){draws++;}};
  const document={querySelector:()=>({toDataURL:()=> 'data:image/png;base64,'+pixels().toString('base64')})};
  const page={evaluate:async(fn,arg)=>fn(arg),screenshot:async()=>{overlay++;},locator:()=>({screenshot:async()=>{const bytes=pixels();bytes[0]=overlay;return bytes;}})};
  const shot=new Function('page','window','document','settle','decodeScreenshotPngRgb','hash','path','out','assert','report','fs',code+';return shot;')(
    page,window,document,async()=>{},bytes=>({pixels:bytes,width:10,height:10,channels:3}),hash,path,'unused',assert,{id:'photo',observations:{}},{writeFile:async()=>{}});
  const front=await shot('front'),unchanged=await shot('oblique');
  assert.equal(front,unchanged,'UI-only changes falsely established a changed render');
  assert.equal(draws,4,'capture must request a current renderer frame, including hidden controls');
});
