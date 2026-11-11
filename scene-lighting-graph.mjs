// The ordinary AO/GI resource graph, shared by the page and worker owner.
// The caller supplies the existing domain factories and one Three namespace;
// no document, input element, route parser or second renderer lives here.
export function createSceneLightingGraph({THREE,scene,camera,renderer,aoSettings,aoIntensityValue,giOptions={},
  aoCompute,denoise,configureMaterialSideAODepth,createSceneGI,retain=()=>{}}){
  const keep=value=>{retain(value);return value;};
  const {pass,mrt,normalView,positionViewDirection,packNormalToRGB,sample,unpackRGBToNormal,
    positionView,vec4,texture,convertToTexture,uniform,mix,float,screenUV,builtinAOContext}=THREE.TSL;
  const renderPipeline = keep(new THREE.RenderPipeline(renderer));

  const prePass = keep(pass(scene, camera));
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

  const scenePass = keep(pass(scene, camera));

  const aoResScale = 0.5;
  const drawSize = renderer.getDrawingBufferSize(new THREE.Vector2());
  let depthRT = keep(new THREE.RenderTarget(
    Math.round(drawSize.x * aoResScale),
    Math.round(drawSize.y * aoResScale),
    { type: THREE.FloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter }
  ));
  const depthMaterial = keep(new THREE.NodeMaterial());
  depthMaterial.name = 'LinearDepthToColor';
  depthMaterial.blending = THREE.NoBlending;
  depthMaterial.colorNode = vec4(positionView.z.negate(), 0, 0, 1);

  const depthTexNode = texture(depthRT.texture);
  const normalTexNode = texture(normalTexture);
  const aoPass = keep(aoCompute(depthTexNode, normalTexNode, camera));
  const acceptedAO=aoSettings;
  for(const [field,key] of [['radius','radius'],['scale','scale'],['thickness','thickness'],['falloff','distanceFallOff']])aoPass[key].value=acceptedAO[field];
  configureMaterialSideAODepth(aoPass, { scene, camera, depthRT, depthMaterial }, THREE.RendererUtils);

  const aoResolved = keep(convertToTexture(aoPass.getTextureNode()));
  const denoisePass = keep(denoise(aoResolved, prePassDepth, prePassNormal, camera));
  const denoiseResolved = keep(convertToTexture(denoisePass));
  // Resolve screen-space visibility before the lit pass, not once per material.
  const setupScenePass = scenePass.setup;
  scenePass.setup = function(builder) {
    if(sceneGI.reflections.settings.enabled)sceneGI.reflections.result.build(builder);
    denoiseResolved.build(builder);
    return setupScenePass.call(this, builder);
  };

  const aoIntensity = uniform(aoIntensityValue);
  // Preserve the existing 0..1 look; stronger AO darkens smoothly without negative light.
  const aoVisibility = texture(denoiseResolved.value, screenUV).r.clamp(0, 1);
  const aoOutput = mix(float(1.0), aoVisibility, aoIntensity.min(1)).div(
    float(1).add(aoIntensity.sub(1).max(0).mul(float(1).sub(aoVisibility))));
  scenePass.contextNode = builtinAOContext(aoOutput);
  const sceneGI = keep(createSceneGI(scene,camera,aoIntensity,{...giOptions,renderer}));
  function setRenderer(next){
    if(typeof next?.getDrawingBufferSize!=='function')throw Error('Lighting graph requires its current renderer');
    renderer=next;renderPipeline.renderer=next;renderPipeline.needsUpdate=true;
    sceneGI.reflections?.setRenderer?.(next);
  }
  function syncReflections(){
    scenePass.contextNode=THREE.TSL.context({...builtinAOContext(aoOutput).getFlowContextData(),
      sceneReflectionLighting:sceneGI.reflections.settings.enabled?sceneGI.reflections.lightingContext:null});
    scenePass.needsUpdate=true;
  }
  function resizeDepth(){
    const size=renderer.getDrawingBufferSize(new THREE.Vector2());
    const width=Math.round(size.x*aoResScale),height=Math.round(size.y*aoResScale);
    if(depthRT.width===width&&depthRT.height===height)return false;
    depthRT.setSize(width,height);return true;
  }
  syncReflections();
  return {setRenderer,resizeDepth,syncReflections,renderPipeline,prePass,prePassDepth,prePassNormal,scenePass,aoPass,aoResScale,depthRT,depthMaterial,
    aoIntensity,aoOutput,sceneGI};
}
