// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('actual worker entry mounts the shared drawer before its header can use the legacy tab fallback',async()=>{
 const source=await readFile(new URL('../scene-worker-page-entry.mjs',import.meta.url),'utf8');
 const entry=source.replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
 let opened=null;const assets={open(mode){opened=mode;},close(){},panel:()=>({open:false,mode:'browse'})};let mounted=0,started=0;const tab={dataset:{tab:'generate'},classList:{toggle(){}},addEventListener(_type,fn){this.click=fn;}};
 const owner={image:{refresh:async()=>{}},editor:{edits:{},select(){}},start:async()=>{started++;},frameSelected(){}};
 const doc={body:{classList:{add(){}}},getElementById:()=>({addEventListener(){}}),querySelectorAll:selector=>selector==='.tab'?[tab]:[]};
 const win={location:{hash:'',search:''},addEventListener(){}};
 const dependencies={mountSceneWorkerPage:()=>owner,createUserPreferences:()=>({load:async()=>null}),
  initializeVolumeCockpitLayout:async()=>({}),installAuthoringWorkspace:()=>({setWorkbenchInspector(){}}),
  installSceneWorkerAssetsDrawer:({owner:actual})=>{assert.equal(actual,owner);mounted++;return assets;},
  settleStartupVeil:(_doc,promise)=>promise,THREE:{},OrbitControls:function(){},installSceneNavigation(){},frameBox(){}};
 const start=new Function(...Object.keys(dependencies),entry+';return startSceneWorkerPage;')(...Object.values(dependencies));
 await start({document:doc,window:win});
 assert.equal(mounted,1,'the actual worker page must install its shared Assets/Generate drawer');
 assert.equal(win.kaminosAssets,assets);assert.equal(started,1);tab.click();assert.equal(opened,'generate','legacy Workbench Generate must reach the shared bottom drawer too');
});

function mountImageConsumer({requestFailure=false}={}){return readFile(new URL('../scene-worker-assets-page.mjs',import.meta.url),'utf8').then(source=>{
 let imageControls;const notices=[],entry={kind:'image',name:'new-basin.png',source:'/api/read?root=image-inbox&path=new-basin.png'};
 const state={roots:[],root:'image-inbox',path:'',entries:[],results:[],selected:null,loading:false,adding:false,error:null};
 const owner={editor:{edits:{}},read:()=>({ui:{objects:[]}}),image:{run:async()=>entry,retryOutput:async()=>entry,retryPersistence:async()=>entry,read:()=>({outputs:[]}),subscribe(){},busy:()=>false},
 page:{request:(operation,input)=>({completion:requestFailure?Promise.reject(Error('selection transport unavailable')):Promise.resolve({output:{revision:1,state:{...state,selected:input.entry}}})})}};
 const dependencies={installAuthoringAssets:()=>({render(){},state:()=>({open:false}),open(){},close(){}}),installKleinImageGeneration:({controller})=>{imageControls=controller;return {render(){}};},installGenerateLayout:()=>({render(){}}),installBrowseLayout:()=>({render(){}})};
 const mount=new Function(...Object.keys(dependencies),source.replace(/^import .*;\n/gm,'').replace(/^export /gm,'')+';return installSceneWorkerAssetsDrawer;')(...Object.values(dependencies));
 const assets=mount({document:{},owner,report:message=>notices.push(message)});return {assets,imageControls,entry,notices};
});}
test('saved image completion and save retries select the actual saved entry for the shared preview',async()=>{
 for(const operation of ['run','retryOutput','retryPersistence']){const f=await mountImageConsumer();assert.deepEqual(await f.imageControls[operation]({}),f.entry);assert.deepEqual(f.assets.read({selectionOnly:true}).selected,f.entry);}
});
test('selection failure after saving preserves the saved outcome and reports the presentation problem',async()=>{
 const f=await mountImageConsumer({requestFailure:true});assert.deepEqual(await f.imageControls.run({}),f.entry);assert.match(f.notices.join(' '),/saved.*selection/i);
});
