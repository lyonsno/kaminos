import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(process.env.KAMINOS_LOADER_TEST_INDEX || new URL('../index.html',import.meta.url),'utf8');
const body=source.slice(source.indexOf('async function showGLB('),source.indexOf('// --- OBJ Inspector ---'));
function loader(){
 const loads=[],added=[],registered=[],disposed=[];
 let announceLoad;
 const loadStarted=new Promise(resolve=>{announceLoad=resolve;});
 const root={userData:{},traverse(fn){fn({isMesh:false});}};
 const clip={name:'Accepted motion'}, clips=[clip];
 const context={URL,console,fluidViewportReady:Promise.resolve(),sceneMutationToken:1,glbFileName:'previous.glb',modelSourceUrl:null,
  shouldClearSceneForImport:options=>options.clear!==false,
  clearScene(){throw Error('Workbench append must preserve the existing scene');},
  resolveAssetArrivalMode:()=> 'append',applyAssetArrival:()=>({}),
  GLTFLoader:class{load(url,success,_progress,error){loads.push({url,success,error});announceLoad();}},
  greenroomPreviewIsActive:()=>false,disposeObjectTree:object=>disposed.push(object),
  scene:{add:object=>added.push(object)},sceneNavigation:null,transformControls:null,
  registerSceneObject(object,metadata){const row={...metadata,id:'registered-asset',object};registered.push(row);return row;},
  document:{getElementById:()=>({value:'1',classList:{add(){}}})},setInfo(){},frameAssetArrival(){},window:{},
 };
 vm.createContext(context);vm.runInContext(body,context);
 return {context,loads,loadStarted,added,registered,disposed,root,clips};
}

test('ordinary GLB callers retain the actual root result',async()=>{
 const f=loader(),pending=f.context.showGLB('/retained/body.glb',{clear:false});
 f.loads[0].success({scene:f.root,animations:f.clips});
 assert.equal(await pending,f.root);assert.equal(f.registered.length,1);
});

test('Workbench asset receipt preserves real root, clips and registered source identity',async()=>{
 const f=loader(),pending=f.context.showGLB('/retained/body.glb',{clear:false,returnAsset:true,metadata:{source:'/retained/body.glb',fileName:'body.glb'}});
 f.loads[0].success({scene:f.root,animations:f.clips});
 const asset=await pending;
 assert.equal(asset.root,f.root,'owner playback needs the actual loaded root');
 assert.equal(asset.clips,f.clips,'do not lose or reconstruct the loaded animation clips');
 assert.equal(asset.id,'registered-asset');assert.equal(asset.source,'/retained/body.glb');
 assert.equal(asset.fileName,'body.glb');assert.equal(f.added[0],asset.root);
});

test('late asset from closed owner is disposed before scene registration',async()=>{
 const f=loader();let current=true;
 const pending=f.context.showGLB('/retained/body.glb',{clear:false,returnAsset:true,isCurrent:()=>current});
 current=false;f.loads[0].success({scene:f.root,animations:f.clips});
 await assert.rejects(pending,/stale async GLB/);
 assert.equal(f.added.length,0);assert.equal(f.registered.length,0);assert.deepEqual(f.disposed,[f.root]);
});

test('asset without animations returns the real empty clip set',async()=>{
 const f=loader(),pending=f.context.showGLB('/retained/static.glb',{clear:false,returnAsset:true});
 f.loads[0].success({scene:f.root,animations:[]});
 assert.equal((await pending).clips.length,0);
});

test('shared load hook waits for viewer and preserves membership despite clear or preview options',async()=>{
 const f=loader();let initialize;
 f.context.fluidViewportReady=new Promise(resolve=>{initialize=resolve;});
 const pending=f.context.window.kaminosWorkbenchLoadAsset('/retained/body.glb',{clear:true,register:false,normalize:false});
 assert.equal(f.loads.length,0);
 initialize();await f.loadStarted;
 f.loads[0].success({scene:f.root,animations:f.clips});
 assert.equal((await pending).id,'registered-asset');assert.equal(f.registered.length,1);
});
