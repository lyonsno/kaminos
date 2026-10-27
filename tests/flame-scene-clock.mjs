// kaminos-test: node
import assert from 'node:assert/strict';
let implementation={};try{implementation=await import('../flame-scene-clock.mjs');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
assert.equal(typeof implementation.createFlameSceneClock,'function','A courtyard clock must follow the real fluid step counter and hold/exact-step that same solver');
const {createFlameSceneClock}=implementation;
let count=20,paused=false,released=false,sourceActive=true,lookFrozen=false;const steps=[];
const c=createFlameSceneClock({readRuntime:()=>({active:sourceActive,lookFrozen,simStepCount:count,simulationPaused:paused,timeStep:{effective:{dtScale:1}}}),pauseSimulation:value=>{paused=value;},stepSimulation:r=>{steps.push(r);count+=r.steps;},now:()=>1000,onRelease:()=>{released=true;}});
assert.equal(paused,true);assert.equal(c.take(),0);c.setRunning(true);count+=6;assert.ok(Math.abs(c.take()-.1)<1e-12);assert.equal(c.take(),0);c.setRunning(false);assert.equal(paused,true);assert.throws(()=>c.setRunning('yes'));assert.throws(()=>c.advance({seconds:-1}));
c.advance({seconds:.01});assert.equal(count,26);c.advance({seconds:.09});assert.equal(count,32);assert.equal(steps[0].steps,6);assert.equal(c.take(),0,'Exact steps cannot be consumed a second time as live frames');
sourceActive=false;c.setRunning(true);assert.equal(c.take(.25),.25,'An absent source cannot freeze the creatures');assert.equal(count,32);sourceActive=true;lookFrozen=true;assert.equal(c.take(.2),.2,'A manually frozen source still leaves creatures alive');lookFrozen=false;assert.throws(()=>c.advance({seconds:1}),/hold|pause/i);c.setRunning(false);c.dispose();assert.equal(paused,false);assert.equal(released,true);assert.throws(()=>c.take(),/released/);
console.log('Scene time follows actual fluid ticks, pauses without hidden work, exact-advances once and restores clock custody');
