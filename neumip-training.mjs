import {AUTHOR_SPATIAL_RECIPE,LEGACY_SPATIAL_RECIPE,checkedNeumipTrainingRecipe,neumipSpatialTrainingState,createNeumipSpatialFilter} from './neumip-spatial-training.mjs';
export {neumipSpatialTrainingState} from './neumip-spatial-training.mjs';
// Browser/native WebGPU training for Kaminos's released NeuMIP web format.
// Parameters remain float32; all levels are independent learned fields.
const TARGET_STATE=Symbol('NeuMIP current target batch');
export function createNeumipStudent({resolution=64,seed=1,trainingRecipe=LEGACY_SPATIAL_RECIPE}={}) {
  checkedNeumipTrainingRecipe(trainingRecipe);
  if(!Number.isInteger(resolution)||resolution<2||!Number.isInteger(Math.log2(resolution)))throw Error('NeuMIP resolution must be a power of two >= 2');
  let state=seed>>>0;
  const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return (state+.5)/4294967296;};
  const normal=()=>Math.sqrt(-2*Math.log(random()))*Math.cos(2*Math.PI*random());
  const texture=(size,channels)=>({width:size,height:size,channels,data:Float32Array.from({length:size*size*channels},()=>normal()*(trainingRecipe===AUTHOR_SPATIAL_RECIPE?.1:.05))});
  const offset=texture(resolution,6),mips=[];
  if(trainingRecipe===AUTHOR_SPATIAL_RECIPE)offset.data.fill(0);
  for(let n=resolution;n>=2;n/=2)mips.push(texture(n,8));
  const layers=[];
  for(const [prefix,sizes] of [['offset_network',[8,24,24,24,1]],['main',[12,24,24,24,6]]])for(let k=0;k<4;k++){
    const input=sizes[k],output=sizes[k+1],scale=k===3?.03:Math.sqrt(2/input);
    const biases=new Float32Array(output);if(prefix==='main'&&k===3)biases[0]=.05;
    layers.push({name:`${prefix}.mpl${k}`,input,output,relu:k<3,weights:Float32Array.from({length:input*output},()=>normal()*scale),biases});
  }
  return {offset,mips,layers,architecture:'kaminos-neumip-web-distillation-v1'};
}

export function neumipTrainingLayout(model) {
  let at=0,act=0,delta=0;
  const networks={};
  for(const prefix of ['offset_network','main']){
    const layers=[];const input=prefix==='main'?12:8;
    const inputOffset=act;act+=input;
    for(let k=0;k<4;k++){
      const source=model.layers.find(l=>l.name===`${prefix}.mpl${k}`);
      const weightsOffset=at;at+=source.weights.length;
      const biasesOffset=at;at+=source.biases.length;
      layers.push({...source,weightsOffset,biasesOffset,inputOffset:k?layers[k-1].actOffset:inputOffset,actOffset:act,deltaOffset:delta});
      act+=source.output;delta+=source.output;
    }
    networks[prefix]={inputOffset,layers};
  }
  const weightCount=at;
  const fields=[model.offset,...model.mips].map(t=>{const field={...t,offset:at};at+=t.data.length;return field;});
  const values=new Float32Array(at);
  for(const net of Object.values(networks))for(const l of net.layers){values.set(l.weights,l.weightsOffset);values.set(l.biases,l.biasesOffset);}
  for(const f of fields)values.set(f.data,f.offset);
  return {networks,fields,weightCount,count:at,actCount:act,deltaCount:delta,scratchStride:act+delta+4,values};
}

// Exact storage requirements, shared by device admission and allocation.
export function neumipTrainingBufferSizes(layout,batchSize,{trainingRecipe=LEGACY_SPATIAL_RECIPE}={}) {
  checkedNeumipTrainingRecipe(trainingRecipe);
  if(!Number.isSafeInteger(batchSize)||batchSize<1)throw Error('batchSize must be positive');
  return {parameters:layout.count*4,queries:batchSize*8*4,targets:batchSize*3*4,gradients:layout.count*4,
    scratch:batchSize*layout.scratchStride*4,partial:layout.weightCount*Math.ceil(batchSize/64)*4,moments:layout.count*8,...(trainingRecipe===AUTHOR_SPATIAL_RECIPE?{spatialParameters:layout.count*4,spatialScratch:layout.count*4,spatialGradient:layout.count*4}:{})};
}

