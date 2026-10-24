// kaminos-test: node
import vm from 'node:vm';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const elements = new Map();
const element = id => { if (!elements.has(id)) elements.set(id, { value: '', files: [], dataset: {} }); return elements.get(id); };
let finishSave;
const save = new Promise(resolve => { finishSave = resolve; });
const context = vm.createContext({ document: { getElementById: element }, indexedDB: {},
  createModelStore: () => ({ put: () => save }), readLocalModels: async () => ({}), __route: {}, console });
let source = await fs.readFile(new URL('../demos/hand-mesh/main.js', import.meta.url), 'utf8');
source = source.replace(/^import .*;$/gm, '').replace(/^initialize\(\)\.catch\(.*$/m, '');
vm.runInContext(source, context);
vm.runInContext('install = async () => { route = __route; loading = false; buttons(); }', context);
const begin = source.indexOf("  $('files').onchange =");
const end = source.indexOf('  window.handMeshDemo =', begin);
vm.runInContext(source.slice(begin, end), context);
const imported = vm.runInContext("$('files').onchange()", context);
await new Promise(resolve => setImmediate(resolve));
assert.equal(element('choose').disabled, true, 'a pending browser save must not admit another folder selection');
finishSave(); await imported;
assert.equal(element('choose').disabled, false);
assert.equal(element('files').value, '');
console.log('production local-model import remains serialized through browser save');
