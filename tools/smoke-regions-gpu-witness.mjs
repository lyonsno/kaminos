import fs from 'node:fs/promises';import assert from 'node:assert/strict';
import {buildTriangleVisibility} from '../scene-light-visibility.mjs';
import {regionRaySample} from '../scene-source-regions.mjs';import {integrateCellRay} from '../scene-source-aware.mjs';import {sceneSourceDomain} from '../scene-volume-source.mjs';
const [origin,out]=process.argv.slice(2);assert(origin&&out);await fs.mkdir(out,{recursive:true});
const report={receiver:'beaming-frustum-fluffer',status:'running',phase:'launch',origin,repo:process.cwd(),executable:process.env.KAMINOS_TEST_BROWSER,checks:[]};const write=()=>fs.writeFile(out+'/report.json',JSON.stringify(report,null,2));await write();let browser;
const guides=[{id:'left',lo:[-.75,-.75,-.25],hi:[-.25,-.25,.25]},{id:'right',lo:[.25,.25,-.25],hi:[.75,.75,.25]}];
const values=new Float32Array(8**3*4);for(let z=0;z<8;z++)for(let y=0;y<8;y++)for(let x=0;x<8;x++){let e=0;if(x>=1&&x<=2&&y>=1&&y<=2&&z>=3&&z<=4)e=20;if(x>=5&&x<=6&&y>=5&&y<=6&&z>=3&&z<=4)e=2;if(x===1&&y===6&&z===7)e=3;values.set([e,.5*e,.25*e,.12],4*(x+8*(y+8*z)));}
const wall=[{a:[0,-100,-100],b:[0,100,-100],c:[0,100,100]},{a:[0,-100,-100],b:[0,100,100],c:[0,-100,100]}];
const pack=t=>{const p=buildTriangleVisibility(t).packGpu();return {...p,nodes:Array.from(p.nodes),nodeWords:Array.from(new Uint32Array(p.nodes.buffer)),triangles:Array.from(p.triangles)};};
report.input={dimensions:[8,8,8],values:Array.from(values),guides,geometry:{clear:pack([]),wall:pack(wall)}};await write();
try{
 const {chromium}=await import(process.env.KAMINOS_TEST_PLAYWRIGHT);browser=await chromium.launchPersistentContext(out+'/profile',{executablePath:report.executable,headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal','--use-mock-keychain','--password-store=basic']});const page=browser.pages()[0];page.setDefaultTimeout(0);await page.goto(origin+'/api/runtime-config');report.runtime=await page.evaluate(()=>JSON.parse(document.body.innerText));assert.equal(report.runtime.source.repoRoot,process.cwd());
 report.phase='production-gather';await write();report.signal=await page.evaluate(async input=>{
  const {createVolumeGather}=await import('/scene-volume-gather.mjs');const adapter=await navigator.gpu.requestAdapter();if(!adapter||adapter.info.isFallbackAdapter!==false)throw Error('explicit native adapter required');const info={vendor:adapter.info.vendor,architecture:adapter.info.architecture,isFallbackAdapter:adapter.info.isFallbackAdapter};const device=await adapter.requestDevice();const errors=[],losses=[];device.addEventListener('uncapturederror',e=>errors.push(e.error.message));device.lost.then(e=>{if(e.reason!=='destroyed')losses.push(e.message);});device.pushErrorScope('validation');const rows=[];
  for(const [name,g]of Object.entries(input.geometry)){
   const geometry={...g,nodes:new Float32Array(new Uint32Array(g.nodeWords).buffer),triangles:new Float32Array(g.triangles)};const gather=createVolumeGather(device,{geometry,receivers:[],volumeGrid:4,sourceDimensions:[8,8,8],smokeRefinement:1,directions:24,angularPattern:'regions'});gather.setSourceRegions(input.guides);
   const texture=device.createTexture({size:[8,8,8],dimension:'3d',format:'rgba32float',usage:GPUTextureUsage.COPY_DST|GPUTextureUsage.TEXTURE_BINDING});const sky=device.createTexture({size:[1,1],format:'rgba16float',usage:GPUTextureUsage.COPY_DST|GPUTextureUsage.TEXTURE_BINDING});device.queue.writeTexture({texture:sky},new Uint16Array([0x3800,0x3800,0x3800,0x3c00]),{bytesPerRow:8},[1,1]);
   try{
    let frame=0;for(const [count,scale,environment]of [[24,1,false],[48,1,false],[24,2,false],[24,0,false],[24,0,true]]){
     const data=new Float32Array(input.values);for(let i=0;i<data.length;i++)if(i%4!==3)data[i]*=scale;else if(environment)data[i]=0;
     device.queue.writeTexture({texture},data,{bytesPerRow:128,rowsPerImage:8},[8,8,8]);gather.setDirections(count);
     const metadata=gather.encode({status:'encoded',texture,dimensions:[8,8,8],generation:++frame,frame},{environment:environment?{texture:sky}:null});await device.queue.onSubmittedWorkDone();const result=await gather.readback();const {texture:t,masks,planes,...smokeReconstruction}=metadata.smokeReconstruction;
     rows.push({name,count,scale,environment,metadata:{...metadata,smokeReconstruction},smoke:{dimensions:result.smoke.dimensions,data:Array.from(result.smoke.data)}});
    }
   }finally{gather.destroy();texture.destroy();sky.destroy();}
  }
  const validation=await device.popErrorScope();device.destroy();return {info,rows,errors,losses,validation:validation?.message??null};
 },report.input);await write();assert.equal(report.signal.validation,null);assert.deepEqual(report.signal.errors,[]);assert.deepEqual(report.signal.losses,[]);
 const domain=sceneSourceDomain([8,8,8]);for(const row of report.signal.rows){
  const trace=buildTriangleVisibility(row.name==='wall'?wall:[]);let error=0,peak=0;
  assert.equal(row.metadata.angularPattern,'regions');assert.equal(row.metadata.directions,row.count);assert.equal(row.metadata.sourceGuide.regions.length,2);assert.equal(row.smoke.data.length,256);
  if(!row.environment)for(let z=0;z<4;z++)for(let y=0;y<4;y++)for(let x=0;x<4;x++){
   const p=[x,y,z].map(v=>-1+(v+.5)*.5),expected=[0,0,0];
   for(let i=0;i<row.count;i++){const ray=regionRaySample(p,i,guides,row.count,{domain,grid:4}),hit=trace.trace(p,ray.direction),radiance=integrateCellRay(cell=>{const a=4*(cell[0]+8*(cell[1]+8*cell[2]));return [values[a]*row.scale,values[a+1]*row.scale,values[a+2]*row.scale,values[a+3]];},[8,8,8],p,ray.direction,hit?.distance??Infinity);for(let c=0;c<3;c++)expected[c]+=radiance[c]/(4*Math.PI*row.count*ray.pdf);}
   const at=4*(x+4*(y+4*z));for(let c=0;c<3;c++){error=Math.max(error,Math.abs(expected[c]-row.smoke.data[at+c]));peak=Math.max(peak,Math.abs(expected[c]));}
  }
  row.cpuError=error;assert(error/Math.max(1,peak)<.0002,`${row.name}/${row.count}/${row.scale} CPU replay error ${error}, peak ${peak}`);
  if(row.environment)for(let i=0;i<row.smoke.data.length;i++)if(i%4!==3)assert(Math.abs(row.smoke.data[i]-(row.name==='wall'?.25:.5))<.0001,'constant sky energy must survive source-directed ray allocation');
  if(row.scale===0&&!row.environment)assert(row.smoke.data.every((x,i)=>i%4===3||x===0),'zero emission produces exactly zero radiance');
  report.checks.push(`${row.name}/${row.count}/${row.scale}/sky${row.environment}: actual gather, CPU ray/mixture replay, finite outputs`);
 }
 for(const name of ['clear','wall']){const rows=report.signal.rows.filter(r=>r.name===name);assert.equal(rows[0].metadata.angularCache.preparedRayDirections,24);assert.equal(rows[1].metadata.angularCache.preparedRayDirections,48);assert.equal(rows[2].metadata.angularCache.preparedRayDirections,48,'emission changes and lower counts reuse solid visibility');rows[0].smoke.data.forEach((v,i)=>{if(i%4!==3)assert(Math.abs(rows[2].smoke.data[i]-2*v)<.0001,'same rays scale linearly with emission');});}
 report.status='passed';report.phase='complete';
}catch(e){report.status='failed';report.failure=String(e.stack||e);process.exitCode=1;}finally{await browser?.close();await write();console.log(JSON.stringify({status:report.status,phase:report.phase,failure:report.failure?.split('\n')[0]}));}
