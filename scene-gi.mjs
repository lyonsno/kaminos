import { DataUtils } from 'three/webgpu';
import { pass, mrt, output, normalView, positionViewDirection, diffuseColor, metalness, context, builtinAOContext, texture, screenUV, vec3, vec4, float, mix, uniform, convertToTexture } from 'three/tsl';
import { ssgi } from './lib/addons/tsl/display/SSGINode.js';
import { denoise } from './lib/addons/tsl/display/DenoiseNode.js';
import { resolveSceneGISettings, resolveSceneGIEstimatorSettings, sceneGIReceives } from './scene-gi-settings.mjs';

export function createSceneGI(scene, camera, aoIntensity, {receiveWeight=()=>1}={}) {
  // The screen-space field samples one depth/normal per pixel on both device routes.
  // Keep MSAA on the receiving beauty pass, not on the GI source attachments.
  const source = pass(scene, camera, { samples: 0 });
  source.name = 'SSGI opaque linear source';
  source.transparent = false;
  const visibleNormal = normalView.dot(positionViewDirection).lessThan(0).select(normalView.negate(),normalView);
  source.setMRT(mrt({output, normal:visibleNormal}));
  const depth = source.getTextureNode('depth');
  const normal = source.getTextureNode('normal');
  const effect = ssgi(source.getTextureNode('output'),depth,normal,camera);
  effect.useTemporalFiltering = false;
  effect.useScreenSpaceSampling.value = false;
  effect.giIntensity.value = 1;
  const aoFilter = denoise(effect.getAONode(),depth,normal,camera);
  const giFilter = denoise(effect.getGINode(),depth,normal,camera);
  // Depth tolerance is in scene units; preserve kiln contact boundaries.
  aoFilter.depthPhi.value = giFilter.depthPhi.value = .1;
  const aoTexture = convertToTexture(aoFilter), giTexture = convertToTexture(giFilter);
  const rawAO = effect.getAONode(), rawGI = effect.getGINode();
  let settings = resolveSceneGISettings();
  let estimator = resolveSceneGIEstimatorSettings();
  const gain = uniform(settings.gain), viewMode = uniform(0,'int');
  // Different scheduling graphs make Off an actual bypass. Keep compiled routes
  // alive across toggles because Three bindings can still reference their RTs.
  const routes = new Map();
  const filterFrames = {ao:0,gi:0};
  for (const [name,node] of [['ao',aoTexture],['gi',giTexture]]) {
    const update = node.updateBefore;
    node.updateBefore = function(frame) { const result=update.call(this,frame); filterFrames[name]++; return result; };
  }
  function route() {
    const filtered=settings.denoise>0;
    if(routes.has(filtered))return routes.get(filtered);
    const aoInput=filtered?aoTexture:rawAO, giInput=filtered?giTexture:rawGI;
    const visibility=texture(aoInput.value,screenUV).r.clamp(0,1);
    const irradianceOverPi=texture(giInput.value,screenUV).rgb.mul(gain);
    const ao=mix(float(1),visibility,aoIntensity.min(1)).div(float(1).add(aoIntensity.sub(1).max(0).mul(float(1).sub(visibility))));
    const beauty=pass(scene,camera);
    beauty.name='SSGI material receiving '+(filtered?'filtered':'raw');
    beauty.contextNode=context({
      ...builtinAOContext(ao).getFlowContextData(),
      getOutput(node,{material}) {
        const diffuseReceiver=diffuseColor.rgb.mul(metalness.oneMinus());
        const received=sceneGIReceives(material)?irradianceOverPi.mul(diffuseReceiver).mul(receiveWeight(material)):vec3(0);
        return mix(vec4(node.rgb.add(received),node.a),vec4(received,node.a),float(viewMode.equal(2)));
      },
    });
    const setup=beauty.setup;
    beauty.setup=function(builder) {
      // Building only the selected producers excludes filter dispatches in raw mode.
      aoInput.build(builder);giInput.build(builder);
      return setup.call(this,builder);
    };
    const aoView=vec4(visibility,visibility,visibility,1);
    const surface=texture(depth.value,screenUV).r.lessThan(1);
    const receivedView=vec4(beauty.rgb.mul(surface),1);
    const incomingView=vec4(irradianceOverPi.mul(surface),1);
    const output=mix(mix(mix(beauty,aoView,float(viewMode.equal(1))),receivedView,float(viewMode.equal(2))),incomingView,float(viewMode.equal(3)));
    const result={beauty,output};routes.set(filtered,result);return result;
  }
  let frames = 0;
  const update = effect.updateBefore;
  effect.updateBefore = function(frame) { update.call(this,frame); frames++; };
  return {
    depth, source,
    get beauty() { return route().beauty; },
    output() { return route().output; },
    setSettings(value) {
      const next = resolveSceneGISettings(value);
      if(next.view==='gi')scene.traverseVisible(object=>{
        for(const material of [].concat(object.material||[]))if(material.fragmentNode!=null) {
          throw new Error('Received bounce is unavailable for custom fragment materials');
        }
      });
      settings = next;
      effect.radius.value = settings.radius; effect.thickness.value = settings.thickness;
      effect.sliceCount.value = settings.slices; effect.stepCount.value = settings.steps;
      gain.value = settings.gain;
      effect.resolutionScale=settings.resolutionScale;
      aoTexture.setResolutionScale(settings.resolutionScale);giTexture.setResolutionScale(settings.resolutionScale);
      viewMode.value = ['scene','ao','gi','incoming'].indexOf(settings.view);
      aoFilter.radius.value = giFilter.radius.value = settings.denoise;
    },
    setEstimatorSettings(value) {
      const next = resolveSceneGIEstimatorSettings({...estimator,...value});
      effect.expFactor.value = next.expFactor;
      effect.useScreenSpaceSampling.value = next.screenSpaceSampling;
      effect.useLinearThickness.value = next.linearThickness;
      effect.backfaceLighting.value = next.backfaceLighting;
      for (const key of ['depthPhi','normalPhi','lumaPhi']) aoFilter[key].value = giFilter[key].value = next[key];
      estimator = next;
    },
    async readback(renderer,kind='incoming') {
      if (!['incoming','receiving'].includes(kind)) throw new Error('Invalid GI readback kind');
      const target=kind==='receiving'?route().beauty.renderTarget:effect._ssgiRenderTarget;
      const data=await renderer.readRenderTargetPixelsAsync(target,0,0,target.width,target.height,kind==='receiving'?0:1);
      let sum=0,max=0,nonzero=0,finite=true;
      for(let i=0;i<data.length;i++)if(i%4<3){const v=DataUtils.fromHalfFloat(data[i]);finite&&=Number.isFinite(v);sum+=v;max=Math.max(max,v);if(v>0)nonzero++;}
      const bytes=new Uint8Array(data.buffer,data.byteOffset,data.byteLength),chunks=[];
      // Chunk only the JS call arguments, not the evidence. Preserve every byte.
      for(let i=0;i<bytes.length;i+=16384)chunks.push(String.fromCharCode(...bytes.subarray(i,i+16384)));
      return {kind,view:settings.view,width:target.width,height:target.height,format:'rgba16f-little-endian',base64:btoa(chunks.join('')),stats:{sum,max,nonzero,finite}};
    },
    debugState:()=>({identity:'three-ssilvb-scene-gi-v1',...settings,estimator:{...estimator},frames,
      temporal:false,source:'opaque-linear-lit-surfaces',receiver:'opaque-physical-material-diffuse',
      resolution:[effect._ssgiRenderTarget.width,effect._ssgiRenderTarget.height],
      sourcePasses:1,receivingPasses:1,sourceSamples:source.renderTarget.samples,receivingSamples:route().beauty.renderTarget.samples,
      filtering:settings.denoise>0,filterFrames:{...filterFrames},
      standaloneGTAO:false,format:'rgba16float',gainSemantics:'artistic-relative-estimator-gain',
      viewSemantics:settings.view==='gi'?'material-weighted-added-diffuse-radiance':settings.view==='incoming'?'incoming-irradiance-over-pi':settings.view}),
  };
}
