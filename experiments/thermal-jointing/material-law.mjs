// Borden split neo-Hookean energy/stress adapted from CD-MPM, MIT.
// Source: penn-graphics-research/ziran2019@35742ac3ab1ae42cf2bbe8761fd7c8e630a638c4
// PRE-FIX oracle baseline: thermal rest stretch is deliberately not applied yet.
// Native execution is blocked by the host Metal compiler's XPC failure. Establish
// the restraint-stress test's numerical failure before implementing that change.
// This module is not registered as a Workbench experiment or a working solver.
export const THERMAL_STONE_WGSL = `
fn stoneIdentity() -> mat3x3f {
 return mat3x3f(vec3f(1,0,0),vec3f(0,1,0),vec3f(0,0,1));
}
fn stoneElasticF(F:mat3x3f, temperature:f32, expansion:f32) -> mat3x3f {
 return F;
}
fn stoneDegradation(intact:f32,residual:f32) -> f32 {
 return intact*intact*(1.-residual)+residual;
}
fn stonePositiveEnergy(F:mat3x3f,mu:f32,kappa:f32) -> f32 {
 let J=determinant(F);
 let norm2=dot(F[0],F[0])+dot(F[1],F[1])+dot(F[2],F[2]);
 let dev=max(0.,.5*mu*(pow(J,-2./3.)*norm2-3.));
 let vol=.5*kappa*(.5*(J*J-1.)-log(J));
 return dev+select(0.,vol,J>=1.);
}
fn stoneStress(F:mat3x3f,intact:f32,residual:f32,mu:f32,kappa:f32) -> mat3x3f {
 let J=determinant(F);let B=F*transpose(F);let I=stoneIdentity();
 let trace=B[0].x+B[1].y+B[2].z;
 let dev=mu*pow(J,-2./3.)*(B-I*(trace/3.));
 let vol=.5*kappa*(J*J-1.)*I;
 let g=stoneDegradation(intact,residual);
 if(J>=1.){return g*(dev+vol);}
 return g*dev+vol;
}
fn stoneHistory(old:f32,positiveEnergy:f32) -> f32 {return max(old,positiveEnergy);}
fn stoneIntact(old:f32,solved:f32) -> f32 {return max(0.,min(old,solved));}
`;
