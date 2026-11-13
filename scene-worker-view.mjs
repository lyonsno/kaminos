// Consume the cloneable page view inside the worker's admitted frame. The
// projection matrix carries camera framing/crop that lens fields cannot recover.
function tuple(value,length,label){
 if(!Array.isArray(value)||value.length!==length||!value.every(Number.isFinite))throw Error(`Scene worker camera requires finite ${label}`);
 return [...value];
}
function checkedCamera(value,camera){
 if(value.type!=='PerspectiveCamera'||!camera.isPerspectiveCamera)throw Error('Scene worker requires its perspective camera snapshot');
 const result={type:value.type};
 for(const [key,length] of [['position',3],['quaternion',4],['up',3],['target',3],['projectionMatrix',16]])result[key]=tuple(value[key],length,key);
 for(const key of ['fov','aspect','near','far','zoom','filmGauge','filmOffset']){
  if(!Number.isFinite(value[key]))throw Error(`Scene worker camera requires finite ${key}`);
  result[key]=value[key];
 }
 if(result.fov<=0||result.fov>=180||result.aspect<=0||result.near<=0||result.far<=result.near||result.zoom<=0||result.filmGauge<=0)throw Error('Scene worker camera has invalid lens or clipping planes');
 if(Math.abs(Math.hypot(...result.quaternion)-1)>1e-6)throw Error('Scene worker camera requires a unit quaternion');
 if(Math.hypot(...result.up)===0)throw Error('Scene worker camera requires nonzero up');
 const projection=camera.projectionMatrix.clone().fromArray(result.projectionMatrix);
 if(!Number.isFinite(projection.determinant())||projection.determinant()===0)throw Error('Scene worker camera projection must be invertible');
 return {...result,projection};
}
function checkedViewport(value){
 const {width,height,pixelRatio}=value;
 if(![width,height,pixelRatio].every(number=>Number.isFinite(number)&&number>0))throw Error('Scene worker viewport requires positive finite dimensions and pixel ratio');
 return {width,height,pixelRatio};
}
function applyCamera(camera,view){
 camera.position.fromArray(view.position);camera.quaternion.fromArray(view.quaternion);camera.up.fromArray(view.up);
 for(const key of ['fov','aspect','near','far','zoom','filmGauge','filmOffset'])camera[key]=view[key];
 camera.projectionMatrix.copy(view.projection);camera.projectionMatrixInverse.copy(view.projection).invert();
 camera.updateMatrixWorld(true);
}
export function applySceneWorkerCameraSnapshot(camera,snapshot){applyCamera(camera,checkedCamera(snapshot,camera));}
export function createSceneWorkerView({camera,renderResources,readViewport,writeViewport}){
 if(!camera?.isPerspectiveCamera||typeof renderResources?.resize!=='function'||typeof readViewport!=='function'||typeof writeViewport!=='function')throw Error('Scene worker view requires its actual camera, retained renderer and viewport store');
 return Object.freeze({apply(input,ctx){
  ctx.assertCurrent();
  // Validate the whole snapshot before changing either store. Camera and canvas
  // aspect are independent: an authored output frame may crop the canvas.
  const view=input.camera?checkedCamera(input.camera,camera):null;
  const viewport=input.viewport?checkedViewport(input.viewport):null;
  const previous=readViewport();
  if(view)applyCamera(camera,view);
  if(viewport){
   writeViewport(viewport);
   if(['width','height','pixelRatio'].some(key=>viewport[key]!==previous[key]))renderResources.resize();
  }
 }});
}
