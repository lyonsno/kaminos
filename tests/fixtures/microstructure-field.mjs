export function fieldFixture(){
  const arrays={grid:Float32Array.from({length:8},(_,i)=>i/7),'layers.0.weight':new Float32Array([1,0,0,0,0,0,0,0]),'layers.0.bias':new Float32Array(2),'layers.1.weight':new Float32Array([1,0,0,0]),'layers.1.bias':new Float32Array(2),'layers.2.weight':new Float32Array(18),'layers.2.bias':new Float32Array([0,0,0,1,.2,.4,.6,.3,.8])};
  arrays['layers.2.weight'][0]=1;
  const shapes={grid:[8,1],'layers.0.weight':[2,4],'layers.0.bias':[2],'layers.1.weight':[2,2],'layers.1.bias':[2],'layers.2.weight':[9,2],'layers.2.bias':[9]};
  const meta={schema:'kaminos.microstructure-field.v1',grid:2,features:1,width:2,carrierCount:1,radius:.1,hiddenActivation:'relu',distanceActivation:'softplus',interpolation:'trilinear',gridOrder:'carrier,x,y,z,feature',output:['distance/radius','nx','ny','nz','srgb.r','srgb.g','srgb.b','metallic','roughness'],files:Object.fromEntries(Object.entries(shapes).map(([name,shape])=>[name,{file:name+'.f32',shape,dtype:'float32',bytes:arrays[name].byteLength}]))};
  return {meta,arrays};
}
