// kaminos-test: node
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {resolve,isAbsolute} from 'node:path';
const source=readFileSync(new URL('../scene-object-witness.mjs',import.meta.url),'utf8');
const start=source.indexOf('function assertExpectedServerRoot('),end=source.indexOf('\n}',start)+2;
const context=vm.createContext({resolve,isAbsolute,expectedServerRoot:'/revisions/actual',Error});vm.runInContext(source.slice(start,end),context);
// Scene storage can live outside the serving source tree (the real revision hub contract).
const roots={scenes:{path:'/operator/scenes'},runtime:{source:{repoRoot:'/revisions/actual',commit:'observed',dirty:false}}};
assert.doesNotThrow(()=>context.assertExpectedServerRoot(roots));
assert.throws(()=>context.assertExpectedServerRoot({...roots,runtime:{source:{repoRoot:'/wrong'}}}),/mismatch/);
assert.throws(()=>context.assertExpectedServerRoot({...roots,runtime:{source:{repoRoot:'relative'}}}),/absolute/);
assert.throws(()=>context.assertExpectedServerRoot({scenes:{path:'/revisions/actual/scenes'}}),/unavailable/,'Convenient storage location cannot stand in for source identity');
console.log('Witness checks serving source independently of shared scene storage');
