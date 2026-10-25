// BFL's published image budget and white/JPEG preparation. Browser resizing
// and JPEG encoding use Canvas; pixels are not claimed identical to Pillow.
const roundEven=value=>{const floor=Math.floor(value);return value-floor===.5?floor+(floor%2):Math.round(value);};
export function referenceSize(width,height,references){
  if(![width,height].every(v=>Number.isInteger(v)&&v>0))throw Error('Reference dimensions must be positive integers.');
  if(!Number.isInteger(references)||references<1||references>10)throw Error('BFL accepts 1 to 10 reference images.');
  if(Math.max(width,height)/Math.min(width,height)>200)throw Error('Reference aspect ratio exceeds 200:1.');
  const floor=v=>Math.max(32,Math.floor(v/32)*32),cap=references===1?1024**2:references===2?724**2:512**2;
  let w=Math.max(32,roundEven(width/32)*32),h=Math.max(32,roundEven(height/32)*32);
  if(w*h>cap){const beta=Math.sqrt(width*height/cap);w=floor(width/beta);h=floor(height/beta);}
  if(w*h>cap){if(w===32)h=floor(cap/w);else w=floor(cap/h);}
  return [w,h];
}
export async function prepareReference(raw,references,RawImage){
  const [width,height]=referenceSize(raw.width,raw.height,references);
  const canvas=new OffscreenCanvas(width,height),ctx=canvas.getContext('2d');
  ctx.fillStyle='white';ctx.fillRect(0,0,width,height);ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
  ctx.drawImage(raw.toCanvas(),0,0,width,height);
  const jpeg=await canvas.convertToBlob({type:'image/jpeg',quality:.92});
  const url=URL.createObjectURL(jpeg);
  try{return await RawImage.read(url);}finally{URL.revokeObjectURL(url);}
}
