// Read-only angular inspection of a saved checkpoint in the actual Workbench.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {PerspectiveCamera,Vector3} from '../lib/three.core.js';
import {decodePNGBytes} from '../lod-mesh-bake.mjs';
const [url,out,executable]=process.argv.slice(2);
if(!url||!out||!executable)throw Error('URL, persistent output directory and independent Chromium required');
await fs.mkdir(out,{recursive:true});
const report={status:'running',phase:'launch',url,executable,scope:'saved-asset camera/light/source/student inspection; no performance measurement',poses:[],errors:[],consoleErrors:[]};
const publish=()=>fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
await publish();let context;
try{
 const {chromium}=await import(process.env.KAMINOS_PLAYWRIGHT_MODULE??'playwright-core');
 const profile=await fs.mkdtemp(path.join(os.tmpdir(),'trellis-angle-'));
 context=await chromium.launchPersistentContext(profile,{executablePath:executable,headless:true,viewport:{width:1500,height:1000},deviceScaleFactor:1,args:['--use-mock-keychain','--password-store=basic','--enable-unsafe-webgpu']});
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(m.text());});
 await page.goto(url,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.kaminosWorkbenchExperiments?.state().id==='trellis-support');
 report.runtime=await page.evaluate(()=>fetch('/api/runtime-config').then(r=>r.json()));
 assert.equal(report.runtime.source.repoRoot,process.cwd());
 report.renderer=await page.evaluate(()=>window.kaminosWorkbenchSceneState());assert.equal(report.renderer.rendererBackend,'webgpu');
 const read=()=>page.evaluate(()=>window.kaminosWorkbenchExperiments.read());report.initial=await read();assert.equal(report.initial.comparison.learnedAvailable,true);
 const rect=await page.evaluate(()=>{const r=[...document.querySelectorAll('canvas')].map(c=>c.getBoundingClientRect()).sort((a,b)=>b.width*b.height-a.width*a.height)[0];return {x:r.x,y:r.y,width:r.width,height:r.height};});
 const moves=[[0,0],[130,0],[130,60],[130,0],[130,-90],[130,0],[130,50]];
 report.phase='angle-sweep';await publish();
 for(let i=0;i<moves.length;i++){
  const [dx,dy]=moves[i];if(i){const before=(await read()).comparison.view;await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);await page.mouse.wheel(dx,dy);await page.waitForTimeout(400);assert.notDeepEqual((await read()).comparison.view,before,'Native trackpad input must actually move the camera');}
  const pose={input:{kind:'native trackpad wheel',dx,dy},states:[]};
  for(const mode of ['source','learned']){
   await page.getByRole('group',{name:'Section appearance',exact:true}).getByRole('button',{name:mode==='source'?'Source section':'Learned section',exact:true}).click();await page.waitForTimeout(400);
   const state=await read();assert.equal(state.comparison.requested,mode);assert.equal(state.comparison.checkpoint.sha256,report.initial.comparison.checkpoint.sha256);assert.deepEqual(state.sceneLights,report.initial.sceneLights);
   const file=path.join(out,`pose-${i}-${state.comparison.effective}.png`);await page.screenshot({path:file});
   const view=state.comparison.view,camera=new PerspectiveCamera(view.fov,rect.width/rect.height,view.near,view.far);camera.position.fromArray(view.position);camera.up.fromArray(view.up);camera.zoom=view.zoom;camera.lookAt(new Vector3().fromArray(view.target));camera.updateMatrixWorld();camera.updateProjectionMatrix();
   const center=new Vector3().fromArray(state.comparison.worldCenter).project(camera),sx=Math.round(rect.x+(center.x+1)*rect.width/2),sy=Math.round(rect.y+(1-center.y)*rect.height/2),image=await decodePNGBytes(await fs.readFile(file));
   assert.ok(sx>=2&&sy>=2&&sx<image.width-2&&sy<image.height-2,'Section center must remain in the captured view');
   const pixels=[];for(let y=-2;y<=2;y++)for(let x=-2;x<=2;x++){const at=((sy+y)*image.width+sx+x)*4;pixels.push(Array.from(image.rgba.subarray(at,at+3)));}
   const mean=[0,1,2].map(c=>pixels.reduce((sum,p)=>sum+p[c],0)/pixels.length);
   pose.states.push({mode,effective:state.comparison.effective,view,checkpoint:state.comparison.checkpoint,sourceIdentity:state.comparison.sourceIdentity,worldCenter:state.comparison.worldCenter,pixelCoordinate:[sx,sy],pixels,meanRGB:mean,greenExcess:mean[1]-(mean[0]+mean[2])/2,file});
  }
  assert.deepEqual(pose.states[0].view,pose.states[1].view);report.poses.push(pose);await publish();
 }
 assert.equal(report.errors.length,0);assert.equal(report.consoleErrors.length,0);report.status='passed';report.phase='complete';
}catch(e){report.status='failed';report.error=String(e.stack??e);process.exitCode=1;}
finally{await context?.close();await publish();console.log(JSON.stringify({status:report.status,phase:report.phase,out,error:report.error}));}
