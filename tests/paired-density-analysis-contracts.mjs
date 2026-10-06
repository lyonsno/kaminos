import assert from 'node:assert/strict';
import {summarizePairedTiming as summarize} from '../tools/paired-density-analysis.mjs';
const fixture=()=>({samples:Array.from({length:8},(_,i)=>{const order=i%2?['B','A']:['A','B'];const a=1000n*BigInt(1+i),b=a*3n/4n,start=1000000n*BigInt(i+1);const first=order[0]==='A'?a:b,second=order[1]==='A'?a:b;return {index:i,order,timestamps:[start,start+first,start+first+1n,start+first+1n+second].map(String)}})});
const x=summarize(fixture(),8,1);assert.equal(x.pairedRatio.median,.75);assert.ok(Math.abs(x.counterbalancedBlockRatio.median-.75)<1e-12);assert.equal(x.rows.length,8);assert.ok(x.aMs.max/x.aMs.min===8);
for(const mutate of [x=>x.samples.pop(),x=>x.samples[0].order.reverse(),x=>x.samples[0].timestamps[1]='0',x=>x.samples[0].timestamps[1]=x.samples[0].timestamps[0],x=>x.samples[0].index=2]){const x=fixture();mutate(x);assert.throws(()=>summarize(x,8,1));}
const outlier=fixture();outlier.samples[7].timestamps[3]=String(BigInt(outlier.samples[7].timestamps[2])+100000n);assert.equal(summarize(outlier,8,1).rows.length,8,'slow pair is retained');
console.log('paired timing preserves common drift and rejects false closure');
