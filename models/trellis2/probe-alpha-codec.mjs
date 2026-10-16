// Provisional CPU-only codec comparison. Caller owns the report and fixture PNGs.
// No GPU, inference, scene or universal image-format acceptance is claimed.
import {readFile,writeFile,mkdir,realpath} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {startServer,launchChrome,sourceIdentity} from '../flux2-klein/cdp-harness.mjs';
const option=name=>{const i=process.argv.indexOf(name);if(i<0||!process.argv[i+1])throw Error(name+' is required');return process.argv[i+1];};
const out=path.resolve(option('--out')),images=path.resolve(option('--images')),root=path.resolve(option('--repo-root'));
const nativeLayout=process.argv.includes('--native-layout');
const wrapper=process.argv.includes('--wrapper');
await mkdir(out,{recursive:true});
const report={schema:'trellis2.alpha-codec-probe.v0',status:'running',phase:'admission',
  requestedRoute:wrapper?'prepareTrellisAlphaImage / browser ImageDecoder / source-law alpha conditioning':nativeLayout?'ImageDecoder PNG / native copyTo + explicit channel mapping / source-law alpha conditioning':'ImageDecoder PNG / RGBA copyTo / source-law alpha conditioning',
  source:sourceIdentity(root),repoRoot:root,imagesRoot:images,modelCalls:0,gpuRequested:false,rows:[]};
const persist=()=>writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
let browser,server;
await persist();
try{
  const executable=await realpath(option('--chrome'));
  if(executable.includes('/Applications/Google Chrome.app/'))throw Error('independent browser required; GUI Chrome is not admitted');
  report.executable=executable;
  report.moduleSha256=createHash('sha256').update(await readFile(path.join(root,'models/trellis2/alpha-preparation.js'))).digest('hex');
  const fixture=JSON.parse(await readFile(path.join(root,'models/trellis2/tests/fixtures/alpha-preparation-source.json'),'utf8'));
  const hosted=await startServer({'/repo/':root,'/inputs/':images});server=hosted.server;
  report.origin=hosted.origin;report.phase='browser-launch';await persist();
  browser=await launchChrome(executable,['--disable-gpu'],report,{profileDir:path.join(out,'browser-profile')});
  const url=hosted.origin+'/repo/models/trellis2/alpha-codec-probe.html';report.url=url;
  await browser.navigate(url,'document.readyState==="complete"');
  report.effectiveUrl=await browser.evaluate('location.href');report.phase='codec-comparison';await persist();
  report.servedModuleSha256=await browser.evaluate(`(async()=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await (await fetch('/repo/models/trellis2/alpha-preparation.js')).arrayBuffer())),v=>v.toString(16).padStart(2,'0')).join(''))()`);
  if(report.servedModuleSha256!==report.moduleSha256)throw Error('served preparation module differs from recorded source');
  for(const expected of fixture.cases){
    const row=await browser.evaluate(`(async()=>{
      const row=${JSON.stringify(expected)},sha=async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),v=>v.toString(16).padStart(2,'0')).join('');
      const bytes=new Uint8Array(await (await fetch('/inputs/'+row.name+'.png')).arrayBuffer());
      const result={name:row.name,inputPngSha256:await sha(bytes),inputBytes:bytes.length};
      if(typeof ImageDecoder!=='function')return {...result,status:'unsupported',error:'ImageDecoder is unavailable'};
      if(${wrapper}){
        const {prepareTrellisAlphaImage}=await import('/repo/models/trellis2/alpha-preparation.js');
        const prepared=await prepareTrellisAlphaImage(bytes);
        return {...result,status:'observed',complete:prepared.provenance.decoder.complete,
          format:prepared.provenance.decoder.nativeFormat,inputRgbaSha256:prepared.provenance.decoder.decodedRgbaSha256,
          preparedRgbSha256:await sha(prepared.pixels),preparedBytes:prepared.pixels.byteLength,
          provenance:prepared.provenance};
      }
      const decoder=new ImageDecoder({type:'image/png',data:bytes,colorSpaceConversion:'none',preferAnimation:false});
      let frame;
      try{
        const decoded=await decoder.decode({frameIndex:0,completeFramesOnly:true});frame=decoded.image;
        result.complete=decoded.complete;result.format=frame.format;
        result.size=[frame.codedWidth,frame.codedHeight];result.orientation=[frame.rotation,frame.flip];
        const rgba=new Uint8Array(frame.codedWidth*frame.codedHeight*4);
        result.layout=await frame.copyTo(rgba,${nativeLayout} ? {} : {format:'RGBA'});
        if(${nativeLayout}&&frame.format==='BGRA')for(let i=0;i<rgba.length;i+=4){const r=rgba[i];rgba[i]=rgba[i+2];rgba[i+2]=r;}
        if(${nativeLayout}&&!['RGBA','BGRA'].includes(frame.format))throw Error('native alpha format not admitted: '+frame.format);
        result.inputRgbaSha256=await sha(rgba);
        const {prepareTrellisAlphaRgba}=await import('/repo/models/trellis2/alpha-preparation.js');
        const prepared=await prepareTrellisAlphaRgba({pixels:rgba,width:frame.codedWidth,height:frame.codedHeight});
        result.preparedRgbSha256=await sha(prepared.pixels);result.preparedBytes=prepared.pixels.byteLength;
        result.status='observed';return result;
      }finally{frame?.close();decoder.close();}
    })()`);
    row.inputBytesMatch=row.inputBytes===expected.encodedPngBytes&&row.inputPngSha256===expected.encodedPngSha256;
    row.rgbaMatches=row.inputRgbaSha256===expected.inputRgbaSha256;
    row.preparedMatches=row.preparedRgbSha256===expected.preparedRgbSha256;
    report.rows.push(row);await persist();
  }
  report.status=report.rows.length===fixture.cases.length&&report.rows.every(r=>r.status==='observed'&&r.complete&&r.inputBytesMatch&&r.rgbaMatches&&r.preparedMatches)?'succeeded':'mismatch';
  report.phase=null;
}catch(error){report.status='failed';report.error={message:error.message,stack:error.stack};}
finally{
  try{if(browser)await browser.close();}
  catch(error){report.status='failed';report.phase='browser-close';report.closeError=String(error);}
  try{if(server)await new Promise(resolve=>server.close(resolve));}
  catch(error){report.status='failed';report.phase='server-close';report.serverCloseError=String(error);}
  await persist();
}
console.log(JSON.stringify({status:report.status,phase:report.phase,rows:report.rows.map(r=>({name:r.name,rgbaMatches:r.rgbaMatches,preparedMatches:r.preparedMatches})),report:path.join(out,'report.json')}));
process.exitCode=report.status==='succeeded'?0:1;
