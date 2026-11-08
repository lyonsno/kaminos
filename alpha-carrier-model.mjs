export function validateAlphaModel(model,level){
  if(model.schema!=='kaminos.alpha-model.v1'||JSON.stringify(model.layers)!=='[4,8,8,1]'||!Number.isInteger(model.gridSize)||model.gridSize<2)throw Error('Unsupported alpha decoder layout');
  if(model.carrierCount!==level.count||model.sourceSHA256!==level.sourceSHA256||model.patchesSHA256!==level.patchesSHA256)throw Error('Alpha model level/source identity differs');
}

export function decodeAlpha(features,p){
  if(features.length!==4||p.length!==121)throw Error('Alpha decoder shape differs');
  const a=new Float64Array(8),b=new Float64Array(8);
  for(let j=0;j<8;j++){let value=p[32+j];for(let k=0;k<4;k++)value+=features[k]*p[j*4+k];a[j]=Math.max(value,0);}
  for(let j=0;j<8;j++){let value=p[104+j];for(let k=0;k<8;k++)value+=a[k]*p[40+j*8+k];b[j]=Math.max(value,0);}
  let value=p[120];for(let k=0;k<8;k++)value+=b[k]*p[112+k];return 1/(1+Math.exp(-value));
}

export function alphaDecodeWGSL(p){
  if(p.length!==121||!p.every(Number.isFinite))throw Error('Finite alpha parameters required');
  const n=value=>Number(value).toExponential(9),v=values=>`vec4<f32>(${Array.from(values,n).join(',')})`;
  const lines=['fn alpha_decode(features:vec4<f32>)->f32{'];
  for(let j=0;j<8;j++)lines.push(`let a${j}=max(0.0,dot(features,${v(p.subarray(j*4,j*4+4))})+${n(p[32+j])});`);
  lines.push('let a0v=vec4<f32>(a0,a1,a2,a3);let a1v=vec4<f32>(a4,a5,a6,a7);');
  for(let j=0;j<8;j++)lines.push(`let b${j}=max(0.0,dot(a0v,${v(p.subarray(40+j*8,44+j*8))})+dot(a1v,${v(p.subarray(44+j*8,48+j*8))})+${n(p[104+j])});`);
  lines.push(`let z=dot(vec4<f32>(b0,b1,b2,b3),${v(p.subarray(112,116))})+dot(vec4<f32>(b4,b5,b6,b7),${v(p.subarray(116,120))})+${n(p[120])};return 1.0/(1.0+exp(-z));}`);
  return lines.join('\n');
}

export function alphaAtlas(values,count,size,channels){
  if(values.length!==count*size*size*channels||![1,4].includes(channels)||!Number.isInteger(count)||count<1||size<2)throw Error('Alpha atlas shape differs');
  const columns=Math.ceil(Math.sqrt(count)),rows=Math.ceil(count/columns),pitch=size+2,width=columns*pitch,height=rows*pitch;
  const data=new values.constructor(width*height*channels);
  for(let id=0;id<count;id++)for(let y=0;y<pitch;y++)for(let x=0;x<pitch;x++){
    const sx=Math.max(0,Math.min(size-1,x-1)),sy=Math.max(0,Math.min(size-1,y-1));
    const src=((id*size+sy)*size+sx)*channels,dst=(((Math.floor(id/columns)*pitch+y)*width)+(id%columns)*pitch+x)*channels;
    data.set(values.subarray(src,src+channels),dst);
  }
  return {data,width,height,columns,pitch,size};
}
