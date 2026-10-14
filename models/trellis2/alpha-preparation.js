// Conditioning pixels from an already decoded RGBA8 foreground cutout.
// Source: TRELLIS2MLX1201553 trellmlx/preprocess.py, followed by DINO RGB512.
// The encoded-image entry point decodes alpha cutouts; neither entry removes
// backgrounds. Pixel/kernel identity is
// separate from the image decoder's color/orientation/alpha interpretation.
// Lanczos: Pillow12.3.0 src/libImaging/Resample.c and Convert.c (MIT-CMU).
// https://github.com/python-pillow/Pillow/tree/12.3.0/src/libImaging

const FIXED=2**22,BIAS=FIXED/2;
const clip=v=>Math.max(0,Math.min(255,v));
const sinc=v=>v===0?1:Math.sin(v*Math.PI)/(v*Math.PI);
function stop(signal){if(signal?.aborted)throw new DOMException('Alpha preparation stopped','AbortError');}
function dimensions(width,height){
  if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||
    !Number.isSafeInteger(width*height*4))throw TypeError('positive complete RGBA dimensions required');
}
function coefficients(size,outSize){
  const scale=size/outSize,filterScale=Math.max(1,scale),support=3*filterScale,rows=[];
  for(let x=0;x<outSize;x++){
    const center=(x+.5)*scale,first=Math.max(0,Math.trunc(center-support+.5));
    const last=Math.min(size,Math.trunc(center+support+.5)),weights=[];
    let mass=0;
    for(let i=first;i<last;i++){
      const distance=(i-center+.5)*(1/filterScale);
      const value=distance>=-3&&distance<3?sinc(distance)*sinc(distance/3):0;
      weights.push(value);mass+=value;
    }
    rows.push({first,weights:Int32Array.from(weights,value=>{
      const normalized=mass!==0?value/mass:value;
      return Math.trunc(normalized*FIXED+(normalized<0?-.5:.5));
    })});
  }
  return rows;
}
// Two U8-quantized passes, rather than a single floating bilinear/canvas pass.
function resize(pixels,width,height,outWidth,outHeight,channels){
  let current=pixels;
  if(width!==outWidth){
    const rows=coefficients(width,outWidth),horizontal=new Uint8Array(outWidth*height*channels);
    for(let y=0;y<height;y++)for(let x=0;x<outWidth;x++)for(let c=0;c<channels;c++){
      const row=rows[x];let sum=BIAS;
      for(let k=0;k<row.weights.length;k++)sum+=current[(y*width+row.first+k)*channels+c]*row.weights[k];
      horizontal[(y*outWidth+x)*channels+c]=clip(Math.floor(sum/FIXED));
    }
    current=horizontal;width=outWidth;
  }
  if(height!==outHeight){
    const rows=coefficients(height,outHeight),vertical=new Uint8Array(width*outHeight*channels);
    for(let y=0;y<outHeight;y++)for(let x=0;x<width;x++)for(let c=0;c<channels;c++){
      const row=rows[y];let sum=BIAS;
      for(let k=0;k<row.weights.length;k++)sum+=current[((row.first+k)*width+x)*channels+c]*row.weights[k];
      vertical[(y*width+x)*channels+c]=clip(Math.floor(sum/FIXED));
    }
    current=vertical;
  }
  return current;
}
/** Pillow12.3 U8 Lanczos for independent interleaved 1/3/4-channel planes.
 * This does not convert straight-alpha RGBA to/from premultiplied storage;
 * callers needing Pillow RGBA image semantics must do that separately.
 * Returns owned U8 storage, including when both dimensions are unchanged.
 */
