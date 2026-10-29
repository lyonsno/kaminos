import BloomNode from './lib/addons/tsl/display/BloomNode.js';
import {Fn,float,vec4} from './lib/three.tsl.js';
// Reuse the existing five Gaussian scales and dispatches. Width advances from
// no halo through the finest scale, then blends adjacent progressively broader
// scales. Unlike the stock mixture, it never retains a broad tail at width zero.
export class SceneBloomNode extends BloomNode {
 setup(builder){
  const result=super.setup(builder);
  const scales=[this._textureNodeBlur0,this._textureNodeBlur1,this._textureNodeBlur2,this._textureNodeBlur3,this._textureNodeBlur4];
  this._compositeMaterial.fragmentNode=Fn(()=>{
   const width=this.radius.mul(5),sum=vec4(0).toVar();
   for(let i=0;i<scales.length;i++)sum.addAssign(scales[i].mul(float(1).sub(width.sub(i+1).abs()).max(0)));
   return sum.mul(this.strength);
  })().context(builder.getSharedContext());
  this._compositeMaterial.needsUpdate=true;return result;
 }
}
export const bloom=(input,strength,radius,threshold)=>new SceneBloomNode(input,strength,radius,threshold);
