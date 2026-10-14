// WebGPU witness for browser foreground removal: serves the repo, a U2Net
// package (export-u2net-package.py) and photo references
// (export-rembg-photo-reference.py), runs removeForegroundU2Net in an
// independent Chrome for Testing with WebGPU, and writes a report comparing the
// cutouts with rembg's. Records the effective adapter; a failure before the
// page reports (missing browser, server error, bad references) still writes a
// terminal report with its phase.
//
// node models/u2net/u2net-webgpu-witness.mjs --package <dir> --reference <dir> --chrome <Chrome for Testing> --out <report.json>
import http from 'node:http';import fs from 'node:fs';import path from 'node:path';import {spawn} from 'node:child_process';import {fileURLToPath} from 'node:url';
const args=new Map();for(let i=2;i<process.argv.length;i+=2)args.set(process.argv[i],process.argv[i+1]);
for(const k of ['--package','--reference','--chrome','--out'])if(!args.get(k))throw Error(k+' required');
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),out=path.resolve(args.get('--out'));
const roots={'/repo/':repo,'/package/':path.resolve(args.get('--package')),'/ref/':path.resolve(args.get('--reference'))};
const PAGE=`<!doctype html><meta charset="utf-8"><title>U2Net foreground witness</title><script type="module">
const report={phase:'page',cases:{}};
try{
  const {loadU2NetPackage,createU2NetRunner}=await import('/repo/models/u2net/u2net-webgpu.js');
  const {removeForegroundU2Net}=await import('/repo/models/u2net/rembg-u2net.js');
  const {admitReferenceCases,admitReferenceBytes,compareCutouts}=await import('/repo/models/u2net/witness-checks.js');
  report.phase='adapter';const adapter=await navigator.gpu?.requestAdapter();if(!adapter)throw Error('no WebGPU adapter');
  report.adapter={vendor:adapter.info?.vendor,architecture:adapter.info?.architecture,fallback:adapter.info?.isFallbackAdapter??null};
  const device=await adapter.requestDevice({requiredLimits:{maxStorageBufferBindingSize:adapter.limits.maxStorageBufferBindingSize,maxBufferSize:adapter.limits.maxBufferSize}});
  report.phase='package';const pkg=await loadU2NetPackage('/package/');report.package={source:pkg.graph.source,weightsSha256:pkg.graph.weights.sha256};
  const runner=createU2NetRunner({device,...pkg});
  report.phase='references';const manifest=await fetch('/ref/stages.json');
  if(!manifest.ok)throw Error('reference stages.json: HTTP '+manifest.status);
  const cases=admitReferenceCases(await manifest.json());
  const bin=async(name,what,file,length,sha256)=>{const r=await fetch('/ref/'+name+'/'+file);
    return admitReferenceBytes({name,what,status:r.status,bytes:new Uint8Array(await r.arrayBuffer()),length,sha256});};
  for(const c of cases){
    report.phase='case '+c.name;
    const [w,h]=c.source,[pw,ph]=c.pre;
    const src=await bin(c.name,'source','source-rgb.u8',w*h*3),want=await bin(c.name,'cutout','cutout-rgba.u8',pw*ph*4,c.cutoutSha256);
    const t=performance.now(),r=await removeForegroundU2Net({pixels:src,width:w,height:h,runner}),seconds=(performance.now()-t)/1000;
    if(r.width!==pw||r.height!==ph)throw Error('cutout '+c.name+': size '+r.width+'x'+r.height+' vs reference '+pw+'x'+ph);
    // The same photo through the real kit foreground service while a page-like
    // loop submits a small GPU frame every animation frame: bytes must match the
    // single submission, and frames must be serviced during inference.
    const kit=await import('/repo/webgpu-inference-kit/src/index.js');
    const service=kit.createWebGpuForegroundService({routeId:'u2net-witness',device,queue:device.queue});
    const loop=label=>{const st={label,frames:0,maxGapMs:0,live:true,last:performance.now()};
      const tick=now=>{if(!st.live)return;st.maxGapMs=Math.max(st.maxGapMs,now-st.last);st.last=now;
        service.request({requestId:label+'-'+(st.frames++),run:ctx=>{ctx.submit([device.createCommandEncoder().finish()]);}});
        requestAnimationFrame(tick);};
      requestAnimationFrame(tick);return st;};
    const plain=loop(c.name+'-plain');await removeForegroundU2Net({pixels:src,width:w,height:h,runner});plain.live=false;
    const shared=loop(c.name+'-foreground');const run=await service.beginRun(c.name+'-u2net');
    const s=await removeForegroundU2Net({pixels:src,width:w,height:h,runner,foreground:run});await run.finish();shared.live=false;
    await service.dispose();
    let same=s.rgba.length===r.rgba.length;for(let i=0;same&&i<s.rgba.length;i++)same=s.rgba[i]===r.rgba[i];
    if(!same)throw Error('cutout '+c.name+': foreground run differs from single submission');
    report.cases[c.name]={size:[r.width,r.height],seconds,...compareCutouts(c.name,r.rgba,want),
      frames:{plain:{frames:plain.frames,maxGapMs:plain.maxGapMs},foreground:{frames:shared.frames,maxGapMs:shared.maxGapMs,identical:true}}};
  }
  runner.dispose();report.phase=null;report.status='done';
}catch(e){report.status='error';report.error=String(e.stack||e);}
await fetch('/__report',{method:'POST',body:JSON.stringify(report)});
</script>`;
const types={'.js':'text/javascript','.mjs':'text/javascript','.json':'application/json'};
let child,report={status:'running',phase:'server',effectiveBrowser:args.get('--chrome'),repo};
const write=()=>fs.writeFileSync(out,JSON.stringify(report,null,1));write();
const timer=setTimeout(()=>finish({status:'timeout'}),15*60*1000);
// The first terminal outcome is the report; later events cannot replace it.
let finished=false;
function finish(r){
  if(finished)return;finished=true;clearTimeout(timer);
  report={...report,...r,browserPid:child?.pid??null};write();console.log(JSON.stringify(report));
  try{child?.kill('SIGTERM');}catch{}
  if(server.listening)server.close();
}
const fail=phase=>error=>finish({status:'error',phase,error:String(error?.stack||error)});
const server=http.createServer((req,res)=>{
  if(req.method==='POST'){let b='';req.on('data',d=>b+=d);req.on('end',()=>{res.end('ok');finish(JSON.parse(b));});return;}
  const u=decodeURIComponent(req.url.split('?')[0]);if(u==='/'){res.setHeader('content-type','text/html');return res.end(PAGE);}
  let file=null;for(const [p,r] of Object.entries(roots))if(u.startsWith(p))file=path.join(r,u.slice(p.length));
  if(!file){res.statusCode=404;return res.end();}
  fs.readFile(file,(e,d)=>{if(e){res.statusCode=404;return res.end();}res.setHeader('content-type',types[path.extname(file)]??'application/octet-stream');res.end(d);});
}).listen(0,'127.0.0.1',()=>{
  report.phase='browser';write();
  child=spawn(args.get('--chrome'),['--headless=new','--no-first-run','--enable-unsafe-webgpu','--enable-features=Vulkan,WebGPU,WebGPUDeveloperFeatures',
    '--user-data-dir='+out+'.profile','--remote-debugging-port=0',`http://127.0.0.1:${server.address().port}/`],{stdio:'ignore'});
  child.on('error',fail('browser'));
  child.on('exit',code=>finish({status:'browser-exited',code}));
});
server.on('error',fail('server'));
