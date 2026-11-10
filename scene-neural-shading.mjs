import {TSL,Vector2,DataUtils,NearestFilter} from './lib/three.webgpu.js';
const {Fn,pass,mrt,context,vec2,vec3,vec4,float,uniform,screenUV,positionView,normalView,positionViewDirection,getViewPosition,textureSize,textureLoad,ivec2,If,abs,max,dot,bool}=TSL;
import {checkedNeuralResolution} from './neural-resolution-settings.mjs';

// This cache contains current-frame directional radiance. Learned appearance
// mips retain the footprint of the full-resolution receiving surface.
export default class SceneNeuralShading {
 constructor(source,scene,camera){
  this.source=source;this.camera=camera;this.scale=uniform(1);this.reuse=uniform(true,'bool');
  this.projectionInverse=uniform(camera.projectionMatrixInverse);
  this.footprint=uniform(new Vector2(1,1));this.frames=0;this.materials=new Map();this.keys=new Map();this.freeKeys=[];this.nextKey=0x8400;this.uncacheableMaterials=0;this.scheduled=new WeakSet();
  this.radianceNode=Fn(([],builder)=>builder.material?.isNeumipMaterial?vec4((builder.material.lightsNode??builder.lightsNode).totalDiffuseNode.max(0),this.materialKey(builder.material)):vec4(0))();
  const capture=pass(scene,camera,{samples:0});this.capture=capture;
  capture.name='Neural material shading';capture.transparent=false;
  capture.contextNode=context({sceneReflectionLighting:null,sceneNeuralShading:this,neuralShadingMode:'capture',neuralFootprintScale:this.footprint});
  const visible=normalView.dot(positionViewDirection).lessThan(0).select(normalView.negate(),normalView);
  // Private cache output alpha and neural transport alpha carry an exact
  // normal negative half-float key; ordinary transport alpha stays nonnegative.
  capture.setMRT(mrt({output:this.radianceNode,normal:vec4(visible,1)}));
  for(const name of ['output','normal','depth']){
   const texture=capture.getTexture(name);texture.minFilter=texture.magFilter=NearestFilter;
  }
  capture.borrowMaterials=renderer=>this.borrowMaterials(renderer);
  capture.compileCallDepth=renderer=>source._renderCallDepths?.get(renderer)??2;
  const resize=capture.setSize;
  capture.setSize=(width,height)=>{
   resize.call(capture,width,height);
   if(capture.renderTarget.width<1||capture.renderTarget.height<1)capture.renderTarget.setSize(Math.max(1,capture.renderTarget.width),Math.max(1,capture.renderTarget.height));
   this.footprint.value.set(capture.renderTarget.width/width,capture.renderTarget.height/height);
  };
  const update=capture.updateBefore;
  capture.updateBefore=frame=>{
   if(this.scale.value===1)return;
   let active=false;scene.traverseVisible(o=>{if(o.isMesh&&[].concat(o.material??[]).some(m=>m.isNeumipMaterial))active=true;});
   if(!active)return;
   const restore=this.borrowMaterials(frame.renderer);
   try{update.call(capture,frame);this.frames++;}finally{restore();}
  };
 }
 materialKey(material){
  if(this.keys.has(material))return this.keys.get(material).value;
  const bits=this.freeKeys.pop()??this.nextKey++,value=bits<0xfc00?DataUtils.fromHalfFloat(bits):0;
  if(!value){this.uncacheableMaterials++;console.warn('Neural cache material-key space exhausted; this material retains direct evaluation');}
  const release=()=>{this.keys.delete(material);material.removeEventListener('dispose',release);if(value)this.freeKeys.push(bits);else this.uncacheableMaterials--;};
  this.keys.set(material,{value,release});material.addEventListener('dispose',release);return value;
 }
 hasMaterials(){let found=false;this.capture.scene.traverse(o=>{if(o.isMesh&&[].concat(o.material??[]).some(m=>m.isNeumipMaterial&&!m.transparent))found=true;});return found;}
 prepareBefore(target){
  if(this.scheduled.has(target))return;this.scheduled.add(target);
  const setup=target.setup,cache=this;
  target.setup=function(builder){cache.capture.getTextureNode('output').build(builder);return setup.call(this,builder);};
 }
 occluder(material,renderer){
  if(material.isNeumipMaterial||material.lights===false||material.fragmentNode!=null)return material;
  let entry=this.materials.get(material);
  if(!entry||entry.version!==material.version){
   const node=material.isNodeMaterial?material:renderer.library.fromMaterial(material);if(!node)return material;
   if(entry){material.removeEventListener('dispose',entry.release);entry.material.dispose();}
   const copy=node.clone();copy.setupLighting=()=>vec3(0);
   const release=()=>{copy.dispose();this.materials.delete(material);};
   entry={version:material.version,material:copy,release};this.materials.set(material,entry);material.addEventListener('dispose',release);
  }
  for(const key of ['opacity','alphaTest','displacementScale','displacementBias'])entry.material[key]=material[key];
  return entry.material;
 }
 borrowMaterials(renderer){
  const saved=[];
  const restore=()=>{for(const [object,material] of saved)object.material=material;};
  try{this.capture.scene.traverseVisible(object=>{
   if(!object.isMesh||!object.material)return;
   const original=object.material,mapped=[].concat(original).map(m=>this.occluder(m,renderer));
   if(mapped.some((m,i)=>m!==[].concat(original)[i])){saved.push([object,original]);object.material=Array.isArray(original)?mapped:mapped[0];}
  });}catch(error){restore();throw error;}
  return restore;
 }
 setScale(value){this.scale.value=checkedNeuralResolution(value);this.capture.setResolutionScale(value);}
 state(){return {requestedScale:this.scale.value,nominalNeuralPixelFraction:this.scale.value**2,frames:this.frames,
  resolution:[this.capture.renderTarget.width,this.capture.renderTarget.height],reuseSource:this.reuse.value,
  reconstruction:'current-frame depth/normal/material-aware bilinear',geometryScale:1,
  additionalGeometryPasses:this.scale.value<1?1:0,uncacheableMaterials:this.uncacheableMaterials,fallback:'direct neural evaluation where no compatible sample exists; nominal fraction excludes fallback work',
  footprint:'full-resolution receiving pixels; independently learned mips'};}
 resolveLighting(builder,material){
  const mode=builder.context.neuralShadingMode;
  if(builder.camera!==this.camera||!['source','beauty','standalone'].includes(mode)||material.transparent||builder.renderer.logarithmicDepthBuffer===true)return null;
  // Three shares normal/view properties across the lighting graph. Their first
  // initialization must precede cache branches, including the full-rate path.
  normalView.toVar('neuralReceiverNormal').append();
  positionViewDirection.toVar('neuralReceiverView').append();
  const key=this.materialKey(material);if(key===0)return null;
  const cached=vec3(0).toVar('neuralCachedRadiance'),valid=bool(false).toVar('neuralCacheValid');
  if(mode==='beauty'){
   const color=this.source.getTextureNode('transport'),depth=this.source.getTextureNode('depth'),normal=this.source.getTextureNode('normal');
   const coord=ivec2(screenUV.mul(vec2(textureSize(color)))),sample=textureLoad(color,coord);
   const d=textureLoad(depth,coord).r,p=getViewPosition(screenUV,d,this.projectionInverse);
   // A fixed world-space epsilon rejects valid far pixels when the scene's
   // near plane is small. Allow two neighboring 24/32-bit depth intervals.
   const adjacent=getViewPosition(screenUV,d.add(1/16777216),this.projectionInverse);
   const depthTolerance=max(.0001,abs(adjacent.z.sub(p.z)).mul(2));
   const n=normalView.dot(positionViewDirection).lessThan(0).select(normalView.negate(),normalView).normalize();
   cached.assign(sample.rgb);
   valid.assign(this.reuse.and(sample.a.equal(key)).and(d.lessThan(1))
    .and(abs(p.z.sub(positionView.z)).lessThanEqual(depthTolerance))
    .and(dot(textureLoad(normal,coord).rgb.normalize(),n).greaterThan(.999)));
   return {radiance:cached,valid};
  }
  const capture=this.capture,low=capture.getTextureNode('output'),normal=capture.getTextureNode('normal'),depth=capture.getTextureNode('depth');
   If(this.scale.lessThan(1),()=>{
    const size=vec2(textureSize(low)),q=screenUV.mul(size).sub(.5),base=q.floor(),f=q.fract();
    const sum=vec3(0).toVar(),weight=float(0).toVar();
    const n=normalView.dot(positionViewDirection).lessThan(0).select(normalView.negate(),normalView).normalize();
    for(const [x,y] of [[0,0],[1,0],[0,1],[1,1]]){
     const pixel=base.add(vec2(x,y)).clamp(vec2(0),size.sub(1)),coord=ivec2(pixel),sampleUV=pixel.add(.5).div(size);
     const d=textureLoad(depth,coord).r,source=textureLoad(low,coord);
     const p=getViewPosition(sampleUV,d,this.projectionInverse);
     const planeError=abs(dot(p.sub(positionView),n));
     const tolerance=max(.0001,abs(positionView.z).mul(.0003));
     const compatible=d.lessThan(1).and(source.a.equal(key))
      .and(dot(textureLoad(normal,coord).rgb.normalize(),n).greaterThan(.9)).and(planeError.lessThan(tolerance));
     const w=(x?f.x:f.x.oneMinus()).mul(y?f.y:f.y.oneMinus()).mul(float(compatible));
     sum.addAssign(source.rgb.mul(w));weight.addAssign(w);
    }
    If(weight.greaterThan(.00001),()=>{cached.assign(sum.div(weight));valid.assign(true);});
   });
  return {radiance:cached,valid};
 }

 dispose(){for(const [material,{release}] of this.keys)material.removeEventListener('dispose',release);this.keys.clear();this.capture.dispose();for(const [source,{material,release}] of this.materials){source.removeEventListener('dispose',release);material.dispose();}this.materials.clear();}
}
