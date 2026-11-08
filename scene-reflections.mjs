import {Node,RenderTarget,NodeMaterial,QuadMesh,HalfFloatType,FloatType,RedFormat,NearestFilter,LinearFilter,LinearMipmapLinearFilter,Vector2,Matrix4,RendererUtils,TSL} from './lib/three.webgpu.js';
import {fullscreenGraphContext} from './lib/addons/tsl/display/FullscreenGraphContext.js';
import {SCENE_REFLECTION_QUERY_WGSL} from './scene-reflection-query.mjs';
import {SCENE_REFLECTION_RECONSTRUCTION_WGSL} from './scene-reflection-reconstruction.mjs';
import {installSceneReflectionLighting} from './scene-reflection-lighting.mjs';
const {Fn,NodeUpdateType,uniform,texture,sampler,passTexture,context,uv,screenUV,vec2,vec3,vec4,float,wgsl,wgslFn,If,outputStruct,property,getViewPosition,positionView,normalView,positionViewDirection,roughness,dot,abs,max,mix,pow,exp,floor}=TSL;

import {resolveReflectionSettings} from './scene-reflection-settings.mjs';
export {resolveReflectionSettings} from './scene-reflection-settings.mjs';

const sample=wgslFn(`fn reflectionSampleEntry(coords:vec2<f32>,depthMap:texture_depth_2d,colorMap:texture_2d<f32>,colorSampler:sampler,normalMap:texture_2d<f32>,projection:mat4x4<f32>,inverseProjection:mat4x4<f32>,maxDistance:f32,thickness:f32,nearPlane:f32,steps:u32,refinementSteps:u32,frame:u32,roughnessCutoff:f32,samples:u32,stable:bool)->mat4x4<f32>{
 return sampleSceneReflectionPayload(coords,depthMap,colorMap,colorSampler,normalMap,projection,inverseProjection,maxDistance,thickness,nearPlane,steps,refinementSteps,frame,roughnessCutoff,samples,stable);
}`,[wgsl(SCENE_REFLECTION_QUERY_WGSL)]);
const reconstruct=wgslFn(`fn reflectionReconstructEntry(coords:vec2<f32>,current:texture_2d<f32>,currentStats:texture_2d<f32>,depthMap:texture_depth_2d,normalMap:texture_2d<f32>,oldColor:texture_2d<f32>,oldNormal:texture_2d<f32>,oldDepth:texture_2d<f32>,oldStats:texture_2d<f32>,inverseProjection:mat4x4<f32>,toPrevious:mat4x4<f32>,previousProjection:mat4x4<f32>,previousInverseProjection:mat4x4<f32>,historyValid:bool,historyWeight:f32,roughnessCutoff:f32)->mat4x4<f32>{
 return reconstructSceneReflection(coords,current,currentStats,depthMap,normalMap,oldColor,oldNormal,oldDepth,oldStats,inverseProjection,toPrevious,previousProjection,previousInverseProjection,historyValid,historyWeight,roughnessCutoff);
}`,[wgsl(SCENE_REFLECTION_RECONSTRUCTION_WGSL)]);

