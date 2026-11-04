import {Group} from '../../lib/three.core.js';
import {checkedMechanism} from './model.mjs';
export const MECHANISM_SOURCE='kaminos:link-mechanism';
export function mechanismObject(recipe){const root=new Group();root.name='Mechanism';root.userData.linkMechanism=checkedMechanism(recipe);return root;}
const checkedPosition=v=>{if(v!==undefined&&(!Number.isFinite(v)||v<0||v>1))throw Error('Mechanism position must be between zero and one');return v??0;};
export const mechanismRecordDomain={type:'pbr',source:MECHANISM_SOURCE,
 recognize:o=>!!o?.userData?.linkMechanism,
 check:r=>({...r,mechanism:checkedMechanism(r.mechanism),mechanismPosition:checkedPosition(r.mechanismPosition)}),fields:r=>({mechanism:r.mechanism,mechanismPosition:checkedPosition(r.mechanismPosition)}),
 capture:entry=>({type:'pbr',source:MECHANISM_SOURCE,mechanism:checkedMechanism(entry.object.userData.linkMechanism),mechanismPosition:checkedPosition(entry.object.userData.mechanismFraction)}),
 reloadable:r=>{checkedMechanism(r.mechanism);return true;},
 load:(r,l,o)=>{const root=mechanismObject(r.mechanism);root.userData.mechanismFraction=checkedPosition(r.mechanismPosition);return l.constructed(root,r,o);}};
