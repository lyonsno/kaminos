// Pillow 12.3 Image.resize(..., LANCZOS) for 8-bit images without alpha
// (src/libImaging/Resample.c, MIT-CMU): Lanczos-3 coefficients, 22-bit fixed
// point, horizontal then vertical pass, round-half-up then clip. Callers with
// alpha must premultiply first, as Pillow does for RGBA/LA.
const PRECISION_BITS=32-8-2,ONE=1<<PRECISION_BITS,HALF=1<<(PRECISION_BITS-1),SUPPORT=3;

const sinc=x=>{if(x===0)return 1;x*=Math.PI;return Math.sin(x)/x;};
const lanczos=x=>(-3<=x&&x<3)?sinc(x)*sinc(x/3):0;

function coefficients(inSize,outSize){
  const scale=inSize/outSize,filterscale=Math.max(scale,1),support=SUPPORT*filterscale,ksize=Math.ceil(support)*2+1;
  const bounds=new Int32Array(outSize*2),weights=new Int32Array(outSize*ksize),k=new Float64Array(ksize);
  for(let xx=0;xx<outSize;xx++){
    const center=(xx+0.5)*scale,ss=1/filterscale;
    let xmin=Math.trunc(center-support+0.5);if(xmin<0)xmin=0;
    let xmax=Math.trunc(center+support+0.5);if(xmax>inSize)xmax=inSize;xmax-=xmin;
    let ww=0;
    for(let x=0;x<xmax;x++){const w=lanczos((x+xmin-center+0.5)*ss);k[x]=w;ww+=w;}
    for(let x=0;x<ksize;x++){
      const v=x<xmax?(ww!==0?k[x]/ww:k[x]):0;
      weights[xx*ksize+x]=v<0?Math.trunc(-0.5+v*ONE):Math.trunc(0.5+v*ONE);
    }
    bounds[xx*2]=xmin;bounds[xx*2+1]=xmax;
  }
  return {ksize,bounds,weights};
}
const clip8=v=>{v>>=PRECISION_BITS;return v<0?0:v>255?255:v;};

// pixels: interleaved U8 rows, `channels` per pixel.
export function resizePillowLanczosU8(pixels,width,height,outWidth,outHeight,channels){
  if(![1,3,4].includes(channels))throw RangeError('1, 3 or 4 channels');
  if(pixels.length!==width*height*channels)throw RangeError('complete pixel rows required');
  let src=pixels,w=width,h=height;
  if(outWidth!==width){
    const {ksize,bounds,weights}=coefficients(width,outWidth),dst=new Uint8Array(outWidth*h*channels);
    for(let y=0;y<h;y++)for(let x=0;x<outWidth;x++){
      const xmin=bounds[x*2],n=bounds[x*2+1],k=x*ksize;
      for(let c=0;c<channels;c++){
        let ss=HALF;for(let i=0;i<n;i++)ss+=src[(y*w+xmin+i)*channels+c]*weights[k+i];
        dst[(y*outWidth+x)*channels+c]=clip8(ss);
      }
    }
    src=dst;w=outWidth;
  }
  if(outHeight!==height){
    const {ksize,bounds,weights}=coefficients(height,outHeight),dst=new Uint8Array(w*outHeight*channels);
    for(let y=0;y<outHeight;y++){
      const ymin=bounds[y*2],n=bounds[y*2+1],k=y*ksize;
      for(let x=0;x<w;x++)for(let c=0;c<channels;c++){
        let ss=HALF;for(let i=0;i<n;i++)ss+=src[((ymin+i)*w+x)*channels+c]*weights[k+i];
        dst[(y*w+x)*channels+c]=clip8(ss);
      }
    }
    src=dst;h=outHeight;
  }
  return src===pixels?pixels.slice():src;
}
