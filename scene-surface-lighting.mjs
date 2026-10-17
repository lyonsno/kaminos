import {TSL} from './lib/three.webgpu.js';
const {Fn,mrt,vec4,vec3,uniform,screenUV,positionView,normalView,positionViewDirection,getViewPosition,If,abs,max,dot}=TSL;

// The opaque GI source already evaluates these materials. Export their raw
// flame irradiance once, then reuse it only in that camera's receiving pass.
// Other cameras and surfaces retain the producer's original material lighting.
export default class SceneSurfaceLighting {
  constructor(source,camera,{enabled=true}={}){
    this.source=source;this.camera=camera;this.enabled=uniform(enabled,'bool');
    this.bindings=new WeakMap();this.materials=new Set();this.capture=null;
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
    if(builder.context.sceneSurfaceLighting!==this||material.transparent||material.transmission>0)return node;
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
