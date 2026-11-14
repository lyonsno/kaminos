// Held reference for repartitioning a finite optical support in material
// space. This is separate from the camera billboard representation.
export const PARTICLE_SUPPORT_QUADRATURE_WGSL=/* wgsl */`
fn particleSupportErf(x:f32)->f32{
 // A&S 7.1.26; max absolute error about 1.5e-7 before f32 rounding.
 let a=abs(x);
 let t=1.0/(1.0+0.3275911*a);
 let p=(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-0.284496736)*t+0.254829592)*t;
 return sign(x)*(1.0-p*exp(-a*a));
}

// The endpoints are in the ellipsoid's local sigma frame. worldLength
// measures the same segment before this transform. The Gaussian has unit
// peak and finite support; callers supply intrinsic coefficients separately.
fn particleSupportPathMeasure(a:vec3<f32>,b:vec3<f32>,worldLength:f32,cutoff:f32,interval:vec2<f32>)->f32{
 if(worldLength<=0.0||cutoff<=0.0||interval.y<=interval.x){return 0.0;}
 let delta=b-a;
 let leg=length(delta);
 if(leg<=1e-7){
  let r2=dot(a,a);
  return select(0.0,exp(-0.5*r2)*worldLength*(interval.y-interval.x),r2<=cutoff*cutoff);
 }
 let direction=delta/leg;
 let along=dot(a,direction);
 let perpendicular=a-along*direction;
 let r2=dot(perpendicular,perpendicular);
 let rim2=cutoff*cutoff-r2;
 if(rim2<=0.0){return 0.0;}
 let rim=sqrt(rim2);
 let lo=max(-rim,along+interval.x*leg);
 let hi=min(rim,along+interval.y*leg);
 if(hi<=lo){return 0.0;}
 let halfWidth=(hi-lo)*0.5;
 let middle=lo+halfWidth;
 var longitudinal:f32;
 // Avoid subtracting two rounded, nearly equal erf values for short paths.
 if(halfWidth<0.01){
  let h=halfWidth*0.5773502691896258;
  longitudinal=halfWidth*(exp(-0.5*(middle-h)*(middle-h))+exp(-0.5*(middle+h)*(middle+h)));
 }else{
  longitudinal=1.2533141373155001*(particleSupportErf(hi*0.7071067811865476)-particleSupportErf(lo*0.7071067811865476));
 }
 return max(0.0,(worldLength/leg)*exp(-0.5*r2)*longitudinal);
}

// A Gaussian sliced by a parent-local plane is an exact partition at the
// handoff. These restricted fields are not individually narrowed Gaussians.
// Parameter zero is the receiver end, so interval order already matches
// opticalCompose's near/far convention even when the ray reverses.
fn particleSupportRayCut(a:vec3<f32>,b:vec3<f32>,axis:u32)->f32{
 let d=b[axis]-a[axis];
 if(d==0.0){return 1.0;}
 return clamp(-a[axis]/d,0.0,1.0);
}

fn particleSupportTransfer(q:vec4<f32>,a:vec3<f32>,b:vec3<f32>,worldLength:f32,cutoff:f32,split:bool,axis:u32)->vec4<f32>{
 if(!split){return opticalPanel(q,particleSupportPathMeasure(a,b,worldLength,cutoff,vec2<f32>(0.0,1.0)));}
 let cut=particleSupportRayCut(a,b,axis);
 let near=opticalPanel(q,particleSupportPathMeasure(a,b,worldLength,cutoff,vec2<f32>(0.0,cut)));
 let far=opticalPanel(q,particleSupportPathMeasure(a,b,worldLength,cutoff,vec2<f32>(cut,1.0)));
 return opticalCompose(near,far);
}
`;
