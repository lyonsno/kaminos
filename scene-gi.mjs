import { DataUtils } from 'three/webgpu';
import { pass, mrt, output, normalView, positionViewDirection, diffuseColor, metalness, context, builtinAOContext, texture, screenUV, vec3, vec4, float, mix, uniform, convertToTexture } from 'three/tsl';
import { ssgi } from './lib/addons/tsl/display/SSGINode.js';
import SceneGIHistory from './scene-gi-history.mjs';
import SceneLightingFilter from './scene-lighting-filter.mjs';
import SceneSurfaceLighting from './scene-surface-lighting.mjs';
import {createGISourceComparison} from './scene-gi-source-comparison.mjs';
import { denoise } from './lib/addons/tsl/display/DenoiseNode.js';
import { resolveSceneGISettings, resolveSceneGIEstimatorSettings, sceneGIReceives } from './scene-gi-settings.mjs';

export function createSceneGI(scene, camera, aoIntensity, {receiveWeight=()=>1,filterImplementation='shared',surfaceReuse=true,sourceComparison=false}={}) {
  if(!['shared','separate'].includes(filterImplementation))throw Error('Unknown lighting filter implementation');
  // The screen-space field samples one depth/normal per pixel on both device routes.
  // Keep MSAA on the receiving beauty pass, not on the GI source attachments.
  const source = pass(scene, camera, { samples: 0 });
  source.name = 'SSGI opaque linear source';
  source.transparent = false;
  const visibleNormal = normalView.dot(positionViewDirection).lessThan(0).select(normalView.negate(),normalView);
  source.setMRT(mrt({output, normal:visibleNormal}));
  const surfaceLighting=new SceneSurfaceLighting(source,camera,{enabled:surfaceReuse});
  const depth = source.getTextureNode('depth');
  const normal = source.getTextureNode('normal');
  const effect = ssgi(source.getTextureNode('output'),depth,normal,camera);
  effect.useTemporalFiltering = false;
  effect.useScreenSpaceSampling.value = false;
  effect.giIntensity.value = 1;
  const history=new SceneGIHistory(effect.getAONode(),effect.getGINode(),depth,normal,camera);
  const comparison=sourceComparison?createGISourceComparison(scene,camera,source,visibleNormal,reason=>history.reset(reason)):null;
  if(comparison)effect.sourceOverride=comparison.inputs;
  const filters=new Map();
  const rawAO = effect.getAONode(), rawGI = effect.getGINode();
  let settings = resolveSceneGISettings();
  let estimator = resolveSceneGIEstimatorSettings();
  const gain = uniform(settings.gain), viewMode = uniform(0,'int');
  // Different scheduling graphs make Off an actual bypass. Keep compiled routes
  // alive across toggles because Three bindings can still reference their RTs.
  const routes = new Map();
  const filterFrames = {ao:0,gi:0};
  const filterKey=temporal=>`${filterImplementation}:${temporal}`;
  function filterPair(temporal) {
    const key=filterKey(temporal);
    if(filters.has(key))return filters.get(key);
    const pair={};
    if(filterImplementation==='shared'){
      const filter=new SceneLightingFilter(temporal?history.getAONode():rawAO,temporal?history.getGINode():rawGI,depth,normal,camera);
      for(const key of ['depthPhi','normalPhi','lumaPhi'])filter[key].value=estimator[key];
      filter.radius.value=settings.denoise;filter.resolutionScale=settings.resolutionScale;
      pair.shared=filter;pair.ao={filter,node:filter.getAONode()};pair.gi={filter,node:filter.getGINode()};
      filters.set(key,pair);return pair;
    }
    for(const [name,input] of [['ao',temporal?history.getAONode():rawAO],['gi',temporal?history.getGINode():rawGI]]) {
      const filter=denoise(input,depth,normal,camera);
      for(const key of ['depthPhi','normalPhi','lumaPhi'])filter[key].value=estimator[key];
      filter.radius.value=settings.denoise;
      const node=convertToTexture(filter);node.setResolutionScale(settings.resolutionScale);
      const update=node.updateBefore;
      node.updateBefore=function(frame){const result=update.call(this,frame);filterFrames[name]++;return result;};
      pair[name]={filter,node};
    }
    filters.set(key,pair);return pair;
  }
  function route() {
    const filtered=settings.denoise>0;
    const key=`${filterImplementation}:${filtered}:${settings.temporal}`;
    if(routes.has(key))return routes.get(key);
    const pair=filtered?filterPair(settings.temporal):null;
    const aoInput=filtered?pair.ao.node:settings.temporal?history.getAONode():rawAO;
    const giInput=filtered?pair.gi.node:settings.temporal?history.getGINode():rawGI;
    const visibility=aoInput.sample(screenUV).r.clamp(0,1);
    const irradianceOverPi=giInput.sample(screenUV).rgb.mul(gain);
    const ao=mix(float(1),visibility,aoIntensity.min(1)).div(float(1).add(aoIntensity.sub(1).max(0).mul(float(1).sub(visibility))));
    const beauty=pass(scene,camera);
    beauty.name='SSGI material receiving '+(filtered?'filtered':'raw');
    beauty.contextNode=context({
      sceneSurfaceLighting:surfaceLighting,
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
    const displayed=comparison?mix(output,comparison.inputs.enabled.select(comparison.inputs.beauty,source.getTextureNode('output')),float(comparison.showSource)):output;
    const result={beauty,output:displayed};routes.set(key,result);return result;
  }
  let frames = 0;
  const update = effect.updateBefore;
  effect.updateBefore = function(frame) { update.call(this,frame); frames++; };
  return {
    depth, source, surfaceLighting, sourceComparison:comparison,
    setFilterImplementation(value){if(!['shared','separate'].includes(value))throw Error('Unknown lighting filter implementation');filterImplementation=value;},
    get beauty() { return route().beauty; },
    output() { return route().output; },
    setSettings(value) {
      const next = resolveSceneGISettings(value);
      if(next.view==='gi')scene.traverseVisible(object=>{
        for(const material of [].concat(object.material||[]))if(material.fragmentNode!=null) {
          throw new Error('Received bounce is unavailable for custom fragment materials');
        }
      });
      if(['mode','radius','thickness','slices','steps','resolutionScale','temporal'].some(key=>next[key]!==settings[key]))history.reset('estimator-settings');
      settings = next;
      history.resolutionScale=next.resolutionScale;history.weight.value=next.temporalWeight;
      effect.useTemporalFiltering=next.temporal;
      effect.radius.value = settings.radius; effect.thickness.value = settings.thickness;
      effect.sliceCount.value = settings.slices; effect.stepCount.value = settings.steps;
      gain.value = settings.gain;
      effect.resolutionScale=settings.resolutionScale;
      for(const pair of filters.values()){
        if(pair.shared)pair.shared.resolutionScale=settings.resolutionScale;
        for(const {filter,node} of [pair.ao,pair.gi]){node.setResolutionScale?.(settings.resolutionScale);filter.radius.value=settings.denoise;}
      }
      viewMode.value = ['scene','ao','gi','incoming'].indexOf(settings.view);

    },
    setEstimatorSettings(value) {
      const next = resolveSceneGIEstimatorSettings({...estimator,...value});
      effect.expFactor.value = next.expFactor;
      effect.useScreenSpaceSampling.value = next.screenSpaceSampling;
      effect.useLinearThickness.value = next.linearThickness;
      effect.backfaceLighting.value = next.backfaceLighting;
      if(Object.keys(next).some(key=>next[key]!==estimator[key]))history.reset('estimator-parameters');
      for(const pair of filters.values())for(const {filter} of [pair.ao,pair.gi])for(const key of ['depthPhi','normalPhi','lumaPhi'])filter[key].value=next[key];
      estimator = next;
    },
    requestHistoryFrames(){if(settings.mode==='combined'&&settings.temporal)history.requestFrames();},
    needsHistoryFrame:()=>settings.mode==='combined'&&settings.temporal&&history.needsFrame(),
    resetHistory(reason) { history.reset(reason); },
    async readback(renderer,kind='incoming') {
      if (!['incoming','receiving','estimate','surface'].includes(kind)) throw new Error('Invalid GI readback kind');
      if(kind==='surface'&&!surfaceLighting.capture)throw Error('No flame surface irradiance is mounted');
      const target=kind==='surface'?source.renderTarget:kind==='receiving'?route().beauty.renderTarget:kind==='incoming'&&settings.temporal?history.targets[1-history.writeIndex]:effect._ssgiRenderTarget;
      const attachment=kind==='surface'?target.textures.indexOf(surfaceLighting.capture.value):kind==='receiving'?0:1;
      const data=await renderer.readRenderTargetPixelsAsync(target,0,0,target.width,target.height,attachment);
      let sum=0,max=0,nonzero=0,finite=true,covered=0;
      for(let i=0;i<data.length;i++)if(i%4<3){const v=DataUtils.fromHalfFloat(data[i]);finite&&=Number.isFinite(v);sum+=v;max=Math.max(max,v);if(v>0)nonzero++;}
      if(kind==='surface')for(let i=3;i<data.length;i+=4)if(DataUtils.fromHalfFloat(data[i])>.5)covered++;
      const bytes=new Uint8Array(data.buffer,data.byteOffset,data.byteLength),chunks=[];
      // Chunk only the JS call arguments, not the evidence. Preserve every byte.
      for(let i=0;i<bytes.length;i+=16384)chunks.push(String.fromCharCode(...bytes.subarray(i,i+16384)));
      return {kind,source:kind==='surface'?'opaque-source-flame-irradiance':kind==='receiving'?'receiving':kind==='incoming'&&settings.temporal?'temporal-result':'current-estimate',estimatorFrames:frames,historyFrames:history.frames,view:settings.view,width:target.width,height:target.height,format:'rgba16f-little-endian',base64:btoa(chunks.join('')),stats:{sum,max,nonzero,finite,...(kind==='surface'?{covered}:{})}};
    },
    debugState:()=>({identity:'three-ssilvb-scene-gi-v1',...settings,estimator:{...estimator},frames,
      history:{enabled:settings.temporal,frames:history.frames,valid:history.valid.value,resetReason:history.resetReason,bytesPerPixel:34,weight:history.weight.value,pendingFrames:history.pendingFrames,settlingInitialInfluence:.01},source:'opaque-linear-lit-surfaces',receiver:'opaque-physical-material-diffuse',
      resolution:[effect._ssgiRenderTarget.width,effect._ssgiRenderTarget.height],
      sourcePasses:1+(comparison?.read().additionalSourcePasses??0),sourceComparison:comparison?.read()??null,receivingPasses:1,sourceSamples:source.renderTarget.samples,receivingSamples:route().beauty.renderTarget.samples,
      filtering:settings.denoise>0,filterImplementation,filterFrames:filterImplementation==='shared'?{ao:filters.get(filterKey(settings.temporal))?.shared.frames??0,gi:filters.get(filterKey(settings.temporal))?.shared.frames??0}: {...filterFrames},
      surfaceLighting:surfaceLighting.state(),
      standaloneGTAO:false,format:'rgba16float',gainSemantics:'artistic-relative-estimator-gain',
      viewSemantics:settings.view==='gi'?'material-weighted-added-diffuse-radiance':settings.view==='incoming'?'incoming-irradiance-over-pi':settings.view}),
  };
}
