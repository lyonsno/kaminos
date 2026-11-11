import assert from 'node:assert/strict';
export function assertMasonryWorkshopState(state,{display,relief}={}){
 assert.equal(state?.schema,'kaminos.masonry-workshop.v1','wrong or missing experiment state');
 assert.ok(Array.isArray(state.stones)&&state.stones.length>0,'missing registered stones');
 for(const s of state.stones){assert.ok(s.id&&s.triangles>0,'missing source geometry');for(const k of ['face','margin','corner'])assert.ok(Number.isInteger(s.regions[k])&&s.regions[k]>=0,`missing ${k}`);assert.equal(Object.values(s.regions).reduce((n,v)=>n+v,0),s.triangles,'region accounting must cover actual triangles');}
 assert.equal(state.representations?.nvidia,'unimplemented','this source smoke must not claim fitted NVIDIA');
 assert.equal(state.representations?.sbtf,'unimplemented','this source smoke must not claim fitted SBTF');
 assert.equal(state.representations?.appearance,'ordinary PBR baseline');
 if(display!==undefined)assert.equal(state.display,display,'stale/fallback display');
 if(relief!==undefined)assert.equal(state.source.relief,relief,'stale/fallback source recipe');
 return state;
}
export async function runMasonryWorkshopWitness({evaluate,ws,capture,out,onEvidence=()=>{}}){
 const settle=()=>evaluate(ws,'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
 const read=()=>evaluate(ws,'window.kaminosWorkbenchExperiments.read()');
 const mark=(phase,evidence={})=>onEvidence({phase,...evidence});
 mark('reading-initial-state');
 const before=assertMasonryWorkshopState(await read(),{display:'source',relief:.025});
 const controls=await evaluate(ws,`(()=>{const e=document.querySelector('input[aria-label="Margin relief"]');return {wrapped:e?.parentElement?.classList.contains('authoring-number-wrap')};})()`);assert.equal(controls.wrapped,true,'numeric presentation must mount around the actual input');
 mark('source-coordinate-before',{before});
 const sourceBefore=await evaluate(ws,"window.kaminosWorkbenchExperiments.invoke('sourceData').then(d=>({point:d.stones[0].source.triangles[0].a,config:d.stones[0].source.config}))");
 mark('capturing-source',{before,sourceBefore});
 await settle();await capture(ws,out.replace(/\.png$/,'-source.png'));
 // Exercise the real field, then drain the same serialized operation path.
 await evaluate(ws,`(async()=>{const input=document.querySelector('input[aria-label="Margin relief"]');if(!input)throw Error('Missing relief control');input.value='45';input.dispatchEvent(new Event('change',{bubbles:true}));await window.kaminosWorkbenchExperiments.invoke('flushEdits');})()`);
 const changed=assertMasonryWorkshopState(await read(),{display:'source',relief:.045});
 mark('source-coordinate-after',{before,changed});
 const sourceAfter=await evaluate(ws,"window.kaminosWorkbenchExperiments.invoke('sourceData').then(d=>({point:d.stones[0].source.triangles[0].a,config:d.stones[0].source.config}))");
 assert.notDeepEqual(sourceAfter.point,sourceBefore.point,'source geometry did not change');
 await evaluate(ws,"window.kaminosWorkbenchExperiments.invoke('resolution',{display:12,integral:24})");
 const resolutionState=await read();assert.equal(resolutionState.resolutions.display,12);assert.equal(resolutionState.resolutions.integral,24);assert.equal(resolutionState.stones[0].displayTriangles,12*12*12);assert.equal(resolutionState.stones[0].triangles,12*24*24);
 await evaluate(ws,"window.kaminosWorkbenchExperiments.invoke('display',{mode:'integral'})");await settle();await capture(ws,out.replace(/\.png$/,'-integral.png'));
 await evaluate(ws,"window.kaminosWorkbenchExperiments.invoke('display',{mode:'source'})");
 const rejection=await evaluate(ws,"window.kaminosWorkbenchExperiments.invoke('source',{height:-1}).then(()=>false,()=>true)");assert.equal(rejection,true);assertMasonryWorkshopState(await read(),{relief:.045});
 const invalidField=await evaluate(ws,`(async()=>{const e=document.querySelector('input[aria-label="Margin relief"]');e.focus();e.value='300';e.dispatchEvent(new Event('change',{bubbles:true}));await window.kaminosWorkbenchExperiments.invoke('flushEdits');return {value:e.value,error:document.querySelector('[role="status"]')?.textContent};})()`);assert.equal(Number(invalidField.value),45,'rejected focused edit restores accepted value');
 mark('inspecting-ray',{changed,sourceBefore,sourceAfter,invalidField});
 const zeroField=await evaluate(ws,`(async()=>{const e=document.querySelector('input[aria-label="Margin relief"]');e.value='-4';e.dispatchEvent(new Event('input',{bubbles:true}));await window.kaminosWorkbenchExperiments.invoke('flushEdits');const zero=await window.kaminosWorkbenchExperiments.read();e.value='45';e.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(resolve=>setTimeout(resolve,130));const live=await window.kaminosWorkbenchExperiments.read();return {zero:zero.source.relief,live:live.source.relief};})()`);assert.deepEqual(zeroField,{zero:0,live:.045});
 const inspect=await evaluate(ws,"window.kaminosWorkbenchExperiments.invoke('inspect',{})");assert.ok(inspect.carrier?.hit,'probe must reach the carrier');assert.equal(inspect.visibleHit.resolution,12);assert.equal(inspect.source.resolution,24);assert.deepEqual(inspect.visibleHit,inspect.displaySource);
 await evaluate(ws,`(async()=>{const s=document.querySelector('select[aria-label="Masonry view"]');if(!s)throw Error('Missing view control');s.value='regions';s.dispatchEvent(new Event('change',{bubbles:true}));await window.kaminosWorkbenchExperiments.invoke('flushEdits');})()`);
 mark('reading-regions',{changed,inspect});
 const regions=assertMasonryWorkshopState(await read(),{display:'regions',relief:.045});await settle();await capture(ws,out.replace(/\.png$/,'-regions.png'));
 await evaluate(ws,"window.kaminosWorkbenchExperiments.invoke('display',{mode:'carrier'})");assertMasonryWorkshopState(await read(),{display:'carrier'});await settle();await capture(ws,out.replace(/\.png$/,'-carrier.png'));
 await evaluate(ws,"window.kaminosWorkbenchExperiments.invoke('display',{mode:'source'})");
 const typing=await evaluate(ws,`(async()=>{const divisions=document.querySelector('input[aria-label="Display divisions"]');divisions.focus();divisions.value='1';divisions.dispatchEvent(new Event('input',{bubbles:true}));const prefix=divisions.value;divisions.value='16';divisions.dispatchEvent(new Event('input',{bubbles:true}));await window.kaminosWorkbenchExperiments.invoke('flushEdits');const state=await window.kaminosWorkbenchExperiments.read();divisions.blur();const relief=document.querySelector('input[aria-label="Margin relief"]');relief.focus();relief.value='0.0';relief.dispatchEvent(new Event('input',{bubbles:true}));const decimal=relief.value;relief.value='0.05';relief.dispatchEvent(new Event('input',{bubbles:true}));await window.kaminosWorkbenchExperiments.invoke('flushEdits');const fine=await window.kaminosWorkbenchExperiments.read();relief.blur();return {prefix,decimal,display:state.resolutions.display,relief:fine.source.relief,seedMax:document.querySelector('input[aria-label="Source seed"]').max};})()`);assert.deepEqual(typing,{prefix:'1',decimal:'0.0',display:16,relief:.00005,seedMax:''});
 await evaluate(ws,"window.kaminosWorkbenchExperiments.invoke('source',{relief:.025})");
 await settle();return {before,changed,resolutionState,zeroField,typing,regions,inspect,final:assertMasonryWorkshopState(await read(),{display:'source',relief:.025})};
}

export function assertMasonryBrowserValidation(stderr){assert.ok(!stderr.includes('used in submit while destroyed'),'destroyed GPU buffer invalidates the masonry browser run');}
