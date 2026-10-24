// Ordinary Workbench interaction smoke, not a performance benchmark.
// Usage: node tools/fracture-attachment-witness.mjs URL OUTPUT PLAYWRIGHT BROWSER [OBJECT_JSON]
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {checkRefinement,checkBoundaryChange} from './fracture-refinement-check.mjs';
const [url,out,playwright,executable,objectSpec]=process.argv.slice(2);
if(!url||!out||!playwright||!executable)throw Error('URL, output directory, Playwright module and independent browser executable required');
fs.mkdirSync(out,{recursive:true});
const root=path.resolve(new URL('..',import.meta.url).pathname);let commit=null;
const report={status:'running',phase:'source-identification',requestedURL:url,sourceRoot:root,sourceCommit:commit,executable,errors:[],console:[]};
const save=()=>{const target=path.join(out,'report.json');fs.writeFileSync(target+'.next',JSON.stringify(report,null,2));fs.renameSync(target+'.next',target);};
const assert=(ok,message)=>{if(!ok)throw Error(message);};let context;save();
try{
 let object={name:'kiln',triangles:102327,sha256:'0825ee134ba3161412257d01ec5461d95344844d27ce500cc4805aed6ce9e75f'};
 if(objectSpec){report.phase='object-identity';save();object=JSON.parse(fs.readFileSync(objectSpec,'utf8'));assert(typeof object.name==='string'&&Number.isInteger(object.triangles)&&object.triangles>0&&/^[a-f0-9]{64}$/.test(object.sha256)&&typeof object.source==='string','Invalid object identity: name, positive triangle count, SHA256 and source required');}
 report.phase='object-identity';const click=object.click??[.5,.52];assert(Array.isArray(click)&&click.length===2&&click.every(v=>Number.isFinite(v)&&v>=0&&v<=1),'Invalid fixture click: two viewport fractions required');
 report.object=object;report.fixtureClick=click;report.phase='source-identification';save();
 commit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();report.sourceCommit=commit;report.phase='launch';save();
 const {chromium}=await import(playwright);
 context=await chromium.launchPersistentContext(path.join(out,'profile'),{headless:true,executablePath:executable,viewport:{width:1440,height:1100},args:['--use-mock-keychain','--password-store=basic','--enable-unsafe-webgpu','--use-gl=angle','--use-angle=metal']});
 context.setDefaultTimeout(0);context.setDefaultNavigationTimeout(0);
 const page=context.pages()[0];page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>report.console.push({type:m.type(),text:m.text()}));
 await page.goto(url,{waitUntil:'domcontentloaded'});report.phase='loading';save();
 await page.waitForFunction(()=>window.kaminosWorkbenchExperiments?.state().id==='fracture-shape');
 const invoke=(name,value)=>page.evaluate(({name,value})=>window.kaminosWorkbenchExperiments.invoke(name,value),{name,value});
 const read=()=>page.evaluate(()=>window.kaminosWorkbenchExperiments.read());
 const capture=async name=>{await page.evaluate(()=>document.activeElement?.blur?.());await page.waitForTimeout(400);await page.screenshot({path:path.join(out,name+'.png')});};
 report.phase='source-conformance';report.effectiveURL=page.url();report.runtime=await page.evaluate(async()=>({config:await(await fetch('/api/runtime-config')).json(),scene:window.kaminosWorkbenchSceneState?.()}));report.initial=await read();save();
 assert(report.runtime.config.source.commit===commit,'Effective served revision differs from inspected checkout');
 assert(report.initial.triangleCount===object.triangles,'Wrong source triangle count');if(object.source)assert(report.initial.source===object.source,'Wrong requested source route');
 report.sourceFiles={};for(const name of ['fracture-boundary-edit.mjs','fracture-shape-worker-core.mjs','fracture-shape-partition.mjs','fracture-shape-partition.worker.mjs','experiments/fracture-shape.experiment.mjs','scene-control-history.mjs']){const expected=createHash('sha256').update(fs.readFileSync(path.join(root,name))).digest('hex'),response=await page.request.get(new URL(name,page.url()).href),actual=createHash('sha256').update(await response.body()).digest('hex');assert(response.ok()&&expected===actual,`Wrong served source: ${name}`);report.sourceFiles[name]=actual;}
 const asset=await page.request.get(new URL(report.initial.source,page.url()).href);report.assetDigest=createHash('sha256').update(await asset.body()).digest('hex');assert(asset.ok()&&report.assetDigest===object.sha256,'Wrong asset bytes');
 assert(report.initial.analysis.passes===7&&report.initial.analysis.cacheHit===false,'Seven-origin initial preparation missing');
 await invoke('frame');await capture('initial');
 report.phase='local-controls';save();
 const nested=report.initial.hierarchy.nodes.filter(n=>n.kind==='branch'&&n.children.length&&n.triangles>500).sort((a,b)=>b.triangles-a.triangles)[0];assert(nested,'No substantial nested fitting to exercise');
 await invoke('select',nested.id);await invoke('keepTogether');report.kept=await invoke('export');await capture('selected-together');await invoke('separate',.06);await capture('selected-together-separated');await invoke('separate',0);
 await page.getByRole('button',{name:'Finer here',exact:true}).click();report.refined=await invoke('export');await capture('selected-refined');await invoke('separate',.06);await capture('selected-refined-separated');await invoke('separate',0);
 const owners=r=>r.labels.map(id=>r.partition.parts[id].nodeId),before=owners(report.kept),after=owners(report.refined),nodes=report.kept.hierarchy.nodes;
 const inside=id=>{while(id!==null){if(id===nested.id)return true;id=nodes[id].parent;}return false;};
 let changed=0;for(let i=0;i<before.length;i++){if(!inside(report.kept.hierarchy.faceOwners[i]))assert(before[i]===after[i],'Local refinement changed an outside triangle');else if(before[i]!==after[i])changed++;}assert(changed>0,'Finer here did not refine selected fitting');report.localChangedTriangles=changed;
 await page.getByRole('button',{name:'Keep together',exact:true}).click();assert(JSON.stringify(owners(await invoke('export')))===JSON.stringify(before),'Keep together failed to restore local grouping');
 report.reapplied=await invoke('partition',report.initial.settings);assert(JSON.stringify(owners(await invoke('export')))===JSON.stringify(before),'Unchanged thresholds discarded local grouping');
 report.savedSetup=(await read()).setup;await page.evaluate(()=>window.kaminosWorkbenchExperiments.close());assert((await page.evaluate(()=>window.kaminosWorkbenchExperiments.state())).id===null,'Close did not release experiment');
 await page.evaluate(setup=>window.kaminosWorkbenchExperiments.open('fracture-shape',setup),report.savedSetup);report.reopened=await invoke('export');assert(JSON.stringify(owners(report.reopened))===JSON.stringify(before),'Reopen lost local grouping');assert(report.reopened.selected===nested.id,'Reopen lost selection');
 await invoke('resetLocal');await invoke('detail',1);await invoke('select',0);await invoke('refine');await invoke('refine');
 report.ancestorRefined=await invoke('export');await invoke('select',nested.id);report.descendantSelected=await invoke('export');
 assert(JSON.stringify(owners(report.descendantSelected))===JSON.stringify(owners(report.ancestorRefined)),'Selecting a represented descendant changed grouping');
 await invoke('refine');report.descendantRefined=await invoke('export');
 report.inheritedRefinement=checkRefinement(report.descendantSelected,report.descendantRefined,nested.id);
 await invoke('resetLocal');await invoke('select',-1);await invoke('frame');
 // A real canvas click, through the same selection route as the human.
 const rect=await page.locator('#viewport').boundingBox();assert(rect,'Viewport missing');
 report.clickPoint={x:rect.x+rect.width*click[0],y:rect.y+rect.height*click[1],viewport:rect};await page.mouse.click(report.clickPoint.x,report.clickPoint.y);report.clicked=await read();assert(report.clicked.selected>=0,'Canvas click did not select a surface piece');await capture('clicked');
 report.phase='control-history';save();
 await invoke('detail',Math.min(1,report.initial.hierarchy.maxDepth));await invoke('select',-1);report.beforeBrowsing=await invoke('export');
 const deepest=report.initial.hierarchy.nodes.reduce((a,b)=>b.depth>a.depth?b:a);
 await invoke('select',deepest.id);await invoke('select',-1);report.afterBrowsing=await invoke('export');
 assert(JSON.stringify(owners(report.beforeBrowsing))===JSON.stringify(owners(report.afterBrowsing)),'Browsing a hidden piece changed grouping');
 await invoke('detail',report.initial.hierarchy.maxDepth);report.beforeThresholdTrip=await invoke('export');
 await invoke('partition',{...report.initial.settings,minAreaFraction:1});report.coarseThreshold=await read();
 await invoke('partition',report.initial.settings);report.afterThresholdTrip=await invoke('export');
 assert(report.afterThresholdTrip.detailLevel===report.beforeThresholdTrip.detailLevel,'Threshold detour erased requested detail');
 assert(JSON.stringify(owners(report.beforeThresholdTrip))===JSON.stringify(owners(report.afterThresholdTrip)),'Threshold round trip changed grouping');
 const parent=report.initial.hierarchy.nodes.find(n=>n.children.some(id=>report.initial.hierarchy.nodes[id].children.length));
 assert(parent,'No nested parent for grouping-history comparison');const child=parent.children.find(id=>report.initial.hierarchy.nodes[id].children.length);
 await invoke('detail',report.initial.hierarchy.maxDepth);await invoke('select',child);await invoke('keepTogether');await invoke('select',parent.id);
 report.parentButtonBefore=await invoke('export');const parentButton=page.getByRole('button',{name:'Finer here',exact:true});assert(await parentButton.isEnabled(),'Parent refinement unavailable above a coarser child');await parentButton.click();report.parentButtonAfter=await invoke('export');report.parentButtonRefinement=checkRefinement(report.parentButtonBefore,report.parentButtonAfter,parent.id);
 await invoke('select',child);await invoke('keepTogether');await invoke('select',parent.id);await invoke('keepTogether');await invoke('refine');await invoke('refine');report.withChildHistory=await invoke('export');
 await invoke('detail',report.initial.hierarchy.maxDepth);await invoke('select',parent.id);await invoke('keepTogether');await invoke('refine');await invoke('refine');report.withoutChildHistory=await invoke('export');
 assert(JSON.stringify(owners(report.withChildHistory))===JSON.stringify(owners(report.withoutChildHistory)),'Old child overrides resurrected after parent edit');
 // The new absolute local slider uses the same domain operation as agent calls.
 const localSlider=page.getByRole('spinbutton',{name:'Selected piece detail',exact:true});const maximum=Number(await localSlider.getAttribute('max'));
 await localSlider.click();await localSlider.fill(String(maximum));await localSlider.press('Tab');report.sliderResult=await read();assert(report.sliderResult.localDetail[parent.id]===maximum,'Selected piece slider did not set explicit detail');
 report.phase='friendly-controls';save();
 await page.getByText('Global detection settings',{exact:true}).click();
 const names=['Selected piece detail','Preview separation','Grouping detail','Minimum branch reach (% object extent)','Minimum branch area (% surface)','Merge surface patches below (% surface)','Cut position (% object extent)'];
 for(const name of names){const field=page.getByRole('spinbutton',{name,exact:true});assert(await field.evaluate(e=>e.classList.contains('authoring-number')&&e.parentElement.classList.contains('authoring-number-wrap')),`Shared number-drag missing: ${name}`);}
 assert(await page.getByRole('button',{name:'Apply global thresholds',exact:true}).count()===0,'Tuning still requires an Apply button');
 const reachField=page.getByRole('spinbutton',{name:names[3],exact:true}),areaField=page.getByRole('spinbutton',{name:names[4],exact:true});
 const settled=()=>page.evaluate(async()=>{let state;do{await new Promise(requestAnimationFrame);state=await window.kaminosWorkbenchExperiments.read();}while(state.busy);return state;});
 const type=async(field,value)=>{await field.click();await field.fill(String(value));await field.press('Tab');};
 await type(reachField,.2);await type(reachField,.3);await type(areaField,.02);await settled();report.typedThresholds=await read();
 assert(report.typedThresholds.settings.minReachFraction===.003&&report.typedThresholds.settings.minAreaFraction===.0002,'Typed parameters did not update automatically');
 await type(reachField,.1);await settled();
 const drag=async fine=>{await reachField.scrollIntoViewIfNeeded();const box=await reachField.boundingBox(),x=box.x+box.width/2,y=box.y+box.height/2;await page.mouse.move(x,y);if(fine)await page.keyboard.down('Shift');await page.mouse.down();await page.mouse.move(x+12,y);await page.mouse.up();if(fine)await page.keyboard.up('Shift');await settled();return (await read()).settings.minReachFraction;};
 report.normalDrag=await drag(false);assert(Math.abs(report.normalDrag-.00112)<1e-9,'Normal drag lost the small-value scale');
 await type(reachField,.1);await settled();report.fineDrag=await drag(true);assert(Math.abs(report.fineDrag-.001012)<1e-9,'Shift fine drag did not preserve tenfold precision');
 await reachField.click();await reachField.fill('');await reachField.press('Tab');assert(Number(await reachField.inputValue())>0,'Blank input silently applied zero');
 await capture('friendly-controls');
 await invoke('detail',Math.min(1,report.initial.hierarchy.maxDepth));
 report.phase='threshold-filter';save();
 report.filtered=await invoke('partition',{minReachFraction:.001,minAreaFraction:.0001,cleanupAreaFraction:.001});assert(report.filtered.analysis.cacheHit===true&&report.filtered.analysis.builds===1,'Threshold edit reran source preparation');assert(Object.keys(report.filtered.localDetail).length===0,'Global edit retained stale local IDs');
 const invalid=await page.evaluate(async()=>{try{await window.kaminosWorkbenchExperiments.invoke('partition',{minReachFraction:NaN,minAreaFraction:0});return false;}catch{return true;}});assert(invalid,'Invalid threshold accepted');
 await invoke('partition',report.initial.settings);await invoke('detail',1);await invoke('select',-1);await invoke('separate',.06);await capture('separated');await invoke('separate',0);await invoke('view','original');await capture('textured');await invoke('view','regions');await capture('final');report.final=await invoke('export');
 assert(report.final.labels.length===object.triangles&&report.final.hierarchy.faceOwners.length===object.triangles,'Missing source triangle ownership');assert(!report.errors.length,'Uncaught browser errors');
 report.phase='attachment-boundary';save();
 await invoke('select',nested.id);await invoke('keepTogether');report.boundaryBase=await invoke('export');const targetKey=report.boundaryBase.hierarchy.nodes[nested.id].key;
 const candidateFaces=r=>r.candidateBranches.find(c=>c.key===targetKey&&c.status==='included').faces;
 const choice=page.getByRole('combobox',{name:'Attachment boundary',exact:true});
 report.boundaryChoices=await choice.locator('option').evaluateAll(items=>items.map(e=>({value:e.value,text:e.textContent})));
 if(object.name==='kiln')assert(report.boundaryChoices.length>1,'No alternative attachment boundary available on the kiln fitting');
 await invoke('separate',.035);await capture('boundary-original');await invoke('separate',0);
 if(report.boundaryChoices.length>1){
  await choice.selectOption(report.boundaryChoices[1].value);await settled();report.boundaryAlternative=await invoke('export');
  report.alternativeCheck=checkBoundaryChange(report.boundaryBase,report.boundaryAlternative,targetKey);
  await invoke('separate',.035);await capture('boundary-alternative');await invoke('separate',0);
  await choice.selectOption('original');await settled();assert(JSON.stringify(candidateFaces(await invoke('export')))===JSON.stringify(candidateFaces(report.boundaryBase)),'Original boundary choice did not restore membership');
 }
 const cutField=page.getByRole('spinbutton',{name:'Cut position (% object extent)',exact:true});
 await type(cutField,.2);await settled();report.boundaryOutward=await invoke('export');report.outwardCheck=checkBoundaryChange(report.boundaryBase,report.boundaryOutward,targetKey,{expectedOffsetFraction:.002});
 await invoke('separate',.035);await capture('boundary-outward');await invoke('separate',0);
 await type(cutField,-.2);await settled();report.boundaryInward=await invoke('export');report.inwardCheck=checkBoundaryChange(report.boundaryBase,report.boundaryInward,targetKey,{expectedOffsetFraction:-.002});
 await invoke('separate',.035);await capture('boundary-inward');await invoke('separate',0);
 await type(cutField,.2);await settled();report.boundaryRepeated=await invoke('export');assert(JSON.stringify(candidateFaces(report.boundaryRepeated))===JSON.stringify(candidateFaces(report.boundaryOutward)),'Cut position depends on edit history');
 const cutSetup=(await read()).setup;await page.evaluate(()=>window.kaminosWorkbenchExperiments.close());await page.evaluate(setup=>window.kaminosWorkbenchExperiments.open('fracture-shape',setup),cutSetup);report.boundaryReopened=await invoke('export');
 assert(JSON.stringify(candidateFaces(report.boundaryReopened))===JSON.stringify(candidateFaces(report.boundaryRepeated)),'Reopen lost edited boundary');
 await invoke('partition',{...report.initial.settings,minAreaFraction:1});report.boundaryAfterGlobal=await invoke('export');assert(JSON.stringify(candidateFaces(report.boundaryAfterGlobal))===JSON.stringify(candidateFaces(report.boundaryRepeated)),'Global detection erased an edited cut');
 await invoke('partition',report.initial.settings);await invoke('boundary',0);await capture('boundary-controls');
 assert(!report.errors.length,'Uncaught browser errors after boundary editing');
 await page.setViewportSize({width:390,height:844});await capture('narrow');report.narrow=await page.evaluate(()=>({width:innerWidth,documentWidth:document.documentElement.scrollWidth}));assert(report.narrow.documentWidth===390,'Narrow viewport overflow');report.status='passed';
}catch(error){report.status='failed';report.failure={message:error.message,stack:error.stack};if(context)try{await context.pages()[0].screenshot({path:path.join(out,'failure.png')});}catch{}process.exitCode=1;}
finally{report.lastPhase=report.phase;report.phase='terminal';try{save();}finally{await context?.close();}}
console.log(JSON.stringify({status:report.status,failure:report.failure,out,pieces:report.initial?.partition?.parts.length,analysis:report.initial?.analysis,changed:report.localChangedTriangles}));
