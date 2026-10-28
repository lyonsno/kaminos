// Display-only positive reconstruction. Never writes simulation fields.
export function resolveDisplayReconstruction(controls = {}) {
  const mode = controls.displayReconstruction ?? 'off';
  const value = ['off', 'material', 'optical'].indexOf(mode);
  if (value < 0) throw Error('Unknown display reconstruction mode');
  const scale = Number(controls.displayGridScale ?? 2);
  if (![1, 2, 4].includes(scale)) throw Error('Display grid scale must be 1, 2 or 4');
  const emission = Number(controls.emissionSmoothing ?? 0.5);
  const smoke = Number(controls.smokeSmoothing ?? 0.5);
  if (![emission, smoke].every(v => Number.isFinite(v) && v >= 0 && v <= 1)) {
    throw Error('Display smoothing must be between zero and one');
  }
  return { mode, value, scale, emission, smoke };
}

export function positiveCubicWeights(f, smoothing = 1) {
  const cubic = [(1-f)**3/6, (3*f**3-6*f*f+4)/6, (-3*f**3+3*f*f+3*f+1)/6, f**3/6];
  const linear = [0, 1-f, f, 0];
  return cubic.map((v,i) => linear[i] + smoothing*(v-linear[i]));
}

export function displayReconstructionShapes(grid, scale) {
  return [grid, [grid[0]*scale,grid[1],grid[2]],
    [grid[0]*scale,grid[1]*scale,grid[2]], grid.map(v=>v*scale)];
}

export function displayPreparationTiming(times) {
  if(times.length!==4||times.some(t=>typeof t!=='bigint'||t<=0n)||times[1]<=times[0]||times[3]<=times[2]) {
    throw Error('Missing or invalid display preparation timestamps');
  }
  const start=times[0]<times[2]?times[0]:times[2];
  const end=times[1]>times[3]?times[1]:times[3];
  // Native pass intervals can overlap: do not assume render-pass beginning is
  // ordered after compute-pass completion or double-count overlap as wall time.
  return {displayPreparationMs:Number(times[3]-times[2])/1e6,
    preparationAndCameraSpanMs:Number(end-start)/1e6,
    preparationAndCameraSumMs:Number(times[1]-times[0]+times[3]-times[2])/1e6,
    passIntervalsOverlap:times[0]<times[3]&&times[2]<times[1]};
}

const FILTER_WGSL = /* wgsl */`
fn displayWeights(f: f32, amount: f32) -> vec4<f32> {
  let f2=f*f; let f3=f2*f;
  let cubic=vec4<f32>((1.0-f)*(1.0-f)*(1.0-f),3.0*f3-6.0*f2+4.0,-3.0*f3+3.0*f2+3.0*f+1.0,f3)/6.0;
  return mix(vec4<f32>(0.0,1.0-f,f,0.0),cubic,amount);
}
fn displayAxisSample(c: vec3<u32>, dst: vec3<u32>, axis: u32, amounts: vec2<f32>) -> vec4<f32> {
  let src=textureDimensions(displayFilterInput);
  let q=(f32(c[axis])+0.5)*f32(src[axis])/f32(dst[axis])-0.5;
  let cell=i32(floor(q)); let f=fract(q);
  let emissionWeights=displayWeights(f,amounts.x);
  let smokeWeights=displayWeights(f,amounts.y);
  var result=vec4<f32>(0.0);
  for(var i=0u;i<4u;i++) {
    var p=vec3<i32>(c); p[axis]=clamp(cell+i32(i)-1,0,i32(src[axis])-1);
    result+=textureLoad(displayFilterInput,p,0)*vec4<f32>(vec3<f32>(emissionWeights[i]),smokeWeights[i]);
  }
  return result;
}
`;

const AXIS_WGSL = /* wgsl */`
override DISPLAY_AXIS: u32=0u;
@group(0) @binding(0) var displayFilterInput: texture_3d<f32>;
@group(0) @binding(1) var displayFilterOutput: texture_storage_3d<rgba32float,write>;
@group(0) @binding(2) var<uniform> displayAmounts: vec4<f32>;
${FILTER_WGSL}
@compute @workgroup_size(4,4,4)
fn filterDisplayAxis(@builtin(global_invocation_id) c: vec3<u32>) {
  let dst=textureDimensions(displayFilterOutput);
  if(any(c>=dst)){return;}
  textureStore(displayFilterOutput,vec3<i32>(c),displayAxisSample(c,dst,DISPLAY_AXIS,displayAmounts.xy));
}
`;

