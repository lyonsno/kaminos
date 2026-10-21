import {TSL} from './lib/three.webgpu.js';
const {Fn,mrt,vec4,vec3,uniform,screenUV,positionView,normalView,positionViewDirection,getViewPosition,If,abs,max,dot}=TSL;

// The opaque GI source already evaluates these materials. Export their raw
// flame irradiance once, then reuse it only in that camera's receiving pass.
// Other cameras and surfaces retain the producer's original material lighting.
export default class SceneSurfaceLighting {
  constructor(source,camera,{enabled=true}={}){
    this.source=source;this.camera=camera;this.enabled=uniform(enabled,'bool');
    this.bindings=new WeakMap();this.materials=new Set();this.capture=null;
    this.proxyRoots=new Set();this.proxyMaterialAdapter=null;
  }
  registerProxyRoot(root){
    if(this.proxyRoots.has(root))throw Error('Lighting proxy is already registered');
    this.proxyRoots.add(root);
    try{this.proxyMaterialAdapter?.install(root);}catch(error){this.proxyMaterialAdapter?.release(root);this.proxyRoots.delete(root);throw error;}
    return()=>{if(!this.proxyRoots.delete(root))return;this.proxyMaterialAdapter?.release(root);};
  }
  setProxyMaterialAdapter(adapter){
    if(this.proxyMaterialAdapter)throw Error('A proxy material lighting adapter is already mounted');
    this.proxyMaterialAdapter=adapter;
    try{for(const root of this.proxyRoots)adapter.install(root);}catch(error){for(const root of this.proxyRoots)adapter.release(root);this.proxyMaterialAdapter=null;throw error;}
    return()=>{if(this.proxyMaterialAdapter!==adapter)return;for(const root of this.proxyRoots)adapter.release(root);this.proxyMaterialAdapter=null;};
  }
  bind(material,raw,prepare=()=>{}){
    const value=raw.toVar('flameSurfaceIrradiance');
    this.bindings.set(material,{value,prepare});this.materials.add(material);
    if(!this.capture){
      const exported=Fn(([],builder)=>{
        const entry=this.bindings.get(builder.material);
        return entry?vec4(entry.value,1):vec4(0);
      })();
      this.source.setMRT(mrt({...this.source.getMRT().outputNodes,surfaceIrradiance:exported}));
      this.capture=this.source.getTextureNode('surfaceIrradiance');
      this.capture.value.name='surfaceIrradiance';
      // Mounting a flame can happen after the ordinary scene has drawn. Its
      // existing target must rebuild its attachment set before the next draw.
      this.source.renderTarget.dispose();this.source.needsUpdate=true;
    }
    return value;
  }
  unbind(material){this.bindings.delete(material);this.materials.delete(material);}
  forMaterial(builder,material,raw){
    const entry=this.bindings.get(material),node=entry?.value??raw;
    if(builder.context.sceneSurfaceLighting!==this||builder.camera!==this.camera||
      builder.renderer.getRenderTarget()===this.source.renderTarget||builder.renderer.logarithmicDepthBuffer===true||
      material.transparent||material.transmission>0)return node;
    const source=this.source,depth=source.getTextureNode('depth'),normal=source.getTextureNode('normal');
    return Fn(()=>{
      // Screen-aligned shadow derivatives must precede the divergent fallback.
      entry?.prepare();
      const result=vec3(0).toVar();
      const cached=this.capture.sample(screenUV).toVar();
      const d=depth.sample(screenUV).r;
      const p=getViewPosition(screenUV,d,uniform(this.camera.projectionMatrixInverse));
      const n=normalView.dot(positionViewDirection).lessThan(0).select(normalView.negate(),normalView);
      const match=this.enabled.and(cached.a.greaterThan(.5)).and(d.lessThan(1))
        .and(abs(p.z.sub(positionView.z)).lessThanEqual(max(.0001,abs(positionView.z).mul(.00001))))
        .and(dot(normal.sample(screenUV).rgb.normalize(),n.normalize()).greaterThan(.999));
      If(match,()=>result.assign(cached.rgb)).Else(()=>result.assign(node));
      return result;
    })();
  }
  setEnabled(value){this.enabled.value=!!value;}
  state(){return{enabled:this.enabled.value,mounted:!!this.capture,materials:this.materials.size,source:'opaque-GI-source',fallback:'direct-material-evaluation',captureBytesPerPixel:this.capture?8:0};}
}
