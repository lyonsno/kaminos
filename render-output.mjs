// Output profiles describe a picture. They contain no scene membership, light
// recipe or solver settings; those remain owned by the scene and its basins.
export const OUTPUT_SCHEMA='kaminos.render-output.v1';
export const DEFAULT_OUTPUT=Object.freeze({cameraId:null,width:1920,height:1080,percentage:100,quality:'scene',filename:'kaminos.png'});
const copy=value=>structuredClone(value);
export function checkedRenderOutput(raw){
 const value={...DEFAULT_OUTPUT,...copy(raw)};
 for(const key of ['width','height'])if(!Number.isSafeInteger(value[key])||value[key]<1)throw Error('Output dimensions need positive whole pixels');
 if(!Number.isFinite(value.percentage)||value.percentage<=0)throw Error('Output percentage must be positive');
 if(value.cameraId!==null&&(typeof value.cameraId!=='string'||!value.cameraId))throw Error('Choose an output camera');
 if(!['scene','full','preview'].includes(value.quality))throw Error('Unknown output quality');
 if(typeof value.filename!=='string'||!value.filename.trim()||/[\\/\x00-\x1f]/.test(value.filename)||value.filename==='.'||value.filename==='..')throw Error('Enter a filename without a folder path');
 if(value.kind==='recording')value.recording=checkedRecordingOptions(value.recording);
 const extension=value.kind==='recording'&&value.recording.format==='mp4'?'mp4':'png';
 value.filename=value.filename.trim().replace(/\.(png|mp4)$/i,'')+'.'+extension;
 return value;
}
export function checkedRecordingOptions(raw={}){
 const value={frames:120,fps:24,format:'mp4',columns:4,tileWidth:320,...structuredClone(raw)};
 for(const key of ['frames','columns','tileWidth'])if(!Number.isSafeInteger(value[key])||value[key]<1)throw Error(`${key} needs a positive whole number`);
 if(!Number.isFinite(value.fps)||value.fps<=0)throw Error('FPS must be positive');
 if(!['mp4','filmstrip'].includes(value.format))throw Error('Choose MP4 or PNG filmstrip');
 return value;
}
export function outputPixels(raw){
 const value=checkedRenderOutput(raw),width=Math.round(value.width*value.percentage/100),height=Math.round(value.height*value.percentage/100);
 if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1)throw Error('Output percentage must produce at least one whole pixel in each dimension');
 return {width,height};
}
export function checkedOutputProfiles(raw){
 if(raw==null)return {schema:OUTPUT_SCHEMA,items:[]};
 if(raw.schema!==OUTPUT_SCHEMA||!Array.isArray(raw.items))throw Error('Unsupported output profiles');
 const ids=new Set();return {...copy(raw),items:raw.items.map(item=>{
  if(typeof item.id!=='string'||!item.id||ids.has(item.id))throw Error('Output profile identity must be unique');ids.add(item.id);
  if(typeof item.name!=='string'||!item.name.trim())throw Error('Name the output preset');
  const settings=checkedRenderOutput(item.settings);outputPixels(settings);
  return {...copy(item),name:item.name.trim(),settings};
 })};
}
export function createOutputProfiles({controller,makeId=()=>crypto.randomUUID()}){
 let saving=false;
 return {
  async load(){if(saving)throw Error('Output preset save is in progress');return checkedOutputProfiles((await controller.load()).renderOutput);},
  async save(name,settings,id=null){
   if(saving)throw Error('Output preset save is already in progress');saving=true;
   try{
   // Load/edit subset/save under the existing file revision contract. Another
   // writer between load and save gets a visible conflict, never a lost update.
   const document=await controller.load(),profiles=checkedOutputProfiles(document.renderOutput);
   if(controller.state?.().receipt?.revision===null)document.startupConfigured=false;
   if(id!==null&&!profiles.items.some(item=>item.id===id))throw Error('Output preset no longer exists; save a new preset');
   const item={id:id??makeId(),name,settings};
   const next=checkedOutputProfiles({...profiles,items:id===null?[...profiles.items,item]:profiles.items.map(old=>old.id===id?{...old,...item}:old)});
   return checkedOutputProfiles((await controller.save({...document,renderOutput:next})).renderOutput);
   }finally{saving=false;}
  },
 };
}
export function captureStill(host){
 let busy=false;
 return async(raw,{signal}={})=>{
  if(busy)throw Error('A still capture is already in progress');
  const settings=checkedRenderOutput(raw);if(settings.kind==='recording')throw Error('Use viewport recording for this output preset');const pixels=outputPixels(settings);signal?.throwIfAborted();busy=true;
  let session,result,failure;
  try{
   session=await host.begin({settings,pixels,signal});signal?.throwIfAborted();
   await session.draw();signal?.throwIfAborted();result=await session.capture();signal?.throwIfAborted();
   if(result?.width!==pixels.width||result?.height!==pixels.height||!/^data:image\/png;base64,\S+$/.test(result?.dataUrl??''))throw Error('Renderer did not produce the requested PNG pixels');
   result={...result,settings,pixels};
  }catch(error){failure=error;}
  finally{try{await session?.release();}catch(error){failure=failure?new AggregateError([failure,error],'Capture failed and the editor could not be restored'):error;}busy=false;}
  if(failure)throw failure;return result;
 };
}
