import {TSL, HalfFloatType, RGBFormat, UnsignedInt101111Type, NearestFilter, DataUtils} from './lib/three.webgpu.js';
const {Fn,context,mrt,vec3,vec4,float,uniform,property,screenUV,positionView,normalView,positionViewDirection,
  roughness,If,abs,max,dot,getViewPosition}=TSL;

export function supportsShadingReuse(material){
  return !!(material.isMeshStandardNodeMaterial||material.isMeshPhysicalNodeMaterial||material.isMeshStandardMaterial||material.isMeshPhysicalMaterial)
    && !material.transparent && !(material.transmission>0) && !material.transmissionNode
    && !(material.clearcoat>0) && !material.clearcoatNode && !(material.sheen>0) && !material.sheenNode
    && !material.backdropNode && !material.fragmentNode && !material.outputNode && !material.alphaToCoverage;
}

// Material AO affects diffuse linearly and specular by Three's existing law.
// Numeric counterpart is used by the deterministic contract, not GPU rendering.
export function specularVisibility(ao,nv,r){return Math.max(0,Math.min(1,ao+Math.pow(nv+ao,2**(-1-16*r))-1));}
export function applyCachedLighting({base,diffuse,specular,materialAO,nv,roughness:r,sceneAO}){
  const d=materialAO*(sceneAO-1),s=specularVisibility(materialAO*sceneAO,nv,r)-specularVisibility(materialAO,nv,r);
  return base.map((v,i)=>v+diffuse[i]*d+specular[i]*s);
}

export default class SceneShadingCache {
  constructor(source,camera,{enabled=true}={}){
    Object.assign(this,{source,camera});this.enabled=uniform(enabled,'bool');this.debugHits=uniform(false,'bool');this.keys=new WeakMap();this.nextKey=1024;
    // Use exactly representable, finite half-float keys. Zero means no cache.
    this.objectKey=uniform(0).onObjectUpdate(({object,material})=>{
      let materials=this.keys.get(object);if(!materials){materials=new WeakMap();this.keys.set(object,materials);}
      let key=materials.get(material);if(key===undefined){key=this.nextKey<31744?DataUtils.fromHalfFloat(this.nextKey++):0;materials.set(material,key);}return key;
    });
    this.light=property('vec3','cachedSurfaceLight');this.diffuse=property('vec3','cachedIndirectDiffuse');this.specular=property('vec3','cachedIndirectSpecular');
    const eligible=builder=>supportsShadingReuse(builder.material)&&!builder.object?.isQuadMesh;
    source.contextNode=context({
      capturePhysicalIndirect:(builder)=>{if(eligible(builder)){this.diffuse.assign(builder.context.reflectedLight.indirectDiffuse);this.specular.assign(builder.context.reflectedLight.indirectSpecular);}},
      getOutgoingLight:(node,builder)=>eligible(builder)?Fn(()=>{this.light.assign(node);return this.light;})():node,
    });
    const captured=(node,alpha)=>Fn(([],builder)=>eligible(builder)?vec4(node,alpha):vec4(0))();
    source.setMRT(mrt({...source.getMRT().outputNodes,
      surfaceLight:captured(this.light,this.objectKey),
      surfaceIndirectDiffuse:captured(this.diffuse,1),surfaceIndirectSpecular:captured(this.specular,1)}));
    this.base=source.getTextureNode('surfaceLight');this.d=source.getTextureNode('surfaceIndirectDiffuse');this.s=source.getTextureNode('surfaceIndirectSpecular');
    this.base.value.type=HalfFloatType;
    for(const node of [this.d,this.s]){node.value.format=RGBFormat;node.value.type=UnsignedInt101111Type;}
    for(const node of [this.base,this.d,this.s]){node.value.minFilter=node.value.magFilter=NearestFilter;node.value.generateMipmaps=false;}
  }
  receiverContext(sceneAO,surfaceLighting){
    const self=this;
    return {
      getAO(input,builder){
        if(builder.material.transparent===true)return input;
        builder.context.unoccludedMaterialAO=input??float(1);
        return (input??float(1)).mul(sceneAO);
      },
      getOutgoingLight(node,builder){
        if(!supportsShadingReuse(builder.material)||builder.object?.isQuadMesh||builder.camera!==self.camera||builder.renderer.logarithmicDepthBuffer)return node;
        const baseAO=builder.context.unoccludedMaterialAO??float(1);
        const depth=self.source.getTextureNode('depth'),normal=self.source.getTextureNode('normal');
        const projection=uniform(self.camera.projectionMatrixInverse);
        return Fn(()=>{
          surfaceLighting?.prepareMaterial(builder.material);
          const cached=self.base.sample(screenUV).toVar();
          const view=getViewPosition(screenUV,depth.sample(screenUV).r,projection);
          const n=normalView.dot(positionViewDirection).lessThan(0).select(normalView.negate(),normalView);
          const match=self.enabled.and(self.objectKey.greaterThan(0)).and(cached.a.equal(self.objectKey))
            .and(abs(view.z.sub(positionView.z)).lessThanEqual(max(.0001,abs(positionView.z).mul(.00001))))
            .and(dot(normal.sample(screenUV).rgb,n).greaterThan(.999));
          const result=vec3(0).toVar();
          If(match,()=>{
            const nv=normalView.dot(positionViewDirection).clamp();
            const specAO=a=>a.add(nv.add(a).pow(roughness.mul(-16).sub(1).exp2())).sub(1).clamp();
            result.assign(cached.rgb.add(self.d.sample(screenUV).rgb.mul(baseAO).mul(sceneAO.sub(1)))
              .add(self.s.sample(screenUV).rgb.mul(specAO(baseAO.mul(sceneAO)).sub(specAO(baseAO)))));
          }).Else(()=>{result.assign(node);});
          return self.debugHits.select(vec3(match),result);
        })();
      },
    };
  }
  state(){return {enabled:this.enabled.value,route:'current-frame-material-light-reuse',retainedBytesPerPixel:16,
    rasterPasses:2,unsupported:'transparent, transmission, clearcoat, sheen, backdrop, custom fragment/output, alpha-to-coverage',keysAllocated:this.nextKey-1024};}
}
