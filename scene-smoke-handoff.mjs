// Shared rounded Fine support for material and incident-light ownership. A
// missing authored margin keeps the existing cell-width boundary policy.
export const FINE_SMOKE_HANDOFF_WGSL=`
fn fineSmokeEnvelope(p:vec3<f32>,top:f32,authoredMargin:f32)->f32{
 let spanY=max(top+1.0,2.0);let margin=clamp(authoredMargin,0.05,0.60);
 let widthXZ=max(0.04,margin*(0.40/0.36));let startXZ=max(0.0,0.98-widthXZ);
 let widthY=max(0.04,margin*(0.26/0.36));let startY=max(0.0,0.98-widthY);
 let rx=clamp((abs(p.x)-startXZ)/widthXZ,0.0,1.0);
 let rz=clamp((abs(p.z)-startXZ)/widthXZ,0.0,1.0);
 let ry=clamp((p.y-(-1.0+startY*spanY))/(widthY*spanY),0.0,1.0);
 let r=clamp(length(vec3<f32>(rx,ry,rz)),0.0,1.0);
 return 1.0-r*r*(3.0-2.0*r);
}`;
