// kaminos-test: node
import assert from 'node:assert/strict';
import test from 'node:test';
import * as source from '../structural-material-workbench-host.mjs';

const digest='1f09da3563d19e933e03880faf78060889d95c74af73e0695f4c95f15d9d6702';
const manifest={status:'passed',sourceSha256:digest,model:{kind:'graph'},sourceAsset:{url:'./source.glb',sha256:digest,triangles:980688,id:'kiln-cuda-768',label:'Kiln'},support:{kind:'clamp-min',axis:1,band:.035}};
const baseUrl='http://127.0.0.1:61718/__stone/scratch/kiln/manifest.json';

test('the Workbench preserves an explicitly selected prepared input instead of the default bar',()=>{
 assert.equal(source.stoneMaterialParameters('?stoneInputs=/__stone/scratch/kiln&stoneFragments=grains').get('inputs'),'/__stone/scratch/kiln');
 assert.throws(()=>source.stoneMaterialParameters('?stoneInputs='),/input/i);
});
test('kiln source binds its actual asset digest and base-relative URL',()=>{
 assert.equal(typeof source.admitStoneSource,'function','Prepared source identity must be admitted explicitly');
 const actual=source.admitStoneSource(manifest,{baseUrl});
 assert.equal(actual.asset.sha256,digest);assert.equal(actual.asset.url,'http://127.0.0.1:61718/__stone/scratch/kiln/source.glb');
 assert.deepEqual(actual.support,manifest.support);
 for(const changed of [{...manifest,status:'failed'},{...manifest,sourceSha256:'a'.repeat(64)},{...manifest,sourceAsset:undefined},{...manifest,sourceAsset:{...manifest.sourceAsset,url:''}},{...manifest,sourceAsset:{...manifest.sourceAsset,triangles:0}},{...manifest,sourceAsset:{...manifest.sourceAsset,sha256:'bad'}},{...manifest,support:{kind:'clamp-min',axis:4,band:.035}}])assert.throws(()=>source.admitStoneSource(changed,{baseUrl}));
});
test('an explicit base clamp selects the bottom nodes, not the left edge',()=>{
 assert.equal(typeof source.stoneSupportNodes,'function','Support must follow the admitted specimen setup');
 const positions=[[-1,-1,0],[1,-1,0],[-1,1,0],[1,1,0]];
 assert.deepEqual(source.stoneSupportNodes(positions,manifest.support),[0,1]);
 assert.deepEqual(source.stoneSupportNodes(positions,{kind:'clamp-min',axis:0,band:.035}),[0,2]);
 assert.deepEqual(source.stoneSupportNodes(positions,{kind:'none'}),[]);
 for(const support of [{kind:'clamp-min',axis:1,band:0},{kind:'clamp-min',axis:NaN,band:.1},{kind:'clamp-min',axis:1,band:Infinity},{kind:'unknown'}])assert.throws(()=>source.stoneSupportNodes(positions,support));
});
