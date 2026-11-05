// kaminos-test: node
import assert from 'node:assert/strict';
import {contactTopology,contactEligibility} from '../fracture-contact-topology.mjs';
import {buildIgnoredPairTable} from '../fracture-contact-cache.mjs';
import {packContactShapes} from '../fracture-convex-contact.mjs';
const cells=Array.from({length:10},(_,index)=>({index,position:[index,0,0],halfExtents:[10,10,10]}));
const bonds=Array.from({length:9},(_,a)=>({a,b:a+1})),topology=contactTopology(cells,bonds),alive=new Uint8Array(9).fill(1);
const pairIndex=(a,b)=>b*(b-1)/2+a;
assert.equal(contactEligibility(topology,alive)[pairIndex(0,9)],false);
alive[4]=0;
assert.equal(contactEligibility(topology,alive)[pairIndex(0,9)],true,'Breaking an interior bond beyond the old four-index sample really disconnects the pair');
const legacy=buildIgnoredPairTable(cells,bonds).pairs.find(p=>p.i===0&&p.j===9);
assert.equal(legacy.bonds.every(id=>id===0xffffffff||alive[id]),true,'Retained old policy demonstrably misses this actual disconnection');

const ringCells=cells.slice(0,4),ring=[{a:0,b:1},{a:1,b:2},{a:2,b:3},{a:3,b:0}],ringTopology=contactTopology(ringCells,ring),ringAlive=Uint8Array.from([0,1,1,1]);
const eligible=contactEligibility(ringTopology,ringAlive);
assert.equal(eligible[pairIndex(0,2)],false,'Initially neighboring diagonal remains suppressed while a complete alternative attachment path survives');
assert.equal(eligible[pairIndex(0,1)],true,'A broken direct crack face can contact despite another path connecting its bodies');
const duplicate=[{a:0,b:1},{a:0,b:1}],twice=contactTopology(cells.slice(0,2),duplicate);
assert.deepEqual(contactEligibility(twice,[0,1]),[false],'A surviving direct bond still holds the interface');
assert.deepEqual(contactEligibility(twice,[0,0]),[true]);
const farCells=[{position:[0,0,0],halfExtents:[.5,.5,.5]},{position:[4,0,0],halfExtents:[.5,.5,.5]},{position:[8,0,0],halfExtents:[.5,.5,.5]}];
assert.equal(contactEligibility(contactTopology(farCells,[{a:0,b:1},{a:1,b:2}]),[1,1])[pairIndex(0,2)],true,'Connected material can contact after folding; component membership is not a blanket mask');

const packed=packContactShapes(cells,bonds),words=new Uint32Array(packed.data.buffer),header=(record)=>Array.from(words.subarray(record*4,record*4+4));
for(let i=0;i<cells.length;i++){
 const h=header(i*4),adj=header(i*4+1);
 assert.equal(h[1],8,'Box fixture retains every support vertex');
 assert.equal(h[3],6,'Box fixture retains every closed face');
 assert.equal(adj[3],topology.adjacency[i].length,'Every attachment survives GPU packing');
}
assert.equal(packed.maxFaceVertices,4,'Polygon capacity derives from the actual support faces');
console.log('Complete connectivity, local crack eligibility and uncapped topology packing pass');
