// Borden split neo-Hookean energy/stress adapted from CD-MPM, MIT.
// Source: penn-graphics-research/ziran2019@35742ac3ab1ae42cf2bbe8761fd7c8e630a638c4
// Thermal rest stretch is an added isotropic constitutive operation. Temperature
// is normalized: 1 at the initial solid state, 0 at the selected cold endpoint.
// expansion is the total fractional free contraction across that interval.
export const THERMAL_STONE_WGSL = `
fn stoneIdentity() -> mat3x3f {
 return mat3x3f(vec3f(1,0,0),vec3f(0,1,0),vec3f(0,0,1));
}
fn stoneElasticF(F:mat3x3f, temperature:f32, expansion:f32) -> mat3x3f {
 return F*(1./(1.+expansion*(temperature-1.)));
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