export function restoreNeumipParameters(model,layout,values) {
  if(values.length!==layout.count||!values.every(Number.isFinite))throw Error('Invalid fitted NeuMIP parameter array');
  for(const net of Object.values(layout.networks))for(const l of net.layers){
    l.weights.set(values.subarray(l.weightsOffset,l.weightsOffset+l.weights.length));
    l.biases.set(values.subarray(l.biasesOffset,l.biasesOffset+l.biases.length));
  }
  for(const f of layout.fields)f.data.set(values.subarray(f.offset,f.offset+f.data.length));
  return model;
}

export function buildNeumipTrainingWGSL(layout) {
  const {networks,fields,weightCount,actCount,deltaCount,scratchStride}=layout;
  const off=networks.offset_network,main=networks.main;
  const o=off.layers[3].actOffset,m=main.layers[3].actOffset;
  const md=main.layers[3].deltaOffset;
  const forward=net=>net.layers.map(l=>`
    for(var j=0u;j<${l.output}u;j++) {
      var v=p[${l.biasesOffset}u+j];
      for(var i=0u;i<${l.input}u;i++){v+=p[${l.weightsOffset}u+j*${l.input}u+i]*a[${l.inputOffset}u+i];}
      a[${l.actOffset}u+j]=${l.relu?'max(v,0.0)':'v'};
    }`).join('\n');
  const backward=net=>[...net.layers].reverse().map((l,rev)=>{
    const prev=net.layers[net.layers.length-2-rev];
    return `for(var i=0u;i<${l.input}u;i++){
      var sum=0.0;for(var j=0u;j<${l.output}u;j++){sum+=p[${l.weightsOffset}u+j*${l.input}u+i]*d[${l.deltaOffset}u+j];}
      ${prev?`d[${prev.deltaOffset}u+i]=select(0.0,sum,a[${prev.actOffset}u+i]>0.0);`:'di[i]=sum;'}
    }`;
  }).join('\n');
  const gradCase=Object.values(networks).flatMap(n=>n.layers).map(l=>`
    if(w>=${l.weightsOffset}u && w<${l.biasesOffset}u){
      let k=w-${l.weightsOffset}u;let j=k/${l.input}u;let i=k%${l.input}u;
      v=scratch[base+${actCount+l.deltaOffset}u+j]*scratch[base+${l.inputOffset}u+i];
    }
    if(w>=${l.biasesOffset}u && w<${l.biasesOffset+l.output}u){
      v=scratch[base+${actCount+l.deltaOffset}u+w-${l.biasesOffset}u];
    }`).join('\n');
  return `
struct Config { count:u32,step:u32,lrWeights:f32,lrFields:f32,lodBias:f32,freezeOffset:u32,_pad1:f32,_pad2:f32 }
@group(0) @binding(0) var<storage,read_write> p:array<f32>;
@group(0) @binding(1) var<storage,read> queries:array<f32>;
@group(0) @binding(2) var<storage,read_write> targets:array<f32>;
@group(0) @binding(3) var<storage,read_write> grad:array<atomic<u32>>;
@group(0) @binding(4) var<storage,read_write> scratch:array<f32>;
@group(0) @binding(5) var<storage,read_write> partial:array<f32>;
@group(0) @binding(6) var<storage,read_write> moments:array<vec2<f32>>;
@group(0) @binding(7) var<uniform> cfg:Config;
const WIDTH:array<u32,${fields.length}>=array<u32,${fields.length}>(${fields.map(f=>f.width+'u').join(',')});
const HEIGHT:array<u32,${fields.length}>=array<u32,${fields.length}>(${fields.map(f=>f.height+'u').join(',')});
const CHANNELS:array<u32,${fields.length}>=array<u32,${fields.length}>(${fields.map(f=>f.channels+'u').join(',')});
const FIELD:array<u32,${fields.length}>=array<u32,${fields.length}>(${fields.map(f=>f.offset+'u').join(',')});
var<private> a:array<f32,${actCount}>;
var<private> d:array<f32,${deltaCount}>;
var<private> di:array<f32,12>;
fn address(f:u32,xy:vec2<i32>,c:u32)->u32 {
  let size=vec2<i32>(i32(WIDTH[f]),i32(HEIGHT[f]));let q=((xy%size)+size)%size;
  return FIELD[f]+(u32(q.y)*WIDTH[f]+u32(q.x))*CHANNELS[f]+c;
}
fn sampleField(f:u32,uv:vec2<f32>,c:u32)->vec3<f32>{
  let xy=uv*vec2<f32>(f32(WIDTH[f]),f32(HEIGHT[f]))-0.5;let lo=vec2<i32>(floor(xy));let t=fract(xy);
  let v00=p[address(f,lo,c)];let v10=p[address(f,lo+vec2<i32>(1,0),c)];
  let v01=p[address(f,lo+vec2<i32>(0,1),c)];let v11=p[address(f,lo+vec2<i32>(1,1),c)];
  return vec3<f32>(mix(mix(v00,v10,t.x),mix(v01,v11,t.x),t.y),
    mix(v10-v00,v11-v01,t.y)*f32(WIDTH[f]),mix(v01-v00,v11-v10,t.x)*f32(HEIGHT[f]));
}
fn addGrad(index:u32,value:f32){
  if(value==0.0){return;}
  var old=atomicLoad(&grad[index]);
  loop{let result=atomicCompareExchangeWeak(&grad[index],old,bitcast<u32>(bitcast<f32>(old)+value));
    if(result.exchanged){break;}old=result.old_value;}
}
fn scatterField(f:u32,uv:vec2<f32>,c:u32,g:f32){
  let xy=uv*vec2<f32>(f32(WIDTH[f]),f32(HEIGHT[f]))-0.5;let lo=vec2<i32>(floor(xy));let t=fract(xy);
  addGrad(address(f,lo,c),g*(1.0-t.x)*(1.0-t.y));
  addGrad(address(f,lo+vec2<i32>(1,0),c),g*t.x*(1.0-t.y));
  addGrad(address(f,lo+vec2<i32>(0,1),c),g*(1.0-t.x)*t.y);
  addGrad(address(f,lo+vec2<i32>(1,1),c),g*t.x*t.y);
}
fn offsetForward(){${forward(off)}}
fn mainForward(){${forward(main)}}
fn offsetBackward(){${backward(off)}}
fn mainBackward(){${backward(main)}}
fn evaluate(q:u32)->vec3<f32>{
  let uv=vec2<f32>(queries[q*8u],queries[q*8u+1u]);
  let view=vec2<f32>(queries[q*8u+2u],queries[q*8u+3u]);
  for(var c=0u;c<6u;c++){a[${off.inputOffset}u+c]=sampleField(0u,uv,c).x;}
  a[${off.inputOffset+6}u]=view.x;a[${off.inputOffset+7}u]=view.y;offsetForward();
  let z=max(0.6,sqrt(max(0.0,1.0-dot(view,view))));
  let shifted=fract(uv)+a[${o}u]*view/z*0.05;
  let lod=clamp(queries[q*8u+6u]+cfg.lodBias,0.0,${(fields.length-2).toFixed(1)});
  let low=u32(floor(lod))+1u;let high=min(low+1u,${fields.length-1}u);let t=fract(lod);
  a[${main.inputOffset}u]=queries[q*8u+4u];a[${main.inputOffset+1}u]=queries[q*8u+5u];
  a[${main.inputOffset+2}u]=view.x;a[${main.inputOffset+3}u]=view.y;
  for(var c=0u;c<8u;c++){a[${main.inputOffset+4}u+c]=mix(sampleField(low,shifted,c).x,sampleField(high,shifted,c).x,t);}
  mainForward();
  let logRGB=vec3<f32>(a[${m}u]+1.13983*a[${m+2}u],a[${m}u]-0.39465*a[${m+1}u]-0.58060*a[${m+2}u],a[${m}u]+2.03211*a[${m+1}u]);
  let shadow=0.1+1.0/(1.0+exp(-vec3<f32>(a[${m+3}u],a[${m+4}u],a[${m+5}u])));
  return (exp(logRGB)-1.0)*shadow;
}
@compute @workgroup_size(64) fn teacher(@builtin(global_invocation_id) id:vec3<u32>){
  let q=id.x;if(q>=cfg.count){return;}let rgb=evaluate(q);
  for(var c=0u;c<3u;c++){targets[q*3u+c]=rgb[c];}
}
@compute @workgroup_size(64) fn inference(@builtin(global_invocation_id) id:vec3<u32>){
  let q=id.x;if(q>=cfg.count){return;}let rgb=evaluate(q);let base=q*${scratchStride}u;
  for(var c=0u;c<3u;c++){scratch[base+${actCount+deltaCount+1}u+c]=rgb[c];}
}
@compute @workgroup_size(64) fn backward(@builtin(global_invocation_id) id:vec3<u32>){
  let q=id.x;if(q>=cfg.count){return;}let rgb=evaluate(q);let base=q*${scratchStride}u;
  let teacherColor=vec3<f32>(targets[q*3u],targets[q*3u+1u],targets[q*3u+2u]);
  let error=rgb-teacherColor;
  scratch[base+${actCount+deltaCount}u]=dot(error,error)*0.5;
  for(var c=0u;c<3u;c++){scratch[base+${actCount+deltaCount+1}u+c]=rgb[c];}
  let logRGB=vec3<f32>(a[${m}u]+1.13983*a[${m+2}u],a[${m}u]-0.39465*a[${m+1}u]-0.58060*a[${m+2}u],a[${m}u]+2.03211*a[${m+1}u]);
  let sigmoid=1.0/(1.0+exp(-vec3<f32>(a[${m+3}u],a[${m+4}u],a[${m+5}u])));
  let colorGrad=error*(0.1+sigmoid)*exp(logRGB);
  d[${md}u]=colorGrad.x+colorGrad.y+colorGrad.z;
  d[${md+1}u]=-0.39465*colorGrad.y+2.03211*colorGrad.z;
  d[${md+2}u]=1.13983*colorGrad.x-0.58060*colorGrad.y;
  for(var c=0u;c<3u;c++){d[${md+3}u+c]=error[c]*(exp(logRGB[c])-1.0)*sigmoid[c]*(1.0-sigmoid[c]);}
  mainBackward();
  let uv=vec2<f32>(queries[q*8u],queries[q*8u+1u]);let view=vec2<f32>(queries[q*8u+2u],queries[q*8u+3u]);
  let factor=view/max(0.6,sqrt(max(0.0,1.0-dot(view,view))))*0.05;
  let shifted=fract(uv)+a[${o}u]*factor;
  let lod=clamp(queries[q*8u+6u]+cfg.lodBias,0.0,${(fields.length-2).toFixed(1)});
  let low=u32(floor(lod))+1u;let high=min(low+1u,${fields.length-1}u);let t=fract(lod);
  var depthGrad=0.0;
  for(var c=0u;c<8u;c++){
    let g=di[c+4u];let s0=sampleField(low,shifted,c);let s1=sampleField(high,shifted,c);
    depthGrad+=g*dot(mix(s0.yz,s1.yz,t),factor);
    scatterField(low,shifted,c,g*(1.0-t));scatterField(high,shifted,c,g*t);
  }
  d[${off.layers[3].deltaOffset}u]=depthGrad;offsetBackward();
  for(var c=0u;c<6u;c++){scatterField(0u,uv,c,di[c]);}
  for(var i=0u;i<${actCount}u;i++){scratch[base+i]=a[i];}
  for(var i=0u;i<${deltaCount}u;i++){scratch[base+${actCount}u+i]=d[i];}
}
var<workgroup> sums:array<f32,64>;
@compute @workgroup_size(64) fn weightPartials(@builtin(workgroup_id) group:vec3<u32>,@builtin(local_invocation_id) local:vec3<u32>){
  let w=group.x;let q=group.y*64u+local.x;let base=q*${scratchStride}u;var v=0.0;
  if(q<cfg.count){${gradCase}}
  sums[local.x]=v;workgroupBarrier();var stride=32u;
  loop {if(local.x<stride){sums[local.x]+=sums[local.x+stride];}workgroupBarrier();
    if(stride==1u){break;}stride/=2u;}
  if(local.x==0u){partial[w*((cfg.count+63u)/64u)+group.y]=sums[0];}
}
@compute @workgroup_size(64) fn collectWeights(@builtin(global_invocation_id) id:vec3<u32>){
  let w=id.x;if(w>=${weightCount}u){return;}let blocks=(cfg.count+63u)/64u;var sum=0.0;
  for(var b=0u;b<blocks;b++){sum+=partial[w*blocks+b];}atomicStore(&grad[w],bitcast<u32>(sum));
}
@compute @workgroup_size(64) fn adam(@builtin(global_invocation_id) id:vec3<u32>,@builtin(num_workgroups) groups:vec3<u32>){
  let i=id.x+id.y*groups.x*64u;if(i>=${layout.count}u){return;}if(cfg.freezeOffset!=0u&&i>=FIELD[0]&&i<FIELD[0]+WIDTH[0]*HEIGHT[0]*CHANNELS[0]){return;}let g=bitcast<f32>(atomicLoad(&grad[i]))/f32(cfg.count);
  let mv=moments[i];let next=vec2<f32>(0.9*mv.x+0.1*g,0.999*mv.y+0.001*g*g);moments[i]=next;
  let lr=select(cfg.lrFields,cfg.lrWeights,i<${weightCount}u);
  p[i]-=lr*(next.x/(1.0-pow(0.9,f32(cfg.step))))/(sqrt(next.y/(1.0-pow(0.999,f32(cfg.step))))+1e-8);
}
`;
}

