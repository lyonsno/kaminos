// Portraits identify authored looks. They retain a picture of the evolved field,
// not a simulation checkpoint. Camera and rendering resources stay host-owned.
export function flamePortraitView(bounds){
 const {min,max}=bounds??{};
 if(!Array.isArray(min)||!Array.isArray(max)||min.length!==3||max.length!==3||!min.every(Number.isFinite)||!max.every(Number.isFinite)||max.some((value,i)=>value<=min[i]))throw Error('Flame portrait requires a finite domain');
 const target=min.map((value,i)=>(value+max[i])/2),radius=Math.hypot(...max.map((value,i)=>(value-min[i])/2));
 const fov=35,distance=radius/Math.sin(fov*Math.PI/360)*1.08;
 return {framing:'domain-front-v1',position:[target[0],target[1],target[2]+distance],target,up:[0,1,0],fov,near:Math.max(.001,distance-radius*2),far:distance+radius*3};
}
export function createFlamePortrait({begin,encode,now=()=>new Date().toISOString()}){
 let capturing=false;
 return async function capture(options={}){
  if(capturing)throw Error('A flame portrait is already being captured');
  capturing=true;let held;
  try{
   held=await begin(options);const {image,receipt}=await held.draw();
   if(!image||!Number.isInteger(image.width)||!Number.isInteger(image.height)||image.width<=0||image.height<=0||image.rgba?.length!==image.width*image.height*4)throw Error('Flame portrait image is incomplete');
   if(!Number.isFinite(receipt?.simStepCount)||receipt.simStepCount<=0)throw Error('Flame portrait needs an evolved field');
   let visible=false;for(let i=0;i<image.rgba.length;i+=4){if(image.rgba[i+3]&&image.rgba[i]+image.rgba[i+1]+image.rgba[i+2]>0){visible=true;break;}}
   if(!visible)throw Error('Flame portrait is blank; let the flame develop before capturing');
   const {framing,...camera}=held.camera;
   return {schema:'kaminos.flame-portrait.v1',image:await encode(straightFlamePortraitImage(image,receipt.alphaMode)),width:image.width,height:image.height,capturedAt:now(),framing,camera,simulation:structuredClone(receipt),origin:options.origin??'current-field'};
  }finally{try{await held?.release();}finally{capturing=false;}}
 };
}
export function portraitImage(document,portrait,{label='',className='flame-portrait'}={}){
 const image=document.createElement('img');image.className=className;image.alt=label;image.loading='lazy';image.title=(portrait.origin==='backfill'?'Backfilled':'Captured')+(portrait.simulation?.simStepCount?' · step '+portrait.simulation.simStepCount:'')+(portrait.basinApplication?.clamps?.clamps?.length?' · current range clamps applied':'');image.src=portrait.image??portrait.imageUrl;return image;
}

// Large PNG strings enter the JSON contract only at explicit export/import.
// Live endpoints carry a short object URL, so frame reads never clone pixels.
const retainedPortraits=new Map();
export function retainFlamePortrait(portrait){
 if(!portrait)return null;
 if(!portrait.image)return structuredClone(portrait);
 const bytes=Uint8Array.from(atob(portrait.image.split(',')[1]),character=>character.charCodeAt(0));
 const imageUrl=URL.createObjectURL(new Blob([bytes],{type:'image/png'}));
 retainedPortraits.set(imageUrl,structuredClone(portrait));
 const {image,...metadata}=portrait;return {...structuredClone(metadata),imageUrl};
}
export function exportFlamePortrait(portrait){return portrait?structuredClone(retainedPortraits.get(portrait.imageUrl)??portrait):null;}
// Recipes and library objects copy these references. The document owns their
// lifetime; replacing an endpoint must not invalidate a saved object's image.
export function releaseFlamePortrait(_portrait){}
export function mapRecipePortraits(recipe,convert){
 const result=structuredClone(recipe);for(const endpoint of [result?.a,result?.b])if(endpoint?.portrait)endpoint.portrait=convert(endpoint.portrait);return result;
}
export function mapScorePortraits(score,convert){
 const result=structuredClone(score);for(const object of result.objects??[])object.recipe=mapRecipePortraits(object.recipe,convert);
 for(const key of Object.keys(result.stages??{}))result.stages[key]=mapRecipePortraits(result.stages[key],convert);return result;
}

// GPU canvas readback stores premultiplied RGB; ImageData and PNG store straight
// RGB. Converting here prevents alpha being applied a second time in a card.
export function straightFlamePortraitImage(image,alphaMode){
 if(alphaMode!=='premultiplied')return image;
 const rgba=Uint8ClampedArray.from(image.rgba);for(let i=0;i<rgba.length;i+=4){const alpha=rgba[i+3];for(let channel=0;channel<3;channel++)rgba[i+channel]=alpha?Math.round(rgba[i+channel]*255/alpha):0;}
 return {...image,rgba};
}

export async function readOptionalFlamePortrait(presetId,{fetch=globalThis.fetch}={}){
 try{const response=await fetch('/api/volume-settings-preset-cover?id='+encodeURIComponent(presetId),{cache:'no-store'});
  if(response.status===404)return {};if(!response.ok)throw Error('HTTP '+response.status);
  const cover=await response.json();if(!cover?.portrait?.image)throw Error('Cover image is missing');return {portrait:cover.portrait};
 }catch(error){return {portraitError:'Basin portrait could not be read: '+error.message};}
}
