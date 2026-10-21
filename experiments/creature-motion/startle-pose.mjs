// A brief chest recoil over the retained pose. Branches other than the neck
// keep their world transforms, so the reaction cannot drag the planted feet.
// The playback owner restores the source pose before every application.
export function applyStartlePose({THREE,bones,point,strength}){
 if(!(strength>0))return;
 const chest=bones.get('spine-chest'),neck=bones.get('neck');
 const at=new THREE.Vector3().setFromMatrixPosition(chest.matrixWorld);
 const away=at.clone().sub(new THREE.Vector3(...point));away.y=0;
 if(away.lengthSq()<1e-12)return;
 // Work in the chest parent's frame: placement rotation and scale therefore
 // travel with the actor, rather than becoming a world-axis pose instruction.
 const parentInverse=chest.parent.matrixWorld.clone().invert();
 const direction=away.normalize().transformDirection(parentInverse);
 const up=new THREE.Vector3(0,1,0).transformDirection(parentInverse);
 const axis=new THREE.Vector3().crossVectors(up,direction).normalize();
 const followsNeck=child=>{let n=neck;while(n&&n!==chest){if(n===child)return true;n=n.parent;}return false;};
 const retained=chest.children.filter(b=>b.isBone&&!followsNeck(b)).map(b=>[b,b.matrixWorld.clone()]);
 chest.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(axis,.24*strength));
 chest.updateMatrixWorld(true);
 const inverse=chest.matrixWorld.clone().invert();
 for(const [b,world] of retained)inverse.clone().multiply(world).decompose(b.position,b.quaternion,b.scale);
 chest.updateMatrixWorld(true);
}
