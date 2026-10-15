// A glance: the sub's view drawn with its own camera into its own targets, so
// the operator's view is never borrowed. The scene renderer draws the meshes,
// lights and background into a half-float target; the page's own output stage
// (tone mapping and colour space) then writes an 8-bit picture, which is read
// back. Layers the page draws from its main camera only (the fire volume, water
// from the local water host, ambient occlusion and global illumination) are not
// in it; `snap` remains the picture with every layer.
import {cameraFromOptics} from './agent-vantage-ids.mjs';

export const GLANCE_OMITS = Object.freeze(['the fire and smoke volume', 'water drawn by the local water host', 'ambient occlusion and global illumination']);

export function createGlance({THREE, TSL, renderer, scene, hideEditorObjects = () => () => {}, cameraLayers = () => null}) {
  let output = null;
  const outputStage = () => output ??= (() => {
    const source = TSL.texture(new THREE.Texture());
    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = TSL.renderOutput(source);
    return {source, quad: new THREE.QuadMesh(material)};
  })();

  // Draw the view from `optics` at width×height, with editor drawing and the
  // `hide` entries left out. The drawing happens in this call; `ready` resolves
  // to the picture's RGBA bytes, rows from the top.
  function draw({optics, width, height, hide = []}) {
    const camera = cameraFromOptics({THREE, renderer, optics, layers: cameraLayers()});
    const hdr = new THREE.RenderTarget(width, height, {type: THREE.HalfFloatType, depthBuffer: true});
    const picture = new THREE.RenderTarget(width, height, {type: THREE.UnsignedByteType, colorSpace: THREE.NoColorSpace, depthBuffer: false});
    const {source, quad} = outputStage();
    const saved = {target: renderer.getRenderTarget(), mrt: renderer.getMRT(), autoClear: renderer.autoClear};
    const restoreScene = hideEditorObjects({hide});
    let ready;
    try {
      renderer.setMRT(null);
      renderer.autoClear = true;
      renderer.setRenderTarget(hdr);
      renderer.render(scene, camera);
      source.value = hdr.texture;
      renderer.setRenderTarget(picture);
      quad.render(renderer);
      ready = renderer.readRenderTargetPixelsAsync(picture, 0, 0, width, height).then(bytes => {
        const stride = Math.ceil(width * 4 / 256) * 256, pixels = new Uint8ClampedArray(width * height * 4);
        for (let y = 0; y < height; y++) pixels.set(bytes.subarray(y * stride, y * stride + width * 4), y * width * 4);
        for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255;
        return {width, height, pixels};
      });
    } catch (error) {
      hdr.dispose(); picture.dispose();
      throw error;
    } finally {
      renderer.setRenderTarget(saved.target);
      renderer.setMRT(saved.mrt);
      renderer.autoClear = saved.autoClear;
      restoreScene();
    }
    return {ready: ready.finally(() => { hdr.dispose(); picture.dispose(); })};
  }

  return {draw};
}
