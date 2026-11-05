// kaminos-test: node
import assert from 'node:assert/strict';
import {BoxGeometry} from '../lib/three.core.js';
import {prepareWholeFracture} from '../fracture-whole-prepare.mjs';
import {mapBurnSections,sectionReference} from '../burn-structure-core.mjs';
import {LOG_RESIDUE} from '../log-consumption.mjs';
const g=new BoxGeometry(2,2,2),source={positions:g.attributes.position.array,indices:Uint32Array.from(g.index.array),normals:g.attributes.normal.array,uvs:g.attributes.uv.array,faceMaterial:new Uint8Array(12)};
const prepared=prepareWholeFracture(source,{labels:new Uint32Array(12),boundaries:[]},{cellExtent:1});
assert.equal(prepared.cells.length,8);assert.ok(prepared.bonds.length>=12);assert.equal(prepared.receipt.exteriorAreaAfter,prepared.receipt.exteriorAreaBefore);
const material={bounds:{min:[-1,-1,-1],max:[1,1,1]},dimensions:[4,4,4],initial:new Uint32Array(64).fill(1)},mapping=mapBurnSections(prepared,material);
assert.equal(mapping.receipt.unmapped.length,0);assert.ok(mapping.cells.length>0);
const state=new Float32Array(64*8);for(let i=0;i<64;i++)state[i*8+5]=1;
assert.ok(sectionReference(mapping,state).every(s=>s.mapped&&Math.abs(s.fraction-1)<1e-7));
for(let i=0;i<64;i++){state[i*8]=10;state[i*8+1]=1;state[i*8+2]=1;}
assert.ok(sectionReference(mapping,state).every(s=>Math.abs(s.fraction-1)<1e-7),'Heat, visible char and flame do not counterfeit material loss');
assert.ok(sectionReference(mapping,state).every(s=>s.char===1),'Remaining material carries char separately from consumed area');
const cell=mapping.cells[0];state[cell*8+5]=LOG_RESIDUE;
const reduced=sectionReference(mapping,state);assert.ok(reduced.some(s=>s.fraction<1));assert.ok(reduced.some(s=>Math.abs(s.fraction-1)<1e-7),'Local consumption leaves unrelated sections intact');
for(let i=0;i<64;i++)state[i*8+1]=0;
assert.ok(sectionReference(mapping,state).some(s=>s.fraction>0&&s.fraction<1&&s.char>0),'Consumed section area must contribute to structural char damage while the section remains alive');
for(let i=0;i<64;i++)state[i*8+5]=0;
assert.ok(sectionReference(mapping,state).every(s=>s.fraction===0));
assert.ok(sectionReference(mapping,state).every(s=>s.char===0),'Absent material does not contribute char to a surviving section');
for(let i=0;i<64;i++)state[i*8+5]=LOG_RESIDUE+0.0000005;
assert.ok(sectionReference(mapping,state).every(s=>s.fraction===0),'Material absent to the consumption law cannot retain a structural connection');
const unmapped=mapBurnSections(prepared,{...material,initial:new Uint32Array(64)});
assert.equal(unmapped.receipt.unmapped.length,prepared.bonds.length);
assert.ok(sectionReference(unmapped,state).every(s=>s.fraction===null&&!s.mapped),'Unsupported section mapping must remain unknown, not a proved fracture');
assert.throws(()=>sectionReference(mapping,state.subarray(8)),/Complete finite/);
state[0]=NaN;assert.throws(()=>sectionReference(mapping,state),/Complete finite/);
assert.throws(()=>mapBurnSections(prepared,{...material,dimensions:[4,5,4]}),/original finite cubic/);
for(const piece of prepared.pieces)for(let face=0;face<piece.faceInterfaces.length;face++)if(piece.faceInterfaces[face])assert.ok(piece.faceBonds[face]>=0);

// Disconnected mesh parts separated by empty air within a coarse cell must not fuse into one rigid region.
{
 const a=new BoxGeometry(.2,.2,.2),b=new BoxGeometry(.2,.2,.2);
 a.translate(-.3,0,-.4);b.translate(-.3,0,.4);
 const pa=a.attributes.position.array,pb=b.attributes.position.array,na=a.attributes.normal.array,nb=b.attributes.normal.array,ua=a.attributes.uv.array,ub=b.attributes.uv.array;
 const ia=Uint32Array.from(a.index.array),ib=Uint32Array.from(b.index.array,i=>i+pa.length/3);
 const cat=(T,x,y)=>{const o=new T(x.length+y.length);o.set(x);o.set(y,x.length);return o;};
 const splitSource={positions:cat(Float32Array,pa,pb),normals:cat(Float32Array,na,nb),uvs:cat(Float32Array,ua,ub),indices:cat(Uint32Array,ia,ib),faceMaterial:new Uint8Array(24)};
 const splitPrepared=prepareWholeFracture(splitSource,{labels:new Uint32Array(24),boundaries:[]},{cellExtent:1});
 assert.ok(splitPrepared.cells.length>=2,'Spatially separated islands in one part must become separate rigid regions');
 assert.equal(splitPrepared.bonds.length,0,'Separated islands across an air gap must not receive a bond');
}

// A bond whose section face is only assigned on its second endpoint or between sparse occupied cells must still map.
{
 const Asymmetric={...prepared,pieces:prepared.pieces.map((p,i)=>i===prepared.bonds[0].a?{...p,faceBonds:new Int32Array(p.faceBonds.length).fill(-1)}:p)};
 const sparseInitial=new Uint32Array(64);sparseInitial[0]=1;sparseInitial[63]=1;
 const asymmetricMap=mapBurnSections(Asymmetric,{...material,initial:sparseInitial});
 assert.equal(asymmetricMap.receipt.unmapped.length,0,'Bonds with occupied material must map through endpoint faces or nearest occupied cells');
}
