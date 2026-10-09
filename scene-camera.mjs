import {Vector3,Quaternion,Euler,Matrix4} from './lib/three.core.js';
import {checkedPose} from './scene-edit-session.mjs';
import {checkedCameraView} from './scene-camera-views.mjs';
export const CAMERA_TYPE='camera',CAMERA_SOURCE='kaminos:camera',SCENE_CAMERA_SCHEMA='kaminos.scene-camera.v1';
const copy=value=>structuredClone(value),rad=Math.PI/180;
export function checkedCameraRecord(raw){
 if(raw?.type!==CAMERA_TYPE||raw.source!==CAMERA_SOURCE||typeof raw.id!=='string'||!raw.id)throw Error('Unsupported camera object');
 const data={sensorFit:'auto',sensorHeight:24,lensUnit:'millimeters',...raw.camera},transform=checkedPose(raw.transform);
 if(!data||!['perspective','orthographic'].includes(data.projection)||!Number.isFinite(data.lens)||data.lens<=0||!Number.isFinite(data.sensorWidth)||data.sensorWidth<=0||!Number.isFinite(data.near)||data.near<=0||!Number.isFinite(data.far)||data.far<=data.near)throw Error('Invalid camera lens or clipping planes');
 if(!['auto','horizontal','vertical'].includes(data.sensorFit)||!Number.isFinite(data.sensorHeight)||data.sensorHeight<=0)throw Error('Invalid camera sensor fit');
 if(data.projection==='orthographic'&&(!Number.isFinite(data.orthoScale)||data.orthoScale<=0))throw Error('Orthographic camera needs a positive scale');
 if(!['millimeters','fov'].includes(data.lensUnit))throw Error('Invalid camera lens unit');
 return {...copy(raw),transform,camera:{projection:data.projection,lens:data.lens,lensUnit:data.lensUnit,sensorWidth:data.sensorWidth,sensorHeight:data.sensorHeight,sensorFit:data.sensorFit,near:data.near,far:data.far,...(data.projection==='orthographic'?{orthoScale:data.orthoScale}:{})}};
}
// Blender's Lens Unit angle uses the chosen sensor dimension, not the
// renderer's vertical field of view, which also depends on output aspect.
export function cameraLensValue(raw){const data=checkedCameraRecord(raw).camera;return data.lensUnit==='fov'?2*Math.atan((data.sensorFit==='vertical'?data.sensorHeight:data.sensorWidth)/(2*data.lens))/rad:data.lens;}
export function cameraLensPatch(raw,value){const data=checkedCameraRecord(raw).camera;if(!Number.isFinite(value)||value<=0)throw Error('Enter a positive camera lens');if(data.lensUnit==='fov'&&value>=180)throw Error('Camera field of view must be between 0 and 180 degrees');return {lens:data.lensUnit==='fov'?(data.sensorFit==='vertical'?data.sensorHeight:data.sensorWidth)/(2*Math.tan(value*rad/2)):value};}
export function normalizeSceneCamera(raw,objects){
 const value=raw??{schema:SCENE_CAMERA_SCHEMA,activeId:null,aspect:[16,9]};
 if(value.schema!==SCENE_CAMERA_SCHEMA||!Array.isArray(value.aspect)||value.aspect.length!==2||!value.aspect.every(v=>Number.isFinite(v)&&v>0))throw Error('Invalid scene camera frame');
 for(const item of objects.filter(o=>o.type===CAMERA_TYPE))if(objects.filter(o=>o.id===item.id).length!==1)throw Error('Duplicate camera identity');
 const activeId=value.activeId??null;if(activeId!==null&&!objects.some(o=>o.id===activeId&&o.type===CAMERA_TYPE))throw Error('Scene active camera is missing or is not a camera');
 return {schema:SCENE_CAMERA_SCHEMA,activeId,aspect:[...value.aspect]};
}
export function cameraPoseFromView(raw){
 const view=checkedCameraView(raw),rotation=new Euler().setFromQuaternion(new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(new Vector3(...view.position),new Vector3(...view.target),new Vector3(...view.up))));
 return {position:[...view.position],rotation:[rotation.x,rotation.y,rotation.z],scale:[1,1,1]};
}
export function cameraViewFromRecord(raw,aspect=16/9,distance=3){
 const record=checkedCameraRecord(raw),q=new Quaternion().setFromEuler(new Euler(...record.transform.rotation)),position=new Vector3(...record.transform.position);
 const fit=record.camera.sensorFit,vertical=fit==='vertical'||fit==='auto'&&aspect<1,sensor=fit==='vertical'?record.camera.sensorHeight:record.camera.sensorWidth;
 const fov=2*Math.atan(sensor/(2*record.camera.lens*(vertical?1:aspect)))/rad;
 return {position:position.toArray(),target:position.clone().addScaledVector(new Vector3(0,0,-1).applyQuaternion(q),distance).toArray(),up:new Vector3(0,1,0).applyQuaternion(q).toArray(),fov,near:record.camera.near,far:record.camera.far,projection:record.camera.projection,...(record.camera.projection==='orthographic'?{orthoScale:record.camera.orthoScale/(vertical?1:aspect)}:{})};
}
export function cameraRecordFromView(id,label,raw,aspect=16/9){
 const view=checkedCameraView(raw);return checkedCameraRecord({id,label,type:CAMERA_TYPE,source:CAMERA_SOURCE,fileName:'Camera',createdAt:new Date().toISOString(),transform:cameraPoseFromView(view),camera:{projection:'perspective',lens:36/(2*Math.max(aspect,1)*Math.tan(view.fov*rad/2)),sensorWidth:36,near:view.near,far:view.far}});
}
export function cameraFrameRect(width,height,aspect,zoom=1,offset=[0,0]){
 if(![width,height,aspect,zoom].every(v=>Number.isFinite(v)&&v>0)||!offset.every(Number.isFinite))throw Error('Invalid camera frame geometry');
 let w=width,h=w/aspect;if(h>height){h=height;w=h*aspect;}w*=zoom;h*=zoom;
 return {x:(width-w)/2+offset[0]*width,y:(height-h)/2+offset[1]*height,width:w,height:h};
}
export function normalizeCameraViewport(raw,settings){
 if(raw==null)return null;
 if(!['user','camera'].includes(raw.mode)||typeof raw.locked!=='boolean'||raw.mode==='camera'&&!settings.activeId)throw Error('Invalid camera viewport state');
 return {mode:raw.mode,locked:raw.locked,...(raw.userView?{userView:checkedCameraView(raw.userView)}:{})};
}
/** Objects remain in the caller's scene; only active-camera/output references live here. */
export function createSceneCameras({edits,readObjects,writeCameras,readViewport,writeViewport,size,changed=()=>{},admit=()=>{},capture,supportsProjection=()=>true,makeId=()=>crypto.randomUUID()}){
 let settings=normalizeSceneCamera(null,[]),mode='user',userView=null,locked=false,distance=3,frameZoom=.85,frameOffset=[0,0],writing=false;
 let navigationId=null,navigationTimer=null,navigationDistanceBefore=null;
 const cameras=()=>readObjects().filter(o=>o.type===CAMERA_TYPE).map(checkedCameraRecord);
 const active=()=>cameras().find(o=>o.id===settings.activeId)||null;
 const frame=()=>{const {width,height}=size();return cameraFrameRect(width,height,settings.aspect[0]/settings.aspect[1],frameZoom,frameOffset);};
 const notify=()=>changed();
 const applyViewport=view=>{writing=true;try{writeViewport(copy(view));}finally{writing=false;}};
 const sync=()=>{if(mode==='camera'){const item=active();if(!item){mode='user';if(userView)applyViewport(userView);}else applyViewport(cameraViewFromRecord(item,settings.aspect[0]/settings.aspect[1],distance));}notify();};
 const read=()=>({settings:copy(settings),cameras:cameras()});
 const checked=value=>{const records=value.cameras.map(checkedCameraRecord),ids=new Set();for(const record of records){if(ids.has(record.id))throw Error('Duplicate camera identity');ids.add(record.id);}const meta=normalizeSceneCamera(value.settings,records);if(mode==='camera'&&meta.activeId&&!supportsProjection(records.find(o=>o.id===meta.activeId).camera.projection))throw Error('This render route does not support that camera projection');return {settings:meta,cameras:records};};
 const put=value=>{const next=checked(value),before=read();settings=next.settings;try{writeCameras(next.cameras);}catch(error){settings=before.settings;writeCameras(before.cameras);throw error;}sync();};
 edits.register('@scene-cameras',{read,check:checked,write:put});
 const available=()=>{admit();if(edits.state().active||edits.state().replaying)throw Error('Finish the current edit before changing cameras');};
 const change=(value,label)=>{available();return edits.apply('@scene-cameras',checked(value),label);};
 function enter(){available();const item=active();if(!item)throw Error('Add a camera or set the scene camera first');if(!supportsProjection(item.camera.projection))throw Error('This render route does not support that camera projection');if(mode!=='camera'){userView=copy(readViewport());distance=Math.hypot(...userView.position.map((v,i)=>v-userView.target[i]));if(!distance)distance=3;}mode='camera';frameZoom=.85;frameOffset=[0,0];sync();return item.id;}
 function leave({continueFromCamera=false}={}){finishNavigation(false);if(mode!=='camera')return;const current=readViewport();mode='user';if(userView&&!continueFromCamera)applyViewport(userView);else applyViewport({...current,fov:userView?.fov??current.fov});notify();}
 function finishNavigation(cancel=false){if(navigationTimer!==null){clearTimeout(navigationTimer);navigationTimer=null;}if(!navigationId)return;const id=navigationId;navigationId=null;if(cancel&&navigationDistanceBefore!==null)distance=navigationDistanceBefore;navigationDistanceBefore=null;if(edits.state().active?.id===id){cancel?edits.cancel():edits.commit();}sync();}
 const api={read,state:()=>({mode,locked,activeId:settings.activeId,frame:mode==='camera'?frame():null,writing,navigationId}),active:()=>copy(active()),sync,
  readNavigationView:()=>checkedCameraView(mode==='camera'&&userView?userView:readViewport()),
  setNavigationLens(fov){const view=checkedCameraView({...api.readNavigationView(),fov});if(mode==='camera')userView=view;else applyViewport(view);notify();},
  restore(value){finishNavigation(true);put({settings:normalizeSceneCamera(value,readObjects()),cameras:cameras()});},
  restoreViewport(value){value=normalizeCameraViewport(value,settings);mode='user';userView=null;locked=!!value?.locked;if(value?.mode==='camera'&&active()){if(!supportsProjection(active().camera.projection))throw Error('This render route does not support that camera projection');userView=value.userView?copy(value.userView):copy(readViewport());mode='camera';}sync();},
  viewportState:()=>({mode,locked,...(userView?{userView:copy(userView)}:{})}),
  membershipChanged(activeId=settings.activeId){if(activeId!==null&&!cameras().some(o=>o.id===activeId))activeId=null;settings={...settings,activeId};sync();},
  create(label='Camera'){available();const names=new Set(cameras().map(o=>o.label));if(names.has(label)){const base=label;let number=1;while(names.has(label=base+'.'+String(number++).padStart(3,'0'))){};}const id=makeId(),record=checkedCameraRecord({id,label,type:CAMERA_TYPE,source:CAMERA_SOURCE,fileName:'Camera',createdAt:new Date().toISOString(),transform:{...cameraPoseFromView(readViewport()),position:[0,0,0]},camera:{projection:'perspective',lens:50,sensorWidth:36,near:.1,far:1000}});change({cameras:[...cameras(),record],settings:{...settings,activeId:settings.activeId??id}},'Add camera');return id;},
  createFromView(label,view=readViewport()){available();const id=makeId(),record=cameraRecordFromView(id,label,view,settings.aspect[0]/settings.aspect[1]);change({cameras:[...cameras(),record],settings:{...settings,activeId:settings.activeId??id}},'Create camera from view');return id;},
  setActive(id){if(id!==null&&!cameras().some(o=>o.id===id))throw Error('Choose a camera object');change({cameras:cameras(),settings:{...settings,activeId:id}},'Set active camera');return id;},
  updateData(id,patch){const items=cameras();if(!items.some(o=>o.id===id))throw Error('Camera was not found');change({settings,cameras:items.map(o=>o.id===id?{...o,camera:{...o.camera,...patch}}:o)},'Edit camera data');},
  align(){available();const id=active()?.id;if(!id)throw Error('Set the active camera first');if(mode==='camera')throw Error('Leave camera view before aligning it');const view=readViewport();change({settings,cameras:cameras().map(o=>o.id===id?{...o,transform:cameraPoseFromView(view)}:o)},'Align camera to view');enter();return id;},
  setAspect(aspect){change({settings:{...settings,aspect},cameras:cameras()},'Set camera frame aspect');},
  enter,leave,toggle(){if(mode==='camera')leave();else enter();return mode;},
  lock(value){finishNavigation(false);locked=!!value;notify();},
  beginNavigation(operation){if(writing||mode!=='camera')return false;if(!locked){if(operation==='orbit'){leave({continueFromCamera:true});return false;}return true;}admit();const id=active()?.id;if(!id)throw Error('Scene camera is missing');if(!navigationId){navigationDistanceBefore=distance;edits.begin(id,'Navigate camera');navigationId=id;}return false;},
  navigationChanged(){if(!navigationId||writing)return;const view=readViewport();distance=Math.hypot(...view.position.map((v,i)=>v-view.target[i]));edits.preview(cameraPoseFromView(view));},
  endNavigation:finishNavigation,
  wheelEnd(){if(!navigationId)return;if(navigationTimer!==null)clearTimeout(navigationTimer);const id=navigationId;navigationTimer=setTimeout(()=>{navigationTimer=null;if(navigationId===id)finishNavigation(false);},180);},
  panFrame(dx,dy){const {width,height}=size();frameOffset=[frameOffset[0]+dx/width,frameOffset[1]+dy/height];sync();},
  zoomFrame(factor){if(!Number.isFinite(factor)||factor<=0)throw Error('Invalid camera-frame zoom');const next=frameZoom/factor;if(!Number.isFinite(next)||next<=0)throw Error('Camera frame exceeds numeric precision');frameZoom=next;sync();},
  frameBounds(){if(mode!=='camera')return false;frameZoom=.85;frameOffset=[0,0];sync();return true;},
  frameLayout:()=>({zoom:frameZoom,offset:[...frameOffset]}),restoreFrameLayout(value){frameZoom=value.zoom;frameOffset=[...value.offset];sync();},
  async capture(){finishNavigation(false);const original={camera:copy(readViewport()),viewport:api.viewportState()},layout=api.frameLayout();enter();const record=active();try{return await capture(copy(record),frame(),original);}finally{mode=original.viewport.mode;locked=original.viewport.locked;userView=original.viewport.userView??null;frameZoom=layout.zoom;frameOffset=layout.offset;if(mode==='camera')sync();else {applyViewport(original.camera);notify();}}},
  clear(){finishNavigation(true);mode='user';userView=null;settings=normalizeSceneCamera(null,[]);notify();},
 };
 return api;
}
