// kaminos-test: node
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('../volume-settings-preset-witness.mjs',import.meta.url),'utf8');
const start=source.indexOf('function assertOrdinaryCockpitState('),end=source.indexOf('function assertNumericEquivalent(',start);
const check=runInNewContext(source.slice(start,end)+'\nassertOrdinaryCockpitState',{assert});
const valid={state:{active:true,error:null,backend:'WebGPU:test',routeIdentity:'native-3d-compute-fluid-raymarch-v0'},presetReceipt:{presetId:'expected',sourcePresetAuthority:'shared-volume-settings-preset-v2',storePath:'/store'},smokePresentationReceipt:{normalizedRequestedMode:'off',effectiveMode:'off'},activeTab:'volume'};
check(valid,'valid','expected','off');
for(const edit of [row=>row.state.routeIdentity='retired-wrapper',row=>row.state.backend='Dawn:null',row=>row.state.active=false,row=>row.state.error='initialization failed',row=>row.presetReceipt.presetId='stale',row=>row.smokePresentationReceipt.effectiveMode='on']){const wrong=structuredClone(valid);edit(wrong);assert.throws(()=>check(wrong,'invalid','expected','off'));}
console.log('ordinary preset witness rejects wrong route, fallback, inactive, stale and substituted output');
