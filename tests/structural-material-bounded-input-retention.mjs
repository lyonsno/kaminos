import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {test} from 'node:test';

const source=fs.readFileSync(new URL('../structural-material-bounded-live-smoke.mjs',import.meta.url),'utf8');
const start=source.indexOf('async function retainPointerInput(');
const helper=start<0?'':source.slice(start,source.indexOf('\ntry{',start));
const cleanup=source.slice(source.indexOf('}catch(e){report.status'));
const events=[{type:'pointerdown',at:10},{type:'pointermove',at:12},{type:'pointerup',at:13}];

async function failInteraction(readError){
 const report={status:'running',phase:'mouse',browser:{}},saved=[];
 const context={report,view:'desktop',out:'/evidence/report.json',path:{dirname:()=>'/evidence',join:(...parts)=>parts.join('/')},process:{exitCode:0},console:{log(){}},save(){saved.push(structuredClone(report));},page:{isClosed:()=>false,evaluate:async()=>{if(readError)throw new Error(readError);return events;},screenshot:async()=>{}},browser:{close:async()=>{report.retainedAtClose=Boolean(report.pointerInputs?.desktop||report.pointerRetentionErrors?.length);}}};
 vm.runInNewContext(helper+';task=(async()=>{try{throw new Error("first injury persists");'+cleanup+'})();',context);
 await context.task;
 return {report,saved};
}

test('actual failed interaction cleanup retains original pointer events before teardown',async()=>{
 const {report,saved}=await failInteraction();
 assert.equal(report.failure.message,'first injury persists');
 assert.deepEqual(report.pointerInputs?.desktop,events,'Available original pointer signal must survive assertion failure');
 assert.equal(report.retainedAtClose,true,'Retention must precede browser close');
 assert.ok(saved.some(record=>record.pointerInputs?.desktop?.length===3));
});

test('actual failed cleanup reports pointer retention acquisition failure',async()=>{
 const {report}=await failInteraction('page acquisition unavailable');
 assert.equal(report.failure.message,'first injury persists','Preserve the primary failure');
 assert.equal(report.pointerRetentionErrors?.[0]?.message,'page acquisition unavailable');
 assert.equal(report.pointerRetentionErrors?.[0]?.view,'desktop');
 assert.equal(report.browser.ownedChildExited,true);
});
