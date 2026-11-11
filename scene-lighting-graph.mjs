// The ordinary AO/GI resource graph, shared by the page and worker owner.
// The caller supplies the existing domain factories and one Three namespace;
// no document, input element, route parser or second renderer lives here.
export function createSceneLightingGraph({THREE,scene,camera,renderer,aoSettings,aoIntensityValue,giOptions={},
  aoCompute,denoise,configureMaterialSideAODepth,createSceneGI}){
  const {pass,mrt,normalView,positionViewDirection,packNormalToRGB,sample,unpackRGBToNormal,
    positionView,vec4,texture,convertToTexture,uniform,mix,float,screenUV,builtinAOContext}=THREE.TSL;
  const renderPipeline = new THREE.RenderPipeline(renderer);

  const prePass = pass(scene, camera);
  prePass.name = 'Pre-Pass';
  prePass.transparent = false;
  // GTAO integrates the visible hemisphere. With inconsistent authored winding,
  // Three's material-side normal can face away even on a visible double-sided
  // surface. Correct this screen-space input, not the asset or material normal.
  const aoNormalView = normalView.dot(positionViewDirection).lessThan(0).select(normalView.negate(), normalView);
  prePass.setMRT(mrt({ output: packNormalToRGB(aoNormalView) }));
  const prePassNormal = sample((uv) => unpackRGBToNormal(prePass.getTextureNode().sample(uv)));
  const prePassDepth = prePass.getTextureNode('depth');
  const normalTexture = prePass.getTexture('output');
  normalTexture.type = THREE.UnsignedByteType;

  const scenePass = pass(scene, camera);

  const aoResScale = 0.5;
  const drawSize = renderer.getDrawingBufferSize(new THREE.Vector2());
  let depthRT = new THREE.RenderTarget(
    Math.round(drawSize.x * aoResScale),
    Math.round(drawSize.y * aoResScale),
    { type: THREE.FloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter }
  );
  const depthMaterial = new THREE.NodeMaterial();
  depthMaterial.name = 'LinearDepthToColor';
  depthMaterial.blending = THREE.NoBlending;
  depthMaterial.colorNode = vec4(positionView.z.negate(), 0, 0, 1);

  const depthTexNode = texture(depthRT.texture);
  const normalTexNode = texture(normalTexture);
  const aoPass = aoCompute(depthTexNode, normalTexNode, camera);
  const acceptedAO=aoSettings;
  for(const [field,key] of [['radius','radius'],['scale','scale'],['thickness','thickness'],['falloff','distanceFallOff']])aoPass[key].value=acceptedAO[field];
  configureMaterialSideAODepth(aoPass, { scene, camera, depthRT, depthMaterial }, THREE.RendererUtils);

  const aoResolved = convertToTexture(aoPass.getTextureNode());
  const denoisePass = denoise(aoResolved, prePassDepth, prePassNormal, camera);
  const denoiseResolved = convertToTexture(denoisePass);
  // Resolve screen-space visibility before the lit pass, not once per material.
  const setupScenePass = scenePass.setup;
  scenePass.setup = function(builder) {
    denoiseResolved.build(builder);
    return setupScenePass.call(this, builder);
  };

  const aoIntensity = uniform(aoIntensityValue);
  // Preserve the existing 0..1 look; stronger AO darkens smoothly without negative light.
  const aoVisibility = texture(denoiseResolved.value, screenUV).r.clamp(0, 1);
  const aoOutput = mix(float(1.0), aoVisibility, aoIntensity.min(1)).div(
    float(1).add(aoIntensity.sub(1).max(0).mul(float(1).sub(aoVisibility))));
  scenePass.contextNode = builtinAOContext(aoOutput);
  const sceneGI = createSceneGI(scene,camera,aoIntensity,{...giOptions,renderer});
  return {renderPipeline,prePass,prePassDepth,prePassNormal,scenePass,aoPass,aoResScale,depthRT,depthMaterial,
    aoIntensity,aoOutput,sceneGI};
}
