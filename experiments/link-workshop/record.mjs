import {Group} from '../../lib/three.core.js';
import {checkedMechanism} from './model.mjs';
export const MECHANISM_SOURCE='kaminos:link-mechanism';
export function mechanismObject(recipe){const root=new Group();root.name='Mechanism';root.userData.linkMechanism=checkedMechanism(recipe);return root;}
export const mechanismRecordDomain={type:'pbr',source:MECHANISM_SOURCE,
 recognize:o=>!!o?.userData?.linkMechanism,
 check:r=>({...r,mechanism:checkedMechanism(r.mechanism)}),fields:r=>({mechanism:r.mechanism}),
 capture:entry=>({type:'pbr',source:MECHANISM_SOURCE,mechanism:checkedMechanism(entry.object.userData.linkMechanism)}),
 reloadable:r=>{checkedMechanism(r.mechanism);return true;},
 load:(r,l,o)=>l.constructed(mechanismObject(r.mechanism),r,o)};
