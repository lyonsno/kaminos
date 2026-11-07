import {Group} from '../../lib/three.core.js';
import {checkedMechanism} from './model.mjs';
import {checkedBodyGeometry} from './bodies.mjs';
export const MECHANISM_SOURCE='kaminos:link-mechanism';
// Outliner refreshes reuse records. Retain a verdict only for the exact JSON
// input, so nested in-place edits still trigger the full admission check.
const reloadChecks=new WeakMap();
export function mechanismObject(recipe,geometry){
 const root=new Group(),m=checkedMechanism(recipe),g=checkedBodyGeometry(m,geometry);
 root.name='Mechanism';root.userData.linkMechanism=m;if(g)root.userData.linkGeometry=g;return root;
}
export const mechanismRecordDomain={type:'pbr',source:MECHANISM_SOURCE,
 recognize:o=>!!o?.userData?.linkMechanism,
 check:r=>{const mechanism=checkedMechanism(r.mechanism),geometry=checkedBodyGeometry(mechanism,r.geometry);return geometry?{...r,mechanism,geometry}:{...r,mechanism};},
 fields:r=>r.geometry?{mechanism:r.mechanism,geometry:r.geometry}:{mechanism:r.mechanism},
 capture:entry=>{const mechanism=checkedMechanism(entry.object.userData.linkMechanism),geometry=checkedBodyGeometry(mechanism,entry.object.userData.linkGeometry);return geometry?{type:'pbr',source:MECHANISM_SOURCE,mechanism,geometry}:{type:'pbr',source:MECHANISM_SOURCE,mechanism};},
 reloadable:r=>{const key=JSON.stringify([r.mechanism,r.geometry]);if(reloadChecks.get(r)===key)return true;const m=checkedMechanism(r.mechanism);checkedBodyGeometry(m,r.geometry);reloadChecks.set(r,key);return true;},
 load:(r,l,o)=>l.constructed(mechanismObject(r.mechanism,r.geometry),r,o)};
