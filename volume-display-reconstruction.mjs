// Display-only reconstruction. Never writes simulation fields.
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
  const alignment=controls.displayAlignment??'cell-centred';
  if(!['cell-centred','aligned'].includes(alignment))throw Error('Unknown display alignment');
  const emissionInterpolation=controls.emissionInterpolation??'positive';
  const smokeInterpolation=controls.smokeInterpolation??'positive';
  if(![emissionInterpolation,smokeInterpolation].every(v=>['positive','interpolating'].includes(v)))
    throw Error('Unknown display interpolation');
  return { mode, value, scale, emission, smoke, alignment, emissionInterpolation, smokeInterpolation };
}

export function positiveCubicWeights(f, smoothing = 1) {
  const cubic = [(1-f)**3/6, (3*f**3-6*f*f+4)/6, (-3*f**3+3*f*f+3*f+1)/6, f**3/6];
  const linear = [0, 1-f, f, 0];
  return cubic.map((v,i) => linear[i] + smoothing*(v-linear[i]));
}

export function displayAxisCoordinate(j,n,scale,alignment) {
  return alignment==='aligned'?j/scale:(j+.5)/scale-.5;
}
export function displayCameraCoordinate(cell,scale,alignment) {
  return alignment==='aligned'?(cell-.5)*scale:cell*scale-.5;
}
export function displayReconstructionShapes(grid, scale, alignment='cell-centred') {
  const dims=grid.map(n=>alignment==='aligned'?(n-1)*scale+1:n*scale);
  return [grid, [dims[0],grid[1],grid[2]], [dims[0],dims[1],grid[2]], dims];
}

