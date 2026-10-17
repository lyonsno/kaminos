// Native flame material, split at the water interface, before the scene camera.
// Inputs are current GPU attachments; this path performs no readback or submit.
export const SCENE_VOLUME_TRANSPORT = 'native-flame-linear-segment-transport-v0';

const SEGMENT_WGSL = /* wgsl */`
@group(1) @binding(2) var waterEntryDepth: texture_2d<f32>;
@group(1) @binding(3) var opaqueViewDepth: texture_2d<f32>;
@group(1) @binding(4) var<uniform> transportForwardScale: vec4<f32>;
override TRANSPORT_FOREGROUND: bool = false;

@fragment
fn fsSceneTransport(in: VSOut) -> @location(0) vec4<f32> {
  seatGridShape();
  let ndc = in.uv * 2.0 - vec2<f32>(1.0);
  let near = u.invViewProj * vec4<f32>(ndc, -1.0, 1.0);
  let far = u.invViewProj * vec4<f32>(ndc, 1.0, 1.0);
  let rd = normalize(far.xyz / far.w - near.xyz / near.w);
  let depthToLocalT = max(dot(rd, transportForwardScale.xyz) * transportForwardScale.w, 1.0e-6);
  let uv = vec2<f32>(in.uv.x, 1.0 - in.uv.y);
  let dims = vec2<i32>(textureDimensions(waterEntryDepth));
  let pixel = clamp(vec2<i32>(uv * vec2<f32>(dims)), vec2<i32>(0), dims - vec2<i32>(1));
  let entry = max(0.0, textureLoad(waterEntryDepth, pixel, 0).r) / depthToLocalT;
  let opaque = max(0.0, textureLoad(opaqueViewDepth, pixel, 0).r) / depthToLocalT;
  let start = select(min(entry, opaque), 0.0, TRANSPORT_FOREGROUND);
  let end = select(opaque, min(entry, opaque), TRANSPORT_FOREGROUND);
  let result = raymarchVolume(in, end, true, start);
  return vec4<f32>(result.linearRadiance, clamp(1.0 - result.transmittance, 0.0, 1.0));
}
`;

const COMPOSITE_WGSL = /* wgsl */`
@group(0) @binding(0) var radiance: texture_2d<f32>;
@group(0) @binding(1) var radianceSampler: sampler;
struct TransportVertex { @builtin(position) position: vec4<f32>, @location(0) uv: vec2<f32> };
@vertex fn vs(@builtin(vertex_index) i: u32) -> TransportVertex {
  let p = array<vec2<f32>, 3>(vec2<f32>(-1,-1), vec2<f32>(3,-1), vec2<f32>(-1,3))[i];
  var out: TransportVertex;
  out.position = vec4<f32>(p,0,1);
  out.uv = vec2<f32>(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
  return out;
}
@fragment fn fs(in: TransportVertex) -> @location(0) vec4<f32> {
  return textureSampleLevel(radiance, radianceSampler, in.uv, 0.0);
}
`;

