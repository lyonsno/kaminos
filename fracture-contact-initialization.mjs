export const CONTACT_INITIALIZATION_WGSL=`
fn contactInitialPenalty(inverseMass:f32,dt:f32,baseline:f32,enabled:u32)->f32{
 if(enabled==0u||inverseMass<=0.0||dt<=0.0){return baseline;}
 return max(baseline,1.0/(inverseMass*dt*dt));
}`;
