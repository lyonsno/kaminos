import assert from 'node:assert/strict';
export function checkHillCadence(r,expected={bodyCount:100}){
 assert.match(r.hardware.vendor??'',/apple/i);assert.notEqual(r.hardware.isFallbackAdapter,true);
 assert.equal(r.effective.fixture,'hundred-rocks');for(const [key,value] of Object.entries(expected))assert.equal(r.effective[key],value,'Unexpected effective '+key);assert.equal(r.effective.dt,.0015);
 assert.equal(r.frames.length,r.frameCount);assert.ok(r.frameCount>0);
 for(const f of r.frames){assert.equal(f.drawn,true);assert.ok(Number.isFinite(f.wallMs)&&f.wallMs>0);assert.ok(Number.isInteger(f.physicalSteps)&&f.physicalSteps>0);assert.equal(f.afterSteps-f.beforeSteps,f.physicalSteps);}
 assert.ok(r.natural.hostTimes.length>1);assert.ok(r.natural.elapsedMs>0&&Number.isFinite(r.natural.elapsedMs));assert.ok(r.natural.endSteps>r.natural.startSteps);assert.equal(r.natural.playing,false);
 return r;
}
