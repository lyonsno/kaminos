import {Node,RenderTarget,NodeMaterial,QuadMesh,HalfFloatType,LinearFilter,LinearMipmapLinearFilter,Vector2,Matrix4,RendererUtils,TSL} from './lib/three.webgpu.js';
import {fullscreenGraphContext} from './lib/addons/tsl/display/FullscreenGraphContext.js';
import {SCENE_REFLECTION_QUERY_WGSL} from './scene-reflection-query.mjs';
import {SCENE_REFLECTION_RECONSTRUCTION_WGSL} from './scene-reflection-reconstruction.mjs';
import {ReflectionField} from './scene-reflection-field.mjs';
import {SCENE_REFLECTION_ALLOCATION_WGSL} from './scene-reflection-allocation.mjs';
import {installSceneReflectionLighting} from './scene-reflection-lighting.mjs';
const {Fn,NodeUpdateType,uniform,texture,context,uv,screenUV,vec2,vec3,vec4,float,wgsl,wgslFn,If,positionView,normalView,positionViewDirection,roughness,dot,abs,max,mix,pow,exp,floor}=TSL;

import {resolveReflectionSettings} from './scene-reflection-settings.mjs';
export {resolveReflectionSettings} from './scene-reflection-settings.mjs';

const sample=wgslFn(`fn reflectionSampleEntry(coords:vec2<f32>,depthMap:texture_depth_2d,colorMap:texture_2d<f32>,colorSampler:sampler,normalMap:texture_2d<f32>,projection:mat4x4<f32>,inverseProjection:mat4x4<f32>,maxDistance:f32,thickness:f32,nearPlane:f32,steps:u32,refinementSteps:u32,frame:u32,roughnessCutoff:f32,samples:u32,stable:bool,coarseStats:texture_2d<f32>,dense:bool)->mat4x4<f32>{
 var weight=0.0;if(dense){weight=reflectionAllocationAt(coords,depthMap,normalMap,coarseStats,projection,inverseProjection);if(weight<=0.0){return mat4x4<f32>(vec4<f32>(0.0),vec4<f32>(0.0,0.0,0.0,-1.0),vec4<f32>(0.0),vec4<f32>(0.0));}}
 var payload=sampleSceneReflectionPayload(coords,depthMap,colorMap,colorSampler,normalMap,projection,inverseProjection,maxDistance,thickness,nearPlane,steps,refinementSteps,frame,roughnessCutoff,samples,stable);payload[2].x=weight;return payload;
}`,[wgsl(SCENE_REFLECTION_QUERY_WGSL),wgsl(SCENE_REFLECTION_ALLOCATION_WGSL)]);
const reconstruct=wgslFn(`fn reflectionReconstructEntry(coords:vec2<f32>,current:texture_2d<f32>,currentStats:texture_2d<f32>,depthMap:texture_depth_2d,normalMap:texture_2d<f32>,oldColor:texture_2d<f32>,oldNormal:texture_2d<f32>,oldDepth:texture_2d<f32>,oldStats:texture_2d<f32>,inverseProjection:mat4x4<f32>,toPrevious:mat4x4<f32>,previousProjection:mat4x4<f32>,previousInverseProjection:mat4x4<f32>,historyValid:bool,historyWeight:f32,roughnessCutoff:f32,detailMask:texture_2d<f32>,dense:bool)->mat4x4<f32>{
 if(dense){let size=vec2<i32>(textureDimensions(detailMask));let pixel=clamp(vec2<i32>(coords*vec2<f32>(size)),vec2<i32>(0),size-vec2<i32>(1));if(textureLoad(detailMask,pixel,0).r<=0.0){return mat4x4<f32>();}}
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
  this.coarse=new ReflectionField(this,'SSR glossy');this.detail=new ReflectionField(this,'SSR sharp',{dense:true});
  this.detailSize=uniform(new Vector2(1,1));this.adaptive=uniform(false);
  // Existing diagnostic consumers continue to name the coarse field explicitly.
  for(const key of ['raw','targets','result','surface','surfaceDepth','current','currentStats','statistics'])this[key]=this.coarse[key];
  this.previousCamera=new Matrix4();this.previousProjection=new Matrix4();this.resetReason='initial';
  this.settings=resolveReflectionSettings(settings);this.setSettings(this.settings);
  this.setRenderer(renderer);
 }
 get writeIndex(){return this.coarse.writeIndex;}
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
  this.adaptive.value=next.adaptive&&next.sharpResolutionScale>next.resolutionScale;
  if(!this.adaptive.value){this.detail.setSize(1,1);this.detailSize.value.set(1,1);}
  this.requestFrames();
  return this.state();
 }
 // Let the initial image's temporal weight fall below 1%, then return to
 // host idle. This is a finite history tail, not a variance-convergence claim.
 requestFrames(){const s=this.settings,w=this.historyWeight.value;this.pendingHistoryFrames=s?.enabled&&s.temporal&&w>0?1+Math.ceil(Math.log(.01)/Math.log(w)):0;}
 needsFrame(){return this.syncSupport().effective&&this.settings.temporal&&this.pendingHistoryFrames>0;}
 reset(reason='scene-change'){this.valid.value=false;this.resetReason=reason;this.requestFrames();}
 state(){const support=this.syncSupport();return {...this.settings,...support,route:'kaminos-screen-reflection-adaptive-v2',renderBackend:this.renderer.backend?.isWebGPUBackend===true?'webgpu':this.renderer.backend?.constructor.name??'unobserved',frames:this.frames,resolution:this.size.value.toArray(),valid:this.valid.value,resetReason:this.resetReason,
  allocation:this.adaptive.value?'projected-GGX-footprint-two-grid':'uniform',sharpResolution:this.detailSize.value.toArray(),sharpFrames:this.detail.frames,denseFieldActive:this.adaptive.value,rayAllocation:'coarse rays plus sharp-field rays only where footprint or normal variation needs detail',
  materialResponse:'existing-physical-base-specular-once',worldGeometry:false,history:'surface-and-reflection-parallax-reprojection-geometry-validated-variance-clipped',cameraMotionFrames:this.cameraMotionFrames,historyAttachmentBytesPerPixel:28,allocatedFieldBytes:72*this.coarse.raw.width*this.coarse.raw.height+74*this.detail.raw.width*this.detail.raw.height,samplesPerTracingPixel:this.settings.samples,samplingSequence:this.settings.sampling==='stable'?'coherent-hammersley':'pixel-scrambled-halton',
  sourceFiltering:'visible-GGX-pdf-footprint-mips',sourcePyramidFrames:this.radianceFrames,sourcePyramidResolution:[this.radiance.width,this.radiance.height],pendingHistoryFrames:this.pendingHistoryFrames,historyRemainderTarget:.01,effectiveHistoryWeight:this.historyWeight.value};}
 forSurface(){
  return Fn(()=>{
   const result=vec4(0).toVar();
   If(this.available,()=>{
   If(this.adaptive,()=>{
    const weight=this.detail.allocation.sample(screenUV).r.toVar();
    If(weight.greaterThanEqual(1),()=>{result.assign(this.sampleField(this.detail,this.detailSize));}).Else(()=>{
     result.assign(this.sampleField(this.coarse,this.size));
     If(weight.greaterThan(0),()=>{result.assign(mix(result,this.sampleField(this.detail,this.detailSize),weight));});
    });
   }).Else(()=>{result.assign(this.sampleField(this.coarse,this.size));});
   });
   return result;
  })();
 }
 sampleField(field,size){
  return Fn(()=>{
   const grid=screenUV.mul(size).sub(.5),base=floor(grid),fraction=grid.sub(base);
   const n=normalView.dot(positionViewDirection).lessThan(0).select(normalView.negate(),normalView);
   const sum=vec4(0).toVar(),total=float(0).toVar();
   for(let y=0;y<2;y++)for(let x=0;x<2;x++){
    const q=base.add(vec2(x,y)).add(.5).div(size),nr=field.surface.sample(q),depth=field.surfaceDepth.sample(q).r;
    const spatial=(x?fraction.x:fraction.x.oneMinus()).mul(y?fraction.y:fraction.y.oneMinus());
    const geometry=pow(max(dot(n,nr.rgb),0),32).mul(exp(abs(depth.add(positionView.z)).div(max(.01,positionView.z.abs().mul(.005))).negate()));
    const w=spatial.mul(geometry).mul(exp(abs(nr.a.sub(roughness)).mul(-32)));
    sum.addAssign(field.result.sample(q).mul(w));total.addAssign(w);
   }return sum.div(total.max(.00001));
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
  this.coarse.setup(shared,sample,reconstruct);this.detail.setup(shared,sample,reconstruct);
  this.radianceMaterial.needsUpdate=true;this._graph=graph;return this.result;
 }
 updateBefore(frame){
  this.setRenderer(frame.renderer);
  if(!this.syncSupport().effective)return;
  frame.updateBeforeNode(this.source);
  const {renderer}=frame,state=RendererUtils.resetRendererState(renderer);
  try{
   const extent=renderer.getDrawingBufferSize(new Vector2()),w=Math.max(1,Math.round(extent.x*this.settings.resolutionScale)),h=Math.max(1,Math.round(extent.y*this.settings.resolutionScale));
   if(w!==this.size.value.x||h!==this.size.value.y){this.coarse.setSize(w,h);this.size.value.set(w,h);this.reset('resize');}
   const dw=Math.max(1,Math.round(extent.x*this.settings.sharpResolutionScale)),dh=Math.max(1,Math.round(extent.y*this.settings.sharpResolutionScale));
   if(this.adaptive.value&&(dw!==this.detailSize.value.x||dh!==this.detailSize.value.y)){this.detail.setSize(dw,dh);this.detailSize.value.set(dw,dh);this.reset('sharp-resize');}
   const moved=!this.camera.matrixWorld.equals(this.previousCamera)||!this.camera.projectionMatrix.equals(this.previousProjection);
   this.toPreviousView.value.copy(this.previousCamera).invert().multiply(this.camera.matrixWorld);this.oldProjection.value.copy(this.previousProjection);this.oldInverseProjection.value.copy(this.previousProjection).invert();
   if(moved){if(this.valid.value)this.cameraMotionFrames++;this.requestFrames();}
   this.near.value=this.camera.near;this.frame.value=this.frames;
   this.radiance.setSize(this.source.renderTarget.width,this.source.renderTarget.height);
   renderer.setRenderTarget(this.radiance);this.radianceQuad.render(renderer);this.radianceFrames++;
   this.coarse.render(renderer);if(this.adaptive.value)this.detail.render(renderer);
   this.valid.value=true;this.frames++;this.pendingHistoryFrames=Math.max(0,this.pendingHistoryFrames-1);
   this.previousCamera.copy(this.camera.matrixWorld);this.previousProjection.copy(this.camera.projectionMatrix);
  }finally{RendererUtils.restoreRendererState(renderer,state);}
 }
 dispose(){super.dispose();this.releaseLighting();this.radiance.dispose();this.radianceMaterial.dispose();this.coarse.dispose();this.detail.dispose();}
}
