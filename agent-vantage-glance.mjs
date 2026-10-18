// A glance: the sub's view drawn with its own camera into its own targets, so
// the operator's view is never borrowed. The scene renderer draws the meshes,
// lights and background into a half-float target; the page's own output stage
// (tone mapping and colour space) then writes an 8-bit picture, which is read
// back. Layers the page draws from its main camera only (the fire volume, water
// from the local water host, ambient occlusion and global illumination) are not
// in it; `snap` remains the picture with every layer. Where the page keeps a
// proxy of the fire or the water (heat-block splats, surfels) on its own layer,
// a glance draws that proxy instead, and says so (describeProxies).
import {cameraFromOptics} from './agent-vantage-ids.mjs';

export const GLANCE_OMITS = Object.freeze(['the fire and smoke volume', 'water drawn by the local water host', 'ambient occlusion and global illumination']);
const PROXY_SOURCES = Object.freeze({
  fire: {omitted: GLANCE_OMITS[0], drawn: 'fire and smoke (proxy: heat-block splats)'},
  water: {omitted: GLANCE_OMITS[1], drawn: 'water (proxy: surfels)'},
});

// What a glance drew and left out, from each proxy source's status at the draw
// ('drawn', 'awaiting-snapshot', 'hidden', 'absent'). For a strip, `frames`
// lists every frame's statuses: a source drawn in only some frames is left out
// with a count. A source hidden or absent from the scene is not something the
// glance left out. Without proxy statuses, what a glance always left out.
export function describeProxies(proxies, frames = proxies ? [proxies] : null) {
  if (!frames?.length) return {layers: ['scene'], omitted: [...GLANCE_OMITS]};
  const layers = ['scene'], omitted = [];
  for (const [source, words] of Object.entries(PROXY_SOURCES)) {
    const statuses = frames.map(item => item?.[source] ?? 'absent'), drawn = statuses.filter(status => status === 'drawn').length;
    if (drawn === statuses.length) layers.push(words.drawn);
    else if (drawn > 0) omitted.push(`${words.omitted} (drawn as its proxy in ${drawn} of ${statuses.length} frames)`);
    else if (statuses.includes('awaiting-snapshot')) omitted.push(`${words.omitted} (its proxy had no snapshot yet)`);
  }
  omitted.push(GLANCE_OMITS[2]);
  return {layers, omitted};
}

export function createGlance({THREE, TSL, renderer, scene, hideEditorObjects = () => () => {}, cameraLayers = () => null}) {
  let output = null;
  const outputStage = () => output ??= (() => {
    const source = TSL.texture(new THREE.Texture()), finish = TSL.renderOutput(source);
    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = finish;
    return {source, finish, material, quad: new THREE.QuadMesh(material)};
  })();
  // Drawing into a target, the output stage would take its tone mapping and
  // colour space from the target, which has neither, so it is given the
  // page's own, as they stand at each glance.
  const matchPage = stage => {
    if (stage.finish.getToneMapping() !== renderer.toneMapping || stage.finish.outputColorSpace !== renderer.outputColorSpace) {
      stage.finish.setToneMapping(renderer.toneMapping);
      stage.finish.outputColorSpace = renderer.outputColorSpace;
      stage.material.needsUpdate = true;
    }
  };

  // Draw the view from `optics` at width×height, with editor drawing and the
  // `hide` entries left out, and the three.js `layers` (proxy layers) seen as
  // well. The drawing happens in this call; `ready` resolves to the picture's
  // RGBA bytes, rows from the top.
  function draw({optics, width, height, hide = [], layers = []}) {
    const camera = cameraFromOptics({THREE, renderer, optics, layers: cameraLayers()});
    for (const layer of layers) camera.layers.enable(layer);
    const hdr = new THREE.RenderTarget(width, height, {type: THREE.HalfFloatType, depthBuffer: true});
    const picture = new THREE.RenderTarget(width, height, {type: THREE.UnsignedByteType, colorSpace: THREE.NoColorSpace, depthBuffer: false});
    const stage = outputStage(), {source, quad} = stage;
    matchPage(stage);
    const saved = {target: renderer.getRenderTarget(), mrt: renderer.getMRT(), autoClear: renderer.autoClear};
    // The fire billboard is aimed at the operator's camera, so a glance leaves it out with editor drawing.
    const restoreScene = hideEditorObjects({hide, bridges: true});
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
