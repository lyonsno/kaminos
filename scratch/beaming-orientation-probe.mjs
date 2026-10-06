import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const [origin,out]=process.argv.slice(2);
const executable='/Users/noahlyons/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const report={status:'running',phase:'launch',origin,executable,errors:[]};
await fs.mkdir(out,{recursive:true});
let browser;
try {
  report.runtime=await(await fetch(new URL('/api/runtime-config',origin))).json();
  const {chromium}=await import('/private/tmp/beaming-smoke-deps-1001/node_modules/playwright/index.mjs');
  browser=await chromium.launch({executablePath:executable,headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal']});
  const page=await browser.newPage({viewport:{width:256,height:256}});
  page.on('pageerror',e=>report.errors.push(String(e)));
  await page.goto(new URL('/api/runtime-config',origin).href);
  report.phase='native-material-orientation';
  report.probe=await page.evaluate(async()=>{
    const THREE=await import('/lib/three.webgpu.js');
    const {mountDistributedSceneRadiance}=await import('/scene-distributed-radiance.mjs');
    document.body.replaceChildren();document.body.style.margin='0';
    const renderer=new THREE.WebGPURenderer({antialias:false});renderer.setSize(256,256);renderer.toneMapping=THREE.NoToneMapping;
    document.body.append(renderer.domElement);await renderer.init();
    const target=new THREE.RenderTarget(256,256);renderer.setRenderTarget(target);
    const device=renderer.backend.device,errors=[];device.addEventListener('uncapturederror',e=>errors.push(String(e.error)));
    const adapter=device.adapterInfo;
    const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(45,1,.1,10);camera.position.set(0,0,3);camera.lookAt(0,0,0);
    const mesh=new THREE.Mesh(new THREE.PlaneGeometry(1,1),new THREE.MeshStandardMaterial({color:0x808080,side:THREE.DoubleSide,roughness:1,metalness:0}));
    mesh.castShadow=true;scene.add(mesh);
    let consume;
    const prototype={setSceneMediumSource(){},setSceneSourceFrameConsumer(fn){consume=fn;},setSceneDistributedLightFrame(){}};
    const mount=mountDistributedSceneRadiance({renderer,scene,prototype,device,directions:24,volumeGrid:2});
    const texture=device.createTexture({size:[4,8,4],dimension:'3d',format:'rgba32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
    const values=new Float32Array(4*8*4*4);for(let i=0;i<values.length;i+=4)values.set([1,.25,.1,0],i);
    device.queue.writeTexture({texture},values,{bytesPerRow:64,rowsPerImage:8},[4,8,4]);
    const rows=[];
    for(const name of ['original','winding','normals']) {
      if(name==='winding'){const a=mesh.geometry.index.array;for(let i=0;i<a.length;i+=3)[a[i+1],a[i+2]]=[a[i+2],a[i+1]];mesh.geometry.index.needsUpdate=true;}
      if(name==='normals'){const n=mesh.geometry.attributes.normal;for(let i=0;i<n.array.length;i++)n.array[i]*=-1;n.needsUpdate=true;}
      consume({source:{status:'encoded',texture,dimensions:[4,8,4],localMax:[1,3,1],generation:rows.length+1,frame:1}});
      await renderer.renderAsync(scene,camera);await device.queue.onSubmittedWorkDone();
      const read=await mount.readback();
      const pixels=await renderer.readRenderTargetPixelsAsync(target,0,0,256,256);
      const c=document.createElement('canvas');c.width=c.height=256;const ctx=c.getContext('2d');ctx.putImageData(new ImageData(new Uint8ClampedArray(pixels),256,256),0,0);
      const pixel=Array.from(ctx.getImageData(128,128,1,1).data);
      rows.push({name,pixel,surface:Array.from(read.surface.data.slice(0,16)),back:Array.from(read.surfaceBack.data.slice(0,16)),image:c.toDataURL()});
    }
    mount.dispose();texture.destroy();target.dispose();renderer.dispose();
    return {adapter:{vendor:adapter.vendor,architecture:adapter.architecture,description:adapter.description},rows,errors};
  });
  for(const row of report.probe.rows){await fs.writeFile(`${out}/${row.name}.png`,Buffer.from(row.image.split(',')[1],'base64'));delete row.image;}
  assert.match(JSON.stringify(report.probe.adapter),/apple/i,'native Apple route required');
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.probe.errors,[]);
  const [a,b,c]=report.probe.rows;
  assert.ok(a.pixel[0]>20,'fixture must receive measurable light');
  for(const row of [b,c])assert.ok(row.pixel.every((v,i)=>Math.abs(v-a.pixel[i])<=2),`${row.name} must preserve two-sided diffuse receiving: ${row.pixel} versus ${a.pixel}`);
  report.status='passed';report.phase='complete';
}catch(e){report.status='failed';report.error=String(e.stack||e);process.exitCode=1;}
finally {await fs.writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser?.close();}
