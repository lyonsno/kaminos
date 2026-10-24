// kaminos-test: node
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../scene-object-witness.mjs',import.meta.url),'utf8');
const assignment = source.match(/const resourceNames = [^;]+;/)?.[0];
assert.ok(assignment,'asset-link resource collection exists');
const late='http://localhost/api/read?root=greenroom&path=late.png';
const early='http://localhost/early.mjs';
const collect=(observed,timings)=>vm.runInNewContext(`(()=>{${assignment};return resourceNames;})()`,{window:{__kaminosWitnessResourceNames:observed},performance:{getEntriesByType:()=>timings.map(name=>({name}))}});
assert.ok(collect([late],[early]).includes(late),'a real request observed after the timing buffer filled must remain available');
assert.ok(!collect([],[early]).includes(late),'missing requested resource must not be synthesized');
assert.equal(collect([late,late],[late]).filter(x=>x===late).length,1,'resource history deduplicates without dropping identities');
assert.ok(collect(undefined,[early]).includes(early),'timing entries remain supported without observer history');
const init = source.match(/function installAssetResourceHistory\(\) \{[\s\S]*?\n\}/)?.[0];
assert.ok(init,'observer installer is available');
let callback;const window={};
class Observer {constructor(cb){callback=cb;} observe(options){assert.equal(options.type,'resource');assert.equal(options.buffered,true);}}
vm.runInNewContext(`${init};installAssetResourceHistory();`,{window,PerformanceObserver:Observer});
const many=Array.from({length:1001},(_,i)=>({name:'http://localhost/'+i}));
callback({getEntries:()=>many});
assert.equal(window.__kaminosWitnessResourceNames.length,1001,'observer retains every delivered resource without a new cap');
assert.ok(source.includes("Page.addScriptToEvaluateOnNewDocument"),'record before navigation');
console.log('asset resource history: late, absent, duplicate, default and uncapped delivery checks passed');
