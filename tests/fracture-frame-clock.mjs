// kaminos-test: node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {createFractureFrameClock} from '../fracture-frame-clock.mjs';
import {createFractureHandCommands} from '../fracture-hand-commands.mjs';
import {createWorkbenchFrameService} from '../workbench-scene-host.mjs';
// Exercise the actual mounted callback with the host's real timestamp contract.
const source=fs.readFileSync(new URL('../experiments/fracture-coarse.experiment.mjs',import.meta.url),'utf8');
const begin=source.indexOf('unframe=session.onFrame('),end=source.indexOf(';\n   const operations',begin);
const statement=source.slice(begin,end+1);
function replay(hz){
 let steps=0;const frames=createWorkbenchFrameService();
 const clock=createFractureFrameClock({timeStep:1/60,step:()=>steps++,now:()=>0});clock.setActive(true);
 const bind=new Function('session','clock',`let unframe,running=true,inspectParts=false,busy=false,stepping=false,disposed=false,error='';const draw=()=>{},sync=()=>{};${statement};return unframe;`);
 bind(frames,clock);frames.tick(0);steps=0;
 for(let i=1;i<=hz;i++)frames.tick(i*1000/hz);
 return steps;
}
test('one second of host time advances one second of material at 30/60/120Hz',()=>{
 for(const hz of [30,60,120])assert.equal(replay(hz),60,`${hz}Hz must not set material speed`);
});

test('irregular frames preserve elapsed time without silently dropping debt',()=>{
 let n=0;const c=createFractureFrameClock({timeStep:1/60,step:()=>n++,now:()=>0});c.setActive(true);
 for(const t of [3,17,94,101,198,333,501,900,1000])c.tick(t);
 assert.equal(n,60);assert.ok(Math.abs(c.read().pendingSeconds)<1e-12);
 c.tick(3000);assert.equal(n,180);
});
test('pause and visibility suspension exclude inactive time while retaining fractional time',()=>{
 let n=0;const c=createFractureFrameClock({timeStep:1/60,step:()=>n++,now:()=>0});c.setActive(true,0);c.tick(10);c.setActive(false,10);
 c.tick(10000);c.setActive(true,20000);c.tick(20010);assert.equal(n,1);
 assert.ok(Math.abs(c.read().elapsedSeconds-.02)<1e-12);
});
test('a final release quantum is credited against elapsed time, not added to every gesture',()=>{
 let n=0,now=0;const model={setSurfaceHand(){},moveHand(){},release(){},step(){n++;}};
 const hand=createFractureHandCommands(model),c=createFractureFrameClock({timeStep:1/60,step:hand.step,now:()=>now});c.setActive(true);
 hand.set(0,{x:0,y:0,z:0});hand.move({x:1,y:0,z:0});now=5;
 if(hand.release())c.accountReleaseStep();assert.equal(n,1);
 c.tick(1000/60);assert.equal(n,1);c.tick(1000);assert.equal(n,60);
 assert.equal(c.read().releaseSteps,1);assert.ok(Math.abs(c.read().pendingSeconds)<1e-12);
});
test('a rejected physical submission retains its owed time and reports invalid clocks',()=>{
 let fail=true,n=0;const c=createFractureFrameClock({timeStep:1/60,step(){if(fail)throw Error('submission failed');n++;},now:()=>0});
 c.setActive(true);assert.throws(()=>c.tick(20),/submission failed/);fail=false;c.tick(20);assert.equal(n,1);
 assert.throws(()=>c.tick(19),/backwards/);assert.throws(()=>c.tick(NaN),/Finite/);
});
