import {chartOffsetScale} from './neumip-chart.mjs';
const f=value=>{if(!Number.isFinite(value))throw Error('Non-finite NeuMIP weight');const s=String(value);return /[.e]/i.test(s)?s:s+'.0';};

function network(model,prefix,args,output) {
  let text=`fn ${prefix==='main'?'neumipMain':'neumipOffset'}(${args}) -> ${output} {\n`;
  const input=prefix==='main'?['light.x','light.y','view.x','view.y',...Array.from({length:4},(_,i)=>`f0[${i}]`),...Array.from({length:4},(_,i)=>`f1[${i}]`)]:[...Array.from({length:4},(_,i)=>`f0[${i}]`),'f1.x','f1.y','view.x','view.y'];
  text+=`let a0 = array<f32,${input.length}>(${input.join(',')});\n`;
  for(let k=0;k<4;k++){
    const l=model.layers.find(l=>l.name===`${prefix}.mpl${k}`);if(!l)throw Error('Missing NeuMIP layer');
    text+=`var a${k+1}:array<f32,${l.output}>;\n`;
    for(let row=0;row<l.output;row++){
      const parts=[f(l.biases[row]??0)];
      for(let col=0;col<l.input;col+=4){
        const x=Array.from({length:4},(_,i)=>col+i<l.input?`a${k}[${col+i}]`:'0.0');
        const w=Array.from({length:4},(_,i)=>f(col+i<l.input?l.weights[row*l.input+col+i]:0));
        parts.push(`dot(vec4<f32>(${x.join(',')}),vec4<f32>(${w.join(',')}))`);
      }
      const sum=parts.join('+');text+=`a${k+1}[${row}]=${l.relu?`max(0.0,${sum})`:sum};\n`;
    }
  }
  if(prefix==='main'&&model.handoff)text+='return vec3<f32>(a4[0],a4[1],a4[2]);\n}';
  else if(prefix==='main')text+=`let rgb=vec3<f32>(a4[0]+1.13983*a4[2],a4[0]-0.39465*a4[1]-0.58060*a4[2],a4[0]+2.03211*a4[1]);
return (exp(rgb)-vec3<f32>(1.0))*(vec3<f32>(0.1)+vec3<f32>(1.0)/(vec3<f32>(1.0)+exp(-vec3<f32>(a4[3],a4[4],a4[5]))));\n}`;
  else text+='return a4[0];\n}';
  return text;
}

export function buildNeumipWGSL(model) {
  const offset=network(model,'offset_network','f0:vec4<f32>,f1:vec4<f32>,view:vec2<f32>','f32');
  const main=network(model,'main','f0:vec4<f32>,f1:vec4<f32>,view:vec2<f32>,light:vec2<f32>','vec3<f32>');
  return {offset,main,bilinear:`
fn nmBilinear(t:texture_2d<f32>,p:vec2<f32>,level:i32)->vec4<f32>{
 let size=vec2<i32>(textureDimensions(t,level));let q=p*vec2<f32>(size)-vec2<f32>(0.5);
 let i=vec2<i32>(floor(q));let w=fract(q);
 ${model.chart?.boundary==='clamp'?'let a=clamp(i,vec2<i32>(0),size-vec2<i32>(1));let b=clamp(i+vec2<i32>(1),vec2<i32>(0),size-vec2<i32>(1));':'let a=((i%size)+size)%size;let b=(((i+vec2<i32>(1))%size)+size)%size;'}
 return mix(mix(textureLoad(t,a,level),textureLoad(t,vec2<i32>(b.x,a.y),level),w.x),mix(textureLoad(t,vec2<i32>(a.x,b.y),level),textureLoad(t,b,level),w.x),w.y);
}`,features:`
fn neumipFeatures(uv:vec2<f32>,view:vec3<f32>,lod:f32,${model.handoff?'support:f32,':''}off0:texture_2d<f32>,off1:texture_2d<f32>,map0:texture_2d<f32>,map1:texture_2d<f32>)->mat4x4<f32>{
 ${model.handoff?'if(support<=0.0){return mat4x4<f32>(vec4<f32>(0.0),vec4<f32>(0.0),vec4<f32>(0.0),vec4<f32>(0.0));}':''}
 let depth=neumipOffset(nmBilinear(off0,uv,0),nmBilinear(off1,uv,0),view.xy);
 let denominator=max(sqrt(max(0.0,1.0-dot(view.xy,view.xy))),0.6);
 let shifted=${model.chart?'uv':'fract(uv)'}+depth*view.xy/denominator*vec2<f32>(${chartOffsetScale(model.chart).map(f).join(',')});
 let l=clamp(lod,0.0,f32(textureNumLevels(map0)-1u));let lo=i32(floor(l));let hi=min(lo+1,i32(textureNumLevels(map0))-1);let w=fract(l);
 return mat4x4<f32>(mix(nmBilinear(map0,shifted,lo),nmBilinear(map0,shifted,hi),w),mix(nmBilinear(map1,shifted,lo),nmBilinear(map1,shifted,hi),w),vec4<f32>(0.0),vec4<f32>(0.0));
}`};
}
