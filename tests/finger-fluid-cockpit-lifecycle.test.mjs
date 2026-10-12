import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createIPBFPressureCockpit} from '../finger-fluid-pressure-cockpit.mjs';
import {createIPBFPressureControlState} from '../finger-fluid-pressure-controls.mjs';

test('the installed radius callback reports zero without throwing or changing controls',()=>{
  const oldLocation=globalThis.location,oldHistory=globalThis.history;
  globalThis.location={href:'http://localhost/index.html?finger_fluid_pressure_solver=ipbf'};
  globalThis.history={state:null,replaceState(){}};
  try {
    const model=createIPBFPressureControlState({baseRadius:.185,pressureRadiusScale:1,beta:60,densityIterations:3,capillaryStrength:.72});
    const nodes=new Map();
    const node=id=>{
      if(!nodes.has(id))nodes.set(id,{type:id.endsWith('-number')?'number':'range',min:id==='ipbf-radius'?'.06':'0',max:id==='ipbf-radius'?'.25':'8',value:'',checked:false,listeners:{},addEventListener(type,callback){this.listeners[type]=callback;}});
      return nodes.get(id);
    };
    const root={hidden:true,innerHTML:'',ownerDocument:{activeElement:null},querySelector:s=>node(s.slice(1)),querySelectorAll:()=>[...nodes.values()]};
    createIPBFPressureCockpit({root,getSolver:()=>({available:true,getPressureControls:()=>({available:true,...model.read(),particleCount:12288,damping:true}),setPressureControls:patch=>model.request(patch)}),isPaused:()=>false,setPaused(){},restart(){}});
    const before=model.read();
    assert.doesNotThrow(()=>node('ipbf-radius-number').listeners.change({target:{valueAsNumber:0}}));
    assert.match(node('ipbf-control-error').textContent,/positive/);
    assert.deepEqual(model.read(),before);
  } finally {globalThis.location=oldLocation;globalThis.history=oldHistory;}
});