export function resizePillowLanczosU8(pixels,width,height,outWidth,outHeight,channels){
  if(![1,3,4].includes(channels))throw TypeError('1,3 or4 channels required');
  if(![width,height,outWidth,outHeight].every(n=>Number.isSafeInteger(n)&&n>0)||
    ![width*height*channels,outWidth*height*channels,outWidth*outHeight*channels].every(Number.isSafeInteger))
    throw TypeError('positive complete U8 dimensions required');
  if(!(pixels instanceof Uint8Array||pixels instanceof Uint8ClampedArray)||pixels.length!==width*height*channels)
    throw TypeError('complete interleaved U8 pixels required');
  const output=resize(pixels,width,height,outWidth,outHeight,channels);
  return output===pixels?new Uint8Array(output):output;
}
function resizeRgba(pixels,width,height,outWidth,outHeight){
  const premultiplied=new Uint8Array(pixels.length);
  for(let i=0;i<pixels.length;i+=4){
    const alpha=pixels[i+3];premultiplied[i+3]=alpha;
    for(let c=0;c<3;c++){
      const v=pixels[i+c]*alpha+128;
      premultiplied[i+c]=(v+Math.floor(v/256))>>8;
    }
  }
  const output=resize(premultiplied,width,height,outWidth,outHeight,4);
  for(let i=0;i<output.length;i+=4){
    const alpha=output[i+3];
    if(alpha!==0&&alpha!==255)for(let c=0;c<3;c++)output[i+c]=clip(Math.trunc(255*output[i+c]/alpha));
  }
  return output;
}
function tiesEven(value){
  const floor=Math.floor(value),fraction=value-floor;
  return fraction===.5?(floor%2===0?floor:floor+1):Math.round(value);
}
const sha=async pixels=>Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',pixels)),
  value=>value.toString(16).padStart(2,'0')).join('');

export async function prepareTrellisAlphaRgba({pixels,width,height,signal}={}){
  stop(signal);dimensions(width,height);
  if(!(pixels instanceof Uint8Array||pixels instanceof Uint8ClampedArray)||pixels.length!==width*height*4)
    throw TypeError('complete U8 RGBA pixels required');
  let hasAlpha=false;
  for(let i=3;i<pixels.length;i+=4)if(pixels[i]!==255){hasAlpha=true;break;}
  if(!hasAlpha)throw Error('an alpha cutout is required; background segmentation is a separate operation');
  const originalSize=[width,height],scale=Math.min(1,1024/Math.max(width,height));
  let rgba=pixels;
  if(scale<1){
    const nextWidth=Math.trunc(width*scale),nextHeight=Math.trunc(height*scale);
    dimensions(nextWidth,nextHeight);
    rgba=resizeRgba(pixels,width,height,nextWidth,nextHeight);width=nextWidth;height=nextHeight;
  }
  stop(signal);
  let xmin=width,xmax=-1,ymin=height,ymax=-1,foregroundPixels=0;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(rgba[(y*width+x)*4+3]>204){
    xmin=Math.min(xmin,x);xmax=Math.max(xmax,x);ymin=Math.min(ymin,y);ymax=Math.max(ymax,y);foregroundPixels++;
  }
  if(!foregroundPixels)throw Error('no foreground above the source alpha threshold; no raw-image fallback');
  const centerX=(xmin+xmax)/2,centerY=(ymin+ymax)/2,extent=Math.max(xmax-xmin,ymax-ymin),half=Math.floor(extent/2);
  const box=[centerX-half,centerY-half,centerX+half,centerY+half],integerBox=box.map(tiesEven);
  const [left,top,right,bottom]=integerBox,cropWidth=right-left,cropHeight=bottom-top;
  if(cropWidth<1||cropHeight<1)throw Error('source foreground crop is empty');
  const rgb=new Uint8Array(cropWidth*cropHeight*3);
  for(let y=0;y<cropHeight;y++)for(let x=0;x<cropWidth;x++){
    const sx=x+left,sy=y+top;
    if(sx<0||sx>=width||sy<0||sy>=height)continue;
    const i=(sy*width+sx)*4,alpha=Math.fround(rgba[i+3]/255),out=(y*cropWidth+x)*3;
    for(let c=0;c<3;c++){
      const color=Math.fround(rgba[i+c]/255);
      rgb[out+c]=Math.trunc(Math.fround(Math.fround(color*alpha)*255));
    }
  }
  const croppedRgbSha256=await sha(rgb);stop(signal);
  const prepared=resize(rgb,cropWidth,cropHeight,512,512,3);stop(signal);
  return {pixels:prepared,width:512,height:512,provenance:{
    schema:'trellis2.browser-alpha-preparation.v0',route:'decoded-alpha/source-crop-F32-premultiply/Pillow-law-Lanczos512/JS',
    sourceCommit:'1201553c339008eb5e10ab6131acc11ab7cd0158',backgroundRemoval:'caller alpha; no segmentation',
    input:{format:'decoded RGBA8',size:originalSize},alphaThreshold:204,foregroundPixels,
    foregroundBbox:[xmin,ymin,xmax,ymax],scaledSize:[width,height],crop:{
      center_xy:[centerX,centerY],source_extent:extent,bbox_xyxy:box},
    integerCropBox:integerBox,croppedSize:[cropWidth,cropHeight],croppedRgbSha256,
    resampling:'Pillow12.3 U8 Lanczos coefficient and two-pass rounding law; no Canvas resize',
    output:{format:'RGB8',size:[512,512],sha256:await sha(prepared)}}};
}

