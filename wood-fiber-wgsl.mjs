// Analytic fiber term from Marschner et al., SIGGRAPH 2005, equations and
// author woodreflectance.sl. Independent WGSL expression; local surface
// diffuse/specular remain the host's GGX model, so this is a hybrid study.
export const WOOD_FIBER_WGSL = /* wgsl */ `
fn woodDielectricFresnel(cosine: f32, eta: f32) -> f32 {
 let c=clamp(cosine,0.0,1.0);
 let ct=sqrt(max(0.0,1.0-(1.0-c*c)/(eta*eta)));
 let rs=(c-eta*ct)/max(c+eta*ct,1e-7);
 let rp=(eta*c-ct)/max(eta*c+ct,1e-7);
 return 0.5*(rs*rs+rp*rp);
}
fn woodFiberLobe(n: vec3<f32>, a: vec3<f32>, v: vec3<f32>,
 l: vec3<f32>, beta: f32, eta: f32) -> f32 {
 if(dot(n,l)<=0.0 || dot(n,v)<=0.0){return 0.0;}
 let index=max(eta,1.0);
 let vi=-refract(-v,n,1.0/index);
 let li=-refract(-l,n,1.0/index);
 let thetaV=asin(clamp(dot(vi,a),-1.0,1.0));
 let thetaL=asin(clamp(dot(li,a),-1.0,1.0));
 let width=max(beta,1e-5);
 let angle=(thetaV+thetaL)/width;
 let gaussian=width*exp(-0.5*angle*angle)/2.5066283;
 let geometry=1.0/max(pow(cos((thetaV-thetaL)*0.5),2.0),1e-6);
 let attenuation=(1.0-woodDielectricFresnel(dot(n,v),index))
  *(1.0-woodDielectricFresnel(dot(n,l),index));
 return gaussian*geometry*attenuation*max(dot(li,n),0.0);
}`;
