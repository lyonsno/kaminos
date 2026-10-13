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
 const document={nodes:new Map(),createElement(){return new Element(this);},getElementById(id){if(!this.nodes.has(id))this.nodes.set(id,new Element(this,id));return this.nodes.get(id);},querySelectorAll(selector){return selector==='.tab[data-tab]'?[{dataset:{tab:'assets'},textContent:'Assets'},{dataset:{tab:'finger-fluid-bench'},textContent:'Fluid'}]:[];}};
 const installed=[],promotions=[],opened=[];let mounted=null,mountedTool=null;
 const context=vm.createContext({document,URLSearchParams,location:{search:'?investigation=water'},
  window:{__kaminosActiveTab:()=> 'finger-fluid-bench'},fluidViewportReady:Promise.resolve(),
  fingerFluidPressureCockpit:null,fingerFluidBenchSolver:null,fluidWorkbench:null,
  authoringWorkspace:{state:()=>({mode:'workbench'})},
  installExperimentWorkspace(options){installed.push(options);mounted=options.investigation;return {hasControls:()=>promotions.length>0,state:()=>({active:true}),setTool(){},setActive(){},setInvestigation(node,options){mounted=node;mountedTool=options?.tool;},update(){},setControls(options){promotions.push(options);}};},
  createInvestigationEntry:options=>({node:{draft:'retained thought'},subject:options.subject}),setActiveTab:name=>opened.push(name),updateFingerFluidBenchReadout(){},
 });
 const begin=source.indexOf('function installFluidWorkbench('),end=source.indexOf('\nfunction installFingerFluidPressureCockpit()',begin);
 vm.runInContext(source.slice(begin,end),context);
 return {context,document,installed,promotions,opened,mounted:()=>mounted,mountedTool:()=>mountedTool};
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
test('scene investigation uses its requested tool and general subject without creating water',async()=>{
 const h=harness(),ui=await h.context.window.kaminosMountInvestigationEntry({tool:'assets'});
 assert.equal(h.opened.at(-1),'assets');assert.equal(h.mountedTool(),'assets');assert.equal(ui.subject,'experiment');
 assert.equal(h.context.fingerFluidBenchSolver,null);
});
test('unknown investigation tool is rejected before replacing retained controls',async()=>{
 const h=harness();await assert.rejects(h.context.window.kaminosMountInvestigationEntry({tool:'missing-tool'}),/Unknown.*tool/i);
 assert.equal(h.mounted(),null);assert.equal(h.opened.length,0);
});
