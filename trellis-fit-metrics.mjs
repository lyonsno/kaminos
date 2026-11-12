// Conditional surface color is observed only on hit footprints. Pixel error
// also includes coverage, so RGB/alpha tradeoffs remain visible in the report.
export function measureTrellisFit(prediction,target,{coverage=false}={}){
 const stride=coverage?4:3;if(!prediction.length||prediction.length!==target.length||prediction.length%stride||!prediction.every(Number.isFinite)||!target.every(Number.isFinite))throw Error('Complete finite matching material predictions/targets required');
 let weightedRgb=0,weight=0,coverageSquared=0,pixelSquared=0;const count=prediction.length/stride;
 const bins=Object.fromEntries(['absent','partial','visible'].map(k=>[k,{count:0,weight:0,rgb:0,coverage:0,predicted:0}]));
 for(let i=0;i<prediction.length;i+=stride){const a=coverage?prediction[i+3]:1,b=coverage?target[i+3]:1;if(a<0||a>1||b<0||b>1)throw Error('Coverage must be in [0,1]');const bin=bins[b===0?'absent':b===1?'visible':'partial'];bin.count++;bin.weight+=b;bin.coverage+=(a-b)**2;bin.predicted+=a;weight+=b;coverageSquared+=(a-b)**2;for(let k=0;k<3;k++){const error=b*(prediction[i+k]-target[i+k])**2;weightedRgb+=error;bin.rgb+=error;pixelSquared+=(a*prediction[i+k]-b*target[i+k])**2;}}
 const visibility=Object.fromEntries(Object.entries(bins).map(([name,b])=>[name,{count:b.count,conditionalRgbMse:b.weight?b.rgb/(3*b.weight):null,coverageMse:b.count?b.coverage/b.count:null,meanPredictedCoverage:b.count?b.predicted/b.count:null}]));
 return {mse:(weightedRgb+coverageSquared)/(3*weight+(coverage?count:0)),conditionalRgbMse:weight?weightedRgb/(3*weight):null,coverageMse:coverage?coverageSquared/count:null,premultipliedRgbMse:pixelSquared/(3*count),observedCoverage:weight/count,visibility};
}
