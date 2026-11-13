import {Group,Mesh,BufferGeometry,BufferAttribute,MeshStandardMaterial,Vector3} from './lib/three.core.js';
import {palmFrame,wristBoundary,HAND_VIEW} from './hand-input-geometry.mjs';

// Presentation follows Iron Gland's proper [-X,-Y,+Z] opposite-camera view.
// This is a camera-plane input overlay, not calibrated scene contact.
export function createHandInputView({scene,camera,onFrame,redraw}) {
  const root=new Group();root.name='Hand input overlay';root.visible=false;
  root.userData.handInputOverlay=true;root.userData.kaminosEditorOnly=true;scene.add(root);
  const meshes=new Map();let last=null;
  const updateView=()=>{
    if(!last?.hands?.length){root.visible=false;return;}
    root.visible=true;camera.updateMatrixWorld();root.position.copy(camera.getWorldPosition(new Vector3()));
    root.quaternion.copy(camera.getWorldQuaternion(root.quaternion));
    const distance=Math.max(camera.near*2,1),p=camera.projectionMatrix.elements;
    const width=2*(camera.isPerspectiveCamera?distance:1)/p[0],height=2*(camera.isPerspectiveCamera?distance:1)/p[5];
    for(const side of ['left','right']){
      const mesh=meshes.get(side);if(!mesh)continue;
      const hand=last.hands.find(h=>h.handedness===side);mesh.visible=!!hand;
      if(!hand)continue;
      const box=hand.detection.bbox,[iw,ih]=last.imageSize;
      mesh.position.set((.5-(box[0]+box[2])/2/iw)*width,(.5-(box[1]+box[3])/2/ih)*height,-distance);
      // Fixed display magnification preserves metric differences and finger articulation.
      mesh.scale.setScalar(height/.5);
    }
    redraw();
  };
  const off=onFrame(updateView);
  return {clear(){last=null;root.visible=false;redraw();},
    present(result,faces){
      for(const hand of result.hands){
        const values=hand.verticesMeters;
        if(values?.length!==778*3||!Array.from(values).every(Number.isFinite))throw Error('Invalid tracked hand geometry');
        if(!faces?.length||faces.length%3||!Array.from(faces).every(i=>Number.isInteger(i)&&i>=0&&i<778))throw Error('Invalid tracked hand topology');
        let mesh=meshes.get(hand.handedness);
        if(!mesh){
          const geometry=new BufferGeometry();geometry.setAttribute('position',new BufferAttribute(new Float32Array(778*3),3));
          mesh=new Mesh(geometry,new MeshStandardMaterial({color:0x637a82,metalness:.38,roughness:.45}));
          mesh.frustumCulled=false;mesh.raycast=()=>{};root.add(mesh);meshes.set(hand.handedness,mesh);
        }
        const indices=new Uint16Array(faces);
        if(hand.handedness==='left')for(let i=0;i<indices.length;i+=3)[indices[i+1],indices[i+2]]=[indices[i+2],indices[i+1]];
        mesh.geometry.setIndex(new BufferAttribute(indices,1));
        const palm=palmFrame(values,wristBoundary(faces),hand.handedness);
        if(!palm)throw Error('Tracked hand has no valid palm frame');
        const positions=mesh.geometry.attributes.position.array;
        for(let i=0;i<values.length;i++)positions[i]=values[i]*HAND_VIEW[i%3]-palm.center.getComponent(i%3);
        mesh.geometry.attributes.position.needsUpdate=true;mesh.geometry.computeVertexNormals();
      }
      last=result;updateView();
    },
    read:()=>({visible:root.visible,sides:[...meshes].filter(([,m])=>m.visible&&root.visible).map(([s])=>s),placement:'camera-plane; uncalibrated'}),
    dispose(){off();scene.remove(root);for(const mesh of meshes.values()){mesh.geometry.dispose();mesh.material.dispose();}},
  };
}
