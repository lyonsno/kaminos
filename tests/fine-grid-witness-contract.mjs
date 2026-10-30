// kaminos-test: node
import assert from 'node:assert/strict';
import {validateFineGridWitness} from '../tools/fine-grid-witness-contract.mjs';
const n=4*8*4,nf=8*16*8;
const coarse=()=>Array.from({length:n*16},(_,i)=>i%16<3?[2,4,6][i%16]:i%16===4?1:0);
const after=coarse();for(let i=0;i<n;i++)for(let a=0;a<3;a++)after[i*16+a]+=[2,3,4][a];
const fine=new Array(nf*16).fill(0);for(let i=0;i<nf;i++){for(let a=0;a<3;a++)fine[i*16+a]=[8,14,20][a];fine[i*16+4]=3;}
const good={adapter:{vendor:'apple',architecture:'metal-3'},errors:[],dims:[8,16,8],velocityDims:[4,8,4],seed:coarse(),preserved:coarse(),injected:after,prolonged:fine};
validateFineGridWitness(good);
for(const mutate of [x=>x.errors.push('GPU validation'),x=>x.adapter.vendor='swiftshader',x=>x.seed=[],x=>x.injected[0]=0,x=>x.preserved[0]=50,x=>x.prolonged[4]=0,x=>delete x.prolonged]){
 const x=structuredClone(good);mutate(x);assert.throws(()=>validateFineGridWitness(x));
}
