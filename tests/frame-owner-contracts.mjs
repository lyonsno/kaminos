// kaminos-test: node — who supplies frames to model runs (index.html frameOwner): the fire volume only while it renders
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const a=html.indexOf('  const frameOwner=()=>{');const b=html.indexOf('  window.kaminosAppFrameSource=',a);
assert.ok(a>0&&b>a,'the page frame owner must be present');
function page(volumePrototype){
  const device={queue:{}},made=[];
  const context={volumePrototype,sharedGpu:{device},compositionHost:{device},appFrameSource:null,
    createAppFrameSource:({device:d})=>{const s={kind:'app',device:d,debugState:()=>({active:false,pending:false}),setForegroundOpportunityRequester(){}};made.push(s);return s;}};
  vm.runInNewContext(`let appFrameSource=null;\n${html.slice(a,b)}\nthis.frameOwner=frameOwner;`,context);
  return {owner:()=>context.frameOwner(),made};
}
const volume=active=>({kind:'volume',setForegroundOpportunityRequester(){},foregroundGpuContext:()=>({active,renderer:'ordinary-volume'})});

test('an ordinary scene supplies its own frames',()=>{
  assert.equal(page(null).owner().kind,'app');
});

test('a fire volume that is rendering supplies the frames',()=>{
  assert.equal(page(volume(true)).owner().kind,'volume');
});

test('a fluid route left inactive (a cancelled or refused Add > Flame) does not take the frames',()=>{
  const p=page(volume(false));
  assert.equal(p.owner().kind,'app','the ordinary scene keeps drawing while the volume is inactive');
});

test('once the retained fluid route is activated, the next run gets its frames from the volume',()=>{
  const v=volume(false),p=page(v);assert.equal(p.owner().kind,'app');
  v.foregroundGpuContext=()=>({active:true,renderer:'ordinary-volume'});
  assert.equal(p.owner().kind,'volume');
});
