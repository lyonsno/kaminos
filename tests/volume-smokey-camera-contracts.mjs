import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const driver=readFileSync(new URL('../scripts/capture-optical-trace.mjs',import.meta.url),'utf8');
const block=driver.slice(driver.indexOf('report.effectiveCamera='),driver.indexOf("report.phase='baseline'"));
assert.ok(block.length>0,'camera admission block required');
const camera={position:[0,0,1],target:[0,0,0],up:[0,1,0],fov:50};
const run=effective=>vm.runInNewContext(`(async()=>{${block}})()`,{
  assert,report:{requestedCamera:camera},page:{evaluate:async()=>effective},
});
await run(camera);
await assert.rejects(run({...camera,fov:65}),/camera fov/);
console.log('capture rejects changed lens at unchanged pose');
