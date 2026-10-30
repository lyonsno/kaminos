export function configureMaterialSideAODepth(aoPass, { scene, camera, depthRT, depthMaterial }, RendererUtils) {
  // The bundled compute node's scene override loses the source material's side.
  // Own only that depth draw; leave compute, resize, and normal handling intact.
  aoPass.setDepthPass(null, null, null);
  const updateBefore = aoPass.updateBefore;
  aoPass.updateBefore = function(frame) {
    const { renderer } = frame;
    const state = RendererUtils.resetRendererAndSceneState(renderer, scene);
    try {
      scene.overrideMaterial = depthMaterial;
      renderer.setRenderTarget(depthRT);
      renderer.setRenderObjectFunction((...args) => {
        // Proxy previews are viewport presentation, not scene occlusion.
        if (args[0]?.userData?.kaminosProxyPreview) return;
        const previousSide = depthMaterial.side;
        const previousOverride = scene.overrideMaterial;
        depthMaterial.side = args[4].side;
        scene.overrideMaterial = args[0]?.userData?.kaminosAODepthMaterial || depthMaterial;
        try {
          renderer.renderObject(...args);
        } finally {
          depthMaterial.side = previousSide;
          scene.overrideMaterial = previousOverride;
        }
      });
      renderer.render(scene, camera);
    } finally {
      RendererUtils.restoreRendererAndSceneState(renderer, scene, state);
    }
    return updateBefore.call(this, frame);
  };
}
