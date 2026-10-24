// Ordinary Workbench interaction smoke, not a performance benchmark.
// Usage: node tools/fracture-attachment-witness.mjs URL OUTPUT PLAYWRIGHT BROWSER
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const [url,out,playwright,executable]=process.argv.slice(2);
if(!url||!out||!playwright||!executable)throw Error('URL, output directory, Playwright module and independent browser executable required');
fs.mkdirSync(out,{recursive:true});
const root=path.resolve(new URL('..',import.meta.url).pathname),commit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const report={status:'running',phase:'launch',requestedURL:url,sourceRoot:root,sourceCommit:commit,executable,errors:[],console:[]};
const save=()=>{const target=path.join(out,'report.json');fs.writeFileSync(target+'.next',JSON.stringify(report,null,2));fs.renameSync(target+'.next',target);};
const assert=(ok,message)=>{if(!ok)throw Error(message);};let context;save();
try{
 const {chromium}=await import(playwright);
 context=await chromium.launchPersistentContext(path.join(out,'profile'),{headless:true,executablePath:executable,viewport:{width:1440,height:1100},args:['--use-mock-keychain','--password-store=basic','--enable-unsafe-webgpu','--use-gl=angle','--use-angle=metal']});
 const page=context.pages()[0];page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>report.console.push({type:m.type(),text:m.text()}));
 await page.goto(url,{waitUntil:'domcontentloaded'});report.phase='loading';save();
 await page.waitForFunction(()=>window.kaminosWorkbenchExperiments?.state().id==='fracture-shape');
 const invoke=(name,value)=>page.evaluate(({name,value})=>window.kaminosWorkbenchExperiments.invoke(name,value),{name,value});
 const read=()=>page.evaluate(()=>window.kaminosWorkbenchExperiments.read());
 const capture=async name=>{await page.waitForTimeout(400);await page.screenshot({path:path.join(out,name+'.png')});};
 report.phase='source-conformance';report.effectiveURL=page.url();report.runtime=await page.evaluate(async()=>({config:await(await fetch('/api/runtime-config')).json(),scene:window.kaminosWorkbenchSceneState?.()}));report.initial=await read();save();
 assert(report.runtime.config.source.commit===commit,'Effective served revision differs from inspected checkout');
 assert(report.initial.triangleCount===102327,'Expected full kiln source');
 report.sourceFiles={};for(const name of ['fracture-shape-partition.mjs','fracture-shape-partition.worker.mjs','experiments/fracture-shape.experiment.mjs']){const expected=createHash('sha256').update(fs.readFileSync(path.join(root,name))).digest('hex'),response=await page.request.get(new URL(name,page.url()).href),actual=createHash('sha256').update(await response.body()).digest('hex');assert(response.ok()&&expected===actual,`Wrong served source: ${name}`);report.sourceFiles[name]=actual;}
 const asset=await page.request.get(new URL(report.initial.source,page.url()).href);report.assetDigest=createHash('sha256').update(await asset.body()).digest('hex');assert(asset.ok()&&report.assetDigest==='0825ee134ba3161412257d01ec5461d95344844d27ce500cc4805aed6ce9e75f','Wrong asset bytes');
 assert(report.initial.analysis.passes===7&&report.initial.analysis.cacheHit===false,'Seven-origin initial preparation missing');
 await invoke('frame');await capture('initial');
 report.phase='local-controls';save();
 const nested=report.initial.hierarchy.nodes.filter(n=>n.kind==='branch'&&n.children.length&&n.triangles>500).sort((a,b)=>b.triangles-a.triangles)[0];assert(nested,'No substantial nested fitting to exercise');
 await invoke('select',nested.id);await invoke('keepTogether');report.kept=await invoke('export');await capture('selected-together');
 await page.getByRole('button',{name:'Finer here',exact:true}).click();report.refined=await invoke('export');await capture('selected-refined');
 const owners=r=>r.labels.map(id=>r.partition.parts[id].nodeId),before=owners(report.kept),after=owners(report.refined),nodes=report.kept.hierarchy.nodes;
 const inside=id=>{while(id!==null){if(id===nested.id)return true;id=nodes[id].parent;}return false;};
 let changed=0;for(let i=0;i<before.length;i++){if(!inside(report.kept.hierarchy.faceOwners[i]))assert(before[i]===after[i],'Local refinement changed an outside triangle');else if(before[i]!==after[i])changed++;}assert(changed>0,'Finer here did not refine selected fitting');report.localChangedTriangles=changed;
 await page.getByRole('button',{name:'Keep together',exact:true}).click();assert(JSON.stringify(owners(await invoke('export')))===JSON.stringify(before),'Keep together failed to restore local grouping');
 report.savedSetup=(await read()).setup;await page.evaluate(()=>window.kaminosWorkbenchExperiments.close());assert((await page.evaluate(()=>window.kaminosWorkbenchExperiments.state())).id===null,'Close did not release experiment');
 await page.evaluate(setup=>window.kaminosWorkbenchExperiments.open('fracture-shape',setup),report.savedSetup);report.reopened=await invoke('export');assert(JSON.stringify(owners(report.reopened))===JSON.stringify(before),'Reopen lost local grouping');assert(report.reopened.selected===nested.id,'Reopen lost selection');
 await invoke('resetLocal');await invoke('select',-1);await invoke('frame');
 // A real canvas click, through the same selection route as the human.
 const rect=await page.locator('#viewport').boundingBox();assert(rect,'Viewport missing');
 await page.mouse.click(rect.x+rect.width*.5,rect.y+rect.height*.52);report.clicked=await read();assert(report.clicked.selected>=0,'Canvas click did not select a surface piece');await capture('clicked');
 report.phase='threshold-filter';save();
 report.filtered=await invoke('partition',{minReachFraction:.001,minAreaFraction:.0001,cleanupAreaFraction:.001});assert(report.filtered.analysis.cacheHit===true&&report.filtered.analysis.builds===1,'Threshold edit reran source preparation');assert(Object.keys(report.filtered.localDetail).length===0,'Global edit retained stale local IDs');
 const invalid=await page.evaluate(async()=>{try{await window.kaminosWorkbenchExperiments.invoke('partition',{minReachFraction:NaN,minAreaFraction:0});return false;}catch{return true;}});assert(invalid,'Invalid threshold accepted');
 await invoke('partition',report.initial.settings);await invoke('detail',1);await invoke('select',-1);await invoke('separate',.06);await capture('separated');await invoke('separate',0);await invoke('view','original');await capture('textured');await invoke('view','regions');await capture('final');report.final=await invoke('export');
 assert(report.final.labels.length===102327&&report.final.hierarchy.faceOwners.length===102327,'Missing source triangle ownership');assert(!report.errors.length,'Uncaught browser errors');
 await page.setViewportSize({width:390,height:844});await capture('narrow');report.narrow=await page.evaluate(()=>({width:innerWidth,documentWidth:document.documentElement.scrollWidth}));assert(report.narrow.documentWidth===390,'Narrow viewport overflow');report.status='passed';
}catch(error){report.status='failed';report.failure={message:error.message,stack:error.stack};if(context)try{await context.pages()[0].screenshot({path:path.join(out,'failure.png')});}catch{}process.exitCode=1;}
finally{report.lastPhase=report.phase;report.phase='terminal';try{save();}finally{await context?.close();}}
console.log(JSON.stringify({status:report.status,failure:report.failure,out,pieces:report.initial?.partition?.parts.length,analysis:report.initial?.analysis,changed:report.localChangedTriangles}));
