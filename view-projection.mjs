// Orthographic views on the shared perspective camera, as Blender's. Every pass holds the one
// camera object, so it is not replaced: while orthographic, its projection is an orthographic
// one sized so the plane through the orbit pivot keeps its size on screen, and it reports itself
// as orthographic so raycasting and depth decoding branch correctly. Zoom follows the distance
// to the pivot. An orthographic mode entered from an axis view ends when the view direction
// turns (Blender's Auto Perspective); one chosen explicitly (Numpad 5) stays until toggled.
import {Vector3} from './lib/three.core.js';

export function createViewProjection({camera,target}) {
  const perspective=camera.updateProjectionMatrix.bind(camera),forward=new Vector3(),now=new Vector3();
  let orthographic=false,auto=false;

  function orthographicProjection(){
    const distance=Math.max(camera.position.distanceTo(target()),camera.near),zoom=camera.zoom||1;
    const halfHeight=distance*Math.tan(camera.fov*Math.PI/360)/zoom,halfWidth=halfHeight*camera.aspect;
    // In the camera's own coordinate system: WebGPU's clip depth runs 0 to 1, WebGL's -1 to 1.
    camera.projectionMatrix.makeOrthographic(-halfWidth,halfWidth,halfHeight,-halfHeight,camera.near,camera.far,camera.coordinateSystem,camera.reversedDepth);
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    // The frustum as an OrthographicCamera states it, for helpers that size themselves from it.
    camera.left=-halfWidth*zoom;camera.right=halfWidth*zoom;camera.top=halfHeight*zoom;camera.bottom=-halfHeight*zoom;
  }
  // Callers that resize or change the lens keep calling updateProjectionMatrix; it now
  // produces whichever projection the view is in.
  camera.updateProjectionMatrix=()=>{if(orthographic)orthographicProjection();else perspective();};

  function setOrthographic(on,{auto:fromAxis=false}={}){
    orthographic=!!on;auto=orthographic&&fromAxis;
    camera.isOrthographicCamera=orthographic;camera.isPerspectiveCamera=!orthographic;
    camera.updateMatrixWorld(true);camera.getWorldDirection(forward);
    camera.updateProjectionMatrix();
    return state();
  }
  // Once per frame or after navigation: resize the orthographic view to the current pivot
  // distance, and leave an axis view's orthographic mode once the view has turned.
  function update(){
    if(!orthographic)return state();
    camera.getWorldDirection(now);
    if(auto&&now.angleTo(forward)>1e-4)return setOrthographic(false);
    orthographicProjection();
    return state();
  }
  const state=()=>({orthographic,auto});
  return {state,setOrthographic,update,toggle:()=>setOrthographic(!orthographic)};
}
