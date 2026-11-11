// Shared source-normal policy for the physical teacher and raw mesh preview.
// geometricNormal is unit length and oriented toward surfaceToView.
export const TRELLIS_SOURCE_NORMAL_WGSL=/* wgsl */`
fn trellisSourceNormal(n:vec3f,geometricNormal:vec3f,surfaceToView:vec3f)->vec3f{
 if(dot(n,n)<1e-20){return geometricNormal;}
 var result=normalize(n);
 if(dot(result,geometricNormal)<0.0){result=-result;}
 if(dot(result,surfaceToView)<=0.0){return geometricNormal;}
 return result;
}
`;
