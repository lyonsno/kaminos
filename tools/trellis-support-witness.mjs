// Direct, isolated saved-asset inspection; no timing or performance comparison.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const [url,out,executable]=process.argv.slice(2);
if(!url||!out||!executable)throw Error('usage: node tools/trellis-support-witness.mjs URL OUTPUT_DIRECTORY INDEPENDENT_CHROMIUM');
await fs.mkdir(out,{recursive:true});const report={schema:'kaminos.trellis-support-witness.v1',url,executable,classification:'lightweight saved asset and local geometry inspection; no performance claim',status:'running',phase:'launch',captures:[],consoleErrors:[],pageErrors:[]};
let browser,context,profile;const assets=[];
const persist=()=>fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
await persist();
try{
  report.phase='inspection-dependency';await persist();const {assertSupportInspection}=await import('../trellis-support-evidence.mjs');
  const {chromium}=await import(process.env.KAMINOS_PLAYWRIGHT_MODULE??'playwright-core');
  profile=await fs.mkdtemp(path.join(os.tmpdir(),'barycentric-support-browser-'));
  report.profile=profile;report.ownerPid=process.pid;await persist();
  context=await chromium.launchPersistentContext(profile,{executablePath:executable,headless:true,viewport:{width:1400,height:1000},deviceScaleFactor:1,args:['--use-mock-keychain','--password-store=basic','--enable-unsafe-webgpu']});browser=context.browser();
  const page=await context.newPage();page.on('pageerror',e=>report.pageErrors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(m.text());});
  page.on('response',r=>{if(r.url().includes('machined-graphite-finished.glb'))assets.push(r.body().then(b=>({url:r.url(),status:r.status(),bytes:b.length,sha256:crypto.createHash('sha256').update(b).digest('hex')}),e=>({url:r.url(),status:r.status(),bodyError:String(e)})));});
  report.phase='page-load';await page.goto(url,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.kaminosWorkbenchExperiments?.state().id==='trellis-support');
  report.phase='experiment-load';
  report.initial=await page.evaluate(()=>window.kaminosWorkbenchExperiments.read());assert.equal(report.initial.backend,'WebGPU');assert.ok(report.initial.candidate.sourcePatchTriangles>0);assert.equal(report.initial.candidate.supportTriangles,12);
  assert.equal(report.initial.sourceRoute.beautyLodEnabled,false,'the inspected source must not be substituted by automatic scene LOD');
  const invoke=(op,arg)=>page.evaluate(({op,arg})=>window.kaminosWorkbenchExperiments.invoke(op,arg),{op,arg});
  const candidate=JSON.stringify(await invoke('inspectCandidate'));report.candidateArtifact=path.join(out,'candidate.json');await fs.writeFile(report.candidateArtifact,candidate);report.candidateSha256=crypto.createHash('sha256').update(candidate).digest('hex');
  await invoke('frame');await page.waitForTimeout(1200);
  report.phase='controls';await page.getByLabel('Region X',{exact:true}).click();await page.getByLabel('Region X',{exact:true}).fill('.16');await page.getByLabel('Region X',{exact:true}).press('Enter');
  await page.waitForFunction(()=>{const text=document.querySelector('[data-trellis-support-status]')?.dataset.trellisSupportStatus;if(!text)return false;const s=JSON.parse(text);return !!s.error||(!s.pending&&s.origin[0]===.16);});
  report.changed=await page.evaluate(()=>window.kaminosWorkbenchExperiments.read());assert.equal(report.changed.region.origin[0],.16);assert.equal(report.changed.pending,false);assert.notDeepEqual(report.initial.candidate.sourceTriangleIds,report.changed.candidate.sourceTriangleIds);
  await invoke('setRegion',{origin:report.initial.region.origin});
  const shoot=async(name)=>{await page.waitForTimeout(700);const filename=path.join(out,name+'.png');await page.screenshot({path:filename});report.captures.push(filename);};
  await page.getByRole('button',{name:'Frame region',exact:true}).click();await page.getByRole('group',{name:'Display',exact:true}).getByRole('button',{name:'Region + outline',exact:true}).click();await shoot('region-partition');
  await page.getByRole('button',{name:'Probe region',exact:true}).click();await page.waitForFunction(()=>{const text=document.querySelector('[data-trellis-support-status]')?.dataset.trellisSupportStatus;if(!text)return false;const s=JSON.parse(text);return !!s.error||(!s.probePending&&s.probeSamples===9);});
  report.probe=(await page.evaluate(()=>window.kaminosWorkbenchExperiments.read())).probe;assert.equal(report.probe.backend,'WebGPU');assert.equal(report.probe.samples.length,9);for(const s of report.probe.samples){assert.equal(s.intersectsSupport,true);assert.ok(s.exit>=s.entry);assert.equal(s.entryBoundary?.supportFace,1);assert.equal(s.exitBoundary?.supportFace,0);for(const endpoint of [s.entryBoundary,s.exitBoundary]){assert.ok(endpoint.supportUV.every(v=>Number.isFinite(v)&&v>=0&&v<=1));}if(s.hit){assert.ok(s.sourceUV?.every(Number.isFinite));assert.ok(Math.hypot(...s.position.map((x,k)=>x-s.sourcePosition[k]))<1e-5);}}await fs.writeFile(path.join(out,'probe.json'),JSON.stringify(report.probe,null,2));await shoot('region-probes');
  report.phase='textured-lighting';report.lighting=await invoke('probeLighting');
  assert.equal(report.lighting.lightingPending,false);assert.equal(report.lighting.lighting.route,'textured-clipped-source-shared-transport');
  assert.equal(report.lighting.lighting.radiance.length,9);assert.ok(report.lighting.lighting.radiance.flat().every(Number.isFinite));assert.ok(report.lighting.lighting.radiance.some(v=>v.slice(0,3).some(c=>c>0)));
  // Independent CPU GGX evaluation using the separately observed hit normal and
  // material inputs; this catches a constant-material or lost-UV transport route.
  const dot=(a,b)=>a.reduce((v,x,i)=>v+x*b[i],0),norm=v=>v.map(x=>x/Math.hypot(...v));
  const bsdf=(s,light)=>{let n=s.vertexNormal??s.normal;const v=norm(s.direction.map(x=>-x)),l=norm(light);if(dot(n,v)<0)n=n.map(x=>-x);if(dot(n,v)<=0)n=s.normal;
    const nl=dot(n,l),nv=dot(n,v);if(nl<=0||nv<=0)return [0,0,0];const h=norm(v.map((x,k)=>x+l[k])),nh=Math.max(dot(n,h),0),vh=Math.max(dot(v,h),0),a=Math.max(.02,s.material.roughness**2),a2=a*a,D=a2/(Math.PI*(nh*nh*(a2-1)+1)**2),G=c=>2*c/(c+Math.sqrt(a2+(1-a2)*c*c)),metal=s.material.metalness;
    return s.material.linearBaseColor.map(c=>{const f0=.04*(1-metal)+c*metal,F=f0+(1-f0)*(1-vh)**5;return (c*(1-metal)*(1-F)/Math.PI+F*D*G(nl)*G(nv)/(4*nl*nv))*nl;});};
  report.lightingConformance={reference:'CPU direct GGX from separately queried original vertex normal and PBR point labels; one bounce, unit directional light, zero environment',rows:[],maxAbsoluteError:0};
  report.lighting.lighting.radiance.forEach((row,i)=>{const s=report.lighting.probe.samples[i],expected=s.hit?bsdf(s,report.lighting.lighting.lightDirection):[0,0,0],actual=row.slice(0,3),errors=actual.map((v,k)=>Math.abs(v-expected[k]));report.lightingConformance.rows.push({expected,actual,errors});report.lightingConformance.maxAbsoluteError=Math.max(report.lightingConformance.maxAbsoluteError,...errors);});
  assert.ok(report.lightingConformance.maxAbsoluteError<.002,'textured transport disagrees with source-hit lighting reference');
  await fs.writeFile(path.join(out,'lighting.json'),JSON.stringify({lighting:report.lighting,conformance:report.lightingConformance},null,2));await shoot('region-lighting');
  await invoke('setMode','source');await shoot('region-source');
  await invoke('setMode','support');await shoot('region-support');
  await invoke('setMode','lod');report.near=await invoke('setThreshold',1);assert.equal(report.near.effective,'source');report.far=await invoke('setThreshold',100000);assert.equal(report.far.effective,'support');
  await invoke('setMode','partition');await invoke('setThreshold',180);await invoke('frame');await shoot('whole-partition');
  assert.equal(report.probe.samples.filter(s=>s.hit).length,9,'the selected healthy plate patch must have nine local hits');
  for(const s of report.probe.samples)assert.ok(s.material?.linearBaseColor?.every(Number.isFinite),'source hits must include evaluated material-map labels');
  report.phase='source-provenance';report.assets=await Promise.all(assets);report.sourceBytes=await page.evaluate(async url=>{const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw Error('Source fetch failed');const b=await r.arrayBuffer();const hash=await crypto.subtle.digest('SHA-256',b);return {url:r.url,bytes:b.byteLength,sha256:Array.from(new Uint8Array(hash),v=>v.toString(16).padStart(2,'0')).join('')};},report.initial.sourceUrl);assert.equal(report.sourceBytes.sha256,'fb92b5218ec297d51020f6008c5b69779c544589aa56b2e22ecf399f7ad7c45d');assert.equal(report.initial.candidate.originalTriangles,187308);
  report.phase='material-conformance';const {decodePNGBytes}=await import('../lod-mesh-bake.mjs');const sourceResponse=await fetch(new URL(report.initial.sourceUrl,url));assert.ok(sourceResponse.ok);const payload=Buffer.from(await sourceResponse.arrayBuffer());assert.equal(crypto.createHash('sha256').update(payload).digest('hex'),report.sourceBytes.sha256);
  const jsonLength=payload.readUInt32LE(12),doc=JSON.parse(payload.subarray(20,20+jsonLength)),bin=28+jsonLength,pbr=doc.materials[0].pbrMetallicRoughness;
  assert.ok(!doc.extensionsUsed?.length,'this reference admits the selected extension-free fixture');
  const image=async info=>{const v=doc.bufferViews[doc.images[doc.textures[info.index].source].bufferView];return decodePNGBytes(payload.subarray(bin+(v.byteOffset??0),bin+(v.byteOffset??0)+v.byteLength));};const base=await image(pbr.baseColorTexture),mr=await image(pbr.metallicRoughnessTexture);
  const linear=x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4;
  const sample=(im,uv,srgb)=>{const [x,y]=uv.map((v,k)=>v*[im.width,im.height][k]-.5),ix=Math.floor(x),iy=Math.floor(y),tx=x-ix,ty=y-iy,out=[0,0,0];for(let a=0;a<2;a++)for(let b=0;b<2;b++){const xx=((ix+a)%im.width+im.width)%im.width,yy=((iy+b)%im.height+im.height)%im.height,w=(a?tx:1-tx)*(b?ty:1-ty);for(let k=0;k<3;k++){const v=im.rgba[(yy*im.width+xx)*4+k]/255;out[k]+=w*(srgb?linear(v):v);}}return out;};
  report.materialConformance={reference:'independent decoded GLB PNG LOD0 bilinear-repeat reference; compare against actual borrowed renderer textures',dimensions:[[base.width,base.height],[mr.width,mr.height]],rows:[],maxAbsoluteError:0};
  for(const s of report.probe.samples){const c=sample(base,s.sourceUV,true).map((v,k)=>v*(pbr.baseColorFactor?.[k]??1)),m=sample(mr,s.sourceUV,false),expected=[...c,m[1]*(pbr.roughnessFactor??1),m[2]*(pbr.metallicFactor??1)],actual=[...s.material.linearBaseColor,s.material.roughness,s.material.metalness],errors=actual.map((v,k)=>Math.abs(v-expected[k]));report.materialConformance.rows.push({sourceUV:s.sourceUV,expected,actual,errors});report.materialConformance.maxAbsoluteError=Math.max(report.materialConformance.maxAbsoluteError,...errors);}
  assert.ok(report.materialConformance.maxAbsoluteError<.0045,'actual renderer texture samples disagree with the source material reference');
  report.phase='curved-region';await page.getByRole('group',{name:'Plate region example',exact:true}).getByRole('button',{name:'Rolled edge',exact:true}).click();await page.waitForFunction(()=>{const text=document.querySelector('[data-trellis-support-status]')?.dataset.trellisSupportStatus;if(!text)return false;const s=JSON.parse(text);return !!s.error||(!s.pending&&s.origin[0]===.12);});
  report.rim=await invoke('probe');assert.deepEqual(report.rim.region.normal,[0,1,1]);assert.ok(report.rim.probe.samples.some(s=>s.hit)&&report.rim.probe.samples.some(s=>!s.hit),'the rolled rim must retain both material hits and genuine exits');for(const s of report.rim.probe.samples.filter(s=>s.hit))assert.ok(s.material.linearBaseColor.every(Number.isFinite));
  await fs.writeFile(path.join(out,'rim-candidate.json'),JSON.stringify(await invoke('inspectCandidate')));await fs.writeFile(path.join(out,'rim-probe.json'),JSON.stringify(report.rim.probe,null,2));await invoke('setMode','isolated');await invoke('frameRegion');await shoot('rim-isolated');await invoke('selectExample','panel');await invoke('setMode','partition');await invoke('frame');
  report.runtime=await page.evaluate(()=>fetch('/api/runtime-config').then(r=>r.json()));
  report.codeHashes={};for(const name of ['trellis-local-support.mjs','trellis-support-gpu.mjs','trellis-support-rays.mjs','trellis-source-material.mjs','trellis-surface-teacher.mjs','surface-teacher.mjs','surface-teacher-wgsl.mjs','surface-material-teacher.mjs','experiments/trellis-support.experiment.mjs']){
    const local=await fs.readFile(new URL('../'+name,import.meta.url)),response=await fetch(new URL('/'+name,url));assert.ok(response.ok,'served module unavailable');const served=Buffer.from(await response.arrayBuffer()),hash=b=>crypto.createHash('sha256').update(b).digest('hex');assert.equal(hash(local),hash(served),'served module differs from witness checkout');report.codeHashes[name]=hash(served);
  }
  report.final=await page.evaluate(()=>window.kaminosWorkbenchExperiments.read());
  report.phase='cleanup';await page.evaluate(()=>window.kaminosWorkbenchExperiments.close());
  report.restoredLod=await page.evaluate(()=>window.kaminosSceneLodBudget.read());assert.equal(report.restoredLod.enabled,report.initial.sourceRoute.previousBeautyLodEnabled,'closing the inspection must restore the page LOD setting');
  assertSupportInspection(report);
  report.status='passed';report.phase='complete';
}catch(e){report.status='failed';report.error=String(e.stack??e);process.exitCode=1;const page=context?.pages().at(-1);if(page)try{await page.screenshot({path:path.join(out,'failure.png')});report.failureText=await page.locator('body').innerText();}catch{} }
finally{await context?.close();await browser?.close();report.profile=profile;await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,phase:report.phase,error:report.error,out}));}
