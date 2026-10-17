import {Node,RenderTarget,NodeMaterial,QuadMesh,HalfFloatType,Vector2,RendererUtils,TSL} from './lib/three.webgpu.js';
import {denoise} from './lib/addons/tsl/display/DenoiseNode.js';
const {Fn,NodeUpdateType,passTexture,context,uv,vec2,vec3,vec4,float,int,If,Loop,property,getViewPosition,dot,max,pow,abs,luminance,textureSize,sin,cos,mat2,PI,outputStruct}=TSL;

// Two independently weighted fields, one geometry neighborhood. The bundled
// denoiser supplies its kernel/noise/uniforms so sampling remains version-local.
export default class SceneLightingFilter extends Node {
  static get type(){return 'SceneLightingFilter';}
  constructor(ao,gi,depth,normal,camera){
    super('vec4');Object.assign(this,{ao,gi,depth,normal,camera});
    this.updateBeforeType=NodeUpdateType.FRAME;this.resolutionScale=1;this.frames=0;
    this.reference=denoise(gi,depth,normal,camera);
    for(const key of ['radius','depthPhi','normalPhi','lumaPhi','index'])this[key]=this.reference[key];
    this.target=new RenderTarget(1,1,{count:2,depthBuffer:false});
    for(const [i,map]of this.target.textures.entries()){map.type=HalfFloatType;map.name=i?'Filtered indirect irradiance':'Filtered visibility';map.generateMipmaps=false;}
    this.aoNode=passTexture(this,this.target.textures[0]);this.giNode=passTexture(this,this.target.textures[1]);
    this.material=new NodeMaterial();this.material.name='Shared AO and GI filter';this.quad=new QuadMesh(this.material);
  }
  getAONode(){return this.aoNode;}
  getGINode(){return this.giNode;}
  updateBefore(frame){
    frame.updateBeforeNode(this.gi.passNode);
    const {renderer}=frame,state=RendererUtils.resetRendererState(renderer);
    try{
      const size=renderer.getDrawingBufferSize(new Vector2());
      this.target.setSize(Math.max(1,Math.round(size.x*this.resolutionScale)),Math.max(1,Math.round(size.y*this.resolutionScale)));
      this.reference.updateBefore();renderer.setRenderTarget(this.target);this.quad.render(renderer);this.frames++;
    }finally{RendererUtils.restoreRendererState(renderer,state);}
  }
  setup(builder){
    this.ao.build(builder);this.gi.build(builder);
    const a=property('vec4'),g=property('vec4'),r=this.reference;
    const filter=Fn(()=>{
      const coords=uv(),depth=this.depth.sample(coords).r.toVar(),normal=this.normal.sample(coords).rgb.normalize().toVar();
      const centerAO=this.ao.sample(coords).toVar(),centerGI=this.gi.sample(coords).toVar();
      a.assign(centerAO);g.assign(centerGI);
      If(depth.lessThan(1).and(dot(normal,normal).notEqual(0)),()=>{
        const view=getViewPosition(coords,depth,r._cameraProjectionMatrixInverse).toVar();
        const noiseUV=vec2(coords.x,coords.y.oneMinus()).mul(r._resolution.div(textureSize(r.noiseNode,0)));
        const noise=r.noiseNode.sample(noiseUV).toVar();
        // Retain this Three version's rotation convention, including its basis.
        const angle=noise.element(this.index.mod(4).mul(2).mul(PI));
        const x=sin(angle),y=cos(angle),rotation=mat2(x,y.negate(),x,y);
        const sumAO=centerAO.rgb.toVar(),sumGI=centerGI.rgb.toVar();
        const weightAO=float(1).toVar(),weightGI=float(1).toVar();
        Loop({start:int(0),end:int(16),type:'int',condition:'<'},({i})=>{
          const direction=r._sampleVectors.element(i);
          const offset=rotation.mul(direction.xy.mul(float(1).add(direction.z.mul(this.radius.sub(1))))).div(r._resolution);
          const q=coords.add(offset),d=this.depth.sample(q).r.toVar(),n=this.normal.sample(q).rgb.normalize().toVar();
          const p=getViewPosition(q,d,r._cameraProjectionMatrixInverse).toVar();
          const geometry=max(float(1).sub(abs(dot(view.sub(p),normal)).div(this.depthPhi)),0)
            .mul(pow(max(dot(normal,n),0),this.normalPhi)).toVar();
          const neighborAO=this.ao.sample(q).rgb.toVar(),neighborGI=this.gi.sample(q).rgb.toVar();
          const wa=geometry.mul(max(float(1).sub(abs(luminance(neighborAO).sub(luminance(centerAO.rgb))).div(this.lumaPhi)),0)).toVar();
          const wg=geometry.mul(max(float(1).sub(abs(luminance(neighborGI).sub(luminance(centerGI.rgb))).div(this.lumaPhi)),0)).toVar();
          sumAO.addAssign(neighborAO.mul(wa));weightAO.addAssign(wa);
          sumGI.addAssign(neighborGI.mul(wg));weightGI.addAssign(wg);
        });
        a.assign(vec4(sumAO.div(weightAO),centerAO.a));g.assign(vec4(sumGI.div(weightGI),centerGI.a));
      });
      return vec4(0);
    });
    this.material.contextNode=context(builder.getSharedContext());
    this.material.colorNode=filter();this.material.outputNode=outputStruct(a,g);this.material.needsUpdate=true;
    return this.aoNode;
  }
  dispose(){super.dispose();this.target.dispose();this.material.dispose();this.reference.noiseNode.value.dispose();}
}
