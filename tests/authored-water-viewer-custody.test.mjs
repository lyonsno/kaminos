// kaminos-test: node
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const begin=source.indexOf('function setActiveTab('),end=source.indexOf('window.__kaminosSetActiveTab',begin);
let starts=0,stops=0;const panel={hidden:true};
const context={URLSearchParams,location:{search:'?workspace=workbench'},window:{location:{search:'?workspace=workbench'}},authoringWorkspace:{state:()=>({mode:'workbench'})},sharedWorkbench:{setTool(){}},document:{body:{classList:{toggle(){}}},querySelectorAll:()=>[],getElementById:id=>id==='finger-fluid-bench-operator-panel'?panel:id==='sam-image-viewport'?{hidden:true}:null},samImageTools:null,startFingerFluidBench:()=>starts++,stopFingerFluidBench:()=>stops++,isFireLightFieldRoute:()=>false,requestAnimationFrame(){},drawFingerJuiceHostPreview(){},ensureFingerJuiceTabFrameLoaded(){}};
vm.createContext(context);vm.runInContext(source.slice(begin,end),context);context.setActiveTab('finger-fluid-bench');
assert.equal(starts,0,'Selecting shared Fluid tools must not create a competing standalone simulation and renderer');assert.equal(panel.hidden,true,'The legacy canvas must stay hidden in the shared scene');assert.equal(stops,1);
context.location.search=context.window.location.search='?kaminos_finger_fluid_bench=1';context.setActiveTab('finger-fluid-bench');assert.equal(starts,1,'Explicit historical standalone route remains usable');assert.equal(panel.hidden,false);
console.log('Shared Fluid selection preserves one scene renderer; explicit historical route remains admitted');
