import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {buildTriangleVisibility} from '../scene-light-visibility.mjs';
const [url,out]=process.argv.slice(2);
assert.ok(url&&out,'name runtime URL and persistent output directory');
await fs.mkdir(out,{recursive:true});
const executable='/Users/noahlyons/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const report={status:'running',phase:'launch',url,executable,checks:[]};
const save=()=>fs.writeFile(`${out}/report.json`,JSON.stringify(report,null,2));
await save();let browser;
try {
  const {chromium}=await import('/private/tmp/beaming-smoke-deps-1001/node_modules/playwright/index.mjs');
  browser=await chromium.launch({executablePath:executable,headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal']});
  const page=await browser.newPage();await page.goto(new URL('/api/runtime-config',url).href);
  report.runtime=await page.evaluate(()=>JSON.parse(document.body.innerText));
  const plane=[{a:[0,-2,-2],b:[0,4,-2],c:[0,4,2]},{a:[0,-2,-2],b:[0,4,2],c:[0,-2,2]}];
  const oblique=plane.map(t=>Object.fromEntries(Object.entries(t).map(([k,p])=>[k,[.1-.3*p[1],p[1],p[2]]])));
  const corners=Array.from({length:8},(_,i)=>[(i&1)?.3:-.3,(i&2)?1.3:.7,(i&4)?.3:-.3]);
  const faces=[[0,1,3,2],[4,6,7,5],[0,4,5,1],[2,3,7,6],[0,2,6,4],[1,5,7,3]];
  const cage=faces.flatMap(([a,b,c,d])=>[{a:corners[a],b:corners[b],c:corners[c]},{a:corners[a],b:corners[c],c:corners[d]}]);
  report.fixtures=Object.fromEntries(Object.entries({empty:[],plane,oblique,reversed:plane.map(t=>({...t,b:t.c,c:t.b})),cage}).map(([name,triangles])=>{
    const p=buildTriangleVisibility(triangles).packGpu();return [name,{...p,nodes:Array.from(p.nodes),triangles:Array.from(p.triangles),
      // Preserve u32 escape/leaf words independently of f32 JSON subnormals.
      nodeWords:Array.from(new Uint32Array(p.nodes.buffer))}];
  }));
  report.phase='native-production-kernel';await save();
  report.signal=await page.evaluate(async fixtures=>{
    const {createPreparedSmoke}=await import('/scene-prepared-smoke.mjs');
    const {DISTRIBUTED_SMOKE_WGSL}=await import('/scene-smoke-reconstruction.mjs');
    const adapter=await navigator.gpu.requestAdapter();if(!adapter||adapter.isFallbackAdapter)throw new Error('native adapter required');
    const info={vendor:adapter.info.vendor,architecture:adapter.info.architecture,description:adapter.info.description,isFallbackAdapter:adapter.isFallbackAdapter};
    if(/swiftshader/i.test(JSON.stringify(info)))throw new Error('fallback not admitted');
    const device=await adapter.requestDevice(),errors=[],losses=[];
    device.addEventListener('uncapturederror',e=>errors.push(e.error.message));
    device.lost.then(i=>{if(i.reason!=='destroyed')losses.push({reason:i.reason,message:i.message});});
    device.pushErrorScope('validation');
    const shader=DISTRIBUTED_SMOKE_WGSL.replaceAll('@group(2)','@group(0)')+`
      @group(0) @binding(2) var<storage,read> query:array<vec4<f32>>;
      @group(0) @binding(3) var<storage,read_write> result:array<vec4<f32>>;
      @compute @workgroup_size(1) fn test(@builtin(global_invocation_id) id:vec3<u32>){result[id.x]=vec4<f32>(distributedMeanIncident(query[id.x].xyz),1);}`;
    const module=device.createShaderModule({code:shader});
    const compilation=await module.getCompilationInfo();if(compilation.messages.some(m=>m.type==='error'))throw new Error(JSON.stringify(compilation.messages));
    const pipeline=device.createComputePipeline({layout:'auto',compute:{module,entryPoint:'test'}});
    const rows=[];
    for(const [name,g] of Object.entries(fixtures)){
      const owned=[];let prepared;
      const buffer=(data,extra=0)=>{const b=device.createBuffer({size:Math.max(16,data.byteLength),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|extra});device.queue.writeBuffer(b,0,data);owned.push(b);return b;};
      try{
        const nodes=buffer(new Uint32Array(g.nodeWords)),triangles=buffer(new Float32Array(g.triangles));
        const source=device.createTexture({dimension:'3d',size:[2,4,2],format:'rgba32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});owned.push(source);
        prepared=createPreparedSmoke(device,{nodes,triangles,nodeCount:g.nodeCount,source,coarseDimensions:[2,4,2],factor:8});
        const positions=name==='cage'?[[0,1,0]]:name==='empty'?[[-.25,1.25,.1],[-1,-1,-1],[1,3,1],[0,3.01,0]]:name==='oblique'?[[-.35,0,0],[.45,0,0],[.1,0,0]]:[[-.2,1,0],[.2,1,0],[0,1,0]];
        const query=buffer(new Float32Array(positions.flatMap(p=>[...p,0]))),result=buffer(new Float32Array(positions.length*4),GPUBufferUsage.COPY_SRC);
        const read=device.createBuffer({size:positions.length*16,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});owned.push(read);
        const group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:prepared.texture.createView()},...[prepared.metadata.masks,query,result].map((b,i)=>({binding:i+1,resource:{buffer:b}}))]});
        const outputs=[];
        for(const scale of [1,2]){
          const data=new Float32Array(2*4*2*4);
          for(let z=0;z<2;z++)for(let y=0;y<4;y++)for(let x=0;x<2;x++){
            const v=name==='oblique'?((-.5+x)+.3*(-.5+y)<.1?2:100):(x?100:2);
            const rgb=name==='empty'?[1.5+x,2.5+y,3.5+z]:[v,v,v];
            data.set([...rgb.map(v=>v*scale),1],4*(x+2*(y+4*z)));
          }
          device.queue.writeTexture({texture:source},data,{bytesPerRow:32,rowsPerImage:4},[2,4,2]);
          const encoder=device.createCommandEncoder();prepared.encode(encoder);
          const pass=encoder.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(positions.length);pass.end();
          encoder.copyBufferToBuffer(result,0,read,0,positions.length*16);device.queue.submit([encoder.finish()]);
          await read.mapAsync(GPUMapMode.READ);outputs.push(Array.from(new Float32Array(read.getMappedRange())));read.unmap();
        }
        const {texture,masks,...metadata}=prepared.metadata;rows.push({name,positions,outputs,metadata});
      }finally{prepared?.destroy();for(const r of owned)r.destroy();}
    }
    const validation=await device.popErrorScope();device.destroy();return {adapter:info,rows,errors,losses,validation:validation?.message??null,shader};
  },report.fixtures);await save();
  assert.equal(report.signal.validation,null);assert.deepEqual(report.signal.errors,[]);assert.deepEqual(report.signal.losses,[]);
  assert.equal(report.signal.rows.length,5);assert.ok(report.fixtures.cage.nodeCount>1,'cage must exercise internal BVH escape traversal');
  for(const row of report.signal.rows){
    assert.equal(row.metadata.staticPreparations,1);assert.equal(row.metadata.updates,2);assert.equal(row.metadata.cameraTriangleTests,0);
    const expected=row.name==='cage'?[0,0,0,1]:row.name==='empty'?[1.75,4.25,4.1,1,1.5,2.5,3.5,1,2.5,5.5,4.5,1,0,0,0,1]:[2,2,2,1,100,100,100,1,0,0,0,1];
    for(let j=0;j<2;j++){
      assert.equal(row.outputs[j].length,expected.length);
      row.outputs[j].forEach((v,i)=>assert.ok(Number.isFinite(v)&&Math.abs(v-expected[i]*(i%4===3?1:j+1))<.0001,`${row.name} update${j} component${i}: ${v}`));
    }
    report.checks.push(`${row.name}: numerical boundary lookup, two live updates, one static preparation`);
  }
  report.status='passed';report.phase='complete';
}catch(e){report.status='failed';report.error=String(e.stack||e);process.exitCode=1;}
finally{await save();await browser?.close();}
console.log(JSON.stringify({status:report.status,phase:report.phase,error:report.error,out}));
