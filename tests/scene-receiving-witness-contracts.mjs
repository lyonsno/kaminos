import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// Execute the exact acceptance block used before saving each native view.
const source=readFileSync(new URL('../scratch/beaming-distributed-witness.mjs',import.meta.url),'utf8');
const start=source.indexOf('        assert.equal(view.lighting.smokeMode,smokeMode);');
const end=source.indexOf('        await page.screenshot',start);
assert.ok(start>0&&end>start,'witness must validate effective state before capture');
const check=(view,smokeMode)=>vm.runInNewContext(source.slice(start,end),{assert,view,smokeMode});
for(const mode of ['legacy','distributed']) {
  const valid={lighting:{smokeMode:mode,directions:96,frame:{volumeReceivers:mode==='legacy'?0:8192}},
    volume:{error:null,physicalColor:{incidentLight:{legacyDispatched:mode==='legacy'}}}};
  check(valid,mode);
  for(const corrupt of [
    v=>{v.lighting.smokeMode=mode==='legacy'?'distributed':'legacy';},
    v=>{v.lighting.directions=24;},
    v=>{v.lighting.frame.volumeReceivers=mode==='legacy'?8192:0;},
    v=>{v.volume.physicalColor.incidentLight.legacyDispatched=mode!=='legacy';},
    v=>{v.volume.error='native validation failed';},
    v=>{delete v.lighting.frame;},
  ]) {
    const invalid=structuredClone(valid);corrupt(invalid);
    assert.throws(()=>check(invalid,mode),'wrong, missing or failed effective state must not pass capture');
  }
}
console.log('native receiving witness rejects wrong mode, shadowed samples, stale counts, duplicate solve and native errors');
