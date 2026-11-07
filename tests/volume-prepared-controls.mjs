// kaminos-test: node
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('../volume-core.js',import.meta.url),'utf8');
const start=source.indexOf('    async borrowThermalGpuContext('),end=source.indexOf('    async bindFollowingDomain',start);
const events=[],device={};const host=runInNewContext('({'+source.slice(start,end)+'})',{ensureGpu:async()=>events.push('gpu'),updateUniforms:()=>events.push('controls'),performance:{now:()=>12},device,gridSize:32,gridHeight:32});
await host.borrowThermalGpuContext({prepareControls:true});assert.deepEqual(events,['gpu','controls'],'requested cold preparation must resolve control-dependent volume resources before activation');
events.length=0;await host.borrowThermalGpuContext();assert.deepEqual(events,['gpu'],'ordinary thermal borrowing keeps its existing behavior');
