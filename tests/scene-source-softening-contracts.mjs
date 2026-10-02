import assert from 'node:assert/strict';
import {softenEmissionReference,validateSourceSoftness} from '../scene-source-softening.mjs';
const dims=[5,5,5], count=125, center=62;
const input=new Float32Array(count*4);
for(let i=0;i<count;i++)input[i*4+3]=i*.03125;
input.set([6,3,1,input[center*4+3]],center*4);
const original=input.slice(),clear=new Uint32Array(count);
assert.deepEqual(softenEmissionReference(input,dims,clear,0),input,'zero is exact baseline');
const smooth=softenEmissionReference(input,dims,clear,1);
assert.ok(smooth[center*4]<6,'emission peak must soften, not pass through');
assert.ok(smooth[(center+1)*4]>0,'emission must reach a clear adjacent cell');
for(const passes of [1,4,16]){
  const result=softenEmissionReference(input,dims,clear,passes);
  for(let c=0;c<3;c++)assert.ok(Math.abs(result.reduce((sum,v,i)=>sum+(i%4===c?v:0),0)-[6,3,1][c])<1e-5,'conserve RGB including domain edges');
  for(let i=0;i<count;i++)assert.equal(result[i*4+3],input[i*4+3],'extinction unchanged');
  assert.ok(result.every(v=>v>=0&&Number.isFinite(v)));
}
const occupied=new Uint32Array(count);
for(let z=0;z<5;z++)for(let y=0;y<5;y++)occupied[2+5*(y+5*z)]=1;
const wallInput=input.slice();wallInput[center*4]=0;wallInput[center*4+1]=0;wallInput[center*4+2]=0;wallInput[(center-1)*4]=6;
const wall=softenEmissionReference(wallInput,dims,occupied,16);
for(let z=0;z<5;z++)for(let y=0;y<5;y++)for(let x=2;x<5;x++)assert.equal(wall[4*(x+5*(y+5*z))],0,'no filter transfer across occupied wall');
occupied[center]=1;
assert.equal(softenEmissionReference(input,dims,occupied,4)[center*4],6,'occupied source cells retain emission, never discard it');
assert.deepEqual(input,original,'input never mutated');
for(const value of [-1,.5,NaN,Infinity])assert.throws(()=>validateSourceSoftness(value),/nonnegative integer/);
console.log('lighting-source emission conservation, softness, extinction and boundary contracts passed');
