import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
class Element {
 children=[];dataset={};textContent='';
 constructor(document,id=''){this.document=document;this.id=id;}
 append(...nodes){for(const n of nodes){this.children.push(n);if(n.id)this.document.nodes.set(n.id,n);}}
 querySelector(selector){return this.document.getElementById(selector);}
 querySelectorAll(){return [];}
 closest(){return this;}
}
function harness(){
 const document={nodes:new Map(),createElement(){return new Element(this);},getElementById(id){if(!this.nodes.has(id))this.nodes.set(id,new Element(this,id));return this.nodes.get(id);},querySelectorAll(){return []}};
 const installed=[],promotions=[];let mounted=null;
 const context=vm.createContext({document,URLSearchParams,location:{search:'?investigation=water'},
  window:{__kaminosActiveTab:()=> 'finger-fluid-bench'},fluidViewportReady:Promise.resolve(),
  fingerFluidPressureCockpit:null,fingerFluidBenchSolver:null,fluidWorkbench:null,fluidReflectionCockpit:null,
  mountReflectionCockpit:()=>({read(){},select(){},configureB(){}}),
  authoringWorkspace:{state:()=>({mode:'workbench'})},
  installExperimentWorkspace(options){installed.push(options);mounted=options.investigation;return {state:()=>({active:true}),setActive(){},setInvestigation(node){mounted=node;},update(){},setControls(options){promotions.push(options);}};},
  createInvestigationEntry:()=>({node:{draft:'retained thought'}}),setActiveTab(){},updateFingerFluidBenchReadout(){},
 });
 const begin=source.indexOf('function installFluidWorkbench('),end=source.indexOf('\nfunction installFingerFluidPressureCockpit()',begin);
 vm.runInContext(source.slice(begin,end),context);
 return {context,document,installed,promotions,mounted:()=>mounted};
}
test('entry-first actual host mount promotes the existing controls after water startup while preserving its draft',async()=>{
 const h=harness(),ui=await h.context.window.kaminosMountInvestigationEntry({});
 assert.equal(h.installed.length,1);assert.equal(h.installed[0].instruments,null);assert.equal(h.context.window.__kaminosInvestigationEntryOnly,true);
 h.context.fingerFluidBenchSolver={available:true};h.context.fingerFluidPressureCockpit={};h.context.installFluidWorkbench();
 assert.equal(h.promotions.length,1,'entry workspace must acquire the real cockpit and run controls once water becomes available');
 assert.equal(h.promotions[0].instruments,h.document.getElementById('ipbf-pressure-cockpit'));
 assert.equal(h.promotions[0].runNodes.length,2);assert.equal(h.context.window.__kaminosInvestigationEntryOnly,false);
 assert.equal(h.mounted(),ui.node);assert.equal(ui.node.draft,'retained thought');
 h.context.installFluidWorkbench();assert.equal(h.promotions.length,1,'ordinary repeated installation must not duplicate controls');
});
