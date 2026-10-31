// kaminos-test: node
import assert from 'node:assert/strict';
import {waitForLermScene} from '../tools/lerm-witness-startup.mjs';

let predicate, options;
await waitForLermScene({waitForFunction(fn, arg, config) { predicate=fn; options=config; }});
assert.equal(options?.timeout, 0, 'Scene loading must not inherit Playwright\'s 30-second deadline');
globalThis.window={};globalThis.document={body:{innerText:''}};
assert.equal(predicate(),false,'Missing activation is pending, not success');
window.kaminosWorkbenchExperiments={state:()=>({id:'another-experiment'})};
assert.equal(predicate(),false,'A different experiment cannot satisfy activation');
window.kaminosWorkbenchExperimentError='Missing creature asset';
assert.throws(predicate,/Missing creature asset/,'Activation errors must fail without waiting for a deadline');
delete window.kaminosWorkbenchExperimentError;
window.kaminosWorkbenchExperiments={state:()=>({id:'lerms/hand-goin'})};
assert.equal(predicate(),true);
delete globalThis.window;delete globalThis.document;
