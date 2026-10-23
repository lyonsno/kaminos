// kaminos-test: node
import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';
import {createSceneEdits} from '../scene-edit-session.mjs';import {createSceneCameras,cameraViewFromRecord} from '../scene-camera.mjs';import {createViewportRecording} from '../viewport-recording.mjs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8'),begin=html.indexOf('  const viewportRecording=createViewportRecording('),end=html.indexOf('  const outputUI=',begin);
function fixture(){
 let view={position:[3,2,4],target:[0,0,0],up:[0,1,0],near:.1,far:100,fov:40},objects=[],id=0,ratio=2,clock=0;
 const readView=()=>structuredClone(view),writeView=v=>{view=structuredClone(v);};
 const edits=createSceneEdits({read:id=>objects.find(o=>o.id===id)?.transform,write:(id,t)=>{objects.find(o=>o.id===id).transform=structuredClone(t);}});
 const sceneCameras=createSceneCameras({edits,readObjects:()=>objects,writeCameras:items=>{objects=structuredClone(items);},readViewport:readView,writeViewport:writeView,size:()=>({width:800,height:600}),makeId:()=>String(++id)});
 const a=sceneCameras.createFromView('A'),b=sceneCameras.createFromView('B',{...view,position:[10,3,4]});sceneCameras.setActive(a);sceneCameras.enter();sceneCameras.lock(true);sceneCameras.restoreFrameLayout({zoom:1.2,offset:[.1,.2]});
 const scope={createViewportRecording:options=>createViewportRecording({...options,now:()=>clock}),createRecordingSink:async()=>({add(){},finish:async n=>({blob:new Blob(['movie']),frameCount:n}),dispose(){}}),vantageBusy:()=>null,vantageCaptureHeld:false,outputCaptureExtent:null,recordingExtent:null,recordingFrameSink:null,sceneSaveBlockedByFailedRestore:false,sceneObjects:[],sceneCameras,renderer:{backend:{device:{limits:{maxTextureDimension2D:8192}}},getPixelRatio:()=>ratio,setPixelRatio:v=>{ratio=v;},domElement:{}},camera:{zoom:1,updateProjectionMatrix(){}},readAuthoredCameraView:readView,writeAuthoredCameraView:writeView,cameraViewFromRecord,viewProjection:{state:()=>({orthographic:false,auto:false}),setOrthographic(){}},activeSceneComposition:null,volumePrototype:null,readVolumeControls:()=>({}),sceneGI:{resetHistory(){}},syncViewportRendererSize(){},markDirty(){},viewportDisplay:{quality:'full'},signal:new AbortController().signal,document:{createElement:()=>({getContext:()=>({drawImage(){}})})},transformControls:null,sceneFrameCount:0,localLiquidHost:null};
 vm.createContext(scope);vm.runInContext(html.slice(begin,end)+'\nglobalThis.rec=viewportRecording;',scope);
 return {scope,a,b,edits,cameras:sceneCameras,objects:()=>structuredClone(objects),view:readView,navigate(){sceneCameras.beginNavigation('pan');writeView({...view,position:view.position.map((v,i)=>v+(i===0?1:0))});sceneCameras.navigationChanged();sceneCameras.endNavigation(false);},frame(value){clock+=1000;scope.recordingFrameSink(value);}};
}
for(const completion of ['cancel','complete','stop'])test(`borrowed B navigation cannot author locked A on ${completion}`,async()=>{
 const f=fixture(),before={objects:f.objects(),viewport:f.cameras.viewportState(),layout:f.cameras.frameLayout(),view:f.view(),undo:f.edits.state().undoCount};
 const pending=f.scope.rec.start({cameraId:f.b,width:160,height:120,frames:2,fps:1});await new Promise(setImmediate);f.navigate();f.frame();
 if(completion==='cancel'){f.scope.rec.cancel();await assert.rejects(pending,e=>e.name==='AbortError');}else{completion==='stop'?f.scope.rec.stop():f.frame();await pending;}
 assert.deepEqual(f.objects(),before.objects,'borrowing B must not edit A or B');assert.equal(f.edits.state().undoCount,before.undo);assert.deepEqual(f.cameras.viewportState(),before.viewport);assert.deepEqual(f.cameras.frameLayout(),before.layout);assert.deepEqual(f.view(),before.view);
 f.navigate();assert.equal(f.edits.state().undoCount,before.undo+1,'normal locked-camera navigation resumes after recording');
});

for(const completion of ['cancel','complete','stop'])for(const quality of ['scene','full','preview'])test(`recording ${quality} preserves compiled emitter controls on ${completion}`,async()=>{
 const f=fixture(),s=f.scope;
 const source={inputRadius:.043,immersedRadius:.037,immersedCentreX:.18,immersedThickness:.022,resolution:32,emitterSourceLaw:'immersed-source',flowRate:.28};
 let runtime={...source,raySteps:24,renderScale:.8,adaptiveRays:.5,occupancySkip:.25,viewportPreview:false};
 const changes=[];s.volumePrototype={setControls(patch){changes.push(structuredClone(patch));Object.assign(runtime,patch);}};
 s.readVolumeControls=({quality='full'}={})=>({...source,inputRadius:.4,immersedRadius:.3,immersedCentreX:0,immersedThickness:.15,resolution:96,flowRate:1,raySteps:quality==='preview'?12:24,renderScale:quality==='preview'?.5:.8,adaptiveRays:.5,occupancySkip:.25,viewportPreview:quality==='preview'});
 const assertSource=()=>{for(const[key,value]of Object.entries(source))assert.equal(runtime[key],value,`recording changed ${key}`);};
 const pending=s.rec.start({width:160,height:120,frames:2,fps:1,quality});await new Promise(setImmediate);assertSource();
 // Ordinary source edits during recording stay authored after release too.
 source.immersedRadius=.028;runtime.immersedRadius=.028;f.frame();
 if(completion==='cancel'){s.rec.cancel();await assert.rejects(pending,e=>e.name==='AbortError');}else{completion==='stop'?s.rec.stop():f.frame();await pending;}
 assertSource();assert.equal(runtime.viewportPreview,false);assert.equal(runtime.raySteps,24);assert.equal(runtime.renderScale,.8);
 assert.ok(changes.every(p=>Object.keys(p).every(k=>['raySteps','renderScale','adaptiveRays','occupancySkip','viewportPreview'].includes(k))),'only rendering controls belong to output');
});

test('host-composed water and fire recording does not overlay a stale separate volume canvas',async()=>{
 const f=fixture(),s=f.scope,drawn=[];s.activeSceneComposition={};s.isSceneItemVisible=()=>true;s.isFireLightFieldRoute=()=>true;s.viewportDisplay.fire='full';s.volumePrototype={debugState:()=>({active:true}),setControls(){}};s.document.createElement=()=>({getContext:()=>({drawImage:canvas=>drawn.push(canvas)})});
 const pending=s.rec.start({width:160,height:120,frames:1,fps:1});await new Promise(setImmediate);const stale={name:'stale separate volume'};f.frame({fire:{canvas:stale,presentation:'host-composed'}});const result=await pending;assert.equal(drawn.includes(stale),false,'the final host already contains fire and water');assert.deepEqual(Array.from(result.receipts[0].layers),['mesh','ordinary-emissive-volume','authored-water-volume-transport']);
});
