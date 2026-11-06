import {Node,RenderTarget,NodeMaterial,QuadMesh,HalfFloatType,FloatType,RedFormat,NearestFilter,LinearFilter,LinearMipmapLinearFilter,Vector2,Matrix4,RendererUtils,TSL} from './lib/three.webgpu.js';
import {fullscreenGraphContext} from './lib/addons/tsl/display/FullscreenGraphContext.js';
import {SCENE_REFLECTION_QUERY_WGSL} from './scene-reflection-query.mjs';
import {installSceneReflectionLighting} from './scene-reflection-lighting.mjs';
const {Fn,NodeUpdateType,uniform,texture,sampler,passTexture,context,uv,screenUV,vec2,vec3,vec4,float,wgsl,wgslFn,If,outputStruct,property,getViewPosition,positionView,normalView,positionViewDirection,roughness,dot,abs,max,mix,pow,exp,floor}=TSL;

export function resolveReflectionSettings(value={}){
 const result={enabled:false,resolutionScale:.5,steps:64,maxDistance:50,thickness:.15,roughnessCutoff:.95,temporal:true,historyWeight:.85,...value};
 for(const key of ['enabled','temporal'])if(typeof result[key]!=='boolean')throw Error(`${key} must be boolean`);
 for(const key of ['resolutionScale','maxDistance','thickness','roughnessCutoff'])if(!Number.isFinite(result[key])||result[key]<=0)throw Error(`${key} must be positive`);
 if(result.resolutionScale>1||result.roughnessCutoff>1)throw Error('Reflection scale and roughness cutoff must be at most one');
 if(!Number.isSafeInteger(result.steps)||result.steps<1||result.steps>4294967295)throw Error('Reflection steps must be a positive u32 integer');
 if(!Number.isFinite(result.historyWeight)||result.historyWeight<0||result.historyWeight>=1)throw Error('Reflection history weight must be in [0,1)');
 return result;
}

const sample=wgslFn(`fn reflectionSampleEntry(coords:vec2<f32>,depthMap:texture_depth_2d,colorMap:texture_2d<f32>,colorSampler:sampler,normalMap:texture_2d<f32>,projection:mat4x4<f32>,inverseProjection:mat4x4<f32>,maxDistance:f32,thickness:f32,nearPlane:f32,steps:u32,frame:u32,roughnessCutoff:f32)->vec4<f32>{
 return sampleSceneReflection(coords,depthMap,colorMap,colorSampler,normalMap,projection,inverseProjection,maxDistance,thickness,nearPlane,steps,frame,roughnessCutoff);
}`,[wgsl(SCENE_REFLECTION_QUERY_WGSL)]);

