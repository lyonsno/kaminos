import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../index.html',import.meta.url),'utf8');
function fixture({running=false,available=true}={}) {
  const nodes=new Map();
  const node=id=>{if(!nodes.has(id))nodes.set(id,{hidden:false,classList:{toggle(){}},dataset:{}});return nodes.get(id);};
  let tab='finger-fluid-bench',active=true,mode='workbench',generation=1,starts=0,stops=0,resumes=0;
  const water={available},viewport={};
  const context=vm.createContext({
    document:{body:node('body'),getElementById:node,querySelectorAll:()=>[]},
    window:{__kaminosActiveTab:()=>tab},
    authoringControlSessions:[],scenePlacementTools:{edits:{state:()=>({})}},setInfo(){},
    fingerFluidBenchRunning:running,fingerFluidBenchSolver:water,fingerFluidBenchViewport:viewport,
    fluidWorkbench:{state:()=>({active}),setActive:v=>{active=v;}},
    authoringWorkspace:{state:()=>({mode})},installFluidWorkbench(){},
    samImageTools:null,isFireLightFieldRoute:()=>false,
    startFingerFluidBench(){starts++;generation++;},
    stopFingerFluidBench(){stops++;generation++;context.fingerFluidBenchViewport=null;},
    resumeFingerFluidBenchAfterWitness(){resumes++;context.fingerFluidBenchRunning=true;},
  });
  vm.runInContext(source.slice(source.indexOf('function setActiveTab('),source.indexOf('window.__kaminosSetActiveTab =')),context);
  const setTab=context.setActiveTab;
  context.setActiveTab=(name,options)=>{setTab(name,options);tab=name;};
  const callbacks=source.slice(source.indexOf('    beforeSwitch: next => {'),source.indexOf('    openWorkbenchTab: tab =>'));
  const hooks=vm.runInContext(`({${callbacks}})`,context);
  return {context,water,viewport,node,read:()=>({tab,active,generation,starts,stops,resumes}),switchMode(next){assert.equal(hooks.beforeSwitch(next),true);mode=next;hooks.afterSwitch(next);}};
}

for(const running of [false,true])test(`Authoring round trip retains available shared water when scheduler running=${running}`,()=>{
  const f=fixture({running});
  f.switchMode('authoring');
  assert.equal(f.read().stops,0,'workspace presentation must not stop the held water');
  assert.equal(f.context.fingerFluidBenchViewport,f.viewport);
  assert.equal(f.node('finger-fluid-bench-operator-panel').hidden,false);
  f.switchMode('workbench');
  assert.equal(f.read().generation,1,'returning to the same water must retain session identity');
  assert.equal(f.read().starts,0);
  assert.equal(f.read().tab,'finger-fluid-bench');
  assert.equal(f.read().active,true);
});

test('leaving Fluid for another experiment still stops its presentation',()=>{
  const f=fixture();f.context.setActiveTab('assets',{reveal:false});assert.equal(f.read().stops,1);
});

test('an unavailable solver is not preserved as live water',()=>{
  const f=fixture({available:false});f.switchMode('authoring');assert.equal(f.read().stops,1);
});