// These entry points compose with the native temperature/radiance functions.
// Raw mode stores soot, heat, fresh burn, and independent smoke soot. Optical
// mode stores emission RGB and extinction. No FP16 clipping or normalization.
export const DISPLAY_RECONSTRUCTION_WGSL = /* wgsl */`
@group(0) @binding(34) var displayField: texture_3d<f32>;
@group(3) @binding(12) var displayFilterOutput: texture_storage_3d<rgba32float,write>;
@group(3) @binding(13) var displayFilterInput: texture_3d<f32>;
${FILTER_WGSL}
fn displayOptics(raw: vec4<f32>) -> vec4<f32> {
  var r: FlowReconstructionSample;
  r.material=vec4<f32>(max(raw.x,0.0),max(raw.y,0.0),0.0,0.0);
  r.freshBurn=max(raw.z,0.0);
  let medium=physicsEmissiveMaterial(r,1.0);
  let extinction=max(raw.w,0.0)*max(u.viewport_steps_density.w,0.0)*u.emissive_material.x;
  return vec4<f32>(medium.emission,extinction);
}
@compute @workgroup_size(4,4,4)
fn seedDisplayField(@builtin(global_invocation_id) c: vec3<u32>) {
  seatGridShape();
  if(any(c>=vec3<u32>(GRID,GRID_Y,GRID))){return;}
  let m=fluidSrc[index3(c)*SLOTS_PER_CELL+1u];
  let burn=textureLoad(reactantSrc,vec3<i32>(c),0).y;
  var value=vec4<f32>(m.x,m.y,burn,m.x);
  if(u.display_reconstruction.x>1.5){value=displayOptics(value);}
  textureStore(displayFilterOutput,vec3<i32>(c),value);
}
@compute @workgroup_size(4,4,4)
fn finishDisplayField(@builtin(global_invocation_id) c: vec3<u32>) {
  let dst=textureDimensions(displayFilterOutput);
  if(any(c>=dst)){return;}
  var value=displayAxisSample(c,dst,2u,u.display_reconstruction.yz);
  if(u.display_reconstruction.x<1.5){value=displayOptics(value);}
  textureStore(displayFilterOutput,vec3<i32>(c),value);
}
fn displayReconstructionActive() -> bool {
  return LEAN_EMISSIVE_RAYMARCH && u.display_reconstruction.x>0.5;
}
fn sampleDisplayMaterial(p: vec3<f32>, smokeVisible: f32) -> EmissiveMaterial {
  let dims=textureDimensions(displayField);
  // Cubic simulation cells: a tall domain has more Y cells, not taller cells.
  let q=clamp(worldToCell(p)*u.display_reconstruction.w-0.5,vec3<f32>(0.0),vec3<f32>(dims)-1.0);
  let c=vec3<i32>(floor(q)); let f=fract(q);
  var value=vec4<f32>(0.0);
  for(var z=0;z<2;z++){for(var y=0;y<2;y++){for(var x=0;x<2;x++){
    let cell=min(c+vec3<i32>(x,y,z),vec3<i32>(dims)-1);
    let w=select(1.0-f.x,f.x,x==1)*select(1.0-f.y,f.y,y==1)*select(1.0-f.z,f.z,z==1);
    value+=textureLoad(displayField,cell,0)*w;
  }}}
  let extinction=max(value.w,0.0)*smokeVisible;
  let albedo=clamp(u.emissive_material.y,0.0,1.0);
  return EmissiveMaterial(value.rgb,extinction*(1.0-albedo),extinction*albedo);
}
`;

