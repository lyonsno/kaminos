// The pinned diffusers Flux3ImageProcessor keeps each reference's own resolution,
// scales only above 4096² pixels, then center-crops to the 16-pixel latent grid.
// Browser resampling uses Canvas high quality; transparent inputs get a white
// background explicitly, matching the images presented to the operator.
export function referenceImageGeometry(sourceWidth,sourceHeight,{maxArea=4096*4096}={}){
 if(!Number.isInteger(sourceWidth)||!Number.isInteger(sourceHeight)||Math.min(sourceWidth,sourceHeight)<16)throw Error('Reference image must be at least 16 pixels on each side');
 const scale=Math.min(1,Math.sqrt(maxArea/(sourceWidth*sourceHeight)));
 const resizedWidth=Math.floor(sourceWidth*scale),resizedHeight=Math.floor(sourceHeight*scale);
 const width=Math.floor(resizedWidth/16)*16,height=Math.floor(resizedHeight/16)*16;
 if(!width||!height)throw Error('Reference image becomes smaller than the 16-pixel grid');
 return {sourceWidth,sourceHeight,resizedWidth,resizedHeight,left:Math.floor((resizedWidth-width)/2),top:Math.floor((resizedHeight-height)/2),width,height};
}
export function referenceRgb(rgba){
 const out=new Float32Array(rgba.length/4*3);
 for(let p=0;p<rgba.length/4;p++)for(let c=0;c<3;c++){const a=rgba[p*4+3]/255;out[p*3+c]=(rgba[p*4+c]*a+255*(1-a))/127.5-1;}
 return out;
}
export async function readReferenceImage(entry,{signal,maxArea}={}){
 if(entry?.kind!=='image'||entry?.visibility?.status==='withheld')throw Error('Choose an available source image for reference conditioning');
 const source=entry.source||`/api/read?${new URLSearchParams({root:entry.root_id||entry.root,path:entry.path})}`;
 const response=await fetch(source,{signal});if(!response.ok)throw Error(`Reference image: ${response.status}`);
 const blob=await response.blob(),bytes=await blob.arrayBuffer();
 const sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
 const bitmap=await createImageBitmap(blob);let canvas;
 try{
  const geometry=referenceImageGeometry(bitmap.width,bitmap.height,{maxArea}),{width,height,resizedWidth,resizedHeight,left,top}=geometry;
  canvas=new OffscreenCanvas(width,height);const ctx=canvas.getContext('2d',{willReadFrequently:true});
  ctx.fillStyle='white';ctx.fillRect(0,0,width,height);ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
  ctx.drawImage(bitmap,-left,-top,resizedWidth,resizedHeight);signal?.throwIfAborted();
  return {width,height,rgb:referenceRgb(ctx.getImageData(0,0,width,height).data),provenance:{source,name:entry.name,sha256,geometry,alphaBackground:'white',resize:'canvas-high-quality'}};
 }finally{bitmap.close();if(canvas){canvas.width=1;canvas.height=1;}}
}
