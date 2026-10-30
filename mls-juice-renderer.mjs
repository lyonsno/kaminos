import {
  DEFAULT_TRANSMISSION_MIN_CONTRIBUTION,
  normalizeTransmissionMinContribution,
} from './local-liquid-optical-query.mjs';

const cameraStruct=`struct Camera{view:mat4x4f,projection:mat4x4f,inverseProjection:mat4x4f,inverseView:mat4x4f,domain:vec4f,params:vec4f,optics:vec4f}
@group(0) @binding(0) var<uniform> camera:Camera;`;
const quad=`@vertex fn quad(@builtin(vertex_index) id:u32)->@builtin(position) vec4f{
  let corners=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));return vec4f(corners[id],0,1);
}`;
const particleCode=cameraStruct+`
struct Particle{position:vec3f,life:f32,v:vec3f,C:mat3x3f}
@group(0) @binding(1) var<storage,read> particles:array<Particle>;
struct Billboard{@builtin(position) position:vec4f,@location(0) uv:vec2f,@location(1) center:vec3f}
@vertex fn particle(@builtin(vertex_index) vertex:u32,@builtin(instance_index) instance:u32)->Billboard{
  let corners=array<vec2f,6>(vec2f(-1,-1),vec2f(1,-1),vec2f(-1,1),vec2f(-1,1),vec2f(1,-1),vec2f(1,1));
  let p=particles[instance];let center=(camera.view*vec4f(camera.domain.xyz+p.position*camera.domain.w,1)).xyz;
  let offset=corners[vertex]*camera.params.z;
  var output:Billboard;output.position=camera.projection*vec4f(center+vec3f(offset,0),1);
  if(p.life<=0.){output.position=vec4f(2,2,2,1);}
  output.uv=corners[vertex];output.center=center;return output;
}
struct Depth{@location(0) depth:f32,@builtin(frag_depth) z:f32}
@fragment fn front(input:Billboard)->Depth{
  let r2=dot(input.uv,input.uv);if(r2>1.){discard;}
  let view=input.center+vec3f(input.uv*camera.params.z,sqrt(1.-r2)*camera.params.z);
  let clip=camera.projection*vec4f(view,1);var output:Depth;output.depth=-view.z;output.z=clip.z/clip.w;return output;
}
@fragment fn fs_back(input:Billboard)->Depth{
  let r2=dot(input.uv,input.uv);if(r2>1.){discard;}
  let view=input.center+vec3f(input.uv*camera.params.z,-sqrt(1.-r2)*camera.params.z);
  let clip=camera.projection*vec4f(view,1);var output:Depth;output.depth=-view.z;output.z=clip.z/clip.w;return output;
}
@fragment fn thickness(input:Billboard)->@location(0) f32{
  let r2=dot(input.uv,input.uv);if(r2>1.){discard;}return 2.*camera.params.z*sqrt(1.-r2);
}`;
const smoothCode=cameraStruct+quad+`
@group(0) @binding(1) var source:texture_2d<f32>;
override horizontal:bool;
@fragment fn filterDepth(@builtin(position) pos:vec4f)->@location(0) f32{
  let size=vec2i(textureDimensions(source));let pixel=vec2i(pos.xy);let center=textureLoad(source,pixel,0).x;
  if(center>=camera.params.w){return center;}var sum=0.;var weights=0.;
  for(var i=-4;i<=4;i++){
    let delta=select(vec2i(0,i),vec2i(i,0),horizontal);
    let sample=textureLoad(source,clamp(pixel+delta,vec2i(0),size-1),0).x;
    if(sample>=camera.params.w){continue;}
    let weight=exp(-f32(i*i)/7.5-pow((sample-center)/(camera.params.z*2.2),2.));
    sum+=weight*sample;weights+=weight;
  }return sum/max(weights,1e-6);
}`;
const compositeCode=cameraStruct+quad+`
@group(0) @binding(1) var front:texture_2d<f32>;
@group(0) @binding(2) var backTex:texture_2d<f32>;
@group(0) @binding(3) var thickness:texture_2d<f32>;
@group(0) @binding(4) var sceneColor:texture_2d<f32>;
@group(0) @binding(5) var sceneDepth:texture_2d<f32>;
fn eye(uv:vec2f,depth:f32)->vec3f{
  let ray=camera.inverseProjection*vec4f(uv.x*2.-1.,1.-uv.y*2.,1,1);return ray.xyz*depth/-ray.z;
}
fn point(pixel:vec2i,center:f32)->vec3f{
  let size=vec2i(textureDimensions(front));let p=clamp(pixel,vec2i(0),size-1);var d=textureLoad(front,p,0).x;
  if(d>=camera.params.w||abs(d-center)>camera.params.z*4.){d=center;}
  return eye((vec2f(p)+.5)/vec2f(size),d);
}
fn backPoint(pixel:vec2i,center:f32)->vec3f{
  let size=vec2i(textureDimensions(backTex));let p=clamp(pixel,vec2i(0),size-1);var d=textureLoad(backTex,p,0).x;
  if(d<=0.||abs(d-center)>camera.params.z*6.){d=center;}
  return eye((vec2f(p)+.5)/vec2f(size),d);
}
@fragment fn compose(@builtin(position) pos:vec4f)->@location(0) vec4f{
  let colorSize=vec2i(textureDimensions(sceneColor));let pixel=vec2i(pos.xy);let uv=pos.xy/vec2f(colorSize);
  let size=vec2i(textureDimensions(front));let p=clamp(vec2i(uv*vec2f(size)),vec2i(0),size-1);
  let depth=textureLoad(front,p,0).x;let background=textureLoad(sceneColor,pixel,0);
  let sceneD=textureLoad(sceneDepth,pixel,0).x;
  if(depth>=camera.params.w||depth>sceneD+.005){return background;}
  let dx=point(p+vec2i(1,0),depth)-point(p-vec2i(1,0),depth);
  let dy=point(p+vec2i(0,1),depth)-point(p-vec2i(0,1),depth);
  var detailN=normalize(cross(dx,dy));if(detailN.z<0.){detailN=-detailN;}
  let mdx=point(p+vec2i(3,0),depth)-point(p-vec2i(3,0),depth);
  let mdy=point(p+vec2i(0,3),depth)-point(p-vec2i(0,3),depth);
  var macroN=normalize(cross(mdx,mdy));if(macroN.z<0.){macroN=-macroN;}
  let amount=textureLoad(thickness,p,0).x;
  let denseBodyConfidence=smoothstep(camera.params.z*.8,camera.params.z*3.2,amount);
  let transportN=normalize(mix(detailN,macroN,denseBodyConfidence*.55));
  let normal=normalize(mix(macroN,detailN,.35));
  let normalVariance=clamp(1.-dot(detailN,macroN),0.,1.);
  let rawExitDepth=textureLoad(backTex,p,0).x;
  let visibleExitDepth=min(rawExitDepth,sceneD);
  let enclosingSpan=max(visibleExitDepth-depth,0.);
  let spanSupportRatio=amount/max(enclosingSpan,1e-4);
  let slabSupported=rawExitDepth>depth&&spanSupportRatio>=.25;
  let slabExitDepth=select(depth+amount*.85,max(rawExitDepth,depth+amount*.35),slabSupported);
  let submergedOpaque=sceneD<slabExitDepth;
  let waterExitDepth=min(slabExitDepth,sceneD);
  let geometricPathLength=max(waterExitDepth-depth,0.);
  let sceneBoundedPath=max(sceneD-depth,0.);
  let viewDir=normalize(eye(uv,depth));let view=-viewDir;
  let insideRay=refract(viewDir,transportN,1.0/1.333);
  let metricScale=1./max(abs(insideRay.z),.25);
  let metricGeometricPath=geometricPathLength*metricScale;
  let metricSceneBoundedPath=sceneBoundedPath*metricScale;
  let opticalThicknessPath=min(amount*.85*metricScale,metricSceneBoundedPath);
  let absorptionPath=min(mix(opticalThicknessPath,mix(metricGeometricPath,max(metricGeometricPath,opticalThicknessPath),denseBodyConfidence),select(0.,1.,slabSupported)),metricSceneBoundedPath);
  let fresnel=.02037+(1.-.02037)*pow(1.-max(0.,dot(macroN,view)),5.);
  let absorption=exp(-vec3f(1.10,0.42,0.18)*absorptionPath);
  let transmissionMinContribution=clamp(camera.optics.x,0.,1.);
  let transmissionContribution=(1.-fresnel)*max(absorption.r,max(absorption.g,absorption.b));
  let entryOffset=transportN.xy*vec2f(1.,-1.)*clamp(amount*55.,1.5,24.);
  var refractedRadiance=background.rgb;
  if(transmissionContribution >= transmissionMinContribution){
    let exitPosView=eye(uv,depth)+insideRay*metricGeometricPath;
    let exitClip=camera.projection*vec4f(exitPosView,1.);
    let exitW=max(abs(exitClip.w),1e-4);
    let exitUv=clamp(vec2f(exitClip.x/exitW*.5+.5,.5-exitClip.y/exitW*.5),vec2f(.001),vec2f(.999));
    var targetUv=exitUv;
    if(!submergedOpaque){
      let exitP=clamp(vec2i(exitUv*vec2f(size)),vec2i(0),size-1);
      let exitCenter=max(textureLoad(backTex,exitP,0).x,depth);
      let edx=backPoint(exitP+vec2i(1,0),exitCenter)-backPoint(exitP-vec2i(1,0),exitCenter);
      let edy=backPoint(exitP+vec2i(0,1),exitCenter)-backPoint(exitP-vec2i(0,1),exitCenter);
      var exitN=normalize(cross(edx,edy));if(exitN.z>0.){exitN=-exitN;}
      let rawOutgoing=refract(insideRay,-exitN,1.333);
      let outgoingRay=select(insideRay,rawOutgoing,length(rawOutgoing)>.001);
      let validSceneDepth=sceneD>waterExitDepth&&sceneD<camera.params.w;
      let postExitDepthSpan=select(max(geometricPathLength,amount*.6),sceneD-waterExitDepth,validSceneDepth);
      let postExitPosView=exitPosView+outgoingRay*(postExitDepthSpan/max(abs(outgoingRay.z),.25));
      let postClip=camera.projection*vec4f(postExitPosView,1.);
      let postW=max(abs(postClip.w),1e-4);
      targetUv=clamp(vec2f(postClip.x/postW*.5+.5,.5-postClip.y/postW*.5),vec2f(.001),vec2f(.999));
    }
    let twoInterfaceDelta=clamp(targetUv*vec2f(colorSize)-vec2f(pixel),vec2f(-28.),vec2f(28.));
    let baseRefractPixel=vec2f(pixel)+mix(entryOffset,twoInterfaceDelta,select(0.,1.,slabSupported||submergedOpaque));
    let coneRadius=clamp(1.+denseBodyConfidence*normalVariance*16.,1.,5.5);
    let offsets=array<vec2f,5>(vec2f(0.,0.),vec2f(1.,0.),vec2f(-1.,0.),vec2f(0.,1.),vec2f(0.,-1.));
    var radSum=vec3f(0.);var wSum=0.;
    let tapCount=select(1,5,denseBodyConfidence>.25);
    for(var k=0;k<tapCount;k++){
      let candidate=clamp(vec2i(baseRefractPixel+offsets[k]*coneRadius),vec2i(0),colorSize-1);
      let tapPixel=select(candidate,pixel,textureLoad(sceneDepth,candidate,0).x<depth);
      let w=select(.18,.28,k==0);
      radSum+=textureLoad(sceneColor,tapPixel,0).rgb*w;wSum+=w;
    }
    refractedRadiance=radSum/max(wSum,1e-5);
  }else{
    let refracted=clamp(pixel+vec2i(entryOffset),vec2i(0),colorSize-1);
    let refractionPixel=select(refracted,pixel,textureLoad(sceneDepth,refracted,0).x<depth);
    refractedRadiance=textureLoad(sceneColor,refractionPixel,0).rgb;
  }
  let waterScatter=vec3f(0.055,0.30,0.42)*(vec3f(1.)-absorption);
  let transmitted=refractedRadiance*absorption+waterScatter*(1.-fresnel);
  let worldNormal=(camera.inverseView*vec4f(normal,0)).xyz;
  let sky=mix(vec3f(.12,.19,.22),vec3f(.7,.82,.88),clamp(worldNormal.y*.5+.5,0.,1.));
  let light=normalize(vec3f(-.3,.8,.7));let spec=pow(max(0.,dot(normal,normalize(light+view))),100.);
  return vec4f(mix(transmitted,sky,fresnel)+vec3f(2.)*spec,1);
}`;

