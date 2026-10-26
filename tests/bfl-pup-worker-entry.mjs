// kaminos-test: node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
// Execute the worker entry with its one provider import injected. This tests the
// browser-scope failure boundary, not the third-party model's loading behavior.
const source=(await fs.readFile(new URL('../models/bfl-pup/worker-browser.mjs',import.meta.url),'utf8')).replace(/^import .*;$/gm,'');
const handlers={},messages=[],self={addEventListener:(type,fn)=>{handlers[type]=fn;}};
vm.runInNewContext(source,{self,postMessage:value=>messages.push(value),createBrowserPromptHelper:async()=>new Promise(()=>{})});
assert.equal(typeof handlers.unhandledrejection,'function','an orphaned runtime promise must fail the owned worker request instead of leaving loading unresolved');
handlers.unhandledrejection({reason:Error('external tensor allocation failed')});
assert.equal(messages.at(-1).type,'error');assert.match(messages.at(-1).value,/external tensor allocation failed/);
console.log('Worker-scope unhandled runtime rejection is returned to the owning request');