export function createSceneVolumeTransport(device) {
  const segmentLayout=device.createBindGroupLayout({label:SCENE_VOLUME_TRANSPORT,entries:[
    {binding:2,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'unfilterable-float'}},
    {binding:3,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'unfilterable-float'}},
    {binding:4,visibility:GPUShaderStage.FRAGMENT,buffer:{type:'uniform'}},
  ]});
  const params=device.createBuffer({label:SCENE_VOLUME_TRANSPORT,size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
  const compositeModule=device.createShaderModule({label:SCENE_VOLUME_TRANSPORT+' composite',code:COMPOSITE_WGSL});
  const compositeLayout=device.createBindGroupLayout({entries:[
    {binding:0,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'float'}},
    {binding:1,visibility:GPUShaderStage.FRAGMENT,sampler:{type:'filtering'}},
  ]});
  const blend={color:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}};
  const composite=device.createRenderPipeline({label:SCENE_VOLUME_TRANSPORT+' composite',
    layout:device.createPipelineLayout({bindGroupLayouts:[compositeLayout]}),
    vertex:{module:compositeModule,entryPoint:'vs'},fragment:{module:compositeModule,entryPoint:'fs',targets:[{format:'rgba16float',blend}]},primitive:{topology:'triangle-list'}});
  const sampler=device.createSampler({minFilter:'linear',magFilter:'linear'});
  let texture=null,compositeGroup=null,extent='',source=null,sourceLayout=null,lightLayout=null,disposed=false;
  const pipelines=new Map();
  return {
    encode({encoder,targetView,frontDepthView,sceneDepthView,forwardScale,width,height,code,mainLayout,mainGroup,lighting=null,constants={},foreground=false}) {
      if(disposed)throw Error('Native scene transport disposed');
      if(!encoder||!targetView||!frontDepthView||!sceneDepthView)throw Error('Native scene transport needs current encoder and attachments');
      if(![width,height].every(v=>Number.isSafeInteger(v)&&v>0))throw Error('Native scene transport extent must be positive integers');
      if(!Array.isArray(forwardScale)||forwardScale.length!==4||!forwardScale.every(Number.isFinite)||forwardScale[3]<=0)throw Error('Native scene transport requires finite camera forward and positive world scale');
      if(!code||!mainLayout||!mainGroup||lighting&&(!lighting.layout||!lighting.group))throw Error('Native scene transport source is incomplete');
      // Preserve the native renderer's chosen render scale. Only the final
      // premultiplied transport is expanded to the host's backing extent.
      if(extent!==`${width}x${height}`) {
        texture?.destroy();extent=`${width}x${height}`;
        texture=device.createTexture({label:SCENE_VOLUME_TRANSPORT,size:[width,height],format:'rgba16float',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});
        compositeGroup=device.createBindGroup({layout:compositeLayout,entries:[{binding:0,resource:texture.createView()},{binding:1,resource:sampler}]});
      }
      if(source!==code||sourceLayout!==mainLayout||lightLayout!==lighting?.layout) {
        pipelines.clear();source=code;sourceLayout=mainLayout;lightLayout=lighting?.layout;
      }
      const variant={...constants,TRANSPORT_FOREGROUND:foreground},key=JSON.stringify(variant);
      if(!pipelines.has(key)) {
        const module=device.createShaderModule({label:SCENE_VOLUME_TRANSPORT,code:code+SEGMENT_WGSL});
        const layouts=[mainLayout,segmentLayout];if(lighting)layouts.push(lighting.layout);
        pipelines.set(key,device.createRenderPipeline({label:SCENE_VOLUME_TRANSPORT,
          layout:device.createPipelineLayout({bindGroupLayouts:layouts}),vertex:{module,entryPoint:'vs'},
          fragment:{module,entryPoint:'fsSceneTransport',constants:variant,targets:[{format:'rgba16float'}]},primitive:{topology:'triangle-list'}}));
      }
      device.queue.writeBuffer(params,0,new Float32Array(forwardScale));
      const group=device.createBindGroup({layout:segmentLayout,entries:[{binding:2,resource:frontDepthView},{binding:3,resource:sceneDepthView},{binding:4,resource:{buffer:params}}]});
      const march=encoder.beginRenderPass({label:SCENE_VOLUME_TRANSPORT+(foreground?':foreground':':background'),colorAttachments:[{view:texture.createView(),loadOp:'clear',clearValue:{r:0,g:0,b:0,a:0},storeOp:'store'}]});
      march.setPipeline(pipelines.get(key));march.setBindGroup(0,mainGroup);march.setBindGroup(1,group);if(lighting)march.setBindGroup(2,lighting.group);march.draw(3);march.end();
      const compose=encoder.beginRenderPass({label:SCENE_VOLUME_TRANSPORT+':linear-over',colorAttachments:[{view:targetView,loadOp:'load',storeOp:'store'}]});
      compose.setPipeline(composite);compose.setBindGroup(0,compositeGroup);compose.draw(3);compose.end();
      return {identity:SCENE_VOLUME_TRANSPORT,segment:foreground?'camera-to-water':'water-to-opaque',width,height,colorSpace:'linear_hdr',displayTransform:'none',privateSubmit:false};
    },
    dispose(){if(disposed)return;disposed=true;texture?.destroy();params.destroy();pipelines.clear();},
  };
}
