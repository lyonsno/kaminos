const cameraStruct=`struct Camera{view:mat4x4f,projection:mat4x4f,inverseProjection:mat4x4f,inverseView:mat4x4f,domain:vec4f,params:vec4f}
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
@fragment fn thickness(input:Billboard)->@location(0) f32{
  let r2=dot(input.uv,input.uv);if(r2>1.){discard;}return 2.*camera.params.z*sqrt(1.-r2);
}`;
const smoothCode=cameraStruct+quad+`
@group(0) @binding(1) var source:texture_2d<f32>;
override horizontal:bool;
@fragment fn filterDepth(@builtin(position) pos:vec4f)->@location(0) f32{
  let size=vec2i(textureDimensions(source));let pixel=vec2i(pos.xy);let center=textureLoad(source,pixel,0).x;
  if(center>=camera.params.w){return center;}var sum=0.;var weights=0.;
  for(var i=-3;i<=3;i++){
    let delta=select(vec2i(0,i),vec2i(i,0),horizontal);
    let sample=textureLoad(source,clamp(pixel+delta,vec2i(0),size-1),0).x;
    if(sample>=camera.params.w){continue;}
    let weight=exp(-f32(i*i)/5.-pow((sample-center)/(camera.params.z*2.),2.));
    sum+=weight*sample;weights+=weight;
  }return sum/max(weights,1e-6);
}`;
const compositeCode=cameraStruct+quad+`
@group(0) @binding(1) var front:texture_2d<f32>;
@group(0) @binding(2) var thickness:texture_2d<f32>;
@group(0) @binding(3) var sceneColor:texture_2d<f32>;
@group(0) @binding(4) var sceneDepth:texture_2d<f32>;
fn eye(uv:vec2f,depth:f32)->vec3f{
  let ray=camera.inverseProjection*vec4f(uv.x*2.-1.,1.-uv.y*2.,1,1);return ray.xyz*depth/-ray.z;
}
fn point(pixel:vec2i,center:f32)->vec3f{
  let size=vec2i(textureDimensions(front));let p=clamp(pixel,vec2i(0),size-1);var d=textureLoad(front,p,0).x;
  if(d>=camera.params.w||abs(d-center)>camera.params.z*4.){d=center;}
  return eye((vec2f(p)+.5)/vec2f(size),d);
}
@fragment fn compose(@builtin(position) pos:vec4f)->@location(0) vec4f{
  let colorSize=vec2i(textureDimensions(sceneColor));let pixel=vec2i(pos.xy);let uv=pos.xy/vec2f(colorSize);
  let size=vec2i(textureDimensions(front));let p=clamp(vec2i(uv*vec2f(size)),vec2i(0),size-1);
  let depth=textureLoad(front,p,0).x;let background=textureLoad(sceneColor,pixel,0);
  if(depth>=camera.params.w||depth>textureLoad(sceneDepth,pixel,0).x+.005){return background;}
  let dx=point(p+vec2i(1,0),depth)-point(p-vec2i(1,0),depth);
  let dy=point(p+vec2i(0,1),depth)-point(p-vec2i(0,1),depth);
  var normal=normalize(cross(dx,dy));if(normal.z<0.){normal=-normal;}
  let view=normalize(-eye(uv,depth));let amount=textureLoad(thickness,p,0).x;
  let refracted=clamp(pixel+vec2i(normal.xy*vec2f(1,-1)*amount*75.),vec2i(0),colorSize-1);
  let refractionPixel=select(refracted,pixel,textureLoad(sceneDepth,refracted,0).x<depth);
  let transmitted=textureLoad(sceneColor,refractionPixel,0).rgb*exp(-vec3f(3.,.65,.3)*amount);
  let worldNormal=(camera.inverseView*vec4f(normal,0)).xyz;
  let sky=mix(vec3f(.12,.19,.22),vec3f(.7,.82,.88),clamp(worldNormal.y*.5+.5,0.,1.));
  let fresnel=.02+.98*pow(1.-max(0.,dot(normal,view)),5.);
  let light=normalize(vec3f(-.3,.8,.7));let spec=pow(max(0.,dot(normal,normalize(light+view))),100.);
  return vec4f(mix(transmitted,sky,fresnel)+vec3f(2.)*spec+vec3f(.015,.07,.085)*(1.-exp(-amount*3.)),1);
}`;

