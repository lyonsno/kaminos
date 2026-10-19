// The pick map's ID pass: the scene drawn once more from a view, with every
// material's own shader, so the renderer itself decides what covers each pixel
// (face side, alpha test and cut-outs, discards, vertex deformation, morphs,
// depth and colour-write state, clipping). Only what a fragment writes changes,
// through render-target outputs: the drawing object's number in red and green
// and its instance in blue and alpha, and in a second target the fragment's
// view depth. A blended fragment that adds nothing (alpha below 1/255) is
// discarded, so what shows through it is what is named.
//
// Object numbers last for the page's life. three skips per-object uniform
// updates for objects that have not changed, so a number once written for an
// object must stay that object's number.
import {UNIDENTIFIED, idsFromReadback, depthsFromReadback} from './agent-vantage-core.mjs';

// A camera with exactly the given matrices, which must already be in the
// renderer's clip convention and depth direction, so the renderer draws
// through them unchanged. Shaders read near and far from the camera itself.
export function cameraFromOptics({THREE, renderer, optics, layers = null}) {
  if ((optics.coordinateSystem ?? THREE.WebGLCoordinateSystem) !== renderer.coordinateSystem) {
    throw new Error('The optics are not in the renderer\'s clip convention');
  }
  if (!!optics.reversedDepth !== !!renderer.reversedDepthBuffer) throw new Error('The optics do not match the renderer\'s depth direction');
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
  if (Number.isFinite(optics.far)) camera.far = optics.far;
  if (Number.isInteger(layers)) camera.layers.mask = layers;
  return camera;
}

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

  let outputs = null, idWrite = null, idDistance = null;
  const idOutputs = () => outputs ??= (() => {
    const {mrt, uniform, vec4, instanceIndex, vertexStage, If, Discard, output, Fn, floor, mod, round, positionView} = TSL;
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
    idWrite = write;
    idDistance = vec4(positionView.z.negate(), 0, 0, 1);
    // Outputs other than `output` are not blended.
    return mrt({output: write, distance: idDistance}).setBlendMode('output', new THREE.BlendMode(THREE.NoBlending));
  })();
  // A material's own outputs (`mrtNode`) take precedence over the ID outputs
  // when three merges them, and may hold coverage decisions, such as a
  // discard. For the ID draw the material gets outputs that still run its own
  // `output`, which the scene pass writes, and then write the ID and depth.
  const wrapped = new WeakMap();
  const idOutputsAround = own => {
    if (!wrapped.has(own)) {
      const {mrt, Fn} = TSL, theirs = own.outputNodes?.output;
      const write = theirs ? Fn(() => { theirs.toVar(); return idWrite; })() : idWrite;
      wrapped.set(own, mrt({output: write, distance: idDistance}).setBlendMode('output', new THREE.BlendMode(THREE.NoBlending)));
    }
    return wrapped.get(own);
  };

  // A material with its own fragment shader writes past the render-target
  // outputs, so it is drawn with a plain stand-in that keeps its face side,
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

  const cameraFor = optics => cameraFromOptics({THREE, renderer, optics, layers: cameraLayers()});

  // Draw the scene from `optics` into a width×height map, with editor drawing
  // and the `hide` entries left out, and start reading `region` back, with its
  // depth when `depth` is set. Everything up to the GPU submission happens in
  // this call, so the map shows the scene as it is at this call. `drawn` lists
  // every object drawn, with its number, and marks those drawn with a stand-in.
  // `withoutLayers` leaves layers out of this map (a sub's map draws no proxy,
  // which is drawn outside it; an operator pick keeps the operator's view).
  function draw({optics, width, height, hide = [], region = [0, 0, width, height], depth = false, bridges = false, withoutLayers = []}) {
    const camera = cameraFor(optics);
    for (const layer of withoutLayers) camera.layers.disable(layer);
    const target = new THREE.RenderTarget(width, height, {count: 2, type: THREE.UnsignedByteType, format: THREE.RGBAFormat, colorSpace: THREE.NoColorSpace,
      depthBuffer: true, generateMipmaps: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter});
    target.textures[0].name = 'output';
    Object.assign(target.textures[1], {name: 'distance', type: THREE.FloatType, format: THREE.RedFormat});
    const drawn = new Map();
    const saved = {target: renderer.getRenderTarget(), mrt: renderer.getMRT(), clearColor: renderer.getClearColor(new THREE.Color()),
      clearAlpha: renderer.getClearAlpha(), autoClear: renderer.autoClear, objectFunction: renderer.getRenderObjectFunction(),
      background: scene.background, backgroundNode: scene.backgroundNode};
    const restoreScene = hideEditorObjects({hide, bridges});
    let ready;
    try {
      scene.background = null;
      scene.backgroundNode = null;
      renderer.setClearColor(0x000000, 0);
      renderer.autoClear = true;
      renderer.setMRT(idOutputs());
      renderer.setRenderTarget(target);
      renderer.setRenderObjectFunction((object, drawScene, drawCamera, geometry, material, group, lightsNode, clippingContext, passId) => {
        const custom = !!material?.fragmentNode, seen = drawn.get(object), ownOutputs = material?.mrtNode ?? null;
        drawn.set(object, {n: numberOf(object), object, ...(custom || seen?.custom ? {custom: true} : {})});
        if (ownOutputs) material.mrtNode = idOutputsAround(ownOutputs);
        try { renderer.renderObject(object, drawScene, drawCamera, geometry, custom ? standIn(material) : material, group, lightsNode, clippingContext, passId); }
        finally { if (ownOutputs) material.mrtNode = ownOutputs; }
      });
      renderer.render(scene, camera);
      const [x, y, w, h] = region;
      const ids = renderer.readRenderTargetPixelsAsync(target, x, y, w, h, 0).then(bytes => idsFromReadback(bytes, w, h));
      const depths = depth ? renderer.readRenderTargetPixelsAsync(target, x, y, w, h, 1).then(floats => depthsFromReadback(floats, w, h)) : null;
      ready = Promise.all([ids, depths]).then(([numbers, values]) => (values ? {...numbers, depths: values} : numbers));
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