test('actual normal teardown destroys only its own device, once',()=>{
  const source=readFileSync(new URL('../finger-fluid-webgpu-core.js',import.meta.url),'utf8');
  const start=source.lastIndexOf('  function destroy() {'),open=source.indexOf('{',start);
  let depth=1,end=open+1;for(;depth;end++){if(source[end]==='{')depth++;if(source[end]==='}')depth--;}
  const body=source.slice(open+1,end-1);
  const names=[...new Set([...body.matchAll(/(\w+)\??\.destroy\(/g)].map(m=>m[1]))].filter(n=>n!=='device');
  const invoke=new Function('runtimeLifecycle','movingHillSupportProvider','device','ownsDevice','resources',`const {${names.join(',')}}=resources;${body}`);
  for(const owned of [true,false]){
    let stopped=false,deviceDestroyCount=0;
    const resources=Object.fromEntries(names.map(name=>[name,{destroy(){}}]));
    const life={beginTeardown(){if(stopped)return false;stopped=true;return true;}};
    const device={destroy(){deviceDestroyCount++;}};
    invoke(life,{release(){}},device,owned,resources);
    invoke(life,{release(){}},device,owned,resources);
    assert.equal(deviceDestroyCount,owned?1:0);
  }
});


test('run controls keep their handlers and disabled state when mounted outside the tuning panel',async()=>{
  const oldLocation=globalThis.location,oldHistory=globalThis.history;
  globalThis.location={href:'http://localhost/index.html?finger_fluid_pressure_solver=ipbf'};
  globalThis.history={state:null,replaceState(){}};
  try {
    const model=createIPBFPressureControlState({baseRadius:.185,pressureRadiusScale:1,beta:60,densityIterations:3,capillaryStrength:.72});
    const nodes=new Map(),detached=new Set();let paused=false,finishReset;
    const node=id=>{if(!nodes.has(id))nodes.set(id,{type:id.endsWith('-number')?'number':'range',min:'0',max:'8',value:'',checked:false,listeners:{},addEventListener(type,callback){this.listeners[type]=callback;}});return nodes.get(id);};
    const root={hidden:true,innerHTML:'',ownerDocument:{activeElement:null},querySelector:s=>detached.has(s.slice(1))?null:node(s.slice(1)),querySelectorAll:()=>[...nodes].filter(([id])=>!detached.has(id)).map(([,node])=>node)};
    const cockpit=createIPBFPressureCockpit({root,getSolver:()=>({available:true,getPressureControls:()=>({available:true,...model.read(),particleCount:12288,damping:true}),setPressureControls:patch=>model.request(patch)}),isPaused:()=>paused,setPaused:v=>{paused=v;},restart:()=>new Promise(resolve=>{finishReset=resolve;})});
    for(const id of ['ipbf-pause','ipbf-reset','ipbf-control-status'])detached.add(id);
    assert.doesNotThrow(()=>cockpit.update());
    node('ipbf-pause').listeners.click();assert.equal(paused,true);assert.equal(node('ipbf-pause').textContent,'Resume');
    const reset=node('ipbf-reset').listeners.click();assert.equal(node('ipbf-pause').disabled,true);assert.equal(node('ipbf-reset').disabled,true);
    finishReset();await reset;assert.equal(node('ipbf-pause').disabled,false);assert.match(node('ipbf-control-status').textContent,/Paused/);
  }finally{globalThis.location=oldLocation;globalThis.history=oldHistory;}
});

test('particle count is a draft until an explicit restart and invalid counts do not restart',async()=>{
 const oldLocation=globalThis.location,oldHistory=globalThis.history;
 globalThis.location={href:'http://localhost/index.html?finger_fluid_pressure_solver=ipbf'};globalThis.history={state:null,replaceState(){}};
 try{
  const model=createIPBFPressureControlState({baseRadius:.185,pressureRadiusScale:1,beta:60,densityIterations:2,capillaryStrength:.72});
  const nodes=new Map();const node=id=>{if(!nodes.has(id))nodes.set(id,{type:'number',min:'0',max:'8',value:'',listeners:{},addEventListener(t,f){this.listeners[t]=f;}});return nodes.get(id);};
  const root={ownerDocument:{activeElement:null},querySelector:s=>node(s.slice(1)),querySelectorAll:()=>[...nodes.values()]};let count=12288,available=true;const requests=[];
  const cockpit=createIPBFPressureCockpit({root,getSolver:()=>({getPressureControls:()=>({available,...model.read(),particleCount:count,damping:true})}),isPaused:()=>false,setPaused(){},restart(){},restartParticles:async n=>{requests.push(n);if(n===999999999){available=false;throw Error("device capacity exceeded");}available=true;count=n;}});
  assert.equal(Number(node('ipbf-particles').value),12288);
  node('ipbf-particles').value='16384';cockpit.update();assert.equal(node('ipbf-particles').value,'16384');assert.deepEqual(requests,[]);
  await node('ipbf-particles-apply').listeners.click();assert.deepEqual(requests,[16384]);assert.match(node('ipbf-control-status').textContent,/16,384/);
  node('ipbf-particles').value='1.5';await node('ipbf-particles-apply').listeners.click();assert.deepEqual(requests,[16384]);assert.match(node('ipbf-control-error').textContent,/1024/);
  node('ipbf-particles').value='999999999';await node('ipbf-particles-apply').listeners.click();assert.equal(node('ipbf-particles').disabled,false);assert.equal(node('ipbf-particles-apply').disabled,false);assert.match(node('ipbf-control-error').textContent,/device capacity/);
  node('ipbf-particles').value='12288';await node('ipbf-particles-apply').listeners.click();assert.equal(count,12288);assert.match(node('ipbf-control-status').textContent,/12,288/);
 }finally{globalThis.location=oldLocation;globalThis.history=oldHistory;}
});
