import assert from 'node:assert/strict';
import {sceneGIRestoreIdentity} from '../scene-gi-evidence.mjs';
const observedRestoredFile='refractory-kiln_2026-09-25_07-10-26_7efc73826a384890b532aa1634cb4136.kaminos.json';
const requestedRestoreFilename='handy-floor-restore-gray-floor002-1006.kaminos.json';
const restore=sceneGIRestoreIdentity(requestedRestoreFilename,'http://127.0.0.1:18537/#scene='+observedRestoredFile);
assert.equal(restore.restoreFixture,observedRestoredFile,'minted filename must come from effective restored route');
assert.equal(restore.requestedRestoreFilename,requestedRestoreFilename);
assert.equal(sceneGIRestoreIdentity('ignored','http://local/?scene=authored.kaminos.json').restoreFixture,'authored.kaminos.json');
assert.throws(()=>sceneGIRestoreIdentity('missing','http://local/'),'missing effective artifact must fail');
import {existsSync} from 'node:fs';
const path=new URL('../scene-gi-evidence.mjs',import.meta.url);
// Before this validator, the witness accepted a run without pixel admission.
const admit=existsSync(path)?(await import(path)).admitSceneGIComparison:()=>true;
assert.throws(()=>admit({}),/evidence/, 'missing pixel/route evidence must not pass');
const pixels=v=>({width:2,height:1,values:[v,v,v,255,30,40,50,255]});
const good={native:true,root:'owned',expectedRoot:'owned',errors:[],sourceBefore:'abc',sourceAfter:'abc',
  giRaw:{max:2,nonzero:3},baseline:pixels(10),restored:pixels(10),combined:pixels(12),zero:pixels(10),
  bounce:{...pixels(2),view:'gi',gain:1,frameBefore:4,frameAfter:5},
  visibility:{...pixels(80),view:'ao',gain:1,frameBefore:5,frameAfter:6}};
assert.ok(admit(good));
for(const bad of [{bounce:{...good.bounce,view:'scene'}},{bounce:{...good.bounce,...good.combined}},
  {visibility:{...good.visibility,frameAfter:5}},{bounce:{...good.bounce,gain:0}},{visibility:undefined}]) {
  assert.throws(()=>admit({...good,...bad}),/evidence/,'wrong or stale diagnostics must not pass');
}
for(const bad of [{native:false},{root:'wrong'},{errors:['validation']},{sourceAfter:'changed'},
  {giRaw:{max:0,nonzero:0}},{combined:pixels(10)},{restored:pixels(0)},
  {baseline:{width:2,height:1,values:[]}}, {combined:{width:2,height:1,values:[NaN]}}]) {
  assert.throws(()=>admit({...good,...bad}),/evidence/);
}
console.log('scene GI evidence rejects wrong route, errors, changed source, blank, partial and disconnected output');
