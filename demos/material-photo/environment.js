import * as THREE from 'three/webgpu';
import { decodeRadianceHdrRgbe } from '../../finger-fluid-webgpu-core.js';

export const ENVIRONMENTS = {
  studio: {label:'Studio',file:'studio_small_09_1k.hdr'},
  warehouse: {label:'Warehouse',file:'empty_warehouse_01_1k.hdr'},
  sunset: {label:'Sunset',file:'kloofendal_48d_partly_cloudy_puresky_1k.hdr'},
};

export async function loadEnvironmentTexture(name) {
  const entry=ENVIRONMENTS[name];
  if(!entry)throw Error('Unknown HDR environment');
  const url=new URL(`../../assets/hdr/${entry.file}`,import.meta.url);
  const response=await fetch(url);
  if(!response.ok)throw Error(`HDR environment HTTP ${response.status}`);
  const {rgbe,width,height}=decodeRadianceHdrRgbe(await response.arrayBuffer());
  const data=new Uint16Array(width*height*4);
  for(let i=0;i<rgbe.length;i+=4){
    const scale=rgbe[i+3]===0?0:2**(rgbe[i+3]-128)/256;
    for(let c=0;c<3;c++)data[i+c]=THREE.DataUtils.toHalfFloat(rgbe[i+c]*scale);
    data[i+3]=THREE.DataUtils.toHalfFloat(1);
  }
  const texture=new THREE.DataTexture(data,width,height,THREE.RGBAFormat,THREE.HalfFloatType);
  texture.mapping=THREE.EquirectangularReflectionMapping;
  texture.colorSpace=THREE.LinearSRGBColorSpace;
  texture.magFilter=texture.minFilter=THREE.LinearFilter;
  texture.flipY=true;texture.needsUpdate=true;
  texture.userData={environment:name,source:url.href,width,height};
  return texture;
}

export function lightFromRing(u,v) {
  if(![u,v].every(Number.isFinite))throw Error('Invalid light ring position');
  const x=(u-.5)/.35,y=(.5-v)/.35,r=Math.hypot(x,y);
  const scale=r>1?(1-4*Number.EPSILON)/r:1;
  return {x:x*scale,y:y*scale};
}

export function lightOnRing({x,y}) {
  return {u:.5+x*.35,v:.5-y*.35};
}