// Receives an existing device: browser Kit and native Dawn use identical WGSL.
// The caller owns scheduling/admission and can pause between fenced updates.
export async function createNeumipTraining(device,model,{batchSize=4096,trainingRecipe:requestedRecipe}={}) {
  const explicitRecipe=requestedRecipe!==undefined,trainingRecipe=checkedNeumipTrainingRecipe(requestedRecipe);
  if(!Number.isSafeInteger(batchSize)||batchSize<1)throw Error('batchSize must be positive');
  const layout=neumipTrainingLayout(model),sizes=neumipTrainingBufferSizes(layout,batchSize,{trainingRecipe}),buffers=[];
  for(const [label,bytes] of Object.entries(sizes)){
    if(bytes>device.limits?.maxStorageBufferBindingSize)throw Error(`NeuMIP storage binding ${label} requires ${bytes} bytes; device limit is ${device.limits.maxStorageBufferBindingSize}. Request sufficient device limits.`);
    if(bytes>device.limits?.maxBufferSize)throw Error(`NeuMIP buffer ${label} requires ${bytes} bytes; device limit is ${device.limits.maxBufferSize}`);
  }
  const storage=(label,bytes,extra=0)=>{const b=device.createBuffer({label,size:Math.max(4,bytes),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC|extra});buffers.push(b);return b;};
  try {
  const parameters=storage('neumip fitted parameters',sizes.parameters);
  const queries=storage('neumip material queries',sizes.queries);
  const targets=storage('neumip teacher RGB',sizes.targets);
  const gradients=storage('neumip gradients',sizes.gradients);
  const scratch=storage('neumip activations and deltas',sizes.scratch);
  const partial=storage('neumip reduced weight gradients',sizes.partial);
  const moments=storage('neumip Adam moments',sizes.moments);
  const config=device.createBuffer({label:'neumip train configuration',size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});buffers.push(config);
  const bindingLayout=device.createBindGroupLayout({entries:Array.from({length:8},(_,binding)=>({binding,visibility:GPUShaderStage.COMPUTE,buffer:{type:binding===7?'uniform':binding===1?'read-only-storage':'storage'}}))});
  const pipelineLayout=device.createPipelineLayout({bindGroupLayouts:[bindingLayout]});
  const code=buildNeumipTrainingWGSL(layout),module=device.createShaderModule({label:'NeuMIP directional learning',code});
  const info=await module.getCompilationInfo();const errors=info.messages.filter(m=>m.type==='error');
  if(errors.length)throw Error(errors.map(m=>`${m.lineNum}:${m.linePos} ${m.message}`).join('\n'));
  const pipelines={};for(const entryPoint of ['teacher','inference','backward','weightPartials','collectWeights','adam']){
    pipelines[entryPoint]=await device.createComputePipelineAsync({label:`NeuMIP ${entryPoint}`,layout:pipelineLayout,compute:{module,entryPoint}});
  }
  const spatial=trainingRecipe===AUTHOR_SPATIAL_RECIPE?await createNeumipSpatialFilter(device,layout,{parameters,gradients,storage,buffers}):null;
  const makeGroup=(parameterBuffer,gradientBuffer)=>device.createBindGroup({layout:bindingLayout,entries:[parameterBuffer,queries,targets,gradientBuffer,scratch,partial,moments,config].map((buffer,binding)=>({binding,resource:{buffer}}))});
  const group=makeGroup(spatial?.parameters??parameters,gradients),adamGroup=spatial?makeGroup(parameters,spatial.rawGradient):group;
  device.queue.writeBuffer(parameters,0,layout.values);
  let count=batchSize,step=0,queryVersion=0,queryBits=null,currentTargets=null;
  const targetsFor=encoder=>{
    if(!currentTargets||currentTargets.version!==queryVersion)throw Error('Targets do not match the current query batch');
    if(currentTargets.encoder&&currentTargets.encoder!==encoder)throw Error('Pending teacher targets belong to a different encoder');
    return {count,queryBits,device};
  };
  const configure=({lodBias=0,lrWeights=.001,lrFields=.01,spatialStep=step}={})=>{
    const data=new ArrayBuffer(32),view=new DataView(data);view.setUint32(0,count,true);view.setUint32(4,Math.max(1,step),true);
    view.setFloat32(8,lrWeights,true);view.setFloat32(12,lrFields,true);view.setFloat32(16,lodBias,true);view.setUint32(20,neumipSpatialTrainingState(trainingRecipe,spatialStep).trainOffsetField?0:1,true);device.queue.writeBuffer(config,0,data);
  };
  const maxGroups=device.limits?.maxComputeWorkgroupsPerDimension??65535;
  const dispatch=(encoder,name,x,y=1)=>{if(x>maxGroups||y>maxGroups)throw Error(`NeuMIP ${name} dispatch ${x}x${y} exceeds device workgroup limit ${maxGroups}`);const pass=encoder.beginComputePass({label:`NeuMIP ${name}`});pass.setPipeline(pipelines[name]);pass.setBindGroup(0,name==='adam'?adamGroup:group);pass.dispatchWorkgroups(x,y);pass.end();};
  const read=async(buffer,size)=>{
    const staging=device.createBuffer({size,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});
    try{const e=device.createCommandEncoder();e.copyBufferToBuffer(buffer,0,staging,0,size);device.queue.submit([e.finish()]);await staging.mapAsync(GPUMapMode.READ);return new Float32Array(staging.getMappedRange().slice(0));}finally{staging.destroy();}
  };
  const readPredictions=async({includeLoss=false}={})=>{const all=await read(scratch,count*layout.scratchStride*4),rgb=new Float32Array(count*3);let loss=0;
    for(let q=0;q<count;q++){const base=q*layout.scratchStride+layout.actCount+layout.deltaCount;loss+=all[base];rgb.set(all.subarray(base+1,base+4),q*3);}
    if(!rgb.every(Number.isFinite)||(includeLoss&&!Number.isFinite(loss)))throw Error('Non-finite NeuMIP fit');return includeLoss?{rgb,loss:loss/count}:{rgb};};
  return {layout,buffers:{parameters,queries,targets,gradients,scratch,partial,moments,config},code,trainingRecipe,spatialState:()=>neumipSpatialTrainingState(trainingRecipe,step),
    setQueries(values){if(!(values instanceof Float32Array)||values.length%8||values.length<8||values.length>batchSize*8||!values.every(Number.isFinite))throw Error('Invalid NeuMIP queries');count=values.length/8;queryVersion++;currentTargets=null;queryBits=new Uint32Array(values.buffer,values.byteOffset,values.length).slice();device.queue.writeBuffer(queries,0,values);},
    setTargets(values){if(!(values instanceof Float32Array)||values.length!==count*3||!values.every(Number.isFinite))throw Error('Invalid NeuMIP RGB targets');device.queue.writeBuffer(targets,0,values);currentTargets={version:queryVersion,encoder:null};},
    async evaluate(options={}){configure(options);const e=device.createCommandEncoder();spatial?.forward(e,step);dispatch(e,'inference',Math.ceil(count/64));device.queue.submit([e.finish()]);return readPredictions();},
    async teach(options={}){configure(options);const version=queryVersion,n=count,e=device.createCommandEncoder();spatial?.forward(e,step);dispatch(e,'teacher',Math.ceil(n/64));device.queue.submit([e.finish()]);const rgb=await read(targets,n*3*4);currentTargets={version,encoder:null};return rgb;},
    encodeTeacher(encoder,options={}){configure(options);spatial?.forward(encoder,step);dispatch(encoder,'teacher',Math.ceil(count/64));currentTargets={version:queryVersion,encoder};},
    copyTargetsFrom(encoder,source){
      const state=source[TARGET_STATE]?.(encoder);
      if(!state||state.count!==count||state.device!==device||!queryBits||!state.queryBits||queryBits.some((v,i)=>v!==state.queryBits[i]))throw Error('Teacher target batch does not match current queries');
      encoder.copyBufferToBuffer(source.buffers.targets,0,targets,0,count*3*4);currentTargets={version:queryVersion,encoder};
    },
    async gradients(options={}){targetsFor(null);configure(options);const e=device.createCommandEncoder();spatial?.forward(e,step);e.clearBuffer(gradients);dispatch(e,'backward',Math.ceil(count/64));dispatch(e,'weightPartials',layout.weightCount,Math.ceil(count/64));dispatch(e,'collectWeights',Math.ceil(layout.weightCount/64));spatial?.adjoint(e);device.queue.submit([e.finish()]);return {values:await read(spatial?.rawGradient??gradients,layout.count*4),...await readPredictions({includeLoss:true})};},
    encodeUpdate(encoder,options={}){if(!explicitRecipe)throw Error('Select a NeuMIP training recipe before optimizer updates');targetsFor(encoder);const spatialStep=step;step++;configure({...options,spatialStep});spatial?.forward(encoder,spatialStep);encoder.clearBuffer(gradients);dispatch(encoder,'backward',Math.ceil(count/64));dispatch(encoder,'weightPartials',layout.weightCount,Math.ceil(count/64));dispatch(encoder,'collectWeights',Math.ceil(layout.weightCount/64));spatial?.adjoint(encoder);const groups=Math.ceil(layout.count/64),rows=Math.ceil(groups/maxGroups);dispatch(encoder,'adam',Math.ceil(groups/rows),rows);},
    [TARGET_STATE]:targetsFor,
    readPredictions,
    async exportModel(){
      if(!spatial)return restoreNeumipParameters(model,layout,await read(parameters,layout.count*4));
      const e=device.createCommandEncoder();spatial.forward(e,step);device.queue.submit([e.finish()]);
      const baked=structuredClone(model);return restoreNeumipParameters(baked,neumipTrainingLayout(baked),await read(spatial.parameters,layout.count*4));
    },
    dispose(){buffers.forEach(b=>b.destroy());},
    get step(){return step;},
  };
  } catch(error) {buffers.forEach(b=>b.destroy());throw error;}
}
