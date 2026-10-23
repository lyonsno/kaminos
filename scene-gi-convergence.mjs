import {RenderTarget,NodeMaterial,QuadMesh,FloatType,RedFormat,RGBAFormat,NearestFilter,TSL} from './lib/three.webgpu.js';
const {Fn,texture,uv,vec2,vec4,float,max,sqrt,dot,uniform}=TSL;

// Reduce the estimated standard error of the running mean on the GPU. Only
// one float crosses to the CPU; no synchronous wait or full-frame readback.
export default class GIConvergence {
  constructor(mean,ao,variance,gain,tolerance,feedback=uniform(false)) {
    Object.assign(this,{mean,ao,variance,gain,tolerance,feedback});this.levels=[];this.size='';
    this.checkpoint=null;this.checkpointValid=uniform(false);this.checkpointMaterial=null;
  }
  invalidateCheckpoint(){this.checkpointValid.value=false;}
  resize(width,height) {
    const key=`${width}x${height}:${this.feedback.value}`;
    if(this.size===key)return;
    this.dispose();this.size=key;
    if(this.feedback.value){
      this.checkpoint=new RenderTarget(width,height,{depthBuffer:false,type:FloatType,format:RGBAFormat,minFilter:NearestFilter,magFilter:NearestFilter});
      this.checkpoint.texture.generateMipmaps=false;
      this.checkpointMaterial=new NodeMaterial();this.checkpointMaterial.name='GI transport checkpoint';
      this.checkpointMaterial.colorNode=this.mean.sample(uv());
      this.checkpointQuad=new QuadMesh(this.checkpointMaterial);
    }
    const checkpoint=this.checkpoint?texture(this.checkpoint.texture):null;
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
            if(checkpoint){
              // Progressive feedback estimates a changing lighting solution.
              // Low sampling error alone cannot establish transport settling.
              const delta=mean.rgb.sub(checkpoint.sample(q).rgb).mul(this.gain);
              const drift=sqrt(dot(delta,delta)).div(this.tolerance.mul(max(1,sqrt(dot(value,value)))));
              error=max(error,this.checkpointValid.select(drift,float(1e6)));
            }
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
    if(this.checkpoint){renderer.setRenderTarget(this.checkpoint);this.checkpointQuad.render(renderer);this.checkpointValid.value=true;}
    return this.levels.at(-1).target;
  }
  dispose(){for(const level of this.levels){level.target.dispose();level.material.dispose();}this.levels=[];this.size='';this.checkpoint?.dispose();this.checkpointMaterial?.dispose();this.checkpoint=null;this.checkpointMaterial=null;this.invalidateCheckpoint();}
}
