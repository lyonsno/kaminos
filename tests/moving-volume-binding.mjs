// kaminos-test: node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../volume-core.js',import.meta.url),'utf8');
const method=source.match(/    async bindFollowingDomain\([\s\S]*?\n    },/)[0].replace(/,$/,'');
let constructed=0,destroyed=0;
const context={device:{},productFrameOwner:'prototype',followingDomain:null,state:{},liquidFireContactDescriptor:null,proxyPacing:false,
 productTransform:{translate:[0,0,0],scale:1},gridSize:32,followingDomainShift(){},
 async createMovingVolumeGpu(){constructed++;return {dispose(){destroyed++;}};}};
const runtime=vm.runInNewContext(`({${method}})`,context);
const bind=()=>runtime.bindFollowingDomain({getPosition:()=>[0,0,0]});
const pending=[bind(),bind()];
const results=await Promise.allSettled(pending);
assert.equal(results.filter(r=>r.status==='fulfilled').length,1,'Concurrent bindings must retain exactly one owner');
assert.equal(destroyed,constructed-1,'The losing construction must release its GPU resource');
await assert.rejects(bind(),/already bound/);
results.find(r=>r.status==='fulfilled').value();
assert.equal(destroyed,constructed);
assert.equal(context.followingDomain,null);
assert.equal(context.state.followingDomain.status,'released');
console.log('Following-domain exclusive owner and release pass');
