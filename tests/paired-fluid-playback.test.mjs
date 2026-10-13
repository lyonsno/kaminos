import test from 'node:test';import assert from 'node:assert/strict';
let create;try{({createPairedFluidPlayback:create}=await import('../paired-fluid-playback.mjs'));}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
function fixture(fail=false){let steps=[0,0],shown,events=[];const backend={dt:1/60,read:()=>steps.map((step,i)=>({id:'arm'+i,generation:1,step,dt:1/60})),capture:()=>steps.map(step=>({step})),advance:async i=>{if(fail&&i===1)throw Error('candidate broke');steps[i]++;},show:frames=>{shown=frames.map(f=>f.step);},dispose(){}};return{backend,events,get steps(){return steps;},get shown(){return shown;}};}
test('paired playback scrubs the actual retained trajectory without rewinding live solvers',async()=>{
 assert.equal(typeof create,'function','Paired controller unavailable');const f=fixture(),c=await create({backend:f.backend,record:e=>f.events.push(e)});
 await c.seek(3);assert.deepEqual(f.steps,[3,3]);assert.deepEqual(f.shown,[3,3]);await c.seek(1);assert.deepEqual(f.steps,[3,3]);assert.deepEqual(f.shown,[1,1]);
 await c.seek(4);assert.deepEqual(f.steps,[4,4]);assert.equal(c.read().timeSeconds,4/60);assert.equal(c.read().retainedFrames,5);
 c.play({endStep:6,rate:2});await c.tick(0);await c.tick(1000/60);assert.equal(c.read().step,6);assert.equal(c.read().playing,false);assert.equal(c.read().dt,1/60);
 assert.equal(f.events.at(-1).effective.arms.length,2);await c.dispose();assert.rejects(c.seek(0),/disposed/);
});
test('pause interrupts a pending advance at a complete pair boundary',async()=>{
 const f=fixture();let release;const advance=f.backend.advance;
 f.backend.advance=async i=>{if(i===0&&f.steps[0]===0)await new Promise(resolve=>{release=resolve;});await advance(i);};
 const c=await create({backend:f.backend,record:e=>f.events.push(e)}),pending=c.seek(20);
 await new Promise(resolve=>setImmediate(resolve));c.pause();release();await pending;
 assert.deepEqual(f.steps,[1,1]);assert.equal(c.read().failure,null);assert.equal(f.events.at(-1).phase,'interrupted');await c.dispose();
});
test('one failed arm remains a partial pair and cannot masquerade as aligned',async()=>{
 assert.equal(typeof create,'function');const f=fixture(true),c=await create({backend:f.backend,record:e=>f.events.push(e)});
 await assert.rejects(c.seek(1),/candidate broke/);assert.deepEqual(f.steps,[1,0]);assert.equal(c.read().aligned,false);assert.equal(c.read().failure,'candidate broke');assert.equal(f.events.at(-1).phase,'failed');await c.dispose();
});
