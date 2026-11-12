// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {captureViewFan} from '../view-fan.mjs';
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const view={position:[0,0,3],target:[0,0,0],up:[0,1,0],near:.01,far:100,fov:40};
test('the actual viewport batch redraws the restored camera before relinquishing its manual draw authority',()=>{
 const html=readFileSync(process.env.KAMINOS_FAN_TEST_INDEX??new URL('../index.html',import.meta.url),'utf8'),start=html.indexOf('  const captureFanBatch=(views,size)=>{'),end=html.indexOf('  window.kaminosViewFans=installViewFanTool',start);
 assert.ok(start>=0&&end>start);
 let ratio=2,current=structuredClone(view),displayed=null;
 const scope={captureViewFan,authoringBusy:false,vantageCaptureHeld:false,outputCaptureExtent:null,recordingExtent:null,deviceRecoveryHeld:()=>false,viewProjection:{state:()=>({orthographic:false})},manualInspectionRender:false,sceneFrameCount:0,workingScene:{objects:[]},sceneGI:{resetHistory(){}},camera:{zoom:2,aspect:1,updateProjectionMatrix(){}},renderer:{_nodes:{nodeFrame:{frameId:0,update(){this.frameId++;}}},info:{},backend:{device:{limits:{maxTextureDimension2D:8192}}},domElement:{},getPixelRatio:()=>ratio,setPixelRatio:v=>ratio=v},readAuthoredCameraView:()=>structuredClone(current),writeAuthoredCameraView:v=>{current=structuredClone(v);},suspendEditorDrawingForVantage:()=>()=>{},syncViewportRendererSize(){},captureComposedCanvases:()=>({image,width:1,height:1}),document:{},markDirty(){}};
 scope.renderSceneFrame=()=>{if(!scope.manualInspectionRender)return false;scope.sceneFrameCount++;displayed=structuredClone(current);return true;};
 vm.createContext(scope);vm.runInContext(html.slice(start,end)+';globalThis.capture=captureFanBatch;',scope);
 const alternate={...view,position:[2,0,3]};scope.capture([{angle:25,view:alternate}],1);
 assert.deepEqual(displayed,view,'the visible pixels must return to the original camera even in exclusive inspection');assert.equal(scope.sceneFrameCount,2);assert.equal(scope.manualInspectionRender,false);assert.equal(ratio,2);assert.equal(scope.camera.zoom,2);
});
