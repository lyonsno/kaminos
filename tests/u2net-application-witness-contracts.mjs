// kaminos-test: node
import assert from 'node:assert/strict';
import {checkU2NetApplicationWitness as check} from '../models/u2net/application-witness-checks.mjs';
const base={expectedRevision:'exact',source:{rev:'exact',dirtyFiles:[]},outsideCheckout:true,installed:{integrity:'package'},kit:{integrity:'kit'},browser:{effectiveBrowser:'Chrome'},weights:{sha256:'weights'},
 state:{adapter:{isFallbackAdapter:false},loading:{weights:{sha256:'weights'}},runs:[{queue:['model','page','model']},{queue:['model','page','model']}],gpuErrors:[],afterDestroy:{session:'active',routes:0,foregroundDisposed:false}},
 paused:'paused',pausedFrames:2,stopped:true,repeatDifference:0,directDifference:0,referenceMaxDifference:1,output:{bytes:12,sha256:'output',transparent:1,opaque:1},framesAfterDestroy:2};
assert.deepEqual(check(base),[]);
for(const mutate of [r=>r.source.rev='wrong',r=>r.installed=null,r=>r.state.adapter.isFallbackAdapter=true,r=>r.state.loading.weights.sha256='other',r=>r.state.runs=[],r=>r.state.runs[1].queue=['model','model','page'],r=>r.directDifference=1,r=>r.output.bytes=0,r=>r.output.transparent=0,r=>r.state.afterDestroy.session='closed',r=>r.stopped=false]){
 const r=structuredClone(base);mutate(r);assert.ok(check(r).length,'false closure must fail');
}
console.log('U2Net witness rejects missing, stale, fallback, blank and post-run-only evidence');
