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
  const x=u-.5,y=.5-v,r=Math.hypot(x,y);
  const distance=Math.min(1,Math.max(0,(r-.3)/.13));
  const scale=r?distance*(1-4*Number.EPSILON)/r:0;
  return {x:x*scale,y:y*scale};
}

export function lightOnRing({x,y}) {
  const length=Math.hypot(x,y),r=.3+.13*length;
  return {u:.5+(length?x/length:0)*r,v:.5-(length?y/length:1)*r};
}
