// kaminos-test: node
import assert from 'node:assert/strict';
import {registrationRequest,savedRegistrationURL} from '../registration-retention.mjs';
await assert.rejects(registrationRequest('s','t',{request:async()=>({ok:true,json:async()=>({})})}),/identity/);
await assert.rejects(registrationRequest('s','t',{save:{},request:async()=>({ok:true,json:async()=>({})})}),/receipt/);
await assert.rejects(registrationRequest('s','t',{save:{},request:async()=>({ok:false,json:async()=>({error:'changed input'})})}),/changed input/);
const url=new URL(savedRegistrationURL('http://127.0.0.1:8342/?foo=bar#scene=old',{sourceUrl:'s',targetUrl:'t',id:'saved'}));
assert.equal(url.hash,'');assert.equal(url.searchParams.get('experiment'),'part-claims');assert.deepEqual(JSON.parse(url.searchParams.get('experiment_inputs')),{sourceUrl:'s',targetUrl:'t',registrationId:'saved'});
console.log('registration retention refuses missing/error receipts and reopens exact saved identity');
