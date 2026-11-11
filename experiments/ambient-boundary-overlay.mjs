import {BufferGeometry,Float32BufferAttribute,LineBasicMaterial,LineSegments} from '../lib/three.core.js';
import {ambientBoundaryEnvelope} from '../volume-ambient-boundary.mjs';
// Presentation only: no registered scene object, collision, shadow or depth write.
export async function createAmbientBoundaryOverlay(session){
 const geometry=new BufferGeometry(),material=new LineBasicMaterial({color:0x63e2d0,transparent:true,opacity:.8,depthWrite:false,depthTest:false,toneMapped:false});
 const root=new LineSegments(geometry,material);root.name='Ambient contact envelope';root.renderOrder=10000;root.frustumCulled=false;root.raycast=()=>{};root.visible=false;
 let handle;try{handle=await session.attach(root,{owned:true,presentation:true});}catch(error){geometry.dispose();material.dispose();throw error;}let signature='';
 return {root,handle,sync(boundary,shown){root.visible=!!shown&&!!boundary?.effective.applied;if(!root.visible)return;const next=JSON.stringify([boundary.domain,boundary.effective.widthLocal]);if(next===signature)return;signature=next;const positions=ambientBoundaryEnvelope(boundary),existing=geometry.getAttribute('position');if(existing&&existing.array.length===positions.length){existing.array.set(positions);existing.needsUpdate=true;}else geometry.setAttribute('position',new Float32BufferAttribute(positions,3));root.position.fromArray(boundary.domain.translate);root.scale.setScalar(boundary.domain.scale);root.updateMatrixWorld(true);}};
}
