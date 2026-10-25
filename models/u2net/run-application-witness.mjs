import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {packU2NetModule} from '../../scripts/pack-u2net-module.mjs';
import {launchChrome,startServer,sourceIdentity} from '../flux2-klein/cdp-harness.mjs';
import {readBrowserJson} from '../unimate/application-witness-checks.mjs';
import {checkU2NetApplicationWitness} from './application-witness-checks.mjs';
const args=process.argv.slice(2),opt=n=>{const i=args.indexOf(n);return i<0?undefined:args[i+1];};
if(!opt('--out'))throw Error('--out required');
const out=path.resolve(opt('--out')),repo=path.resolve(import.meta.dirname,'../..');await fs.mkdir(out,{recursive:true});
const report={schema:'kaminos.u2net.application-witness.v0',phase:'arguments',source:sourceIdentity(repo),expectedRevision:opt('--revision'),argv:process.argv,commands:[]};
let browser,server;
const persist=()=>fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
const phase=async value=>{report.phase=value;await persist();};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const command=(exe,argv,cwd)=>{const record={exe,argv,cwd};report.commands.push(record);try{record.stdout=execFileSync(exe,argv,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']});record.exit=0;return record.stdout;}catch(e){record.exit=e.status;record.stderr=String(e.stderr??e);throw e;}};
const wait=expr=>browser.evaluate(`(async()=>{while(!(${expr})){if(window.u2netWitness?.phase==='failed')throw Error(window.u2netWitness.error);await new Promise(requestAnimationFrame);}return true;})()`);
const bytes=async(expr,file)=>{const value=Uint8Array.from(await readBrowserJson(browser.evaluate,`Array.from(${expr})`));await fs.writeFile(path.join(out,file),value);return value;};
const difference=(a,b)=>{if(a.length!==b.length)throw Error('output size differs');let max=0;for(let i=0;i<a.length;i++)max=Math.max(max,Math.abs(a[i]-b[i]));return max;};
try{
 await persist();
 if(!report.expectedRevision||report.source.rev!==report.expectedRevision||report.source.dirtyFiles.length)throw Error('clean exact revision required');
 for(const n of ['--chrome','--weights','--reference','--case'])if(!opt(n))throw Error(n+' required');
 const chrome=await fs.realpath(opt('--chrome'));if(/\/Applications\/Google Chrome\.app\//.test(chrome))throw Error('independent testing browser required');
 report.browser={executable:chrome};
 const weights=path.resolve(opt('--weights')),reference=path.resolve(opt('--reference')),name=opt('--case');
 const manifest=JSON.parse(await fs.readFile(path.join(reference,'stages.json'),'utf8'));
 const config=manifest[name];if(!config)throw Error('named reference absent');
 const graphBytes=await fs.readFile(path.join(weights,'graph.json')),graph=JSON.parse(graphBytes);
 report.weights={root:weights,graphSha256:hash(graphBytes),sha256:graph.weights.sha256};await fs.writeFile(path.join(out,'graph.json'),graphBytes);
 const source=await fs.readFile(path.join(reference,name,'source-rgb.u8')),want=await fs.readFile(path.join(reference,name,'cutout-rgba.u8'));
 if(source.length!==config.source[0]*config.source[1]*3||want.length!==config.pre[0]*config.pre[1]*4||hash(want)!==config.sha.cutout)throw Error('reference identity/shape mismatch');
 const input=path.join(out,'input');await fs.mkdir(input,{recursive:true});
 await fs.writeFile(path.join(input,'source-rgb.u8'),source);await fs.writeFile(path.join(input,'cutout-rgba.u8'),want);await fs.writeFile(path.join(input,'case.json'),JSON.stringify(config,null,2));
 report.input={reference,name,sourceSha256:hash(source),cutoutSha256:hash(want),config};
 const outside=path.join(out,'outside'),artifacts=path.join(outside,'artifacts'),app=path.join(outside,'app');
 report.outsideCheckout=!outside.startsWith(repo+path.sep);if(!report.outsideCheckout)throw Error('outside installation required');
 await fs.mkdir(app,{recursive:true});await phase('pack');report.installed=await packU2NetModule({out:artifacts});
 report.kit=JSON.parse(command('npm',['pack',path.join(repo,'webgpu-inference-kit'),'--pack-destination',artifacts,'--ignore-scripts','--json'],repo))[0];
 await fs.writeFile(path.join(app,'package.json'),JSON.stringify({private:true,type:'module'}));
 await phase('install');command('npm',['install','--offline','--ignore-scripts','--no-audit','--no-fund',report.installed.tarball,path.join(artifacts,report.kit.filename)],app);
 await fs.copyFile(path.join(import.meta.dirname,'application-witness.js'),path.join(app,'entry.js'));await fs.copyFile(path.join(import.meta.dirname,'application-witness.html'),path.join(app,'index.html'));
 await build({entryPoints:[path.join(app,'entry.js')],outfile:path.join(app,'app.js'),bundle:true,format:'esm',platform:'browser',target:'esnext'});
 server=await startServer({'/weights/':weights,'/input/':input,'/':app});report.pageUrl=server.origin+'/index.html';
 await phase('browser');browser=await launchChrome(chrome,['--window-size=1200,1000'],report.browser);
 await browser.navigate(report.pageUrl,'Boolean(window.u2netWitness)');await wait("window.u2netWitness.phase==='idle'");
 await phase('pause-resume');await browser.evaluate('window.runCutout(true);true',false);
 await wait('Boolean(window.u2netWitness.current?.pausePromise)');
 report.paused=await browser.evaluate('(async()=>{const p=await window.u2netWitness.current.pausePromise;window.__frames=window.u2netWitness.frames;return p.status;})()');
 await wait('window.u2netWitness.frames>=window.__frames+2');report.pausedFrames=await browser.evaluate('window.u2netWitness.frames-window.__frames');
 await browser.evaluate('window.u2netApp.resume()');await wait("window.u2netWitness.phase==='done'");
 const first=await bytes('window.cutout.rgba','first-cutout.rgba');
 await phase('stop-retry');await browser.evaluate('window.runCutout(true);true',false);await wait('Boolean(window.u2netWitness.current?.pausePromise)');
 await browser.evaluate('(async()=>{await window.u2netWitness.current.pausePromise;window.u2netApp.stop();})()');await wait("window.u2netWitness.phase==='stopped'");report.stopped=true;
 await browser.evaluate('window.runCutout();true',false);await wait("window.u2netWitness.phase==='done'");const repeated=await bytes('window.cutout.rgba','repeated-cutout.rgba');
 report.repeatDifference=difference(first,repeated);report.referenceMaxDifference=difference(first,want);
 let transparent=0,opaque=0;for(let i=3;i<first.length;i+=4){if(first[i]===0)transparent++;if(first[i]===255)opaque++;}
 report.output={bytes:first.length,sha256:hash(first),transparent,opaque};
 const capture=await browser.send('Page.captureScreenshot',{format:'png'});if(!capture.result?.data)throw Error('missing screenshot');await fs.writeFile(path.join(out,'installed-cutout.png'),Buffer.from(capture.result.data,'base64'));
 const png=await browser.evaluate("document.getElementById('cutout').toDataURL('image/png')");await fs.writeFile(path.join(out,'cutout.png'),Buffer.from(png.split(',')[1],'base64'));
 await phase('direct-comparison');await browser.evaluate('window.directCutout()');const direct=await bytes('window.directOutput.rgba','direct-cutout.rgba');report.directDifference=difference(first,direct);
 await phase('destroy');await browser.evaluate('window.destroyModel()');await browser.evaluate('window.__frames=window.u2netWitness.frames;true');await wait('window.u2netWitness.frames>=window.__frames+2');report.framesAfterDestroy=await browser.evaluate('window.u2netWitness.frames-window.__frames');
 report.state=await readBrowserJson(browser.evaluate,'window.u2netWitness');await fs.writeFile(path.join(out,'consumer-state.json'),JSON.stringify(report.state,null,2));
 await browser.evaluate('window.closeHost()');await browser.close();browser=null;
 report.problems=checkU2NetApplicationWitness(report);if(report.problems.length)throw Error(report.problems.join('; '));await phase('passed');
}catch(error){report.error=String(error.stack??error);}
finally{
 if(browser){try{report.lastState=await readBrowserJson(browser.evaluate,'window.u2netWitness');await fs.writeFile(path.join(out,'last-state.json'),JSON.stringify(report.lastState,null,2));}catch(e){report.stateError=String(e);}try{await browser.close();}catch(e){report.cleanupError=String(e);}}
 else if(report.browser?.ownedBrowserPid&&!report.browser.browserExit){try{process.kill(report.browser.ownedBrowserPid,'SIGTERM');}catch(e){if(e.code!=='ESRCH')report.cleanupError=String(e);}}
 if(server)await new Promise(resolve=>server.server.close(resolve));report.finishedAt=new Date().toISOString();await persist();
}
console.log(JSON.stringify({phase:report.phase,error:report.error,problems:report.problems,report:path.join(out,'report.json')}));process.exitCode=report.phase==='passed'?0:1;
