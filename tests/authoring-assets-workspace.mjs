// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// Execute the actual shared-header event wiring with both workspace states.
const source=readFileSync(new URL('../authoring-workspace.mjs',import.meta.url),'utf8');
const start=source.indexOf("  header.querySelectorAll('[data-workbench-tab]')");
const end=source.indexOf("  inspector.querySelectorAll",start);
assert.ok(start>=0&&end>start);
for(const workspace of ['authoring','workbench'])test(`Assets and Generate share panel toggling in ${workspace}`,()=>{
 const buttons=['assets','generate'].map(tab=>({dataset:{workbenchTab:tab},addEventListener(_,handler){this.click=handler;}}));
 let panel={open:false,mode:'browse'},loads=0,legacyOpens=0,workspaceChanges=0;
 const assets={panel:()=>({...panel}),close(){panel.open=false;},open(mode){panel={open:true,mode};loads++;}};
 vm.runInNewContext(source.slice(start,end),{header:{querySelectorAll:()=>buttons},mode:workspace,document:{defaultView:{kaminosAssets:assets}},setMode(){workspaceChanges++;return true;},openWorkbenchTab(){legacyOpens++;}});
 buttons[0].click();assert.deepEqual(panel,{open:true,mode:'browse'});
 buttons[0].click();assert.equal(panel.open,false,'same button closes its open panel');
 buttons[0].click();buttons[1].click();assert.deepEqual(panel,{open:true,mode:'generate'},'another mode changes panel content');
 buttons[1].click();assert.equal(panel.open,false);
 assert.equal(loads,3);assert.equal(legacyOpens,0);assert.equal(workspaceChanges,0);
});
