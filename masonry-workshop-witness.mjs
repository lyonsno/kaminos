import assert from 'node:assert/strict';
export function assertMasonryWorkshopState(state,{display,relief}={}){
 assert.equal(state?.schema,'kaminos.masonry-workshop.v1','wrong or missing experiment state');
 assert.ok(Array.isArray(state.stones)&&state.stones.length>0,'missing registered stones');
 for(const s of state.stones){assert.ok(s.id&&s.triangles>0,'missing source geometry');for(const k of ['face','margin','corner'])assert.ok(s.regions[k]>0,`missing ${k}`);}
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
 mark('source-coordinate-before',{before});
 const sourceBefore=await evaluate(ws,"window.kaminosWorkbenchExperiments.invoke('sourceData').then(d=>({point:d.stones[0].source.triangles[0].a,config:d.stones[0].source.config}))");
 mark('capturing-source',{before,sourceBefore});
 await settle();await capture(ws,out.replace(/\.png$/,'-source.png'));
 // Exercise the real field, then drain the same serialized operation path.
 await evaluate(ws,`(async()=>{const input=document.querySelector('input[aria-label="Margin relief"]');if(!input)throw Error('Missing relief control');input.value='.045';input.dispatchEvent(new Event('change',{bubbles:true}));await window.kaminosWorkbenchExperiments.invoke('recipe');})()`);
 const changed=assertMasonryWorkshopState(await read(),{display:'source',relief:.045});
 mark('source-coordinate-after',{before,changed});
 const sourceAfter=await evaluate(ws,"window.kaminosWorkbenchExperiments.invoke('sourceData').then(d=>({point:d.stones[0].source.triangles[0].a,config:d.stones[0].source.config}))");
 assert.notDeepEqual(sourceAfter.point,sourceBefore.point,'source geometry did not change');
 const rejection=await evaluate(ws,"window.kaminosWorkbenchExperiments.invoke('source',{height:-1}).then(()=>false,()=>true)");assert.equal(rejection,true);assertMasonryWorkshopState(await read(),{relief:.045});
 mark('inspecting-ray',{changed,sourceBefore,sourceAfter});
 const inspect=await evaluate(ws,"window.kaminosWorkbenchExperiments.invoke('inspect',{})");assert.ok(inspect.carrier?.hit,'probe must reach the carrier');
 await evaluate(ws,`(async()=>{const s=document.querySelector('select[aria-label="Masonry view"]');if(!s)throw Error('Missing view control');s.value='regions';s.dispatchEvent(new Event('change',{bubbles:true}));await window.kaminosWorkbenchExperiments.invoke('recipe');})()`);
 mark('reading-regions',{changed,inspect});
 const regions=assertMasonryWorkshopState(await read(),{display:'regions',relief:.045});await settle();await capture(ws,out.replace(/\.png$/,'-regions.png'));
 await evaluate(ws,"window.kaminosWorkbenchExperiments.invoke('display',{mode:'carrier'})");assertMasonryWorkshopState(await read(),{display:'carrier'});await settle();await capture(ws,out.replace(/\.png$/,'-carrier.png'));
 await evaluate(ws,"window.kaminosWorkbenchExperiments.invoke('display',{mode:'source'})");
 await evaluate(ws,"window.kaminosWorkbenchExperiments.invoke('source',{relief:.025})");
 await settle();return {before,changed,regions,inspect,final:assertMasonryWorkshopState(await read(),{display:'source',relief:.025})};
}
