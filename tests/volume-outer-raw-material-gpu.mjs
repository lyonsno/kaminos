// Actual exterior kernels and the landed fine hook's padded rgba32float format.
// Synthetic fields, not a live fine/flame consumer or a performance claim.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createOuterSmoke,outerSmokeConfig} from '../volume-outer-smoke.mjs';
import {passiveMaterialSurvival,passiveHeatToSmokeRate} from '../volume-passive-material.mjs';
import {packSolidTextureRows} from '../volume-scene-solid.mjs';
const [native,out]=process.argv.slice(2);assert.ok(native&&out);
mkdirSync(out,{recursive:true});
const report={schema:'outer-authored-raw-native-v0',phase:'adapter',passed:false,cases:[]};
const persist=()=>writeFileSync(resolve(out,'report.json'),JSON.stringify(report,null,2));
let device;const owned=[];
try{
 report.source={root:resolve(new URL('..',import.meta.url).pathname),revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),files:Object.fromEntries(['volume-outer-smoke.mjs','volume-passive-material.mjs','tests/volume-outer-raw-material-gpu.mjs'].map(f=>[f,createHash('sha256').update(readFileSync(new URL('../'+f,import.meta.url))).digest('hex')]))};persist();
 const {create,globals}=await import(pathToFileURL(resolve(native)));Object.assign(globalThis,globals);
 globalThis.__outerRawGPU=create(['backend=metal']);const adapter=await globalThis.__outerRawGPU.requestAdapter();assert.ok(adapter,'Metal adapter required');
 device=await adapter.requestDevice();report.route={backend:'metal',vendor:adapter.info.vendor,architecture:adapter.info.architecture,native:resolve(native),fineProducer:'synthetic',coarseProducer:'createOuterSmoke',ghostConsumer:'texture copy readback; fine consumer not exercised'};
 const errors=[];device.addEventListener('uncapturederror',e=>errors.push(e.error.message));
 const c=outerSmokeConfig({grid:8,extent:2,nearHeightRatio:1}),n=8,shape=c.shape.map(v=>v+1),count=shape.reduce((a,b)=>a*b,1);
 const input=new Float32Array(n**3*16);
 for(let i=0;i<input.length;i+=16){input[i+4]=.4;input[i+5]=.8;input[i+6]=.3;input[i+7]=.5;input[i+12]=.2;}
 const fine=device.createBuffer({size:input.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});owned.push(fine);device.queue.writeBuffer(fine,0,input);
 const textures=()=>Object.fromEntries(['a','b'].map(name=>{const t=device.createTexture({size:shape,dimension:'3d',format:'rgba32float',usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC});owned.push(t);return [name,t];}));
 const readTexture=async texture=>{
   const bytesPerRow=Math.ceil(shape[0]*16/256)*256,size=bytesPerRow*shape[1]*shape[2];
   const b=device.createBuffer({size,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
   try{const e=device.createCommandEncoder();e.copyTextureToBuffer({texture},{buffer:b,bytesPerRow,rowsPerImage:shape[1]},shape);device.queue.submit([e.finish()]);await b.mapAsync(GPUMapMode.READ);
     const padded=new Float32Array(b.getMappedRange()),data=new Float32Array(count*4);
     for(let z=0;z<shape[2];z++)for(let y=0;y<shape[1];y++)data.set(padded.subarray((z*shape[1]+y)*bytesPerRow/4,(z*shape[1]+y)*bytesPerRow/4+shape[0]*4),(z*shape[1]+y)*shape[0]*4);
     return data;
   }finally{b.destroy();}
 };
 const outputs={};
 for(const mode of ['authored-raw','optical-only']){
   const captured=[],allocate=device.createBuffer.bind(device);
   device.createBuffer=d=>{const b=allocate(d);if(d.label?.startsWith('outer smoke state '))captured.push(b);return b;};
   let outer;try{outer=createOuterSmoke(device,{...c,materialMode:mode},n,[fine,fine]);}finally{device.createBuffer=allocate;}
   try{
     report.phase=`${mode}-compile`;assert.deepEqual([...(await outer.shader.getCompilationInfo()).messages].filter(m=>m.type==='error'),[]);
     assert.equal(captured.length,2);const seed=new Float32Array(count*8);
     for(let i=0;i<seed.length;i+=8){seed[i+4]=.54;seed[i+5]=.8;if(mode==='authored-raw'){seed[i+3]=.4;seed[i+6]=.3;}}
     for(const b of captured)device.queue.writeBuffer(b,0,seed);outer.clearSolids();
     const e=device.createCommandEncoder();outer.encodeExternalProjection(e,0,{dtScale:.25,backtraceScale:0},()=>{},0);device.queue.submit([e.finish()]);
     const state=await outer.readState();outputs[mode]=state;writeFileSync(resolve(out,`${mode}.f32`),new Uint8Array(state.buffer));
     if(mode==='authored-raw'){
       report.phase='raw-material-law';const bounds=outer.receipt().donorBounds,s=passiveMaterialSurvival(.25);let donors=0,exterior=0;
       for(let z=0;z<shape[2];z++)for(let y=0;y<shape[1];y++)for(let x=0;x<shape[0];x++){
         const i=(x+shape[0]*(y+shape[1]*z))*8,p=[x,y,z].map((v,a)=>c.min[a]+(v+.5)*c.cellWidth),inside=x<c.shape[0]&&y<c.shape[1]&&z<c.shape[2],donor=inside&&p.every((v,a)=>v>bounds.min[a]&&v<bounds.max[a]);
         const heat=donor?.8:Math.fround(.8)*s.heat,raw=inside?(donor?.4:Math.fround(.4)*s.smoke+passiveHeatToSmokeRate(heat,p[1])*.25):0;
         assert.ok(Math.abs(state[i+3]-raw)<2e-6,`raw soot differs at ${x},${y},${z}: ${state[i+3]} vs ${raw}`);
         assert.ok(Math.abs(state[i+6]-(inside?.3:0))<2e-6,'passive fuel survives without reaction');assert.equal(state[i+7],0,'oxidizer absent, not invented');if(inside)donor?donors++:exterior++;
       }
       assert.ok(donors&&exterior);
       report.phase='ghost-export';const t=textures(),e=device.createCommandEncoder();
       assert.throws(()=>outer.encodeGhostSnapshot(e,{a:t.a,b:t.a}),/distinct/);
       const wrong=device.createTexture({size:[1,1,1],dimension:'3d',format:'rgba32float',usage:GPUTextureUsage.STORAGE_BINDING});owned.push(wrong);
       assert.throws(()=>outer.encodeGhostSnapshot(e,{a:wrong,b:t.b}),/shape/);
       const receipt=outer.encodeGhostSnapshot(e,t);device.queue.submit([e.finish()]);
       const a=await readTexture(t.a),b=await readTexture(t.b);
       for(let i=0;i<count;i++)for(let k=0;k<4;k++){assert.equal(a[i*4+k],state[i*8+k]);assert.equal(b[i*4+k],state[i*8+4+k]);}
       for(const [name,data]of Object.entries({a,b}))writeFileSync(resolve(out,`ghost-${name}.f32`),new Uint8Array(data.buffer));
       assert.equal(receipt.oxidizer,'unavailable');assert.equal(receipt.outerStep,1);report.cases.push({mode,donors,exterior,receipt,outer:outer.receipt()});
       // Half-cell backtrace through a linear scalar ramp gives an independent
       // numerical oracle for both new channels, well outside the fine donor.
       report.phase='raw-material-transport';seed.fill(0);
       for(let z=0;z<shape[2];z++)for(let y=0;y<shape[1];y++)for(let x=0;x<shape[0];x++){
         const i=(x+shape[0]*(y+shape[1]*z))*8;seed[i+1]=c.cellWidth;seed[i+3]=y*.02;seed[i+6]=y*.03;
       }
       const mask=new Uint8Array(c.shape.reduce((a,b)=>a*b,1));
       for(let z=0;z<c.shape[2];z++)for(let x=0;x<c.shape[0];x++)mask[x+c.shape[0]*(13+c.shape[1]*z)]=1;
       outer.setSolids(packSolidTextureRows(mask,c.grid),'synthetic-y13-wall');
       for(const buffer of captured)device.queue.writeBuffer(buffer,0,seed);
       const transport=device.createCommandEncoder();outer.encodeExternalProjection(transport,0,{dtScale:0,backtraceScale:.5},()=>{},0);device.queue.submit([transport.finish()]);
       const moved=await outer.readState(),probe=(2+shape[0]*(10+shape[1]*2))*8;
       assert.ok(Math.abs(moved[probe+3]-9.5*.02)<2e-6,'raw soot must advect half a cell');
       assert.ok(Math.abs(moved[probe+6]-9.5*.03)<2e-6,'fuel must advect half a cell');
       const wall=(2+shape[0]*(13+shape[1]*2))*8;
       assert.equal(moved[wall+3],0,'solid must contain no soot');assert.equal(moved[wall+6],0,'solid must contain no fuel');
       assert.deepEqual(await readTexture(t.a),a,'exported start-step snapshot must remain unchanged by subsequent evolution');
       assert.deepEqual(await readTexture(t.b),b,'material snapshot must remain unchanged until explicitly exported again');
       writeFileSync(resolve(out,'transport.f32'),new Uint8Array(moved.buffer));
       report.cases.push({mode,transport:'half-cell-linear-ramp',rawSoot:moved[probe+3],fuel:moved[probe+6],solidScalarsZero:true,snapshotStable:true});
     }else{
       // A default optical-only instance cannot claim usable raw material.
       assert.throws(()=>outer.encodeGhostSnapshot(device.createCommandEncoder(),textures()),/authored-raw/);
     }
   }finally{outer.destroy();}
 }
 report.phase='baseline-equivalence';for(let i=0;i<outputs['optical-only'].length;i++)if(i%8!==3&&i%8!==6)assert.equal(outputs['authored-raw'][i],outputs['optical-only'][i],'raw tracking changes existing optical/velocity state');
 assert.deepEqual(errors,[]);report.phase='complete';report.passed=true;
}catch(e){report.error=e.stack;process.exitCode=1;}finally{for(const o of owned)o.destroy();device?.destroy();persist();console.log(JSON.stringify(report));delete globalThis.__outerRawGPU;}
