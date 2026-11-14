// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('actual worker entry mounts the shared drawer before its header can use the legacy tab fallback',async()=>{
 const source=await readFile(new URL('../scene-worker-page-entry.mjs',import.meta.url),'utf8');
 const entry=source.replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
 const assets={open(){},close(){},panel:()=>({open:false,mode:'browse'})};let mounted=0,started=0;
 const owner={image:{refresh:async()=>{}},editor:{edits:{},select(){}},start:async()=>{started++;},frameSelected(){}};
 const doc={body:{classList:{add(){}}},getElementById:()=>({addEventListener(){}}),querySelectorAll:()=>[]};
 const win={location:{hash:'',search:''},addEventListener(){}};
 const dependencies={mountSceneWorkerPage:()=>owner,createUserPreferences:()=>({load:async()=>null}),
  initializeVolumeCockpitLayout:async()=>({}),installAuthoringWorkspace:()=>({setWorkbenchInspector(){}}),
  installSceneWorkerAssetsDrawer:({owner:actual})=>{assert.equal(actual,owner);mounted++;return assets;},
  settleStartupVeil:(_doc,promise)=>promise,THREE:{},OrbitControls:function(){},installSceneNavigation(){},frameBox(){}};
 const start=new Function(...Object.keys(dependencies),entry+';return startSceneWorkerPage;')(...Object.values(dependencies));
 await start({document:doc,window:win});
 assert.equal(mounted,1,'the actual worker page must install its shared Assets/Generate drawer');
 assert.equal(win.kaminosAssets,assets);assert.equal(started,1);
});