export default class SceneReflections extends Node{
 static get type(){return 'SceneReflections';}
 constructor(source,camera,renderer,settings={}){
  super('vec4');Object.assign(this,{source,camera,renderer});
  // Context hashing traverses Node values. A non-Node token scopes material
  // integration without embedding this producer's feedback textures in it.
  this.lightingContext=new (class ReflectionLightingContext {})();
  this.available=uniform(false);
  this.updateBeforeType=NodeUpdateType.FRAME;this.frames=0;this.valid=uniform(false);this.frame=uniform(0,'uint');this.size=uniform(new Vector2(1,1));
  this.projection=uniform(camera.projectionMatrix);this.inverseProjection=uniform(camera.projectionMatrixInverse);this.near=uniform(camera.near);
  this.distance=uniform(50);this.thickness=uniform(.15);this.steps=uniform(64,'uint');this.cutoff=uniform(.95);this.historyWeight=uniform(.85);
  this.depth=source.getTextureNode('depth');this.normal=source.getTextureNode('normal');this.color=source.getTextureNode('output');
  this.radiance=new RenderTarget(1,1,{type:HalfFloatType,depthBuffer:false,minFilter:LinearMipmapLinearFilter,magFilter:LinearFilter,generateMipmaps:true});
  this.radiance.texture.name='SSR foreground HDR source pyramid';
  this.filteredColor=texture(this.radiance.texture);this.radianceFrames=0;
  this.radianceMaterial=new NodeMaterial();this.radianceMaterial.name='Reflection HDR source pyramid';this.radianceQuad=new QuadMesh(this.radianceMaterial);
  this.raw=new RenderTarget(1,1,{type:HalfFloatType,depthBuffer:false,minFilter:NearestFilter,magFilter:NearestFilter});this.raw.texture.name='SSR current incident radiance and coverage';
  this.targets=Array.from({length:2},()=>{
   const target=new RenderTarget(1,1,{count:3,depthBuffer:false,minFilter:NearestFilter,magFilter:NearestFilter});
   for(const [i,map]of target.textures.entries()){
    map.type=i===2?FloatType:HalfFloatType;if(i===2)map.format=RedFormat;
    map.name=['SSR resolved incident radiance and coverage','SSR surface normal and roughness','SSR metric surface depth'][i];map.generateMipmaps=false;
   }return target;
  });
  this.writeIndex=1;this.result=passTexture(this,this.targets[0].textures[0]);
  this.surface=texture(this.targets[0].textures[1]);this.surfaceDepth=texture(this.targets[0].textures[2]);
  this.oldColor=texture(this.targets[0].textures[0]);this.oldNormal=texture(this.targets[0].textures[1]);this.oldDepth=texture(this.targets[0].textures[2]);
  this.current=texture(this.raw.texture);
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
  this.settings=next;this.distance.value=next.maxDistance;this.thickness.value=next.thickness;this.steps.value=next.steps;this.cutoff.value=next.roughnessCutoff;this.historyWeight.value=next.temporal?next.historyWeight:0;
  return this.state();
 }
 reset(reason='scene-change'){this.valid.value=false;this.resetReason=reason;}
 state(){const support=this.syncSupport();return {...this.settings,...support,route:'kaminos-screen-reflection-radiance-v1',frames:this.frames,resolution:this.size.value.toArray(),valid:this.valid.value,resetReason:this.resetReason,
  materialResponse:'existing-physical-base-specular-once',worldGeometry:false,history:'stationary-camera-geometry-validated-neighborhood-clamped',samplesPerTracingPixel:1,
  sourceFiltering:'visible-GGX-pdf-footprint-mips',sourcePyramidFrames:this.radianceFrames,sourcePyramidResolution:[this.radiance.width,this.radiance.height]};}
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
  this.traceMaterial.fragmentNode=sample({coords:uv(),depthMap:this.depth,colorMap:this.filteredColor,colorSampler:sampler(this.filteredColor),normalMap:this.normal,projection:this.projection,inverseProjection:this.inverseProjection,maxDistance:this.distance,thickness:this.thickness,nearPlane:this.near,steps:this.steps,frame:this.frame,roughnessCutoff:this.cutoff});
  const resolved=property('vec4'),surface=property('vec4'),metricDepth=property('float');
  this.filterMaterial.contextNode=context(shared);
  this.filterMaterial.colorNode=Fn(()=>{
   const coords=uv(),d=this.depth.sample(coords).r,nr=this.normal.sample(coords);
   const p=getViewPosition(coords,d,this.inverseProjection);
   resolved.assign(vec4(0));surface.assign(nr);metricDepth.assign(p.z.negate());
   If(d.lessThan(1).and(nr.a.lessThan(this.cutoff)),()=>{
    const sum=vec4(0).toVar(),total=float(0).toVar(),upper=vec3(0).toVar();
    for(let y=-1;y<=1;y++)for(let x=-1;x<=1;x++){
     const q=coords.add(vec2(x,y).div(this.size)),neighbor=this.normal.sample(q),qd=this.depth.sample(q).r;
     const point=getViewPosition(q,qd,this.inverseProjection);
     const plane=abs(dot(point.sub(p),nr.rgb)).div(max(.01,p.z.abs().mul(.005)));
     const weight=exp(plane.negate()).mul(pow(max(dot(nr.rgb,neighbor.rgb),0),64)).mul(exp(abs(nr.a.sub(neighbor.a)).mul(-32))).mul(qd.lessThan(1)).mul((x||y)?.5:1);
     const value=this.current.sample(q);
     sum.addAssign(value.mul(weight));total.addAssign(weight);upper.assign(max(upper,value.rgb));
    }
    resolved.assign(sum.div(total.max(.00001)));
    const oldNormal=this.oldNormal.sample(coords),oldDepth=this.oldDepth.sample(coords).r;
    const agrees=abs(oldDepth.sub(p.z.negate())).lessThan(max(.01,p.z.abs().mul(.002))).and(dot(nr.rgb,oldNormal.rgb).greaterThan(.95)).and(abs(nr.a.sub(oldNormal.a)).lessThan(.03));
    If(this.valid.and(agrees),()=>{
     const old=this.oldColor.sample(coords);
     resolved.assign(mix(resolved,vec4(old.rgb.clamp(0,upper),old.a),this.historyWeight));
    });
   });
   return vec4(0);
  })();
  this.filterMaterial.outputNode=outputStruct(resolved,surface,metricDepth);
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
   if(!this.camera.matrixWorld.equals(this.previousCamera)||!this.camera.projectionMatrix.equals(this.previousProjection))this.reset('camera');
   this.near.value=this.camera.near;this.frame.value=this.frames;
   this.radiance.setSize(this.source.renderTarget.width,this.source.renderTarget.height);
   renderer.setRenderTarget(this.radiance);this.radianceQuad.render(renderer);this.radianceFrames++;
   renderer.setRenderTarget(this.raw);this.traceQuad.render(renderer);
   const target=this.targets[this.writeIndex];renderer.setRenderTarget(target);this.filterQuad.render(renderer);
   this.result.value=target.textures[0];this.surface.value=target.textures[1];this.surfaceDepth.value=target.textures[2];
   this.oldColor.value=target.textures[0];this.oldNormal.value=target.textures[1];this.oldDepth.value=target.textures[2];
   this.writeIndex=1-this.writeIndex;this.valid.value=true;this.frames++;
   this.previousCamera.copy(this.camera.matrixWorld);this.previousProjection.copy(this.camera.projectionMatrix);
  }finally{RendererUtils.restoreRendererState(renderer,state);}
 }
 dispose(){super.dispose();this.releaseLighting();this.radiance.dispose();this.radianceMaterial.dispose();this.raw.dispose();for(const t of this.targets)t.dispose();this.traceMaterial.dispose();this.filterMaterial.dispose();}
}
