// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {runInNewContext} from 'node:vm';
const source=process.env.KILN_PREVIEW_SOURCE?readFileSync(process.env.KILN_PREVIEW_SOURCE,'utf8'):readFileSync(new URL('../inference-kiln-preview.mjs',import.meta.url),'utf8');
const start=source.indexOf('  function scheduleDraft(){'),end=source.indexOf('\n  if(promptInput)',start);assert.ok(start>0&&end>start);
function fixture(request){let callback,prepared=[];const state={active:false,disposed:false,request,promptInput:{value:'next draft'},draftTimer:null,clearTimeout(){},setTimeout:fn=>{callback=fn;return 1;},prepare:async x=>prepared.push(x.prompt),failure:assert.fail};runInNewContext(source.slice(start,end)+';globalThis.schedule=scheduleDraft;',state);return {state,prepared,fire:()=>callback?.()};}
test('hidden kiln draft cannot replace an admitted unfinished burn',()=>{const f=fixture({id:'admitted',prompt:'burn these words'});f.state.schedule();f.fire();assert.deepEqual(f.prepared,[]);});
test('admission during pending draft debounce protects physical text',()=>{const f=fixture(null);f.state.schedule();f.state.request={id:'admitted',prompt:'burn these words'};f.fire();assert.deepEqual(f.prepared,[]);});
test('idle draft still prepares exact new words',()=>{const f=fixture(null);f.state.schedule();f.fire();assert.deepEqual(f.prepared,['next draft']);});
