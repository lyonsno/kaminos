import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import * as smoke from '../volume-smokey-heldout.mjs';

assert.equal(typeof smoke.observeHttpFailures,'function','capture must retain the failed HTTP resource identity');
const page=new EventEmitter(),report={};smoke.observeHttpFailures(page,report);
const response=status=>({url:()=>`http://127.0.0.1:18643/api/example?status=${status}`,
  status:()=>status,statusText:()=>status===500?'Internal Server Error':'OK',headers:()=>({'content-type':'application/json'})});
page.emit('response',response(200));assert.deepEqual(report.httpFailures,[]);
page.emit('response',response(500));
assert.deepEqual(report.httpFailures,[{url:'http://127.0.0.1:18643/api/example?status=500',status:500,
  statusText:'Internal Server Error',headers:{'content-type':'application/json'}}]);
page.emit('response',response(404));assert.equal(report.httpFailures.length,2);
assert.equal(report.httpFailures[0].status,500,'later failures must not replace the first');
console.log('failed HTTP resource identity retained');
