// Authored placement of the persistent world envelope, independent of Fine.
export function checkedWorldFrame(value){
 if(value==null)return null;
 const {translate,scale,referenceDims}=value;
 if(!Array.isArray(translate)||translate.length!==3||!translate.every(Number.isFinite)||!Number.isFinite(scale)||scale<=0||!Array.isArray(referenceDims)||referenceDims.length!==3||referenceDims.some(n=>!Number.isSafeInteger(n)||n<2)||referenceDims[0]!==referenceDims[2])throw Error('Invalid world field frame');
 return {translate:[...translate],scale,referenceDims:[...referenceDims]};
}