export async function createMlsJuiceRenderer({device,solver,hostEnvironment=false,transmissionMinContribution=DEFAULT_TRANSMISSION_MIN_CONTRIBUTION}) {
  let activeTransmissionMinContribution=normalizeTransmissionMinContribution(transmissionMinContribution);
  const camera=device.createBuffer({size:320,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST,label:'MLS real host camera'});
  const resources=[];let width=0,height=0;
  async function module(code){const m=device.createShaderModule({code});const errors=(await m.getCompilationInfo()).messages.filter(m=>m.type==='error');if(errors.length)throw Error(errors.map(m=>m.message).join('; '));return m;}
  try{
    let composedCode=compositeCode;
    if(hostEnvironment)composedCode=composedCode.replace('fn eye(', '@group(0) @binding(6) var environment:texture_2d<f32>;\n@group(0) @binding(7) var environmentSampler:sampler;\nfn eye(')
      .replace('let sky=mix(vec3f(.12,.19,.22),vec3f(.7,.82,.88),clamp(worldNormal.y*.5+.5,0.,1.));',
      'let direction=normalize((camera.inverseView*vec4f(reflect(-view,normal),0)).xyz);let envUV=vec2f(atan2(direction.z,direction.x)/6.28318530718+.5,acos(clamp(direction.y,-1.,1.))/3.14159265359);let sky=textureSampleLevel(environment,environmentSampler,envUV,0.).rgb;')
      .replace('vec3f(2.)*spec','vec3f(0.)');
    const environmentSampler=hostEnvironment?device.createSampler({magFilter:'linear',minFilter:'linear',addressModeU:'repeat',addressModeV:'clamp-to-edge'}):null;
    const particles=await module(particleCode),smooth=await module(smoothCode),composite=await module(composedCode);
    const front=await device.createRenderPipelineAsync({label:'MLS particle front surface',layout:'auto',
      vertex:{module:particles,entryPoint:'particle'},fragment:{module:particles,entryPoint:'front',targets:[{format:'r32float'}]},
      depthStencil:{format:'depth32float',depthWriteEnabled:true,depthCompare:'less'}});
    const back=await device.createRenderPipelineAsync({label:'MLS particle back surface',layout:'auto',
      vertex:{module:particles,entryPoint:'particle'},fragment:{module:particles,entryPoint:'fs_back',targets:[{format:'r32float'}]},
      depthStencil:{format:'depth32float',depthWriteEnabled:true,depthCompare:'greater'}});
    const thickness=await device.createRenderPipelineAsync({label:'MLS optical thickness',layout:'auto',
      vertex:{module:particles,entryPoint:'particle'},fragment:{module:particles,entryPoint:'thickness',targets:[{format:'r16float',blend:{color:{srcFactor:'one',dstFactor:'one',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one',operation:'add'}}}]}});
    const smoothing=[];
    for(const horizontal of [true,false])smoothing.push(await device.createRenderPipelineAsync({label:'MLS depth-aware smoothing',layout:'auto',vertex:{module:smooth,entryPoint:'quad'},fragment:{module:smooth,entryPoint:'filterDepth',constants:{horizontal},targets:[{format:'r32float'}]}}));
    const compose=await device.createRenderPipelineAsync({label:'MLS scene refraction',layout:'auto',vertex:{module:composite,entryPoint:'quad'},fragment:{module:composite,entryPoint:'compose',targets:[{format:'rgba16float'}]}});
    const group=(pipeline,entries)=>device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:camera}},...entries.map((resource,i)=>({binding:i+1,resource}))]});
    const particleBuffer=solver.particles??solver.particleBuffer;
    const frontGroup=group(front,[{buffer:particleBuffer}]),backGroup=group(back,[{buffer:particleBuffer}]),thicknessGroup=group(thickness,[{buffer:particleBuffer}]);
    const texture=format=>{const t=device.createTexture({size:[width,height],format,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});resources.push(t);return t;};
    let depth,depthTest,backDepth,backDepthTest,thick,ping,filtered;
    return {
      setOpticalSettings(next={}){
        if(Object.hasOwn(next,'transmissionMinContribution')&&next.transmissionMinContribution!==undefined){
          activeTransmissionMinContribution=normalizeTransmissionMinContribution(next.transmissionMinContribution);
        }
        return {transmissionMinContribution:activeTransmissionMinContribution};
      },
      encode({encoder,hostCamera,environment=null,sceneColor,sceneDepth,target,width:fullWidth,height:fullHeight,beforeComposite=null,afterComposite=null}){
        const w=Math.ceil(fullWidth*.7),h=Math.ceil(fullHeight*.7);
        if(w!==width||h!==height){for(const t of resources)t.destroy();resources.length=0;width=w;height=h;
          depth=texture('r32float');depthTest=texture('depth32float');backDepth=texture('r32float');backDepthTest=texture('depth32float');thick=texture('r16float');ping=texture('r32float');filtered=texture('r32float');}
        const c=solver.config;hostCamera.updateMatrixWorld?.();
        device.queue.writeBuffer(camera,0,new Float32Array([...hostCamera.matrixWorldInverse.elements,...hostCamera.projectionMatrix.elements,
          ...(hostCamera.projectionMatrixInverse?.elements??new Float32Array(16)),...hostCamera.matrixWorld.elements,...c.min,c.cell,width,height,c.particleRadius,hostCamera.far,
          activeTransmissionMinContribution,hostCamera.near??0.1,1.333,hostEnvironment?1:0]));
        function draw(pipeline,bind,view,clearValue,instances=1,test=null,depthClearValue=1){
          const pass=encoder.beginRenderPass({colorAttachments:[{view,clearValue,loadOp:'clear',storeOp:'store'}],...(test?{depthStencilAttachment:{view:test,depthClearValue,depthLoadOp:'clear',depthStoreOp:'store'}}:{})});
          pass.setPipeline(pipeline);pass.setBindGroup(0,bind);pass.draw(instances===1?3:6,instances);pass.end();
        }
        // Particle passes use six billboard vertices even for a one-slot pool.
        const particleDraw=(pipeline,bind,view,clear,test,depthClearValue=1)=>{
          const pass=encoder.beginRenderPass({colorAttachments:[{view,clearValue:clear,loadOp:'clear',storeOp:'store'}],...(test?{depthStencilAttachment:{view:test,depthClearValue,depthLoadOp:'clear',depthStoreOp:'store'}}:{})});
          pass.setPipeline(pipeline);pass.setBindGroup(0,bind);pass.draw(6,c.capacity);pass.end();
        };
        particleDraw(front,frontGroup,depth.createView(),{r:hostCamera.far,g:0,b:0,a:0},depthTest.createView(),1);
        particleDraw(back,backGroup,backDepth.createView(),{r:0,g:0,b:0,a:0},backDepthTest.createView(),0);
        particleDraw(thickness,thicknessGroup,thick.createView(),{r:0,g:0,b:0,a:0});
        draw(smoothing[0],group(smoothing[0],[depth.createView()]),ping.createView(),{r:hostCamera.far,g:0,b:0,a:0});
        draw(smoothing[1],group(smoothing[1],[ping.createView()]),filtered.createView(),{r:hostCamera.far,g:0,b:0,a:0});
        const frontDepthView=filtered.createView();
        beforeComposite?.({frontDepthView});
        draw(compose,group(compose,[frontDepthView,backDepth.createView(),thick.createView(),sceneColor,sceneDepth,...(hostEnvironment?[environment,environmentSampler]:[])]),target,{r:0,g:0,b:0,a:1});
        afterComposite?.({frontDepthView});
      },
      read:()=>({method:'mls_two_interface_optical_slab_refraction_v1',opticalTransportRoute:'snell-two-interface-screen-space-slab-v0',renderScale:.7,width,height,
        passes:['front_depth','back_depth','thickness','bilateral_h','bilateral_v','compose'],
        transmissionMinContribution:activeTransmissionMinContribution,refractionCutoffEnabled:true,
        environment:hostEnvironment?'host_environment_world_radiance':'analytic_sky_not_host_environment',surfaceTension:false}),
      dispose(){camera.destroy();for(const t of resources)t.destroy();}
    };
  }catch(error){camera.destroy();for(const t of resources)t.destroy();throw error;}
}
