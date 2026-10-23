import GIConvergence from './scene-gi-convergence.mjs';
import {Node,RenderTarget,NodeMaterial,QuadMesh,Matrix4,Vector2,HalfFloatType,FloatType,RGBAFormat,RedFormat,NearestFilter,RendererUtils,TSL} from './lib/three.webgpu.js';
const {Fn,NodeUpdateType,uniform,texture,passTexture,uv,vec2,vec3,vec4,float,If,outputStruct,getViewPosition,logarithmicDepthToViewZ,viewZToPerspectiveDepth,min,max,abs,dot,luminance,context,reference,mix,positionWorld,normalView,positionViewDirection}=TSL;

// Reproject estimated diffuse lighting and visibility, leaving current-frame
// geometry and direct lighting untouched. Two alternating MRTs avoid history
// copies and keep each frame's reads distinct from its writes.
export default class SceneGIHistory extends Node {
  static get type(){return 'SceneGIHistory';}
  constructor(ao,gi,depth,normal,camera) {
    super('vec4');
    Object.assign(this,{ao,gi,depth,normal,camera});
    this.updateBeforeType=NodeUpdateType.FRAME;
    this.resolutionScale=1;this.frames=0;this.pendingFrames=0;this.refine=true;this.size=[1,1];this.resetReason='initial';
    this.activity=true;this.stableFrames=0;this.epoch=0;this.converged=false;this.checkPending=false;this.nextCheck=64;this.passingChecks=0;this.lastError=null;this.checkFailure=null;
    this.progressive=uniform(false);this.gain=uniform(5);this.tolerance=uniform(.01);
    this.feedback=uniform(false);
    this.valid=uniform(false);this.weight=uniform(.9);this.resolution=uniform(new Vector2(1,1));
    this.previousView=uniform(new Matrix4());this.previousProjection=uniform(new Matrix4());
    this.currentWorld=uniform(camera.matrixWorld);this.inverseProjection=uniform(camera.projectionMatrixInverse);
    this.targets=Array.from({length:2},()=>{
      const target=new RenderTarget(1,1,{count:4,depthBuffer:false});
      for(const [i,map] of target.textures.entries()) {
        map.type=i===2?HalfFloatType:FloatType;map.format=(i===0||i===3)?RedFormat:RGBAFormat;
        map.minFilter=map.magFilter=NearestFilter;map.generateMipmaps=false;
        map.name=['GI history visibility','GI history irradiance','GI history surface','GI sample variance'][i];
      }
      return target;
    });
    this.writeIndex=1;
    this.outputAO=passTexture(this,this.targets[0].textures[0]);
    this.outputGI=passTexture(this,this.targets[0].textures[1]);
    this.oldAO=texture(this.targets[0].textures[0]);this.oldGI=texture(this.targets[0].textures[1]);
    this.oldSurface=texture(this.targets[0].textures[2]);this.oldVariance=texture(this.targets[0].textures[3]);
    this.convergence=new GIConvergence(this.oldGI,this.oldAO,this.oldVariance,this.gain,this.tolerance,this.feedback);
    this.material=new NodeMaterial();this.material.name='Reproject indirect lighting';
    this.quad=new QuadMesh(this.material);this.quad.name=this.material.name;
  }
  getAONode(){return this.outputAO;}
  getGINode(){return this.outputGI;}
  // Plain texture nodes deliberately avoid scheduling the history producer:
  // source -> estimator -> history must read last frame without a graph cycle.
  // Reprojection checks the source surface itself, including proxy geometry.
  feedbackForSurface(){return Fn(()=>{
    const result=vec3(0).toVar();
    If(this.feedback.and(this.valid),()=>{
      const previous=this.previousView.mul(vec4(positionWorld,1)).toVar();
      const clip=this.previousProjection.mul(previous).toVar();
      const q=vec2(clip.x.div(clip.w).mul(.5).add(.5),float(.5).sub(clip.y.div(clip.w).mul(.5))).toVar();
      const inside=q.x.greaterThanEqual(0).and(q.x.lessThanEqual(1)).and(q.y.greaterThanEqual(0)).and(q.y.lessThanEqual(1));
      If(clip.w.greaterThan(0).and(inside),()=>{
        const surface=this.oldSurface.sample(q).toVar();
        const n=normalView.dot(positionViewDirection).lessThan(0).select(normalView.negate(),normalView);
        const worldNormal=this.currentWorld.mul(vec4(n,0)).xyz.normalize();
        const expected=previous.z.negate();
        const match=abs(surface.a.sub(expected)).lessThanEqual(max(.01,expected.mul(.002)))
          .and(dot(surface.rgb,worldNormal).greaterThan(.9));
        If(match,()=>{result.assign(this.oldGI.sample(q).rgb.max(0));});
      });
    });
    return result;
  })();}
  requestFrames(){
    // A host activity signal invalidates stationary refinement, while moving
    // frames may still reproject the responsive history.
    this.activity=true;this.stableFrames=0;this.converged=false;this.nextCheck=64;
    this.pendingFrames=this.weight.value===0?1:1+Math.ceil(Math.log(.01)/Math.log(this.weight.value));
    this.passingChecks=0;this.lastError=null;this.checkFailure=null;this.epoch++;
    this.convergence.invalidateCheckpoint();
  }
  needsFrame(){return this.refine?!this.converged&&!this.checkFailure:this.pendingFrames>0;}
  reset(reason='explicit'){this.valid.value=false;this.resetReason=reason;this.requestFrames();}
  state(){return {stableFrames:this.stableFrames,converged:this.converged,checkPending:this.checkPending,
    estimatedRelativeError:this.lastError===null?null:this.lastError*this.tolerance.value,
    tolerance:this.tolerance.value,passingChecks:this.passingChecks,checkFailure:this.checkFailure,
    feedback:this.feedback.value,refine:this.refine,pendingFrames:this.refine?null:this.pendingFrames,mode:this.progressive.value?'progressive':'responsive'};}
  renderFrame(renderer,width,height) {
    if(width!==this.size[0]||height!==this.size[1]) {
      for(const target of this.targets)target.setSize(width,height);
      this.size=[width,height];this.resolution.value.set(width,height);this.reset('resize');
    }
    this.progressive.value=this.refine&&!this.activity;
    this.stableFrames=this.activity?0:this.stableFrames+1;this.activity=false;
    const target=this.targets[this.writeIndex];
    renderer.setRenderTarget(target);
    this.quad.render(renderer);
    // Publish only a completed render. Texture samples retain references to
    // these nodes, so cached receiving/filter graphs follow each target swap.
    this.outputAO.value=target.textures[0];this.outputGI.value=target.textures[1];
    this.oldAO.value=target.textures[0];this.oldGI.value=target.textures[1];this.oldSurface.value=target.textures[2];this.oldVariance.value=target.textures[3];
    this.previousView.value.copy(this.camera.matrixWorldInverse);
    this.previousProjection.value.copy(this.camera.projectionMatrix);
    this.writeIndex=1-this.writeIndex;this.valid.value=true;this.frames++;this.pendingFrames=Math.max(0,this.pendingFrames-1);
    if(this.progressive.value&&!this.checkPending&&this.stableFrames>=this.nextCheck){
      const epoch=this.epoch;
      const reduced=this.convergence.draw(renderer,width,height);
      this.checkPending=true;this.nextCheck=this.stableFrames*2;
      renderer.readRenderTargetPixelsAsync(reduced,0,0,1,1).then(data=>{
        if(epoch!==this.epoch)return;
        const error=data[0];
        if(!Number.isFinite(error))throw Error('Non-finite GI refinement error');
        this.lastError=error;this.passingChecks=error<=1?this.passingChecks+1:0;
        this.converged=this.passingChecks>=2;
      }).catch(error=>{if(epoch===this.epoch)this.checkFailure=String(error);})
        .finally(()=>{this.checkPending=false;});
    }
  }
  updateBefore(frame) {
    const {renderer}=frame;
    frame.updateBeforeNode(this.gi.passNode);
    const state=RendererUtils.resetRendererState(renderer);
    try {
      const size=renderer.getDrawingBufferSize(new Vector2());
      this.renderFrame(renderer,Math.max(1,Math.round(size.x*this.resolutionScale)),Math.max(1,Math.round(size.y*this.resolutionScale)));
    } finally {RendererUtils.restoreRendererState(renderer,state);}
  }
  setup(builder) {
    this.ao.build(builder);this.gi.build(builder);
    const visibility=TSL.property('float'),irradiance=TSL.property('vec3'),surface=TSL.property('vec4'),sampleCount=TSL.property('float'),variance=TSL.property('float');
    const resolve=Fn(()=>{
      const coords=uv();surface.assign(vec4(0));sampleCount.assign(0);variance.assign(0);
      let depth=this.depth.sample(coords).r;
      if(builder.renderer.logarithmicDepthBuffer===true) {
        const z=logarithmicDepthToViewZ(depth,reference('near','float',this.camera),reference('far','float',this.camera));
        depth=viewZToPerspectiveDepth(z,reference('near','float',this.camera),reference('far','float',this.camera));
      }
      visibility.assign(this.ao.sample(coords).r);irradiance.assign(this.gi.sample(coords).rgb);
      If(depth.lessThan(1),()=>{
        sampleCount.assign(this.progressive.select(float(1),float(0)));
        const view=getViewPosition(coords,depth,this.inverseProjection).toVar();
        const world=this.currentWorld.mul(vec4(view,1)).toVar();
        const worldNormal=this.currentWorld.mul(vec4(this.normal.sample(coords).rgb,0)).xyz.normalize().toVar();
        surface.assign(vec4(worldNormal,view.z.negate()));
        const previousView=this.previousView.mul(world).toVar();
        const clip=this.previousProjection.mul(previousView).toVar();
        const priorUV=vec2(clip.x.div(clip.w).mul(.5).add(.5),float(.5).sub(clip.y.div(clip.w).mul(.5))).toVar();
        const inside=priorUV.x.greaterThanEqual(0).and(priorUV.x.lessThanEqual(1)).and(priorUV.y.greaterThanEqual(0)).and(priorUV.y.lessThanEqual(1));
        If(this.valid.and(clip.w.greaterThan(0)).and(inside),()=>{
          const metadata=this.oldSurface.sample(priorUV).toVar();
          const expectedDepth=previousView.z.negate();
          const depthAgrees=abs(metadata.a.sub(expectedDepth)).lessThanEqual(max(.01,expectedDepth.mul(.002)));
          const normalAgrees=dot(metadata.rgb,worldNormal).greaterThan(.9);
          If(depthAgrees.and(normalAgrees),()=>{
            If(this.progressive.and(this.oldGI.sample(priorUV).a.greaterThan(0)),()=>{
              const prior=this.oldGI.sample(priorUV).toVar();
              const oldAO=this.oldAO.sample(priorUV).r.toVar();
              sampleCount.assign(prior.a.add(1));
              const delta=vec4(irradiance.sub(prior.rgb).mul(this.gain),visibility.sub(oldAO)).toVar();
              irradiance.assign(prior.rgb.add(irradiance.sub(prior.rgb).div(sampleCount)));
              visibility.assign(oldAO.add(visibility.sub(oldAO).div(sampleCount)));
              variance.assign(this.oldVariance.sample(priorUV).r.add(dot(delta,delta).mul(prior.a.div(sampleCount))));
            }).ElseIf(this.progressive.not(),()=>{
            const lowerGI=irradiance.toVar(),upperGI=irradiance.toVar();
            const lowerAO=visibility.toVar(),upperAO=visibility.toVar();
            // Current-frame neighborhood bounds reject vanished illumination
            // and newly exposed surfaces rather than retaining stale radiance.
            for(let y=-1;y<=1;y++)for(let x=-1;x<=1;x++)if(x||y) {
              const q=coords.add(vec2(x,y).div(this.resolution));
              const color=this.gi.sample(q).rgb,ao=this.ao.sample(q).r;
              lowerGI.assign(min(lowerGI,color));upperGI.assign(max(upperGI,color));
              lowerAO.assign(min(lowerAO,ao));upperAO.assign(max(upperAO,ao));
            }
            const oldColor=this.oldGI.sample(priorUV).rgb.clamp(lowerGI,upperGI).toVar();
            const oldVisibility=this.oldAO.sample(priorUV).r.clamp(lowerAO,upperAO);
            const change=abs(luminance(oldColor).sub(luminance(irradiance))).div(max(.01,luminance(irradiance)));
            const blend=this.weight.div(float(1).add(change.mul(4)));
            irradiance.assign(mix(irradiance,oldColor,blend));
            visibility.assign(mix(visibility,oldVisibility,this.weight));
            });
          });
        });
      });
      return vec4(0);
    });
    this.material.contextNode=context(builder.getSharedContext());
    this.material.colorNode=resolve();this.material.outputNode=outputStruct(visibility,vec4(irradiance,sampleCount),surface,variance);
    this.material.needsUpdate=true;
    return this.outputAO;
  }
  dispose(){this.epoch++;this.convergence.dispose();super.dispose();for(const t of this.targets)t.dispose();this.material.dispose();}
}