export async function createMlsJuiceRenderer({device,solver}) {
  const camera=device.createBuffer({size:288,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST,label:'MLS real host camera'});
  const resources=[];let width=0,height=0;
  async function module(code){const m=device.createShaderModule({code});const errors=(await m.getCompilationInfo()).messages.filter(m=>m.type==='error');if(errors.length)throw Error(errors.map(m=>m.message).join('; '));return m;}
  try{
    const particles=await module(particleCode),smooth=await module(smoothCode),composite=await module(compositeCode);
    const front=await device.createRenderPipelineAsync({label:'MLS particle front surface',layout:'auto',
      vertex:{module:particles,entryPoint:'particle'},fragment:{module:particles,entryPoint:'front',targets:[{format:'r32float'}]},
      depthStencil:{format:'depth32float',depthWriteEnabled:true,depthCompare:'less'}});
    const thickness=await device.createRenderPipelineAsync({label:'MLS optical thickness',layout:'auto',
      vertex:{module:particles,entryPoint:'particle'},fragment:{module:particles,entryPoint:'thickness',targets:[{format:'r16float',blend:{color:{srcFactor:'one',dstFactor:'one',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one',operation:'add'}}}]}});
    const smoothing=[];
    for(const horizontal of [true,false])smoothing.push(await device.createRenderPipelineAsync({label:'MLS depth-aware smoothing',layout:'auto',vertex:{module:smooth,entryPoint:'quad'},fragment:{module:smooth,entryPoint:'filterDepth',constants:{horizontal},targets:[{format:'r32float'}]}}));
    const compose=await device.createRenderPipelineAsync({label:'MLS scene refraction',layout:'auto',vertex:{module:composite,entryPoint:'quad'},fragment:{module:composite,entryPoint:'compose',targets:[{format:'rgba16float'}]}});
    const group=(pipeline,entries)=>device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:camera}},...entries.map((resource,i)=>({binding:i+1,resource}))]});
    const frontGroup=group(front,[{buffer:solver.particles}]),thicknessGroup=group(thickness,[{buffer:solver.particles}]);
    const texture=format=>{const t=device.createTexture({size:[width,height],format,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});resources.push(t);return t;};
    let depth,depthTest,thick,ping,filtered;
    return {
      encode({encoder,hostCamera,sceneColor,sceneDepth,target,width:fullWidth,height:fullHeight}){
        const w=Math.ceil(fullWidth*.7),h=Math.ceil(fullHeight*.7);
        if(w!==width||h!==height){for(const t of resources)t.destroy();resources.length=0;width=w;height=h;
          depth=texture('r32float');depthTest=texture('depth32float');thick=texture('r16float');ping=texture('r32float');filtered=texture('r32float');}
        const c=solver.config;hostCamera.updateMatrixWorld();
        device.queue.writeBuffer(camera,0,new Float32Array([...hostCamera.matrixWorldInverse.elements,...hostCamera.projectionMatrix.elements,
          ...hostCamera.projectionMatrixInverse.elements,...hostCamera.matrixWorld.elements,...c.min,c.cell,width,height,c.particleRadius,hostCamera.far]));
        function draw(pipeline,bind,view,clearValue,instances=1,test=null){
          const pass=encoder.beginRenderPass({colorAttachments:[{view,clearValue,loadOp:'clear',storeOp:'store'}],...(test?{depthStencilAttachment:{view:test,depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'store'}}:{})});
          pass.setPipeline(pipeline);pass.setBindGroup(0,bind);pass.draw(instances===1?3:6,instances);pass.end();
        }
        // Particle passes use six billboard vertices even for a one-slot pool.
        const particleDraw=(pipeline,bind,view,clear,test)=>{
          const pass=encoder.beginRenderPass({colorAttachments:[{view,clearValue:clear,loadOp:'clear',storeOp:'store'}],...(test?{depthStencilAttachment:{view:test,depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'store'}}:{})});
          pass.setPipeline(pipeline);pass.setBindGroup(0,bind);pass.draw(6,c.capacity);pass.end();
        };
        particleDraw(front,frontGroup,depth.createView(),{r:hostCamera.far,g:0,b:0,a:0},depthTest.createView());
        particleDraw(thickness,thicknessGroup,thick.createView(),{r:0,g:0,b:0,a:0});
        draw(smoothing[0],group(smoothing[0],[depth.createView()]),ping.createView(),{r:hostCamera.far,g:0,b:0,a:0});
        draw(smoothing[1],group(smoothing[1],[ping.createView()]),filtered.createView(),{r:hostCamera.far,g:0,b:0,a:0});
        draw(compose,group(compose,[filtered.createView(),thick.createView(),sceneColor,sceneDepth]),target,{r:0,g:0,b:0,a:1});
      },
      read:()=>({method:'sphere_front_depth_two_pass_bilateral_scene_refraction',renderScale:.7,width,height,
        environment:'analytic_sky_not_host_environment',surfaceTension:false}),
      dispose(){camera.destroy();for(const t of resources)t.destroy();}
    };
  }catch(error){camera.destroy();for(const t of resources)t.destroy();throw error;}
}
