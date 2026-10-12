import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../structural-material-shard-view.js',import.meta.url),'utf8'),code=source.slice(source.indexOf('async function beginPick('),source.indexOf('async function finishGesture('));
const ctx={failure:null,bounded:true,residentGrip:null,pieces:[{id:0,geometry:{indices:[]},binding:{}}],positions(){throw new Error('CPU fallback invoked');},boundedCellAnchor:()=>1,components:[],observed:{state:[]},body:{positions:[]},configuration:{},contactPatch(){throw new Error('CPU fallback invoked');}};
vm.runInNewContext(code+';task=beginPick(0,[0,0,0],0);',ctx);
await assert.rejects(ctx.task,/Resident bounded contact unavailable/,'Reset or missing resident cannot silently enter a CPU/readback contact path');