export function createDisplayReconstruction(device, module, uniformBuffer, getInputs) {
  const texture = size => device.createTexture({label:'flame display-only field',dimension:'3d',size,
    format:'rgba32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.COPY_SRC});
  const fallback=texture([1,1,1]);
  let textures=[], shapes=[], signature='', key=null, pipelines=null, groups=null, builds=0;
  let config=resolveDisplayReconstruction();
  let inputBuffers=null, inputTextures=null, seedInputs=null;
  const amounts=device.createBuffer({label:'display filter amounts',size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
  const group=(pipeline,index,entries)=>device.createBindGroup({layout:pipeline.getBindGroupLayout(index),entries});
  const initialize=()=>{
    if(pipelines)return;
    const axisModule=device.createShaderModule({label:'positive separable display filter',code:AXIS_WGSL});
    const create=(entryPoint,shader=module,constants={})=>device.createComputePipeline({label:entryPoint,layout:'auto',compute:{module:shader,entryPoint,constants}});
    pipelines={seed:create('seedDisplayField'),finish:create('finishDisplayField'),
      axes:[0,1].map(axis=>create('filterDisplayAxis',axisModule,{DISPLAY_AXIS:axis}))};
  };
  return {
    get view(){return (textures[3]??fallback).createView({dimension:'3d'});},
    ensure(grid,next) {
      const nextShapes=next.value?displayReconstructionShapes(grid,next.scale):[];
      if(nextShapes.some(s=>s.some(n=>n>device.limits.maxTextureDimension3D))) {
        return {changed:false,admitted:false,reason:'display-grid-exceeds-device-3d-texture-dimensions'};
      }
      config=next;
      const nextSignature=JSON.stringify([grid,next.value?next.scale:0]);
      if(signature===nextSignature)return {changed:false,admitted:true,reason:null};
      signature=nextSignature;key=null;groups=null;
      for(const t of textures)t.destroy();
      textures=[];shapes=[];
      if(next.value) {
        shapes=nextShapes;
        textures=shapes.map(texture);
        initialize();
        groups={seed:group(pipelines.seed,3,[{binding:12,resource:textures[0].createView()}]),
          finish0:group(pipelines.finish,0,[{binding:0,resource:{buffer:uniformBuffer}}]),
          finish3:group(pipelines.finish,3,[{binding:12,resource:textures[3].createView()},{binding:13,resource:textures[2].createView()}]),
          axes:pipelines.axes.map((p,i)=>group(p,0,[{binding:0,resource:textures[i].createView()},
            {binding:1,resource:textures[i+1].createView()},{binding:2,resource:{buffer:amounts}}]))};
      }
      return {changed:true,admitted:true,reason:null};
    },
    encode(encoder,sourceIndex,sourceKey,timing=null) {
      if(!config.value)return false;
      const inputs=getInputs();
      if(inputBuffers!==inputs.fluid || inputTextures!==inputs.reactant) {
        inputBuffers=inputs.fluid;inputTextures=inputs.reactant;key=null;
        seedInputs=inputs.fluid.map((buffer,i)=>group(pipelines.seed,0,[
          {binding:0,resource:{buffer:uniformBuffer}},{binding:1,resource:{buffer}},
          {binding:23,resource:inputs.reactant[i].createView()}]));
      }
      const nextKey=JSON.stringify([sourceKey,sourceIndex,config]);
      if(key===nextKey)return false;
      device.queue.writeBuffer(amounts,0,new Float32Array([config.emission,config.smoke,0,0]));
      const pass=encoder.beginComputePass({label:'prepare flame display reconstruction',
        ...(timing?{timestampWrites:{querySet:timing.querySet,beginningOfPassWriteIndex:timing.beginningOfPassWriteIndex}}:{})});
      const dispatch=shape=>pass.dispatchWorkgroups(...shape.map(n=>Math.ceil(n/4)));
      pass.setPipeline(pipelines.seed);pass.setBindGroup(0,seedInputs[sourceIndex]);pass.setBindGroup(3,groups.seed);dispatch(shapes[0]);
      // Separate passes avoid retaining bindings whose sampled texture becomes
      // the next pass's storage output in a different pipeline layout.
      pass.end();
      for(let i=0;i<2;i++) {
        const axis=encoder.beginComputePass({label:'display reconstruction axis '+i});
        axis.setPipeline(pipelines.axes[i]);axis.setBindGroup(0,groups.axes[i]);
        axis.dispatchWorkgroups(...shapes[i+1].map(n=>Math.ceil(n/4)));axis.end();
      }
      const finish=encoder.beginComputePass({label:'display reconstruction final axis and optics',
        ...(timing?{timestampWrites:{querySet:timing.querySet,endOfPassWriteIndex:timing.endOfPassWriteIndex}}:{})});
      finish.setPipeline(pipelines.finish);finish.setBindGroup(0,groups.finish0);finish.setBindGroup(3,groups.finish3);
      finish.dispatchWorkgroups(...shapes[3].map(n=>Math.ceil(n/4)));finish.end();
      key=nextKey;builds++;return true;
    },
    invalidate(){key=null;},
    read(){return {...config,grid:shapes[3]??null,bytes:shapes.reduce((sum,s)=>sum+s.reduce((a,b)=>a*b,16),0),builds,
      format:'rgba32float',filter:'separable-positive-bspline',lighting:'unchanged-native-source',simulationWrites:false};},
    destroy(){for(const t of textures)t.destroy();fallback.destroy();amounts.destroy();},
  };
}
