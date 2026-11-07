// Same linear RGB → CIE XYZ basis as volume-emissive-transport.mjs.
// Unlike RGB gamut coordinates, physical XYZ coefficients are nonnegative.
export const RGB_TO_XYZ=[[.4124564,.3575761,.1804375],[.2126729,.7151522,.0721750],[.0193339,.1191920,.9503041]];
const [a,b,c]=RGB_TO_XYZ,det=a[0]*(b[1]*c[2]-b[2]*c[1])-a[1]*(b[0]*c[2]-b[2]*c[0])+a[2]*(b[0]*c[1]-b[1]*c[0]);
export const XYZ_TO_RGB=[
 [b[1]*c[2]-b[2]*c[1],a[2]*c[1]-a[1]*c[2],a[1]*b[2]-a[2]*b[1]],
 [b[2]*c[0]-b[0]*c[2],a[0]*c[2]-a[2]*c[0],a[2]*b[0]-a[0]*b[2]],
 [b[0]*c[1]-b[1]*c[0],a[1]*c[0]-a[0]*c[1],a[0]*b[1]-a[1]*b[0]],
].map(row=>row.map(x=>x/det));
function convert(values,matrix){
 if(!(values instanceof Float32Array)||values.length%4||!values.every(Number.isFinite))throw Error('Complete finite optical quadruples required');
 const output=new Float32Array(values.length);
 for(let i=0;i<values.length;i+=4){for(let c=0;c<3;c++)output[i+c]=matrix[c].reduce((s,w,k)=>s+w*values[i+k],0);output[i+3]=values[i+3];}return output;
}
export function opticalRgbToXyz(values){const result=convert(values,RGB_TO_XYZ);if(!result.every(x=>x>=0))throw Error('Optical source is outside the physical positive XYZ cone');return result;}
export const opticalXyzToRgb=values=>convert(values,XYZ_TO_RGB);
