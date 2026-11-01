import {createDomainRemap} from '../volume-domain-remap.mjs';

// Native transfer conformance against analytic world-space fields. The
// independent reference evaluates physical sample positions, not the shader.
export async function runDomainRemapConformance() {
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter || adapter.isFallbackAdapter) throw Error('Native WebGPU required');
  const device = await adapter.requestDevice(), owned = [], errors = [], rows = [];
  device.addEventListener('uncapturederror', e => errors.push(e.error.message));
  const buffer = (data) => {const b=device.createBuffer({size:data.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST});device.queue.writeBuffer(b,0,data);owned.push(b);return b;};
  const texture = (dims, format, data, channels, dimension='3d') => {
    const t=device.createTexture({size:dims,dimension,format,usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC|GPUTextureUsage.COPY_DST});
    if(data)device.queue.writeTexture({texture:t},data,{bytesPerRow:dims[0]*channels*4,rowsPerImage:dims[1]},dims);owned.push(t);return t;
  };
  const read = async b => {
    const s=device.createBuffer({size:b.size,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
    try {const e=device.createCommandEncoder();e.copyBufferToBuffer(b,0,s,0,b.size);device.queue.submit([e.finish()]);await s.mapAsync(GPUMapMode.READ);return s.getMappedRange().slice(0);}
    finally {s.unmap();s.destroy();}
  };
  const readTexture = async (t,d,channels) => {
    const pitch=Math.ceil(d[0]*channels*4/256)*256,s=device.createBuffer({size:pitch*d[1]*d[2],usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
    try {const e=device.createCommandEncoder();e.copyTextureToBuffer({texture:t},{buffer:s,bytesPerRow:pitch,rowsPerImage:d[1]},d);device.queue.submit([e.finish()]);await s.mapAsync(GPUMapMode.READ);const a=new Float32Array(s.getMappedRange()),out=[];for(let z=0;z<d[2];z++)for(let y=0;y<d[1];y++)out.push(...a.slice((z*d[1]+y)*pitch/4,(z*d[1]+y)*pitch/4+d[0]*channels));return out;}
    finally{s.unmap();s.destroy();}
  };
  const indices=d=>Array.from({length:d[0]*d[1]*d[2]},(_,i)=>[i%d[0],Math.floor(i/d[0])%d[1],Math.floor(i/(d[0]*d[1]))]);
  const position=(p,pose,d)=>p.map((v,a)=>pose.translate[a]+(2*v/d[0]-1)*pose.scale);
  const velocity=(w,a)=>1+a*.5+w[0]*.2+w[1]*.1+w[2]*.15;
  const scalar=(w,k)=>10+k+w[0]*.3+w[1]*.2+w[2]*.1;
  const before={translate:[.1,-.4,.2],scale:.8};
  const plan={min:[-4,-4,-4],flowDims:[8,8,8],materialDims:[8,8,8],flowPitch:1,materialPitch:1};
  const wg=new Float32Array(512*8),wv=new Float32Array(512*4);
  indices([8,8,8]).forEach((c,i)=>{const w=c.map(x=>x-3.5);wg.set([scalar(w,0),scalar(w,1),scalar(w,2),.7,scalar(w,4),0,0,0],i*8);for(let a=0;a<3;a++){const f=[...w];f[a]+=.5;wv[i*4+a]=velocity(f,a);}});
  const world={plan,anchor:{translate:[0,0,0],scale:1},gas:buffer(wg),velocity:buffer(wv)};
  device.pushErrorScope('validation');
  try {
    for(const d of [[4,6,4],[3,5,3]])for(const staggered of [true,false]) {
      const n=d[0]*d[1]*d[2],side=Math.max(...d),f=new Float32Array(n*16),front=new Float32Array(n),q=new Uint32Array(n+5).fill(1000),r=new Float32Array(n*2),wave=new Float32Array(n*8),lower=new Float32Array(side*side*3);
      indices(d).forEach((c,i)=>{
        const w=position(c.map(x=>x+.5),before,d);
        for(let k=0;k<16;k++)f[i*16+k]=scalar(w,100+k);
        for(let a=0;a<3;a++){const p=c.map(x=>x+.5);if(staggered)p[a]+=.5;f[i*16+a]=velocity(position(p,before,d),a)/(2*before.scale/d[0]);
          if(c[a]===0){p[a]=0;lower[a*side*side+c[(a+1)%3]+side*c[(a+2)%3]]=velocity(position(p,before,d),a)/(2*before.scale/d[0]);}}
        front[i]=scalar(w,30);r.set([.9,scalar(w,20)],i*2);
        for(let set=0;set<2;set++)wave.set([w[0]+5+set,w[1]+6,w[2]+7,0],(set*n+i)*4);
      });
      const fluid=[buffer(f),buffer(f)],fs=[buffer(front),buffer(front)],qs=[buffer(q),buffer(q)];
      const reaction=[0,1].map(()=>texture(d,'rg32float',r,2)),wavelet=[0,1].map(()=>texture([d[0],d[1],d[2]*2],'rgba32float',wave,4));
      const lo=texture([side,side,3],'r32float',lower,1,'2d'),gpu=createDomainRemap(device,d);owned.push(gpu);
      const setupError=await device.popErrorScope();if(setupError)throw Error(setupError.message);device.pushErrorScope('validation');
      const cases=[{name:'identity',after:before},{name:'integer',after:{translate:[.1+2*.8/d[0],-.4,.2],scale:.8}},
        {name:'fractional',after:{translate:[.237,-.46,.43],scale:.8}},
        {name:'grow',after:{translate:[.1,-.4,.2],scale:1.05}},
        {name:'shrink',after:{translate:[.1,-.4,.2],scale:.51}},
        {name:'disjoint',after:{translate:[2,0,0],scale:.5}},
        {name:'ambient',after:{translate:[8,0,0],scale:.5},world:null}];
      for(const test of cases) {
        device.pushErrorScope('validation');
        device.queue.writeTexture({texture:lo},lower,{bytesPerRow:side*4,rowsPerImage:side},[side,side,3]);
        const e=device.createCommandEncoder();gpu.encode(e,{before,after:test.after,fluid,front:fs,quench:qs,reaction,wavelet,lower:lo,world:test.world===null?null:world,staggered});device.queue.submit([e.finish()]);
        const actual={fluid:Array.from(new Float32Array(await read(fluid[1]))),front:Array.from(new Float32Array(await read(fs[1]))),quench:Array.from(new Uint32Array(await read(qs[1]))),reaction:await readTexture(reaction[1],d,2),wavelet:await readTexture(wavelet[1],[d[0],d[1],d[2]*2],4),lower:await readTexture(lo,[side,side,3],1)};
        const scopedError=await device.popErrorScope();if(scopedError)throw Error(scopedError.message);
        const expected={fluid:[],front:[],quench:[],reaction:[],wavelet:new Array(n*8).fill(0),lower:[...lower]};
        const oldPoint=w=>w.map((v,a)=>((v-before.translate[a])/before.scale+1)*d[0]/2);
        const retained=p=>p.every((v,a)=>v>=-1e-7&&v<d[a]-1e-7);
        const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
        const expectedVelocity=(p,a)=>{
          const w=position(p,test.after,d),old=oldPoint(w);
          let physical;
          if(old.every((v,a)=>v>=-1e-7&&v<=d[a]+1e-7)){
            const bounded=old.map((v,k)=>clamp(v,staggered&&k===a?0:.5,staggered&&k===a?d[k]:d[k]-.5));physical=velocity(position(bounded,before,d),a);
          }else physical=test.world===null?0:velocity(w,a);
          return physical/(2*test.after.scale/d[0]);
        };
        indices(d).forEach((c,i)=>{
          const w=position(c.map(x=>x+.5),test.after,d),old=oldPoint(w),keep=retained(old),sample=position(old.map((v,a)=>clamp(v,.5,d[a]-.5)),before,d);
          const v=Array.from({length:16},(_,k)=>keep?scalar(sample,100+k):0);
          for(let a=0;a<3;a++){const p=c.map(x=>x+.5);if(staggered)p[a]+=.5;v[a]=expectedVelocity(p,a);if(c[a]===0){p[a]=0;expected.lower[a*side*side+c[(a+1)%3]+side*c[(a+2)%3]]=expectedVelocity(p,a);}}
          if(!keep&&test.world!==null)for(let a=0;a<3;a++)v[4+a]=scalar(w,a);
          expected.fluid.push(...v);expected.front.push(keep?scalar(sample,30):0);expected.quench.push(keep?1000:0);
          expected.reaction.push(keep?.9:test.world===null?1:.7,keep?scalar(sample,20):test.world===null?0:scalar(w,4));
          for(let set=0;set<2;set++){const coord=keep?[sample[0]+5+set,sample[1]+6,sample[2]+7,0]:[...old,0];expected.wavelet.splice((set*n+i)*4,4,...coord);}
        });expected.quench.push(...q.slice(n));
        const row={dimensions:d,staggered,case:test.name,before,after:test.after,maxError:0,actual,expected};
        rows.push(row);
        for(const key of Object.keys(expected))for(let i=0;i<expected[key].length;i++){
          const error=Math.abs(expected[key][i]-actual[key][i]);row.maxError=Math.max(row.maxError,error);
          if(!Number.isFinite(error)||error>0.00008)throw Error(`${test.name} ${d} MAC=${staggered} ${key}[${i}] expected=${expected[key][i]} got=${actual[key][i]}`);
        }
      }
    }
    const validation=await device.popErrorScope();if(validation)errors.push(validation.message);
    if(errors.length)throw Error(errors.join('\n'));
    return {status:'passed',adapter:adapter.info,rows,errors,claim:'native analytic field transfer, including lower MAC faces and retained turbulence coordinates'};
  } catch(error) {return {status:'failed',failed:true,error:error.stack,adapter:adapter.info,rows,errors};}
  finally {for(const x of owned)x.destroy();device.destroy();}
}
