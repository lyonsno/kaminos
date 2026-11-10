import {TSL,Vector2,FloatType,NearestFilter} from './lib/three.webgpu.js';
const {Fn,pass,mrt,context,vec2,vec3,vec4,float,uniform,screenUV,positionView,normalView,positionViewDirection,getViewPosition,textureSize,textureLoad,ivec2,If,abs,max,dot,bool}=TSL;
import {checkedNeuralResolution} from './neural-resolution-settings.mjs';

// This cache contains current-frame directional radiance. Learned appearance
// mips retain the footprint of the full-resolution receiving surface.
export default class SceneNeuralShading {
 constructor(source,scene,camera){
  this.source=source;this.camera=camera;this.scale=uniform(1);this.reuse=uniform(true,'bool');
  this.footprint=uniform(new Vector2(1,1));this.frames=0;this.materials=new Map();
  this.radianceNode=Fn(([],builder)=>builder.material?.isNeumipMaterial?vec4((builder.material.lightsNode??builder.lightsNode).totalDiffuseNode,1):vec4(0))();
  const capture=pass(scene,camera,{samples:0});this.capture=capture;
  capture.name='Neural material shading';capture.transparent=false;
  capture.contextNode=context({sceneReflectionLighting:null,sceneNeuralShading:this,neuralShadingMode:'capture',neuralFootprintScale:this.footprint});
  const visible=normalView.dot(positionViewDirection).lessThan(0).select(normalView.negate(),normalView);
  // IDs use two exact 16-bit limbs, so adjacent material instances cannot
  // silently alias through half-float attachment rounding.
  const identity=Fn(([],{material})=>material?.isNeumipMaterial?vec4(material.id%65536,Math.floor(material.id/65536),0,1):vec4(0))();
  capture.setMRT(mrt({output:this.radianceNode,normal:vec4(visible,1),identity}));
  capture.getTexture('identity').type=FloatType;
  for(const name of ['output','normal','identity','depth']){
   const texture=capture.getTexture(name);texture.minFilter=texture.magFilter=NearestFilter;
  }
  const resize=capture.setSize;
  capture.setSize=(width,height)=>{
   resize.call(capture,width,height);
   this.footprint.value.set(capture.renderTarget.width/width,capture.renderTarget.height/height);
  };
  const update=capture.updateBefore;
  capture.updateBefore=frame=>{
   if(this.scale.value===1)return;
   let active=false;scene.traverseVisible(o=>{if(o.isMesh&&[].concat(o.material??[]).some(m=>m.isNeumipMaterial))active=true;});
   if(!active)return;
   const renderer=frame.renderer,prior=renderer.getRenderObjectFunction();
   renderer.setRenderObjectFunction((object,scene,camera,geometry,material,group,lights,clipping)=>{
    // Keep authored vertex displacement, alpha cutouts and depth. Ordinary
    // lit surfaces only occlude the neural cache; they need no second lighting.
    let draw=material;
    if(!material.isNeumipMaterial&&material.lights!==false&&material.fragmentNode==null){
     let entry=this.materials.get(material);
     if(!entry||entry.version!==material.version){
      const node=material.isNodeMaterial?material:renderer.library.fromMaterial(material);
      if(node){
       if(entry){material.removeEventListener('dispose',entry.release);entry.material.dispose();}
       const copy=node.clone();copy.setupLighting=()=>vec3(0);
       const release=()=>{copy.dispose();this.materials.delete(material);};
       entry={version:material.version,material:copy,release};this.materials.set(material,entry);material.addEventListener('dispose',release);
      }
     }
     if(entry){
      // Numeric opacity/displacement edits need no program rebuild in Three.
      for(const key of ['opacity','alphaTest','displacementScale','displacementBias'])entry.material[key]=material[key];
      draw=entry.material;
     }
    }
    (prior??renderer.renderObject).call(renderer,object,scene,camera,geometry,draw,group,lights,clipping);
   });
   try{update.call(capture,frame);this.frames++;}finally{renderer.setRenderObjectFunction(prior);}
  };
 }
 setScale(value){this.scale.value=checkedNeuralResolution(value);this.capture.setResolutionScale(value);}
 state(){return {requestedScale:this.scale.value,nominalNeuralPixelFraction:this.scale.value**2,frames:this.frames,
  resolution:[this.capture.renderTarget.width,this.capture.renderTarget.height],reuseSource:this.reuse.value,
  reconstruction:'current-frame depth/normal/material-aware bilinear',geometryScale:1,
  additionalGeometryPasses:this.scale.value<1?1:0,fallback:'direct neural evaluation where no compatible sample exists; nominal fraction excludes fallback work',
  footprint:'full-resolution receiving pixels; independently learned mips'};}
 resolveLighting(builder,material){
  const mode=builder.context.neuralShadingMode;
  if(builder.camera!==this.camera||!['source','beauty','standalone'].includes(mode)||material.transparent||builder.renderer.logarithmicDepthBuffer===true)return null;
  // Three shares normal/view properties across the lighting graph. Their first
  // initialization must precede cache branches, including the full-rate path.
  normalView.toVar('neuralReceiverNormal').append();
  positionViewDirection.toVar('neuralReceiverView').append();
  const capture=this.capture,low=capture.getTextureNode('output'),normal=capture.getTextureNode('normal'),depth=capture.getTextureNode('depth'),identity=capture.getTextureNode('identity');
  const full=this.source.getTextureNode('transport');
  const cached=vec3(0).toVar('neuralCachedRadiance'),valid=bool(false).toVar('neuralCacheValid');
   If(this.scale.lessThan(1),()=>{
    const size=vec2(textureSize(low)),q=screenUV.mul(size).sub(.5),base=q.floor(),f=q.fract();
    const sum=vec3(0).toVar(),weight=float(0).toVar();
    const n=normalView.dot(positionViewDirection).lessThan(0).select(normalView.negate(),normalView).normalize();
    for(const [x,y] of [[0,0],[1,0],[0,1],[1,1]]){
     const pixel=base.add(vec2(x,y)).clamp(vec2(0),size.sub(1)),coord=ivec2(pixel),sampleUV=pixel.add(.5).div(size);
     const d=textureLoad(depth,coord).r,id=textureLoad(identity,coord);
     const p=getViewPosition(sampleUV,d,uniform(this.camera.projectionMatrixInverse));
     const planeError=abs(dot(p.sub(positionView),n));
     const tolerance=max(.0001,abs(positionView.z).mul(.0003));
     const compatible=d.lessThan(1).and(id.a.greaterThan(.5)).and(id.x.equal(material.id%65536)).and(id.y.equal(Math.floor(material.id/65536)))
      .and(dot(textureLoad(normal,coord).rgb.normalize(),n).greaterThan(.9)).and(planeError.lessThan(tolerance));
     const w=(x?f.x:f.x.oneMinus()).mul(y?f.y:f.y.oneMinus()).mul(float(compatible));
     sum.addAssign(textureLoad(low,coord).rgb.mul(w));weight.addAssign(w);
    }
    If(weight.greaterThan(.00001),()=>{cached.assign(sum.div(weight));valid.assign(true);});
   }).Else(()=>{
    if(mode==='beauty'){cached.assign(full.sample(screenUV).rgb);valid.assign(this.reuse);}
   });
  return {radiance:cached,valid};
 }

 dispose(){this.capture.dispose();for(const [source,{material,release}] of this.materials){source.removeEventListener('dispose',release);material.dispose();}this.materials.clear();}
}
