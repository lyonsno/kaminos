import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const {reconcileStoneWorkbenchTool=()=>{throw Error('Stone workspace reconciliation absent');}}=await import('../tools/stone-workbench-source.mjs');
test('live Stone owns returning Workbench presentation while ordinary authoring tab remains separate',()=>{
 const calls=[],nodes={'experiment-tool-slot':{hidden:false}},document={getElementById:id=>nodes[id]},workspace={setTool:id=>calls.push(id)};
 reconcileStoneWorkbenchTool(workspace,{state:()=>({id:'stone/fracture'})},'assets',document);
 assert.deepEqual(calls,['stone/fracture']);assert.equal(nodes['experiment-tool-slot'].hidden,true);
 reconcileStoneWorkbenchTool(workspace,{state:()=>({id:null})},'assets',document);assert.deepEqual(calls,['stone/fracture','assets']);
 const source=fs.readFileSync(new URL('../tools/stone-workbench-source.mjs',import.meta.url),'utf8');assert.match(source,/reconcileStoneWorkbenchTool\(fluidWorkbench,ownerExperimentEntry/);
});
