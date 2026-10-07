import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../tools/fluid-live-reload-witness.mjs',import.meta.url),'utf8');
const errorFunction=source.slice(source.indexOf('function failOnBrowserError'),source.indexOf('try {',source.indexOf('function failOnBrowserError')));
const start=source.lastIndexOf(" assert.equal(git(root,'rev-parse'");
const tail=source.slice(start,source.indexOf('}catch(e)',start));
for(const event of [{method:'Runtime.exceptionThrown',params:{exceptionDetails:{text:'late RAF exception'}}},{method:'Runtime.consoleAPICalled',params:{type:'error',args:[{value:'late GPU validation'}]}}]) {
 const report={status:'starting',events:[event],observations:[{complete:true,visuals:['retained-frame.png']}]};
 const context={assert,report,root:'owned',revision:'sha',git:(_r,command)=>command==='rev-parse'?'sha':''};
 vm.createContext(context);vm.runInContext(errorFunction,context);
 assert.throws(()=>vm.runInContext(tail,context),/Browser errors/,'late errors after primary capture must prevent successful run disposition');
 assert.notEqual(report.status,'done');assert.deepEqual(report.observations[0].visuals,['retained-frame.png']);
}
console.log('Actual reload terminal path rejects late exception and console-error events while retaining captured evidence');
