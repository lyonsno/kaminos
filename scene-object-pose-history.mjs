// Domain-owned history coordinates for actual scene roots. Visible transforms
// remain the editor's; this registry creates neither a clock nor another ledger.
const owners=new WeakMap();
export function sceneObjectPoseHistory(root){return root?owners.get(root)??null:null;}
export function registerSceneObjectPoseHistory(root,adapter){
 if(!root?.isObject3D||typeof adapter?.capture!=='function'||typeof adapter?.restore!=='function'||owners.has(root))throw Error('Object pose history requires one actual root and capture/restore owner');
 owners.set(root,adapter);return ()=>{if(owners.get(root)===adapter)owners.delete(root);};
}