/** Prepare a selected alpha image, without Canvas color/alpha conversion.
 * Blob/File carries its MIME type. Byte callers may supply `type`; PNG is
 * recognized by its signature. Other formats depend on the actual decoder's
 * native RGBA/BGRA support and are not covered by the PNG parity witness.
 * ImageDecoderClass is an explicit injectable codec for local contract tests.
 */
export async function prepareTrellisAlphaImage(imageBytes,{signal,type,ImageDecoderClass=globalThis.ImageDecoder}={}){
  stop(signal);
  let bytes;
  if(imageBytes instanceof Blob){
    type ||= imageBytes.type;
    bytes=new Uint8Array(await imageBytes.arrayBuffer());
  }else if(imageBytes instanceof ArrayBuffer){
    bytes=new Uint8Array(imageBytes.slice(0));
  }else if(imageBytes instanceof Uint8Array||imageBytes instanceof Uint8ClampedArray){
    bytes=new Uint8Array(imageBytes);
  }else throw TypeError('encoded image Blob, ArrayBuffer or U8 bytes required');
  stop(signal);
  if(!bytes.length)throw Error('encoded image is empty');
  const png=[137,80,78,71,13,10,26,10];
  if(!type&&png.every((v,i)=>bytes[i]===v))type='image/png';
  if(!type)throw Error('image MIME type is required for this encoded input');
  if(typeof ImageDecoderClass!=='function')throw Error('ImageDecoder is unavailable; no Canvas pixel fallback');
  const encodedSha256=await sha(bytes);stop(signal);
  let decoder,frame,closed=false;
  const close=()=>{if(decoder&&!closed){closed=true;decoder.close();}};
  try{
    decoder=new ImageDecoderClass({type,data:bytes,colorSpaceConversion:'none',preferAnimation:false});
    signal?.addEventListener('abort',close,{once:true});stop(signal);
    const decoded=await decoder.decode({frameIndex:0,completeFramesOnly:true});frame=decoded.image;stop(signal);
    if(!decoded.complete)throw Error('incomplete decoded image is not conditioning');
    if(!frame||!['RGBA','BGRA'].includes(frame.format))throw Error('native alpha pixel format is unsupported: '+frame?.format);
    const width=frame.codedWidth,height=frame.codedHeight;dimensions(width,height);
    const rgba=new Uint8Array(width*height*4),layout=[{offset:0,stride:width*4}];
    // Explicit format:'RGBA' can introduce alpha-dependent color rounding.
    // Copy native bytes and change only channel order, never pixel values.
    const actualLayout=await frame.copyTo(rgba,{layout});stop(signal);
    if(actualLayout.length!==1||actualLayout[0].offset!==0||actualLayout[0].stride!==width*4)
      throw Error('native alpha pixel layout differs from the requested packed plane');
    if(frame.format==='BGRA')for(let i=0;i<rgba.length;i+=4){const b=rgba[i];rgba[i]=rgba[i+2];rgba[i+2]=b;}
    const nativeFormat=frame.format,orientation={rotation:frame.rotation??0,flip:frame.flip??false};
    const decodedRgbaSha256=await sha(rgba);stop(signal);
    frame.close();frame=null;close();
    const prepared=await prepareTrellisAlphaRgba({pixels:rgba,width,height,signal});stop(signal);
    return {...prepared,provenance:{...prepared.provenance,
      encodedImage:{type,byteLength:bytes.length,sha256:encodedSha256},
      decoder:{route:ImageDecoderClass===globalThis.ImageDecoder?'browser ImageDecoder':'explicit injected ImageDecoderClass',
        nativeFormat,copyLayout:actualLayout,colorSpaceConversion:'none',frameIndex:0,complete:true,
        orientation,orientationApplied:false,decodedRgbaSha256}}};
  }catch(error){stop(signal);throw error;}
  finally{signal?.removeEventListener('abort',close);frame?.close();close();}
}
