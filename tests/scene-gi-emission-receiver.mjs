// kaminos-test: node
// Exercise the real receiving graph and vendored material output selection.
import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';
const gi=readFileSync(new URL('../scene-gi.mjs',import.meta.url),'utf8'),vendor=readFileSync(new URL('../lib/three.webgpu.js',import.meta.url),'utf8');
const route=gi.slice(gi.indexOf('  function route()'),gi.indexOf('  let frames = 0;'));
const start=vendor.indexOf('\tsetup( builder ) {',vendor.indexOf('class NodeMaterial ')),end=vendor.indexOf('\n\t/**',start);
assert.ok(start>0&&end>start,'actual vendored material setup must be present');
test('combined GI survives emission installation and disabling for ordinary and custom materials',()=>{
 let material;const val=x=>x instanceof N?x.value():x;
 class N{constructor(x){this.fn=typeof x==='function'?x:()=>x;}value(){return this.fn();}get rgb(){return this;}get r(){return this;}get a(){return n(1);}mul(x){return n(()=>this.value()*val(x));}add(x){return n(()=>this.value()+val(x));}sub(x){return n(()=>this.value()-val(x));}div(x){return n(()=>this.value()/val(x));}min(x){return n(()=>Math.min(this.value(),val(x)));}max(x){return n(()=>Math.max(this.value(),val(x)));}clamp(lo,hi){return this.max(lo).min(hi);}oneMinus(){return n(()=>1-this.value());}equal(x){return n(()=>this.value()===val(x));}lessThan(x){return n(()=>this.value()<val(x));}assign(x){const value=val(x);this.fn=()=>value;return this;}build(){} }
 const n=x=>x instanceof N?x:new N(x),output=n(0),sample={sample:()=>n(1)},nodes=[];
 const mix=(a,b,t)=>n(()=>val(a)*(1-Number(val(t)))+val(b)*Number(val(t)));
 const env={settings:{denoise:0,temporal:false},filterImplementation:'shared',routes:new Map(),rawAO:sample,rawGI:{sample:()=>n(5)},gain:n(1),viewMode:n(0),aoIntensity:n(1),screenUV:{},depth:{value:0},scene:{},camera:{},surfaceLighting:{},comparison:null,
  float:n,vec3:n,vec4:x=>n(()=>val(x)),mix,output,diffuseColor:{rgb:n(1)},metalness:n(0),sceneGIReceives:()=>true,receiveWeight:()=>1,
  Fn:fn=>()=>n(()=>val(fn([],{material}))),context:x=>x,builtinAOContext:()=>({getFlowContextData:()=>({})}),texture:()=>({r:n(0)}),mrt:outputNodes=>({outputNodes}),
  pass:()=>Object.assign(n(2),{name:'',contextNode:null,setMRT(x){this.mrt=x;},getMRT(){return this.mrt??null;},setup(){}}),
  subBuild:x=>x};
 vm.createContext(env);vm.runInContext(route+'\nglobalThis.receiving=route().beauty;',env);const beauty=env.receiving;
 const setup=vm.runInContext('({'+vendor.slice(start,end)+'}).setup',env);
 for(const custom of [false,true])for(const enabled of [false,true,false]){
  // Same installation/retention law as rebuildSceneGIOutput: disable keeps MRT.
  if(enabled)beauty.setMRT(env.mrt({output,...beauty.getMRT()?.outputNodes,emissive:n(0)}));
  material={vertexNode:null,geometryNode:null,fragmentNode:null,outputNode:custom?n(2):null,mrtNode:null,depthWrite:false,depthTest:false,transparent:false,
   setupVertex:()=>n(0),setupHardwareClipping(){},setupClipping:()=>null,setupDiffuseColor(){},setupAmbientOcclusion(){},setupVariants(){},setupLighting:()=>n(2),setupOutput:(_b,x)=>x,setupObserver:()=>({})};
  const builder={context:{...beauty.contextNode},renderer:{getRenderTarget:()=>({depthBuffer:false}),getMRT:()=>beauty.getMRT()},addStack(){this.stack={};},removeStack(){return this.stack;},addFlow(stage,stack){if(stage==='fragment')nodes.push(stack.outputNode);}};
  setup.call(material,builder);const final=nodes.at(-1);assert.equal(val(final?.outputNodes?.output??final),7,`${custom?'custom':'ordinary'} receiver, emission ${enabled?'on':'off'}`);
 }
});
