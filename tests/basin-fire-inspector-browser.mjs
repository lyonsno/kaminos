import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';

const output=path.resolve(process.argv[2]);await fs.mkdir(output,{recursive:true});
const root=path.resolve(import.meta.dirname,'..'),html=await fs.readFile(path.join(root,'index.html'),'utf8');
const css=[...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(match=>match[1]).join('\n');
const report={status:'starting',route:'actual inspector/library module plus canonical workbench CSS; CPU DOM only',repoRoot:root,frames:[]};
let browser,server,error;
try{
  assert.ok(process.env.CHROME_EXECUTABLE&&!process.env.CHROME_EXECUTABLE.includes('/Applications/Google Chrome.app/'),'independent browser required');
  server=http.createServer(async(req,res)=>{
    try{if(req.url==='/'){res.setHeader('content-type','text/html');res.end(`<style>${css}</style><link rel="stylesheet" href="/burn-table.css"><main id="inspector"></main>`);}
      else if(['/basin-fire-fixture.mjs','/burn-table.css'].includes(req.url)){res.setHeader('content-type',req.url.endsWith('.css')?'text/css':'text/javascript');res.end(await fs.readFile(path.join(root,req.url.slice(1))));}
      else{res.statusCode=404;res.end();}}catch(err){res.statusCode=500;res.end(String(err));}
  });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const {chromium}=await import(pathToFileURL(path.resolve(process.env.PLAYWRIGHT_MODULE)));
  browser=await chromium.launch({executablePath:process.env.CHROME_EXECUTABLE,headless:true});
  const page=await browser.newPage();report.browserVersion=browser.version();
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:900});await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.evaluate(async()=>{
      const {mountBasinFireInspector,openBasinFireLibrary}=await import('./basin-fire-fixture.mjs');
      const fixture={read:()=>({status:'mounted',basin:{label:'A saved fire basin'},enabled:false,visible:true}),subscribe:()=>()=>{},setEnabled(){},setVisible(){},
        listBasins:async()=>({entries:Array.from({length:80},(_,i)=>({presetId:'basin-'+i,label:i===0?'A saved fire basin':'A very long readable basin label '+i}))}),
        describeBasin:async id=>({presetId:id,label:'A saved fire basin',grid:48,shape:'ring',flow:2.5,raySteps:36,renderScale:.75,supported:true}),applyBasin(){},
        showLibrary:()=>openBasinFireLibrary(fixture,{document})};
      mountBasinFireInspector(fixture,{document,container:document.getElementById('inspector')});window.fixture=fixture;
    });
    assert.equal(await page.locator('[data-reacquire]').isVisible(),false,'a mounted fire must not display recovery controls');
    await page.locator('[data-library]').click();await page.locator('.basin-fire-library-row').first().click();
    const geometry=await page.locator('.basin-fire-library').evaluate(dialog=>({left:dialog.getBoundingClientRect().left,right:dialog.getBoundingClientRect().right,top:dialog.getBoundingClientRect().top,scroll:dialog.scrollWidth,client:dialog.clientWidth}));
    assert.ok(geometry.left>0&&geometry.right<width,'library must fit and be centered within the viewport');
    assert.ok(geometry.scroll<=geometry.client,'library text must wrap without horizontal overflow');
    await page.locator('.basin-fire-library [data-basins]').evaluate(list=>list.scrollTop=list.scrollHeight);
    assert.equal(await page.locator('.basin-fire-library input[type=search]').isVisible(),true);
    assert.equal(await page.locator('.basin-fire-library [data-close]').isVisible(),true);
    await page.screenshot({path:path.join(output,`library-${width}.png`)});report.frames.push({width,geometry});
    await page.locator('.basin-fire-library [data-close]').click();
  }
  report.status='passed';
}catch(err){error=err;report.status='failed';report.error=String(err.stack||err);}
finally{if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));if(error)throw error;}
