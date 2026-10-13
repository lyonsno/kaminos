// kaminos-test: node
// Actual current-main mount callback; layout/guide constructors are fixtures.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
function fixture(){
 let mounted=null,tool=null,mode='authoring';const events=[];
 const document={querySelectorAll:()=>[{dataset:{tab:'assets'}},{dataset:{tab:'volume'}}]};
 const c={document,window:{},workbenchViewerReady:Promise.resolve(),authoringWorkspace:{state:()=>({mode}),setMode(value){mode=value;events.push('mode');return true;}},createInvestigationEntry:options=>({node:{draft:'retained'},subject:options.subject}),sharedWorkbench:{setInvestigation(node,options){mounted=node;tool=options.tool;events.push('mount');}},setActiveTab(value){events.push('tool:'+value);}};
 const a=source.indexOf('window.kaminosMountInvestigationEntry=async');assert.ok(a>=0,'current-main owner investigation mount missing');const b=source.indexOf('\n};',a);assert.ok(b>a);vm.createContext(c);vm.runInContext(source.slice(a,b+3),c);
 return {c,events,mounted:()=>mounted,tool:()=>tool};
}
test('scene investigation mounts on its actual tool with generic subject',async()=>{const f=fixture(),ui=await f.c.window.kaminosMountInvestigationEntry({tool:'volume'});assert.equal(f.mounted(),ui.node);assert.equal(f.tool(),'volume');assert.equal(ui.subject,'experiment');assert.deepEqual(f.events,['mode','mount','tool:volume']);});
test('current-main default is Assets and keeps the supplied subject',async()=>{const f=fixture(),ui=await f.c.window.kaminosMountInvestigationEntry({subject:'creature'});assert.equal(f.tool(),'assets');assert.equal(ui.subject,'creature');});
test('unknown tool rejects before changing workspace or retained controls',async()=>{const f=fixture();await assert.rejects(f.c.window.kaminosMountInvestigationEntry({tool:'missing'}),/Unknown Workbench tool/);assert.deepEqual(f.events,[]);assert.equal(f.mounted(),null);});
