import {RenderTarget,NodeMaterial,QuadMesh,FloatType,RedFormat,NearestFilter,TSL} from './lib/three.webgpu.js';
const {Fn,texture,uv,vec2,vec4,float,max,sqrt,dot}=TSL;

// Reduce the estimated standard error of the running mean on the GPU. Only
// one float crosses to the CPU; no synchronous wait or full-frame readback.
export default class GIConvergence {
  constructor(mean,ao,variance,gain,tolerance) {
    Object.assign(this,{mean,ao,variance,gain,tolerance});this.levels=[];this.size='';
  }
  resize(width,height) {
    if(this.size===`${width}x${height}`)return;
    this.dispose();this.size=`${width}x${height}`;
    let input=null,w=width,h=height;
    do {
      const sw=w,sh=h;w=Math.ceil(w/2);h=Math.ceil(h/2);
      const target=new RenderTarget(w,h,{depthBuffer:false,type:FloatType,format:RedFormat,minFilter:NearestFilter,magFilter:NearestFilter});
      target.texture.generateMipmaps=false;
      const material=new NodeMaterial();material.name='GI refinement error reduction';
      const previous=input,dw=w,dh=h;
      material.colorNode=Fn(()=>{
        const pixel=uv().mul(vec2(dw,dh)).floor().mul(2);
        const result=float(0).toVar();
        for(let y=0;y<2;y++)for(let x=0;x<2;x++){
          const q=pixel.add(vec2(x,y)).add(.5).div(vec2(sw,sh));
          let error;
          if(previous)error=previous.sample(q).r;
          else {
            const mean=this.mean.sample(q),ao=this.ao.sample(q).r,n=mean.a;
            const value=vec4(mean.rgb.mul(this.gain),ao);
            const se=sqrt(this.variance.sample(q).r.max(0).div(n.mul(n.sub(1)).max(1)));
            error=n.greaterThanEqual(64).select(se.div(this.tolerance.mul(max(1,sqrt(dot(value,value))))),float(1e6));
            // Background has neither a receiver nor a sample count.
            error=n.equal(0).select(float(0),error);
          }
          result.assign(max(result,error));
        }
        return vec4(result,0,0,1);
      })();
      this.levels.push({target,material,quad:new QuadMesh(material)});input=texture(target.texture);
    } while(w>1||h>1);
  }
  draw(renderer,width,height){
    this.resize(width,height);
    for(const level of this.levels){renderer.setRenderTarget(level.target);level.quad.render(renderer);}
    return this.levels.at(-1).target;
  }
  dispose(){for(const level of this.levels){level.target.dispose();level.material.dispose();}this.levels=[];this.size='';}
}
