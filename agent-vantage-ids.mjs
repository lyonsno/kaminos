// The pick map's ID pass: the scene drawn once more from a view, with every
// material's own shader, so the renderer itself decides what covers each pixel
// (face side, alpha test and cut-outs, discards, vertex deformation, morphs,
// depth and colour-write state, clipping). Only what a fragment writes changes,
// through a render-target output: the drawing object's number in red and
// green, its instance in blue and alpha. A blended fragment that adds nothing
// (alpha below 1/255) is discarded, so what shows through it is what is named.
//
// Object numbers last for the page's life. three skips per-object uniform
// updates for objects that have not changed, so a number once written for an
// object must stay that object's number.
import {UNIDENTIFIED, idsFromReadback} from './agent-vantage-core.mjs';

export function createIdPass({THREE, TSL, renderer, scene, hideEditorObjects = () => () => {}, cameraLayers = () => null}) {
  const numbers = new WeakMap();
  let next = 1;
  const numberOf = object => {
    let n = numbers.get(object);
    if (n === undefined) {
      if (next >= UNIDENTIFIED) return UNIDENTIFIED;
      n = next++;
      numbers.set(object, n);
    }
    return n;
  };

  let outputs = null;
  const idOutputs = () => outputs ??= (() => {
    const {mrt, uniform, vec4, instanceIndex, vertexStage, If, Discard, output, Fn, floor, mod, round} = TSL;
    const id = uniform(new THREE.Vector2()).onObjectUpdate(({object}, self) => {
      const n = numberOf(object);
      return self.value.set((n & 255) / 255, (n >> 8) / 255);
    });
    const blended = uniform(0).onObjectUpdate(({material}) => (material?.transparent ? 1 : 0));
    const instance = round(vertexStage(instanceIndex.toFloat()));
    const write = Fn(() => {
      If(blended.greaterThan(0.5).and(output.a.lessThan(1 / 255)), () => { Discard(); });
      return vec4(id.x, id.y, mod(instance, 256).div(255), mod(floor(instance.div(256)), 256).div(255));
    })();
    return mrt({output: write}).setBlendMode('output', new THREE.BlendMode(THREE.NoBlending));
  })();

  // A material with its own fragment shader writes past the render-target
  // output, so it is drawn with a plain stand-in that keeps its face side,
  // depth state and vertex shader; its coverage is then approximate.
  const standIns = new WeakMap();
  const standIn = material => {
    let copy = standIns.get(material);
    if (!copy) { copy = new THREE.MeshBasicNodeMaterial(); standIns.set(material, copy); }
    for (const key of ['side', 'depthTest', 'depthWrite', 'colorWrite', 'vertexNode', 'positionNode']) {
      if (copy[key] !== material[key]) { copy[key] = material[key]; copy.needsUpdate = true; }
    }
    return copy;
  };

  // The camera a pick map is drawn with: exactly the given matrices, which
  // must already be in the renderer's clip convention and depth direction.
  const cameraFor = optics => {
    if ((optics.coordinateSystem ?? THREE.WebGLCoordinateSystem) !== renderer.coordinateSystem) {
      throw new Error('The pick map optics are not in the renderer\'s clip convention');
    }
    if (!!optics.reversedDepth !== !!renderer.reversedDepthBuffer) throw new Error('The pick map optics do not match the renderer\'s depth direction');
    const camera = new THREE.PerspectiveCamera();
    camera.matrixAutoUpdate = false;
    camera.matrixWorldAutoUpdate = false;
    camera.matrixWorldInverse.fromArray(optics.viewInverse);
    camera.matrixWorld.copy(camera.matrixWorldInverse).invert();
    camera.matrixWorld.decompose(camera.position, camera.quaternion, camera.scale);
    camera.projectionMatrix.fromArray(optics.projection);
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    camera.coordinateSystem = renderer.coordinateSystem;
    if (renderer.reversedDepthBuffer) camera._reversedDepth = true;
    if (Number.isFinite(optics.near)) camera.near = optics.near;
    const layers = cameraLayers();
    if (Number.isInteger(layers)) camera.layers.mask = layers;
    return camera;
  };

  // Draw the scene from `optics` into a width×height map, with editor drawing
  // and the `hide` entries left out, and start reading `region` back.
  // Everything up to the GPU submission happens in this call, so the map shows
  // the scene as it is at this call. `drawn` lists every object drawn, with its
  // number, and marks those drawn with a stand-in.
  function draw({optics, width, height, hide = [], region = [0, 0, width, height]}) {
    const camera = cameraFor(optics);
    const target = new THREE.RenderTarget(width, height, {type: THREE.UnsignedByteType, format: THREE.RGBAFormat, colorSpace: THREE.NoColorSpace,
      depthBuffer: true, generateMipmaps: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter});
    target.texture.name = 'output';
    const drawn = new Map();
    const saved = {target: renderer.getRenderTarget(), mrt: renderer.getMRT(), clearColor: renderer.getClearColor(new THREE.Color()),
      clearAlpha: renderer.getClearAlpha(), autoClear: renderer.autoClear, objectFunction: renderer.getRenderObjectFunction(),
      background: scene.background, backgroundNode: scene.backgroundNode};
    const restoreScene = hideEditorObjects({hide});
    let ready;
    try {
      scene.background = null;
      scene.backgroundNode = null;
      renderer.setClearColor(0x000000, 0);
      renderer.autoClear = true;
      renderer.setMRT(idOutputs());
      renderer.setRenderTarget(target);
      renderer.setRenderObjectFunction((object, drawScene, drawCamera, geometry, material, group, lightsNode, clippingContext, passId) => {
        const custom = !!material?.fragmentNode, seen = drawn.get(object);
        drawn.set(object, {n: numberOf(object), object, ...(custom || seen?.custom ? {custom: true} : {})});
        renderer.renderObject(object, drawScene, drawCamera, geometry, custom ? standIn(material) : material, group, lightsNode, clippingContext, passId);
      });
      renderer.render(scene, camera);
      const [x, y, w, h] = region;
      ready = renderer.readRenderTargetPixelsAsync(target, x, y, w, h).then(bytes => idsFromReadback(bytes, w, h));
    } catch (error) {
      target.dispose();
      throw error;
    } finally {
      renderer.setRenderObjectFunction(saved.objectFunction);
      renderer.setRenderTarget(saved.target);
      renderer.setMRT(saved.mrt);
      renderer.setClearColor(saved.clearColor, saved.clearAlpha);
      renderer.autoClear = saved.autoClear;
      scene.background = saved.background;
      scene.backgroundNode = saved.backgroundNode;
      restoreScene();
    }
    return {drawn: [...drawn.values()], ready: ready.finally(() => target.dispose())};
  }

  return {draw};
}
