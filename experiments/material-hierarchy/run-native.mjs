import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../../',import.meta.url)),out=path.resolve(process.argv[2]);await fs.mkdir(out,{recursive:true});
const report={status:'failed',phase:'setup',root,head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),source:{},claim:'small native correctness exercise; no timing or production cost claim'};
let browser,server;
try{
 for(const f of ['volume-material-hierarchy.mjs','volume-material-hierarchy-gpu.mjs','volume-world-smoke.mjs','experiments/material-hierarchy/native.mjs','experiments/material-hierarchy/run-native.mjs'])report.source[f]=createHash('sha256').update(await fs.readFile(path.join(root,f))).digest('hex');
 server=http.createServer(async(req,res)=>{try{if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end('<title>Material hierarchy native check</title>');return;}const file=path.resolve(root,'.'+req.url);if(!file.startsWith(root))throw Error('path');res.setHeader('Content-Type','text/javascript');res.end(await fs.readFile(file));}catch{res.statusCode=404;res.end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const {chromium}=await import('/Users/noahlyons/.local/state/kaminos/beaming-browser-deps-1007/node_modules/playwright/index.mjs');
 report.executable='/Users/noahlyons/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
 browser=await chromium.launchPersistentContext(path.join(out,'profile'),{executablePath:report.executable,headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal','--use-mock-keychain','--password-store=basic']});const page=browser.pages()[0];page.setDefaultTimeout(0);
 report.console=[];page.on('console',m=>{if(m.type()==='error')report.console.push(m.text());});
 await page.goto(`http://127.0.0.1:${server.address().port}/`);report.phase='native';
 const signal=await page.evaluate(async()=>await (await import('/experiments/material-hierarchy/native.mjs')).run());await fs.writeFile(path.join(out,'signal.json'),JSON.stringify(signal,null,2));
 if(signal.failed)throw Error(signal.error);report.status='passed';report.phase='complete';
}catch(e){report.error=e.stack;process.exitCode=1;}finally{await browser?.close();if(server)await new Promise(r=>server.close(r));report.resourcesClosed=true;await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
