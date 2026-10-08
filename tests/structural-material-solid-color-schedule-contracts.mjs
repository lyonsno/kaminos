import assert from 'node:assert/strict';
import { prepareSolidTopology,packSolidTopology } from '../structural-material-solid-topology.mjs';
const model=prepareSolidTopology({status:'passed',route:'ftetwild-cpu-wildmeshing-0.4.1',positions:[[0,0,0],[1,0,0],[0,1,0],[0,0,1]],tetrahedra:[[0,1,2,3]],volume:1/6},{kind:'graph'}),arrays=packSolidTopology(model),n=model.positions.length,base=n+1+model.incidence.length*2;
assert.equal(arrays.incidence.length,base+model.colorCount+1+n,'Compact colored dispatch must include a complete node partition');
const offsets=Array.from(arrays.incidence.slice(base,base+model.colorCount+1)),nodes=Array.from(arrays.incidence.slice(base+model.colorCount+1));
assert.equal(offsets[0],0);assert.equal(offsets.at(-1),n);assert.equal(new Set(nodes).size,n);
for(let color=0;color<model.colorCount;color++)assert.ok(nodes.slice(offsets[color],offsets[color+1]).every(node=>model.colors[node]===color));
console.log('Compact update colors retain every material point exactly once');
