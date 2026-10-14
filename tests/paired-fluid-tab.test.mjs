import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8'),start=html.indexOf('function setActiveTab(tabName,'),end=html.indexOf('\nwindow.__kaminosSetActiveTab',start);
function fixture(pair){
 let starts=0,resumes=0;const generic=()=>({hidden:false,classList:{toggle(){}}}),panel={hidden:false,dataset:{viewport:'shared'}};
 const context={document:{body:{classList:{toggle(){}}},querySelectorAll:()=>[],getElementById:id=>id==='finger-fluid-bench-operator-panel'?panel:generic()},authoringWorkspace:{state:()=>({mode:'workbench'})},samImageTools:null,fluidWorkbench:null,isFireLightFieldRoute:()=>false,fingerFluidBenchSolver:null,fingerFluidBenchViewport:null,window:{__kaminosInvestigationEntryOnly:false},fingerFluidOwnerPair:pair?{}:null,startFingerFluidBench:()=>{starts++;},resumeFingerFluidBenchAfterWitness:()=>{resumes++;},stopFingerFluidBench(){},requestAnimationFrame(){}};
 vm.createContext(context);vm.runInContext(html.slice(start,end),context);return {context,get starts(){return starts;},get resumes(){return resumes;}};
}
test('ordinary Fluid tab reentry retains the paired owner without starting legacy water',()=>{const f=fixture(true);f.context.setActiveTab('finger-fluid-bench');assert.equal(f.starts,0);assert.equal(f.resumes,0);});
test('the ordinary singleton still starts or resumes when no pair owns the view',()=>{const f=fixture(false);f.context.setActiveTab('finger-fluid-bench');assert.equal(f.starts,1);f.context.fingerFluidBenchSolver={available:true};f.context.fingerFluidBenchViewport={};f.context.setActiveTab('finger-fluid-bench');assert.equal(f.resumes,1);});
