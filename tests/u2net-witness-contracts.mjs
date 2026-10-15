// kaminos-test: node
// The U2Net WebGPU witness cannot report a parity measurement it did not make:
// reference evidence must be present, complete and as recorded, comparisons
// finite; a browser that fails to launch ends in a terminal error report.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {admitReferenceCases,admitReferenceBytes,compareCutouts,admitForegroundHandback} from '../models/u2net/witness-checks.js';

const sha=b=>createHash('sha256').update(b).digest('hex');
assert.throws(()=>admitReferenceCases({}),/no reference cases/);
assert.throws(()=>admitReferenceCases({truck:{source:[2,2]}}),/truck/);
// An empty or malformed recorded hash cannot disable verification.
for(const cutout of ['','x','0'.repeat(63),'G'.repeat(64)])
  assert.throws(()=>admitReferenceCases({truck:{source:[4,2],pre:[2,1],sha:{cutout}}}),/truck/,'cutout hash '+JSON.stringify(cutout));
await assert.rejects(admitReferenceBytes({name:'truck',what:'cutout',status:200,bytes:new Uint8Array(8),length:8,sha256:''}),/truck.*cutout.*hash/);
const cases=admitReferenceCases({truck:{source:[4,2],pre:[2,1],sha:{cutout:'a'.repeat(64)}}});
assert.deepEqual(cases.map(c=>c.name),['truck']);

const good=new Uint8Array([1,2,3,4,5,6,7,8]);
assert.equal(await admitReferenceBytes({name:'truck',what:'cutout',status:200,bytes:good,length:8,sha256:sha(good)}),good);
await assert.rejects(admitReferenceBytes({name:'truck',what:'cutout',status:404,bytes:new Uint8Array(),length:8}),/truck.*cutout.*404/);
await assert.rejects(admitReferenceBytes({name:'truck',what:'cutout',status:200,bytes:good.slice(0,4),length:8}),/truck.*cutout.*4.*8/);
await assert.rejects(admitReferenceBytes({name:'truck',what:'cutout',status:200,bytes:good,length:8,sha256:'0'.repeat(64)}),/truck.*cutout.*recorded/);

const want=new Uint8Array([10,20,30,255,0,0,0,0]),got=new Uint8Array([11,20,30,254,0,0,0,0]);
assert.deepEqual(compareCutouts('truck',got,want),{alphaDifferent:1,alphaMaxDelta:1,rgbMaxDelta:1,pixels:2});
assert.throws(()=>compareCutouts('truck',got.slice(0,4),want),/truck.*length/);

// A missing browser executable ends in a terminal error report, not "running".
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'u2net-witness-')),out=path.join(dir,'report.json');
const witness=fileURLToPath(new URL('../models/u2net/u2net-webgpu-witness.mjs',import.meta.url));
await new Promise(resolve=>execFile(process.execPath,[witness,'--package',dir,'--reference',dir,'--chrome',path.join(dir,'missing-chrome'),'--out',out],
  {timeout:60000},()=>resolve()));
const report=JSON.parse(await fs.readFile(out,'utf8'));
assert.equal(report.status,'error','failed browser launch must end in a terminal error report');
assert.equal(report.phase,'browser');assert.match(report.error,/ENOENT|missing-chrome/);

// Handback is admitted from queue order only: no activity, page work only before
// or after inference (e.g. drained at finish), or an unsegmented run all refuse.
for(const [queue,why] of [[[],'empty'],[['model','model'],'no page'],[['page','model','model','page'],'outside'],[['page','model','page'],'one segment']])
  assert.throws(()=>admitForegroundHandback('t',queue),/foreground t:/,why);
assert.deepEqual(admitForegroundHandback('t',['page','model','page','page','model','page']),{modelSegments:2,pageBetween:2,pageTotal:4});
