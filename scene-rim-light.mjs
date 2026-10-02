import {Vector3,Quaternion,Euler} from './lib/three.core.js';
import {checkedPose} from './scene-edit-session.mjs';
const rad=degrees=>degrees*Math.PI/180;
const deg=radians=>radians*180/Math.PI;
export const RIM_LIGHT_ID='@rim-light';
export function rimRecipePose(recipe) {
 const az=rad(recipe.azimuth),el=rad(recipe.elevation);
 const offset=new Vector3(Math.cos(el)*Math.sin(az),Math.sin(el),Math.cos(el)*Math.cos(az));
 const position=new Vector3(...recipe.target).addScaledVector(offset,recipe.distance);
 const rotation=new Euler().setFromQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0,0,-1),offset.negate()));
 return {position:position.toArray(),rotation:[rotation.x,rotation.y,rotation.z],scale:[1,1,1]};
}
export function rimRecipeFromPose(recipe,value) {
 const pose=checkedPose(value);
 if(pose.scale.some(v=>Math.abs(v-1)>1e-6))throw Error('Use Cone Angle to change this light’s spread; move or rotate to place it');
 const offset=new Vector3(0,0,1).applyEuler(new Euler(...pose.rotation));
 return {...recipe,target:new Vector3(...pose.position).addScaledVector(offset,-recipe.distance).toArray(),
  azimuth:deg(Math.atan2(offset.x,offset.z)),elevation:deg(Math.asin(Math.max(-1,Math.min(1,offset.y))))};
}

export function checkedRimRecipe(settings) {
 if (typeof settings?.enabled !== 'boolean' || !/^#[\da-f]{6}$/i.test(settings.color)
   || !Array.isArray(settings.target) || settings.target.length !== 3 || !settings.target.every(Number.isFinite)) throw new Error('Invalid rim light');
 for (const key of ['intensity','azimuth','elevation','distance','angle','penumbra']) if (!Number.isFinite(settings[key])) throw new Error(`Invalid rim ${key}`);
 if (settings.intensity < 0 || settings.distance < 0.1 || Math.abs(settings.elevation) > 90
   || settings.angle < 1 || settings.angle > 89 || settings.penumbra < 0 || settings.penumbra > 1) throw new Error('Invalid rim light range');
 return structuredClone(settings);
}
