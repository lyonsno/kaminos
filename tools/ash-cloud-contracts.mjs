// The ordinary profiler directly timestamps encodeDraw. Selective/sidecar
// timestamps cannot satisfy this predicate, even when that API returns ok.
export function acceptAshFlameRaster(sample,expected){
 if(sample?.ok!==true||sample.scope!=='camera-raymarch-raster-only-not-lighting-simulation-or-frame'||!Number.isFinite(sample.ms)||sample.ms<=0||!Array.isArray(sample.timestamps)||sample.timestamps.length!==2)return false;
 try{if(BigInt(sample.timestamps[0])<=0n||BigInt(sample.timestamps[1])<=BigInt(sample.timestamps[0]))return false;}catch{return false;}
 if(!Number.isSafeInteger(sample.simStepCount)||sample.simStepCount<0||!Number.isSafeInteger(sample.width)||sample.width<=0||!Number.isSafeInteger(sample.height)||sample.height<=0||typeof sample.backend!=='string'||!sample.controls||!sample.opticalStepping)return false;
 return !expected||(sample.simStepCount===expected.simStepCount&&sample.width===expected.width&&sample.height===expected.height&&sample.backend===expected.backend&&JSON.stringify(sample.controls)===JSON.stringify(expected.controls)&&JSON.stringify(sample.raymarchShaderSpecialization)===JSON.stringify(expected.raymarchShaderSpecialization)&&JSON.stringify(sample.opticalStepping)===JSON.stringify(expected.opticalStepping));
}