export default class SceneReflections extends Node{
 static get type(){return 'SceneReflections';}
 constructor(source,camera,renderer,settings={}){
  super('vec4');Object.assign(this,{source,camera,renderer});
  // Context hashing traverses Node values. A non-Node token scopes material
  // integration without embedding this producer's feedback textures in it.
  this.lightingContext=new (class ReflectionLightingContext {})();
  this.available=uniform(false);
  this.updateBeforeType=NodeUpdateType.FRAME;this.frames=0;this.pendingHistoryFrames=0;this.valid=uniform(false);this.frame=uniform(0,'uint');this.size=uniform(new Vector2(1,1));
  this.projection=uniform(camera.projectionMatrix);this.inverseProjection=uniform(camera.projectionMatrixInverse);this.near=uniform(camera.near);
  this.distance=uniform(50);this.thickness=uniform(.15);this.steps=uniform(64,'uint');this.cutoff=uniform(.95);this.historyWeight=uniform(.85);
  this.samples=uniform(1,'uint');this.refinementSteps=uniform(6,'uint');this.stable=uniform(false);
  this.toPreviousView=uniform(new Matrix4());this.oldProjection=uniform(new Matrix4());this.oldInverseProjection=uniform(new Matrix4());this.cameraMotionFrames=0;
  this.depth=source.getTextureNode('depth');this.normal=source.getTextureNode('normal');this.color=source.getTextureNode('output');
  this.radiance=new RenderTarget(1,1,{type:HalfFloatType,depthBuffer:false,minFilter:LinearMipmapLinearFilter,magFilter:LinearFilter,generateMipmaps:true});
  this.radiance.texture.name='SSR foreground HDR source pyramid';
  this.filteredColor=texture(this.radiance.texture);this.radianceFrames=0;
  this.radianceMaterial=new NodeMaterial();this.radianceMaterial.name='Reflection HDR source pyramid';this.radianceQuad=new QuadMesh(this.radianceMaterial);
  this.raw=new RenderTarget(1,1,{count:2,type:HalfFloatType,depthBuffer:false,minFilter:NearestFilter,magFilter:NearestFilter});this.raw.textures[0].name='SSR current incident radiance and coverage';this.raw.textures[1].name='SSR current logarithmic hit moments';
  this.targets=Array.from({length:2},()=>{
   const target=new RenderTarget(1,1,{count:4,depthBuffer:false,minFilter:NearestFilter,magFilter:NearestFilter});
   for(const [i,map]of target.textures.entries()){
    map.type=i===2?FloatType:HalfFloatType;if(i===2)map.format=RedFormat;
    map.name=['SSR resolved incident radiance and coverage','SSR surface normal and roughness','SSR metric surface depth','SSR logarithmic moments and applied history weight'][i];map.generateMipmaps=false;
   }return target;
  });
  this.writeIndex=1;this.result=passTexture(this,this.targets[0].textures[0]);
  this.surface=texture(this.targets[0].textures[1]);this.surfaceDepth=texture(this.targets[0].textures[2]);
  this.oldColor=texture(this.targets[0].textures[0]);this.oldNormal=texture(this.targets[0].textures[1]);this.oldDepth=texture(this.targets[0].textures[2]);
  this.current=texture(this.raw.texture);this.currentStats=texture(this.raw.textures[1]);this.statistics=texture(this.targets[0].textures[3]);this.oldStats=texture(this.targets[0].textures[3]);
  this.traceMaterial=new NodeMaterial();this.traceMaterial.name='Sparse GGX screen reflection query';this.traceQuad=new QuadMesh(this.traceMaterial);
  this.filterMaterial=new NodeMaterial();this.filterMaterial.name='Reflection geometry filter and history';this.filterQuad=new QuadMesh(this.filterMaterial);
  this.previousCamera=new Matrix4();this.previousProjection=new Matrix4();this.resetReason='initial';
  this.settings=resolveReflectionSettings(settings);this.setSettings(this.settings);
  this.setRenderer(renderer);
 }
 setRenderer(renderer){
  if(this.renderer===renderer&&this.releaseLighting)return;
  const previous=this.releaseLighting;
  this.renderer=renderer;this.releaseLighting=installSceneReflectionLighting(renderer,this);
  previous?.();if(previous)this.reset('device-replaced');this.syncSupport();
 }
 syncSupport(){
  const reason=!this.camera.isPerspectiveCamera?'perspective-camera-required':this.renderer.logarithmicDepthBuffer?'conventional-depth-required':null;
  const active=this.settings.enabled&&!reason;
  if(this._supportInitialized&&this.available.value!==active)this.reset(reason??'reflection-route-restored');
  this.available.value=active;this._supportInitialized=true;
  return {effective:active,supported:!reason,suspensionReason:this.settings.enabled?reason:null};
 }
 setSettings(value){
  const next=resolveReflectionSettings({...this.settings,...value});
  if(JSON.stringify(next)!==JSON.stringify(this.settings))this.reset('settings');
  this.settings=next;this.distance.value=next.maxDistance;this.thickness.value=next.thickness;this.steps.value=next.steps;this.cutoff.value=next.roughnessCutoff;this.historyWeight.value=next.temporal?Math.fround(next.historyWeight):0;
  this.samples.value=next.samples;this.refinementSteps.value=next.refinementSteps;this.stable.value=next.sampling==='stable';
  this.requestFrames();
  return this.state();
 }
 // Let the initial image's temporal weight fall below 1%, then return to
 // host idle. This is a finite history tail, not a variance-convergence claim.
 requestFrames(){const s=this.settings,w=this.historyWeight.value;this.pendingHistoryFrames=s?.enabled&&s.temporal&&w>0?1+Math.ceil(Math.log(.01)/Math.log(w)):0;}
 needsFrame(){return this.syncSupport().effective&&this.settings.temporal&&this.pendingHistoryFrames>0;}
 reset(reason='scene-change'){this.valid.value=false;this.resetReason=reason;this.requestFrames();}
 state(){const support=this.syncSupport();return {...this.settings,...support,route:'kaminos-screen-reflection-radiance-v1',renderBackend:this.renderer.backend?.isWebGPUBackend===true?'webgpu':this.renderer.backend?.constructor.name??'unobserved',frames:this.frames,resolution:this.size.value.toArray(),valid:this.valid.value,resetReason:this.resetReason,
  materialResponse:'existing-physical-base-specular-once',worldGeometry:false,history:'surface-and-reflection-parallax-reprojection-geometry-validated-variance-clipped',cameraMotionFrames:this.cameraMotionFrames,historyAttachmentBytesPerPixel:28,samplesPerTracingPixel:this.settings.samples,samplingSequence:this.settings.sampling==='stable'?'coherent-hammersley':'pixel-scrambled-halton',
  sourceFiltering:'visible-GGX-pdf-footprint-mips',sourcePyramidFrames:this.radianceFrames,sourcePyramidResolution:[this.radiance.width,this.radiance.height],pendingHistoryFrames:this.pendingHistoryFrames,historyRemainderTarget:.01,effectiveHistoryWeight:this.historyWeight.value};}
 forSurface(){
  return Fn(()=>{
   const result=vec4(0).toVar();
   If(this.available,()=>{
   const coords=screenUV,grid=coords.mul(this.size).sub(.5),base=floor(grid),fraction=grid.sub(base);
   const n=normalView.dot(positionViewDirection).lessThan(0).select(normalView.negate(),normalView);
   const sum=vec4(0).toVar(),total=float(0).toVar();
   for(let y=0;y<2;y++)for(let x=0;x<2;x++){
    const q=base.add(vec2(x,y)).add(.5).div(this.size);
    const nr=this.surface.sample(q),depth=this.surfaceDepth.sample(q).r;
    const spatial=(x?fraction.x:fraction.x.oneMinus()).mul(y?fraction.y:fraction.y.oneMinus());
    const geometry=pow(max(dot(n,nr.rgb),0),32).mul(exp(abs(depth.add(positionView.z)).div(max(.01,positionView.z.abs().mul(.005))).negate()));
    const w=spatial.mul(geometry).mul(exp(abs(nr.a.sub(roughness)).mul(-32)));
    sum.addAssign(this.result.sample(q).mul(w));total.addAssign(w);
   }
   result.assign(sum.div(total.max(.00001)));
   });
   return result;
  })();
 }
 setup(builder){
  this.setRenderer(builder.renderer);
  this.color.build(builder);this.depth.build(builder);this.normal.build(builder);
  const graph=fullscreenGraphContext(this._graph,builder,this.version);
  if(graph===this._graph)return this.result;
  const shared={...graph.shared,sceneReflectionLighting:null};
  this.radianceMaterial.contextNode=context(shared);
  const covered=float(this.depth.sample(uv()).r.lessThan(1));
  this.radianceMaterial.fragmentNode=vec4(this.color.sample(uv()).rgb.mul(covered),covered);
  this.traceMaterial.contextNode=context(shared);
  const traced=property('mat4');
  this.traceMaterial.colorNode=Fn(()=>{traced.assign(sample({coords:uv(),depthMap:this.depth,colorMap:this.filteredColor,colorSampler:sampler(this.filteredColor),normalMap:this.normal,projection:this.projection,inverseProjection:this.inverseProjection,maxDistance:this.distance,thickness:this.thickness,nearPlane:this.near,steps:this.steps,refinementSteps:this.refinementSteps,frame:this.frame,roughnessCutoff:this.cutoff,samples:this.samples,stable:this.stable}));return vec4(0);})();
  this.traceMaterial.outputNode=outputStruct(traced.element(0),traced.element(1));
  this.filterMaterial.contextNode=context(shared);
  const filtered=property('mat4');
  this.filterMaterial.colorNode=Fn(()=>{filtered.assign(reconstruct({coords:uv(),current:this.current,currentStats:this.currentStats,depthMap:this.depth,normalMap:this.normal,oldColor:this.oldColor,oldNormal:this.oldNormal,oldDepth:this.oldDepth,oldStats:this.oldStats,inverseProjection:this.inverseProjection,toPrevious:this.toPreviousView,previousProjection:this.oldProjection,previousInverseProjection:this.oldInverseProjection,historyValid:this.valid,historyWeight:this.historyWeight,roughnessCutoff:this.cutoff}));return vec4(0);})();
  this.filterMaterial.outputNode=outputStruct(filtered.element(0),filtered.element(1),filtered.element(2).x,filtered.element(3));
  this.radianceMaterial.needsUpdate=this.traceMaterial.needsUpdate=this.filterMaterial.needsUpdate=true;this._graph=graph;return this.result;
 }
 updateBefore(frame){
  this.setRenderer(frame.renderer);
  if(!this.syncSupport().effective)return;
  frame.updateBeforeNode(this.source);
  const {renderer}=frame,state=RendererUtils.resetRendererState(renderer);
  try{
   const extent=renderer.getDrawingBufferSize(new Vector2()),w=Math.max(1,Math.round(extent.x*this.settings.resolutionScale)),h=Math.max(1,Math.round(extent.y*this.settings.resolutionScale));
   if(w!==this.size.value.x||h!==this.size.value.y){this.raw.setSize(w,h);for(const t of this.targets)t.setSize(w,h);this.size.value.set(w,h);this.reset('resize');}
   const moved=!this.camera.matrixWorld.equals(this.previousCamera)||!this.camera.projectionMatrix.equals(this.previousProjection);
   this.toPreviousView.value.copy(this.previousCamera).invert().multiply(this.camera.matrixWorld);this.oldProjection.value.copy(this.previousProjection);this.oldInverseProjection.value.copy(this.previousProjection).invert();
   if(moved){if(this.valid.value)this.cameraMotionFrames++;this.requestFrames();}
   this.near.value=this.camera.near;this.frame.value=this.frames;
   this.radiance.setSize(this.source.renderTarget.width,this.source.renderTarget.height);
   renderer.setRenderTarget(this.radiance);this.radianceQuad.render(renderer);this.radianceFrames++;
   renderer.setRenderTarget(this.raw);this.traceQuad.render(renderer);
   const target=this.targets[this.writeIndex];renderer.setRenderTarget(target);this.filterQuad.render(renderer);
   this.result.value=target.textures[0];this.surface.value=target.textures[1];this.surfaceDepth.value=target.textures[2];
   this.oldColor.value=target.textures[0];this.oldNormal.value=target.textures[1];this.oldDepth.value=target.textures[2];this.statistics.value=target.textures[3];this.oldStats.value=target.textures[3];
   this.writeIndex=1-this.writeIndex;this.valid.value=true;this.frames++;this.pendingHistoryFrames=Math.max(0,this.pendingHistoryFrames-1);
   this.previousCamera.copy(this.camera.matrixWorld);this.previousProjection.copy(this.camera.projectionMatrix);
  }finally{RendererUtils.restoreRendererState(renderer,state);}
 }
 dispose(){super.dispose();this.releaseLighting();this.radiance.dispose();this.radianceMaterial.dispose();this.raw.dispose();for(const t of this.targets)t.dispose();this.traceMaterial.dispose();this.filterMaterial.dispose();}
}
