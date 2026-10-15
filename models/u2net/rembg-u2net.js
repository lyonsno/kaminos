// rembg 2.0.76 `remove(img, session=u2net)` as the TRELLIS2MLX preprocess calls
// it for an opaque photo: source max-1024 Lanczos pre-resize, U2Net at 320x320,
// min-max mask, Lanczos mask back to size, Image.composite naive cutout.
// Returns decoded RGBA8 for the alpha-cutout preparation that follows.
import {resizePillowLanczosU8} from './pillow-resample.js';

export const FOREGROUND_ROUTE='rembg 2.0.76 u2net (browser port; U2Net on WebGPU)';
const MEAN=[0.485,0.456,0.406],STD=[0.229,0.224,0.225],SIZE=320;

function stopped(signal){if(signal?.aborted)throw signal.reason?.name==='AbortError'?signal.reason:new DOMException('foreground removal stopped','AbortError');}

// preprocess_image_with_provenance: scale = min(1, 1024 / max(size)); int() sizes.
export function sourcePreResize(rgb,width,height){
  const scale=Math.min(1,1024/Math.max(width,height));
  if(scale>=1)return {rgb,width,height};
  const w=Math.trunc(width*scale),h=Math.trunc(height*scale);
  return {rgb:resizePillowLanczosU8(rgb,width,height,w,h,3),width:w,height:h};
}

// BaseSession.normalize: Lanczos to 320, divide by the image max (F64), ImageNet
// mean/std in F64, then F32, NCHW.
export function rembgInputTensor(rgb,width,height){
  const small=resizePillowLanczosU8(rgb,width,height,SIZE,SIZE,3);
  let max=0;for(const v of small)if(v>max)max=v;
  const div=Math.max(max,1e-6),out=new Float32Array(3*SIZE*SIZE);
  for(let i=0;i<SIZE*SIZE;i++)for(let c=0;c<3;c++)out[c*SIZE*SIZE+i]=(small[i*3+c]/div-MEAN[c])/STD[c];
  return out;
}

// U2netSession.predict after inference: F32 min-max, clip, *255, truncate to
// U8, then Lanczos to the image size.
export function rembgMaskFromPrediction(pred,width,height){
  if(pred.length!==SIZE*SIZE)throw RangeError('320x320 prediction required');
  const f=Math.fround;let ma=-Infinity,mi=Infinity;
  for(const v of pred){if(v>ma)ma=v;if(v<mi)mi=v;}
  const range=f(ma-mi),small=new Uint8Array(SIZE*SIZE);
  for(let i=0;i<pred.length;i++){
    let v=f(f(pred[i]-mi)/range);v=v<0?0:v>1?1:v;
    small[i]=Math.trunc(f(v*255));
  }
  return resizePillowLanczosU8(small,SIZE,SIZE,width,height,1);
}

// naive_cutout: Image.composite(img, transparent RGBA, mask). Pillow pastes the
// RGB image (as opaque RGBA) through the L mask onto zeros: DIV255(v * m).
const div255=v=>{const t=v+128;return ((t>>8)+t)>>8;};
export function naiveCutoutRgba(rgb,mask){
  const n=mask.length,out=new Uint8Array(n*4);
  for(let i=0;i<n;i++){const m=mask[i];
    out[i*4]=div255(rgb[i*3]*m);out[i*4+1]=div255(rgb[i*3+1]*m);out[i*4+2]=div255(rgb[i*3+2]*m);out[i*4+3]=div255(255*m);}
  return out;
}

// pixels: RGB8, or RGBA8 that is fully opaque (an image with real alpha takes
// the alpha-cutout route instead). runner: createU2NetRunner(...).
// foreground: the page's kit foreground run ({foregroundOpportunities, withForeground}),
// so inference yields at GPU boundaries and the CPU resizes run in foreground windows.
export async function removeForegroundU2Net({pixels,width,height,channels=3,runner,signal,foreground}={}){
  if(!runner?.run)throw TypeError('U2Net runner required');
  if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1)throw RangeError('image size required');
  if(!(pixels instanceof Uint8Array||pixels instanceof Uint8ClampedArray)||pixels.length!==width*height*channels||![3,4].includes(channels))
    throw TypeError('complete RGB8 or RGBA8 pixels required');
  stopped(signal);
  let rgb=pixels;
  if(channels===4){
    rgb=new Uint8Array(width*height*3);
    for(let i=0;i<width*height;i++){
      if(pixels[i*4+3]!==255)throw Error('image has alpha; use the alpha-cutout preparation, not foreground removal');
      rgb[i*3]=pixels[i*4];rgb[i*3+1]=pixels[i*4+1];rgb[i*3+2]=pixels[i*4+2];}
  }
  const cpu=(phase,work)=>foreground?.withForeground?foreground.withForeground(phase,async()=>work()):work();
  const pre=await cpu('u2net-pre-resize',()=>sourcePreResize(rgb,width,height));stopped(signal);
  const input=await cpu('u2net-input',()=>rembgInputTensor(pre.rgb,pre.width,pre.height));stopped(signal);
  const {mask:pred}=await runner.run(input,{foreground,signal});stopped(signal);
  const mask=await cpu('u2net-mask',()=>rembgMaskFromPrediction(pred,pre.width,pre.height));
  return {rgba:naiveCutoutRgba(pre.rgb,mask),width:pre.width,height:pre.height,
    provenance:{schema:'trellis2.browser-foreground-removal.v0',route:FOREGROUND_ROUTE,source:{width,height,channels},
      preResized:pre.width!==width||pre.height!==height,size:[pre.width,pre.height],
      reference:'TRELLIS2MLX preprocess rembg-u2net (itself a known divergence from upstream RMBG-2.0)',
      limits:'EXIF orientation is not applied (rembg applies it after the pre-resize); orientation-1 images only'}};
}
