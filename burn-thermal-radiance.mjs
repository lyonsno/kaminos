import * as THREE from './lib/three.webgpu.js';
import {THERMAL_LUT,THERMAL_LUT_MIN,THERMAL_LUT_MAX,THERMAL_LUT_STEP,THERMAL_LUT_COUNT} from './volume-physical-color.mjs';
import {PHYSICS_COLD_KELVIN,PHYSICS_APPEARANCE_DEFAULTS,PHYSICS_APPEARANCE_RANGES} from './volume-physics-appearance.mjs';

export const SURFACE_THERMAL_IDENTITY='resident-temperature-planck-lut-v1';
export const SURFACE_KELVIN_PER_HEAT=PHYSICS_APPEARANCE_DEFAULTS.kelvinPerHeat;
export function checkedSurfaceKelvin(value){
 const [min,max]=PHYSICS_APPEARANCE_RANGES.kelvinPerHeat;
 if(!Number.isFinite(value)||value<min||value>max)throw Error(`Kelvin per heat must be between ${min} and ${max}`);
 return value;
}
// Reference for the existing volume LUT, including its relative radiant power.
// Kelvin is an explicit renderer calibration of the dimensionless material heat.
export function surfaceThermalRadiance(heat,kelvinPerHeat=SURFACE_KELVIN_PER_HEAT){
 checkedSurfaceKelvin(kelvinPerHeat);if(!Number.isFinite(heat)||heat<0)throw Error('Invalid resident heat');
 if(heat===0)return [0,0,0];
 const kelvin=Math.max(THERMAL_LUT_MIN,Math.min(THERMAL_LUT_MAX,PHYSICS_COLD_KELVIN+heat*kelvinPerHeat));
 const p=(kelvin-THERMAL_LUT_MIN)/THERMAL_LUT_STEP,lo=Math.min(THERMAL_LUT_COUNT-2,Math.floor(p)),w=p-lo;
 const value=Array.from({length:4},(_,i)=>THERMAL_LUT[lo*4+i]*(1-w)+THERMAL_LUT[(lo+1)*4+i]*w);
 return value.slice(0,3).map(v=>v*value[3]);
}
export function createSurfaceThermalRadiance(heat,kelvinPerHeat){
 const {texture,vec2,vec3,float}=THREE.TSL;
 const data=Uint16Array.from(THERMAL_LUT,value=>THREE.DataUtils.toHalfFloat(value));
 const map=new THREE.DataTexture(data,THERMAL_LUT_COUNT,1,THREE.RGBAFormat,THREE.HalfFloatType);
 map.name='Shared Planck chromaticity and power';map.colorSpace=THREE.NoColorSpace;
 map.minFilter=map.magFilter=THREE.LinearFilter;map.generateMipmaps=false;map.needsUpdate=true;
 const kelvin=heat.max(0).mul(kelvinPerHeat).add(PHYSICS_COLD_KELVIN).clamp(THERMAL_LUT_MIN,THERMAL_LUT_MAX);
 const coordinate=kelvin.sub(THERMAL_LUT_MIN).div(THERMAL_LUT_STEP).add(.5).div(THERMAL_LUT_COUNT);
 const sample=texture(map,vec2(coordinate,float(.5))).toVar('surfacePlanckRadiance');
 return {node:heat.greaterThan(0).select(sample.rgb.mul(sample.a),vec3(0)),dispose:()=>map.dispose()};
}
