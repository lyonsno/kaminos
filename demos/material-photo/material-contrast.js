import { resizeRgbaBilinear } from '../../models/supermat/supermat-preprocess.js';

export const DEFAULT_CONTRAST = {mode:'original',roughness:.5,metallic:.5};
export function validateContrast(value) {
  if(!['original','manual','highlight'].includes(value?.mode))throw Error('Invalid material contrast mode');
  for(const key of ['roughness','metallic'])if(!Number.isFinite(value[key])||value[key]<0||value[key]>1)throw Error(`Invalid ${key} contrast strength`);
  return {mode:value.mode,roughness:value.roughness,metallic:value.metallic};
}
function validateMap(map) {
  if(!Number.isInteger(map?.width)||!Number.isInteger(map?.height)||map.width<=0||map.height<=0||
    !(map.data instanceof Uint8Array||map.data instanceof Uint8ClampedArray)||map.data.length!==map.width*map.height*4)throw Error('Contrast requires RGBA8 maps');
}
function distribution(map,channel) {
  const bins=new Uint32Array(256);let count=0;
  for(let i=0;i<map.data.length;i+=4)if(map.data[i+3]){bins[map.data[i+channel]]++;count++;}
  const quantile=fraction=>{
    let sum=0;const target=Math.max(1,Math.ceil(count*fraction));
    for(let value=0;value<256;value++){sum+=bins[value];if(sum>=target)return value;}
    return 0;
  };
  const min=quantile(0),max=quantile(1),low=quantile(.02),high=quantile(.98);
  return {count,min,max,low,high,compression:high>low?1-(high-low)/255:0};
}
const linear=value=>{const c=value/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;};
const clamp=value=>Math.max(0,Math.min(1,value));
export function analyzeMaterialContrast(image,maps) {
  validateMap(image);validateMap(maps.orm);validateMap(maps.albedo);
  const {width,height}=maps.orm;
  const photo=resizeRgbaBilinear(image,width,height).data,albedo=resizeRgbaBilinear(maps.albedo,width,height).data;
  const residual=new Float32Array(width*height),luminance=new Float32Array(width*height);
  for(let i=0;i<residual.length;i++){
    const weights=[.2126,.7152,.0722];let source=0,base=0;
    for(let c=0;c<3;c++){source+=weights[c]*linear(photo[i*4+c]);base+=weights[c]*linear(albedo[i*4+c]);}
    luminance[i]=source;residual[i]=Math.max(0,source-base);
  }
  // Local positive photo-minus-albedo peaks are evidence, not a specular classifier.
  const radius=Math.max(1,Math.round(Math.min(width,height)/128));let squares=0,count=0;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=y*width+x;if(!maps.orm.data[i*4+3])continue;
    let surround=0;
    for(const [dx,dy]of [[-radius,0],[radius,0],[0,-radius],[0,radius]]){
      surround+=residual[Math.max(0,Math.min(height-1,y+dy))*width+Math.max(0,Math.min(width-1,x+dx))];
    }
    const peak=Math.max(0,residual[i]-surround/4);
    const evidence=clamp(4*peak/(luminance[i]+.02));squares+=evidence*evidence;count++;
  }
  return {highlightEvidence:count?clamp(8*Math.sqrt(squares/count)):0,
    roughness:distribution(maps.orm,1),metallic:distribution(maps.orm,2)};
}
export function adjustMaterialMaps(maps,analysis,settings) {
  settings=validateContrast(settings);
  const channels={roughness:1,metallic:2},gains={},tables={};
  for(const [name,channel]of Object.entries(channels)){
    const range=analysis[name];
    const gain=range.high>range.low&&settings.mode!=='original'?settings[name]*(settings.mode==='highlight'?analysis.highlightEvidence*range.compression:1):0;
    gains[name]=gain;
    tables[channel]=Uint8Array.from({length:256},(_,value)=>Math.round(value+(255*clamp((value-range.low)/(range.high-range.low||1))-value)*gain));
  }
  if(!gains.roughness&&!gains.metallic)return {maps,gains};
  const data=maps.orm.data.slice(),roughness=data.slice(),metallic=data.slice();
  for(let i=0;i<data.length;i+=4){
    if(data[i+3]){data[i+1]=tables[1][data[i+1]];data[i+2]=tables[2][data[i+2]];}
    for(let c=0;c<3;c++){roughness[i+c]=data[i+1];metallic[i+c]=data[i+2];}
  }
  const {width,height}=maps.orm;
  return {maps:{...maps,orm:{width,height,data},roughness:{width,height,data:roughness},metallic:{width,height,data:metallic}},gains};
}
