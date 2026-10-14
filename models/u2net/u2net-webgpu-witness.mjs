// WebGPU witness for browser foreground removal: serves the repo, a U2Net
// package (export-u2net-package.py) and photo references
// (export-rembg-photo-reference.py), runs removeForegroundU2Net in an
// independent Chrome for Testing with WebGPU, and writes a report comparing the
// cutouts with rembg's. Records the effective adapter; a failure before the
// page reports still writes the report with its phase.
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
  report.phase='adapter';const adapter=await navigator.gpu?.requestAdapter();if(!adapter)throw Error('no WebGPU adapter');
  report.adapter={vendor:adapter.info?.vendor,architecture:adapter.info?.architecture,fallback:adapter.info?.isFallbackAdapter??null};
  const device=await adapter.requestDevice({requiredLimits:{maxStorageBufferBindingSize:adapter.limits.maxStorageBufferBindingSize,maxBufferSize:adapter.limits.maxBufferSize}});
  report.phase='package';const pkg=await loadU2NetPackage('/package/');report.package={source:pkg.graph.source,weightsSha256:pkg.graph.weights.sha256};
  const runner=createU2NetRunner({device,...pkg});
  report.phase='photos';const stages=await (await fetch('/ref/stages.json')).json();
  const bin=async(p,T)=>new T(await (await fetch(p)).arrayBuffer());
  for(const [name,row] of Object.entries(stages)){
    const [w,h]=row.source,src=await bin('/ref/'+name+'/source-rgb.u8',Uint8Array),want=await bin('/ref/'+name+'/cutout-rgba.u8',Uint8Array);
    const t=performance.now(),r=await removeForegroundU2Net({pixels:src,width:w,height:h,runner}),seconds=(performance.now()-t)/1000;
    let alphaDifferent=0,alphaMaxDelta=0,rgbMaxDelta=0;
    for(let i=0;i<r.width*r.height;i++){const d=Math.abs(r.rgba[i*4+3]-want[i*4+3]);if(d)alphaDifferent++;alphaMaxDelta=Math.max(alphaMaxDelta,d);
      for(let c=0;c<3;c++)rgbMaxDelta=Math.max(rgbMaxDelta,Math.abs(r.rgba[i*4+c]-want[i*4+c]));}
    report.cases[name]={size:[r.width,r.height],sizeMatches:r.width===row.pre[0]&&r.height===row.pre[1],seconds,alphaDifferent,alphaMaxDelta,rgbMaxDelta,pixels:r.width*r.height};
  }
  runner.dispose();report.phase=null;report.status='done';
}catch(e){report.status='error';report.error=String(e.stack||e);}
await fetch('/__report',{method:'POST',body:JSON.stringify(report)});
</script>`;
const types={'.js':'text/javascript','.mjs':'text/javascript','.json':'application/json'};
let child,report={status:'running',phase:'server',effectiveBrowser:args.get('--chrome'),repo};
const write=()=>fs.writeFileSync(out,JSON.stringify(report,null,1));write();
const timer=setTimeout(()=>finish({status:'timeout'}),15*60*1000);
function finish(r){clearTimeout(timer);report={...report,...r,browserPid:child?.pid};write();console.log(JSON.stringify(report));try{child?.kill('SIGTERM');}catch{}server.close();}
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
  child.on('exit',code=>{if(server.listening)finish({status:'browser-exited',code});});
});
