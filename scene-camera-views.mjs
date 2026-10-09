export const CAMERA_VIEWS_SCHEMA='kaminos.camera-views.v1';
const copy=value=>structuredClone(value);
export function checkedCameraView(value) {
  const result={};
  for(const key of ['position','target','up']){
    if(!Array.isArray(value?.[key])||value[key].length!==3||!value[key].every(Number.isFinite))throw Error(`Camera ${key} needs three finite values`);
    result[key]=[...value[key]];
  }
  const d=result.target.map((v,i)=>v-result.position[i]),u=result.up;
  const cross=[d[1]*u[2]-d[2]*u[1],d[2]*u[0]-d[0]*u[2],d[0]*u[1]-d[1]*u[0]];
  if(!d.some(v=>v!==0)||!cross.some(v=>v!==0))throw Error('Camera aim and up must define a view');
  if(!Number.isFinite(value.fov)||value.fov<=0||value.fov>=180)throw Error('Camera field of view must be between 0 and 180 degrees');
  if(!Number.isFinite(value.near)||!Number.isFinite(value.far)||value.near<=0||value.far<=value.near)throw Error('Invalid camera clipping planes');
  return {...result,fov:value.fov,near:value.near,far:value.far};
}
export function normalizeCameraViews(value) {
  if(value==null)return {schema:CAMERA_VIEWS_SCHEMA,selectedId:null,items:[]};
  if(value.schema!==CAMERA_VIEWS_SCHEMA||!Array.isArray(value.items))throw Error('Unsupported saved camera views');
  const ids=new Set(),items=value.items.map(item=>{
    if(typeof item.id!=='string'||!item.id||ids.has(item.id))throw Error('Camera view identity must be unique');ids.add(item.id);
    if(typeof item.label!=='string'||!item.label.trim())throw Error('Name the camera view');
    return {id:item.id,label:item.label.trim(),view:checkedCameraView(item.view)};
  });
  const selectedId=value.selectedId??null;
  if(selectedId!==null&&!ids.has(selectedId))throw Error('Selected camera view is missing');
  return {schema:CAMERA_VIEWS_SCHEMA,selectedId,items};
}
export function cameraViewsMatch(a,b) {
  const left=checkedCameraView(a),right=checkedCameraView(b);
  return Object.keys(left).every(key=>[left[key]].flat().every((v,i)=>Math.abs(v-[right[key]].flat()[i])<=1e-8*Math.max(1,Math.abs(v))));
}
export function createCameraViews({edits,readCamera,writeCamera,readLens=()=>({fov:readCamera().fov}),writeLens=null,admit=()=>{},changed=()=>{},capture,makeId=()=>crypto.randomUUID()}) {
  let state=normalizeCameraViews();
  const publish=()=>changed(copy(state));
  const applyView=value=>{
    const next=checkedCameraView(value),before=checkedCameraView(readCamera());
    try{writeCamera(next);}catch(error){try{writeCamera(before);}catch(rollback){throw new AggregateError([error,rollback],'Camera could not be restored');}throw error;}
  };
  edits.register('@camera-views',{read:()=>copy(state),check:normalizeCameraViews,write:value=>{state=normalizeCameraViews(value);publish();}});
  const applyLens=writeLens??(value=>applyView({...readCamera(),fov:value.fov}));
  // Lens undo changes the lens of the current view, never a later navigated pose.
  edits.register('@viewport-lens',{read:()=>copy(readLens()),check:value=>({fov:checkedCameraView({...readCamera(),fov:value.fov}).fov}),write:value=>{const before=copy(readLens());try{applyLens(value);}catch(error){applyLens(before);throw error;}publish();}});
  const available=()=>{admit();const e=edits.state();if(e.active||e.replaying)throw Error('Finish the current edit before changing camera views');};
  const find=id=>{const item=state.items.find(item=>item.id===id);if(!item)throw Error('Camera view was not found');return item;};
  const change=(next,label)=>{available();edits.apply('@camera-views',normalizeCameraViews(next),label);return copy(state);};
  return {
    read:()=>copy(state),current:()=>checkedCameraView(readCamera()),lens:()=>readLens().fov,
    setLens(fov){available();edits.apply('@viewport-lens',{fov},'Adjust camera lens');return checkedCameraView(readCamera());},
    restore(value){state=normalizeCameraViews(value);publish();},
    save(label){available();const item={id:makeId(),label,view:checkedCameraView(readCamera())};change({...state,items:[...state.items,item],selectedId:item.id},'Save camera view');return copy(find(item.id));},
    select(id){available();const item=find(id);applyView(item.view);state.selectedId=id;publish();return copy(item);},
    update(id=state.selectedId){const item=find(id);change({...state,items:state.items.map(v=>v.id===id?{...item,view:checkedCameraView(readCamera())}:v)},'Update camera view');return copy(find(id));},
    rename(id,label){find(id);change({...state,items:state.items.map(item=>item.id===id?{...item,label}:item)},'Rename camera view');},
    duplicate(id=state.selectedId){const item=find(id),next={...copy(item),id:makeId(),label:item.label+' copy'};change({...state,items:[...state.items,next],selectedId:next.id},'Duplicate camera view');return copy(next);},
    remove(id=state.selectedId){find(id);const items=state.items.filter(item=>item.id!==id);change({...state,items,selectedId:state.selectedId===id?(items[0]?.id??null):state.selectedId},'Remove camera view');},
    async capture(id=state.selectedId){const item=this.select(id);if(!capture)throw Error('Camera capture is unavailable');return capture(copy(item));},
    differs(){return !!state.selectedId&&!cameraViewsMatch(readCamera(),find(state.selectedId).view);},
  };
}
