const linear = Array.from({length:256},(_,i)=>{const s=i/255;return s<=.04045?s/12.92:((s+.055)/1.055)**2.4;});

function validateMap(map) {
  if (!Number.isInteger(map?.width) || !Number.isInteger(map?.height) || map.width<1 || map.height<1 ||
      !(map.data instanceof Uint8Array || map.data instanceof Uint8ClampedArray) || map.data.length!==map.width*map.height*4) {
    throw new Error('Invalid emission input dimensions');
  }
}

// Port of splat_bake's RGB hue-divergence gate (0.02..0.15).
// Keep that gate in source RGB space; emit the positive residual in linear light.
export function inferEmission(image,albedo) {
  validateMap(image); validateMap(albedo);
  const data=new Float32Array(image.data.length), color=[0,0,0];
  for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++) {
    const u=Math.max(0,Math.min(albedo.width-1,(x+.5)*albedo.width/image.width-.5));
    const v=Math.max(0,Math.min(albedo.height-1,(y+.5)*albedo.height/image.height-.5));
    const x0=Math.floor(u),y0=Math.floor(v),x1=Math.min(x0+1,albedo.width-1),y1=Math.min(y0+1,albedo.height-1),tx=u-x0,ty=v-y0;
    const index=(y*image.width+x)*4;
    let dot=0,deltaSq=0,albedoSq=0;
    for(let c=0;c<3;c++) {
      color[c]=(1-ty)*((1-tx)*albedo.data[(y0*albedo.width+x0)*4+c]+tx*albedo.data[(y0*albedo.width+x1)*4+c])+
        ty*((1-tx)*albedo.data[(y1*albedo.width+x0)*4+c]+tx*albedo.data[(y1*albedo.width+x1)*4+c]);
      const base=color[c]/255,delta=Math.max(0,(image.data[index+c]-color[c])/255);
      dot+=delta*base;deltaSq+=delta*delta;albedoSq+=base*base;
    }
    const similarity=dot/Math.max(Math.sqrt(deltaSq*albedoSq),1e-8);
    const t=Math.max(0,Math.min(1,((1-similarity)-.02)/.13)), weight=t*t*(3-2*t);
    for(let c=0;c<3;c++) {
      const s=color[c]/255,base=s<=.04045?s/12.92:((s+.055)/1.055)**2.4;
      data[index+c]=Math.max(0,linear[image.data[index+c]]-base)*weight;
    }
    data[index+3]=1;
  }
  return {width:image.width,height:image.height,data,method:'rgb-hue-divergence-residual-v1'};
}

export function emissionTexturePixels(map) {
  if(!Number.isInteger(map?.width)||!Number.isInteger(map?.height)||map.width<1||map.height<1||
      !(map.data instanceof Float32Array)||map.data.length!==map.width*map.height*4) throw new Error('Invalid emission map dimensions');
  const data=new Float32Array(map.data.length),stride=map.width*4;
  for(let i=0;i<map.data.length;i++)if(!Number.isFinite(map.data[i]))throw new Error('Emission map must be finite');
  for(let y=0;y<map.height;y++)data.set(map.data.subarray(y*stride,(y+1)*stride),(map.height-1-y)*stride);
  return {data,width:map.width,height:map.height};
}
