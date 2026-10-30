// kaminos-test: node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
// Exercise the actual async operation without claiming GPU conformance.
const source=await fs.readFile(new URL('../experiments/sinter/burn-fracture-replay.experiment.mjs',import.meta.url),'utf8');
const start=source.indexOf('    reset(){'),end=source.indexOf('    snapshot:',start);
assert.ok(start>=0&&end>start);
const create=new Function(`
 let disposed=false,resetting=false,running=false,resetTask,error=null,resolve;
 const platform={matrixWorld:{x:0}},supportMatrix={x:0,copy(m){this.x=m.x;}};
 const support=()=>({position:[platform.matrixWorld.x,0,0]});
 const old={pose:0,read:()=>({contactsEnabled:true}),dispose(){}};
 const next={pose:0,setContactsEnabled(){},setSupport(i,s){this.pose=s.position[0];},dispose(){}};
 let dynamics=old,surface={dispose(){}};
 const createDynamics=()=>{next.pose=platform.matrixWorld.x;return new Promise(r=>resolve=()=>r(next));};
 const createPlayback=()=>({settled:()=>Promise.resolve()});let playback=createPlayback();
 const renderer={},prepared={},field={},structure={resident:()=>({sourceMaterials:[]})};
 const asset={root:{add(){}}},session={redraw(){}},record=()=>{},read=()=>({});
 const sync=()=>{},fail=e=>{throw e;},createBurnFractureSurface=()=>({dispose(){}});
 const operations={${source.slice(start,end)}};
 return {operations,move:x=>platform.matrixWorld.x=x,finish:()=>resolve(),result:()=>({pose:next.pose,cached:supportMatrix.x,resetting,error})};
`);
const state=create(),pending=state.operations.reset();
await Promise.resolve();
state.move(4);state.finish();await pending;
assert.equal(state.result().pose,4,'Replacement collision support must inherit edits made while Reset is awaiting GPU creation');
assert.equal(state.result().cached,4);
assert.equal(state.result().resetting,false);
