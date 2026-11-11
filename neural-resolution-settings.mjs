export function checkedNeuralResolution(value){
 if(!Number.isFinite(value)||value<=0||value>1)throw Error('Neural shading resolution must be in (0, 1]');
 return value;
}