// At a knot the cubic basis gives (c[-1]+4*c[0]+c[1])/6.
// Repeated end coefficients give diagonal 5 at the two boundaries.
export function splineInverseDiagonal(n) {
  const inverse=new Float64Array(n);
  for(let i=0;i<n;i++)inverse[i]=1/((n===1?6:i===0||i===n-1?5:4)-(i?inverse[i-1]:0));
  return inverse;
}
export function interpolatingSplineCoefficients(samples) {
  const inverse=splineInverseDiagonal(samples.length), c=new Float64Array(samples.length);
  for(let i=0;i<c.length;i++)c[i]=(6*samples[i]-(i?c[i-1]:0))*inverse[i];
  for(let i=c.length-2;i>=0;i--)c[i]-=inverse[i]*c[i+1];
  return [...c];
}
export function sampleDisplayLine(samples,coefficients,q,kind,amount) {
  const cell=Math.floor(q), f=q-cell, weights=positiveCubicWeights(f);
  const at=(values,i)=>values[Math.max(0,Math.min(values.length-1,i))];
  const linear=at(samples,cell)*(1-f)+at(samples,cell+1)*f;
  const cubic=weights.reduce((sum,w,i)=>sum+w*at(kind==='interpolating'?coefficients:samples,cell+i-1),0);
  return linear+amount*(cubic-linear);
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
fn displayAxisSample(c: vec3<u32>, dst: vec3<u32>, axis: u32, amounts: vec2<f32>, aligned: bool, scale: f32, kernels: vec2<f32>) -> vec4<f32> {
  let src=textureDimensions(displayFilterInput);
  let q=select((f32(c[axis])+0.5)*f32(src[axis])/f32(dst[axis])-0.5,f32(c[axis])/scale,aligned);
  let cell=i32(floor(q)); let f=fract(q);
  let cubicWeights=displayWeights(f,1.0);
  let linearWeights=displayWeights(f,0.0);
  let interpolating=vec4<bool>(vec3<bool>(kernels.x>0.5 && amounts.x>0.0),kernels.y>0.5 && amounts.y>0.0);
  var linear=vec4<f32>(0.0);var cubic=vec4<f32>(0.0);
  for(var i=0u;i<4u;i++) {
    var p=vec3<i32>(c); p[axis]=clamp(cell+i32(i)-1,0,i32(src[axis])-1);
    let raw=textureLoad(displayFilterInput,p,0);
    var coefficient=raw;
    if(any(interpolating)) {
      let index=u32(p.x)+src.x*(u32(p.y)+src.y*u32(p.z));
      coefficient=select(raw,displayCoefficients[index],interpolating);
    }
    linear+=raw*linearWeights[i];cubic+=coefficient*cubicWeights[i];
  }
  return mix(linear,cubic,vec4<f32>(vec3<f32>(amounts.x),amounts.y));
}
`;

export const DISPLAY_AXIS_WGSL = /* wgsl */`
override DISPLAY_AXIS: u32=0u;
@group(0) @binding(0) var displayFilterInput: texture_3d<f32>;
@group(0) @binding(1) var displayFilterOutput: texture_storage_3d<rgba32float,write>;
struct DisplayFilterOptions { amounts: vec4<f32>, kernels: vec4<f32> }
@group(0) @binding(2) var<uniform> displayOptions: DisplayFilterOptions;
@group(0) @binding(3) var<storage,read> displayCoefficients: array<vec4<f32>>;
${FILTER_WGSL}
@compute @workgroup_size(4,4,4)
fn filterDisplayAxis(@builtin(global_invocation_id) c: vec3<u32>) {
  let dst=textureDimensions(displayFilterOutput);
  if(any(c>=dst)){return;}
  textureStore(displayFilterOutput,vec3<i32>(c),displayAxisSample(c,dst,DISPLAY_AXIS,displayOptions.amounts.xy,displayOptions.amounts.z>0.5,displayOptions.amounts.w,displayOptions.kernels.xy));
}
`;

export const DISPLAY_PREFILTER_WGSL = /* wgsl */`
override DISPLAY_AXIS: u32=0u;
@group(0) @binding(0) var source: texture_3d<f32>;
@group(0) @binding(1) var<storage,read_write> coefficients: array<vec4<f32>>;
@group(0) @binding(2) var<storage,read> inverseDiagonal: array<f32>;
fn coefficientIndex(p: vec3<u32>,dims: vec3<u32>) -> u32 {return p.x+dims.x*(p.y+dims.y*p.z);}
@compute @workgroup_size(64)
fn prefilterDisplayLine(@builtin(global_invocation_id) id: vec3<u32>, @builtin(num_workgroups) groups: vec3<u32>) {
  let dims=textureDimensions(source);
  let a=(DISPLAY_AXIS+1u)%3u;let b=(DISPLAY_AXIS+2u)%3u;
  let line=id.x+id.y*groups.x*64u;
  if(line>=dims[a]*dims[b]){return;}
  var p=vec3<u32>(0u);p[a]=line%dims[a];p[b]=line/dims[a];
  var previous=vec4<f32>(0.0);
  for(var i=0u;i<dims[DISPLAY_AXIS];i++) {
    p[DISPLAY_AXIS]=i;
    previous=(6.0*textureLoad(source,vec3<i32>(p),0)-previous)*inverseDiagonal[i];
    coefficients[coefficientIndex(p,dims)]=previous;
  }
  for(var i=i32(dims[DISPLAY_AXIS])-2;i>=0;i--) {
    p[DISPLAY_AXIS]=u32(i);let index=coefficientIndex(p,dims);
    previous=coefficients[index]-inverseDiagonal[u32(i)]*previous;
    coefficients[index]=previous;
  }
}
`;

// These entry points compose with the native temperature/radiance functions.
// Raw mode stores soot, heat, fresh burn, and independent smoke soot. Optical
// mode stores emission RGB and extinction. No FP16 clipping or normalization.
export const DISPLAY_RECONSTRUCTION_WGSL = /* wgsl */`
@group(0) @binding(34) var displayField: texture_3d<f32>;
@group(3) @binding(12) var displayFilterOutput: texture_storage_3d<rgba32float,write>;
@group(3) @binding(13) var displayFilterInput: texture_3d<f32>;
@group(3) @binding(14) var<storage,read> displayCoefficients: array<vec4<f32>>;
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
  var value=displayAxisSample(c,dst,2u,u.display_reconstruction.yz,u.display_interpolation.x>0.5,u.display_reconstruction.w,u.display_interpolation.yz);
  if(u.display_reconstruction.x<1.5){value=displayOptics(value);}
  // Coefficients/intermediate axes stay signed. Only physical output has a
  // zero floor; there is no local-maximum or normalized-range ceiling.
  textureStore(displayFilterOutput,vec3<i32>(c),max(value,vec4<f32>(0.0)));
}
fn displayReconstructionActive() -> bool {
  return LEAN_EMISSIVE_RAYMARCH && u.display_reconstruction.x>0.5;
}
fn sampleDisplayMaterial(p: vec3<f32>, smokeVisible: f32) -> EmissiveMaterial {
  let dims=textureDimensions(displayField);
  // Cubic simulation cells: a tall domain has more Y cells, not taller cells.
  let cell=worldToCell(p);
  let mapped=select(cell*u.display_reconstruction.w-0.5,(cell-0.5)*u.display_reconstruction.w,u.display_interpolation.x>0.5);
  let q=clamp(mapped,vec3<f32>(0.0),vec3<f32>(dims)-1.0);
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
  const coefficientFallback=device.createBuffer({label:'unused display coefficients',size:16,usage:GPUBufferUsage.STORAGE});
  let textures=[], shapes=[], signature='', key=null, pipelines=null, groups=null, builds=0;
  let coefficientBuffer=null, diagonals=[], coefficientBytes=0;
  let config=resolveDisplayReconstruction();
  let inputBuffers=null, inputTextures=null, seedInputs=null;
  const amounts=device.createBuffer({label:'display filter options',size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
  const group=(pipeline,index,entries)=>device.createBindGroup({layout:pipeline.getBindGroupLayout(index),entries});
  const initialize=()=>{
    if(pipelines)return;
    const axisModule=device.createShaderModule({label:'separable display filter',code:DISPLAY_AXIS_WGSL});
    const prefilterModule=device.createShaderModule({label:'interpolating spline coefficient solve',code:DISPLAY_PREFILTER_WGSL});
    const create=(entryPoint,shader=module,constants={})=>device.createComputePipeline({label:entryPoint,layout:'auto',compute:{module:shader,entryPoint,constants}});
    pipelines={seed:create('seedDisplayField'),finish:create('finishDisplayField'),
      axes:[0,1].map(axis=>create('filterDisplayAxis',axisModule,{DISPLAY_AXIS:axis})),
      prefilter:[0,1,2].map(axis=>create('prefilterDisplayLine',prefilterModule,{DISPLAY_AXIS:axis}))};
  };
  return {
    get view(){return (textures[3]??fallback).createView({dimension:'3d'});},
    ensure(grid,next) {
      const nextShapes=next.value?displayReconstructionShapes(grid,next.scale,next.alignment):[];
      const needsCoefficients=next.value && (next.emissionInterpolation==='interpolating' || next.smokeInterpolation==='interpolating');
      const nextCoefficientBytes=needsCoefficients?Math.max(...nextShapes.slice(0,3).map(s=>s.reduce((a,b)=>a*b,16))):0;
      if(nextShapes.some(s=>s.some(n=>n>device.limits.maxTextureDimension3D))) {
        return {changed:false,admitted:false,reason:'display-grid-exceeds-device-3d-texture-dimensions'};
      }
      if(nextCoefficientBytes>Math.min(device.limits.maxStorageBufferBindingSize,device.limits.maxBufferSize)) {
        return {changed:false,admitted:false,reason:'display-coefficients-exceed-device-buffer-size'};
      }
      config=next;
      const nextSignature=JSON.stringify([grid,next.value?next.scale:0,next.alignment,Boolean(needsCoefficients)]);
      if(signature===nextSignature)return {changed:false,admitted:true,reason:null};
      signature=nextSignature;key=null;groups=null;
      for(const t of textures)t.destroy();
      coefficientBuffer?.destroy();for(const b of diagonals)b.destroy();
      coefficientBuffer=null;diagonals=[];coefficientBytes=0;
      textures=[];shapes=[];
      if(next.value) {
        shapes=nextShapes;
        textures=shapes.map(texture);
        initialize();
        if(needsCoefficients) {
          coefficientBytes=nextCoefficientBytes;
          coefficientBuffer=device.createBuffer({label:'signed display spline coefficients',size:coefficientBytes,usage:GPUBufferUsage.STORAGE});
          diagonals=grid.map(n=>{
            const buffer=device.createBuffer({label:'display spline inverse diagonal',size:n*4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
            device.queue.writeBuffer(buffer,0,new Float32Array(splineInverseDiagonal(n)));return buffer;
          });
        }
        const coefficients={buffer:coefficientBuffer??coefficientFallback};
        groups={seed:group(pipelines.seed,3,[{binding:12,resource:textures[0].createView()}]),
          finish0:group(pipelines.finish,0,[{binding:0,resource:{buffer:uniformBuffer}}]),
          finish3:group(pipelines.finish,3,[{binding:12,resource:textures[3].createView()},{binding:13,resource:textures[2].createView()},{binding:14,resource:coefficients}]),
          axes:pipelines.axes.map((p,i)=>group(p,0,[{binding:0,resource:textures[i].createView()},
            {binding:1,resource:textures[i+1].createView()},{binding:2,resource:{buffer:amounts}},{binding:3,resource:coefficients}])),
          prefilter:needsCoefficients?pipelines.prefilter.map((p,i)=>group(p,0,[{binding:0,resource:textures[i].createView()},
            {binding:1,resource:coefficients},{binding:2,resource:{buffer:diagonals[i]}}])):[]};
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
      device.queue.writeBuffer(amounts,0,new Float32Array([config.emission,config.smoke,config.alignment==='aligned'?1:0,config.scale,
        config.emissionInterpolation==='interpolating'?1:0,config.smokeInterpolation==='interpolating'?1:0,0,0]));
      const pass=encoder.beginComputePass({label:'prepare flame display reconstruction',
        ...(timing?{timestampWrites:{querySet:timing.querySet,beginningOfPassWriteIndex:timing.beginningOfPassWriteIndex}}:{})});
      const dispatch=shape=>pass.dispatchWorkgroups(...shape.map(n=>Math.ceil(n/4)));
      pass.setPipeline(pipelines.seed);pass.setBindGroup(0,seedInputs[sourceIndex]);pass.setBindGroup(3,groups.seed);dispatch(shapes[0]);
      // Separate passes avoid retaining bindings whose sampled texture becomes
      // the next pass's storage output in a different pipeline layout.
      pass.end();
      const prefilter=axis=>{
        if(!coefficientBuffer || !((config.emissionInterpolation==='interpolating'&&config.emission>0) || (config.smokeInterpolation==='interpolating'&&config.smoke>0)))return;
        const solve=encoder.beginComputePass({label:'display spline coefficients axis '+axis});
        solve.setPipeline(pipelines.prefilter[axis]);solve.setBindGroup(0,groups.prefilter[axis]);
        const shape=shapes[axis];const lines=shape.reduce((a,b)=>a*b,1)/shape[axis];
        const count=Math.ceil(lines/64), width=Math.min(count,device.limits.maxComputeWorkgroupsPerDimension);
        solve.dispatchWorkgroups(width,Math.ceil(count/width));solve.end();
      };
      for(let i=0;i<2;i++) {
        prefilter(i);
        const axis=encoder.beginComputePass({label:'display reconstruction axis '+i});
        axis.setPipeline(pipelines.axes[i]);axis.setBindGroup(0,groups.axes[i]);
        axis.dispatchWorkgroups(...shapes[i+1].map(n=>Math.ceil(n/4)));axis.end();
      }
      prefilter(2);
      const finish=encoder.beginComputePass({label:'display reconstruction final axis and optics',
        ...(timing?{timestampWrites:{querySet:timing.querySet,endOfPassWriteIndex:timing.endOfPassWriteIndex}}:{})});
      finish.setPipeline(pipelines.finish);finish.setBindGroup(0,groups.finish0);finish.setBindGroup(3,groups.finish3);
      finish.dispatchWorkgroups(...shapes[3].map(n=>Math.ceil(n/4)));finish.end();
      key=nextKey;builds++;return true;
    },
    invalidate(){key=null;},
    read(){return {...config,grid:shapes[3]??null,bytes:shapes.reduce((sum,s)=>sum+s.reduce((a,b)=>a*b,16),0)+coefficientBytes+diagonals.reduce((sum,b)=>sum+b.size,0),builds,
      format:'rgba32float',filter:'separable-bspline',lighting:'unchanged-native-source',simulationWrites:false};},
    destroy(){for(const t of textures)t.destroy();coefficientBuffer?.destroy();for(const b of diagonals)b.destroy();coefficientFallback.destroy();fallback.destroy();amounts.destroy();},
  };
}
