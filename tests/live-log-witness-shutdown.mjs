import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
async function finalize({browserError=false,serverError=false,primaryError=null}={}){
  const source=fs.readFileSync(new URL('../tools/live-log-heat-witness.mjs',import.meta.url),'utf8');
  const tail=source.slice(source.lastIndexOf('\nfinally '));
  const report={status:primaryError?'failed':'passed',phase:primaryError?'load':'complete',frames:[{name:'heated'}],...(primaryError?{error:primaryError.message}:{})};
  const order=[],saved=[];const context={report,primaryError,console,
    browser:{async close(){order.push('browser');if(browserError)throw Error('browser shutdown failed');}},
    server:{async stop(){order.push('server');if(serverError)throw Error('server shutdown failed');}},
    async save(){order.push('save');saved.push(JSON.parse(JSON.stringify(report)));}};
  const program='(async()=>{try{if(primaryError)throw primaryError;}'+tail+'})()';
  let error;try{await vm.runInNewContext(program,context);}catch(e){error=e;}
  return {report:saved.at(-1),order,error};
}
test('failed browser/server shutdown cannot leave a passed terminal report',async()=>{
  for(const which of ['browserError','serverError']){const result=await finalize({[which]:true});
    assert.equal(result.report.status,'failed');assert.equal(result.report.phase,'shutdown');assert.ok(result.report.shutdownErrors.length);
    assert.deepEqual(result.order,['browser','server','save']);assert.ok(result.error);assert.equal(result.report.frames[0].name,'heated');}
});
test('cleanup preserves the primary failure and successful cleanup saves afterward',async()=>{
  const primary=Error('page load failed');const failed=await finalize({primaryError:primary,browserError:true,serverError:true});
  assert.equal(failed.error,primary);assert.equal(failed.report.error,'page load failed');assert.equal(failed.report.shutdownErrors.length,2);
  const ok=await finalize();assert.equal(ok.report.status,'passed');assert.equal(ok.error,undefined);assert.deepEqual(ok.order,['browser','server','save']);
});
