// Stable field-local resistance. No clock, per-cell state or tile address enters it.
export function checkedSliding({variation=0,scale=.24,release=0}={}){
 if(!Number.isFinite(release)||release<0||release>1)throw Error('Slide release must be 0–1');
 if(!Number.isFinite(variation)||variation<0||variation>1||!Number.isFinite(Math.fround(scale))||Math.fround(scale)<=0)throw Error('Sliding variation must be 0–1 and scale positive');
 return {variation,scale,release};
}
function hash(x,z){let h=(Math.imul(x,374761393)^Math.imul(z,668265263)^0x9e3779b9)>>>0;h=Math.imul(h^(h>>>13),1274126177)>>>0;return ((h^(h>>>16))>>>0)/4294967296;}
export function slidingThreshold(position,settings={}){
 const {variation,scale}=checkedSliding(settings);if(variation===0)return .5;
 const x=position[0]/scale,z=position[2]/scale,ix=Math.floor(x),iz=Math.floor(z),fx=x-ix,fz=z-iz;
 const u=fx*fx*(3-2*fx),v=fz*fz*(3-2*fz),mix=(a,b,t)=>a+(b-a)*t;
 return .5+variation*.35*(2*mix(mix(hash(ix,iz),hash(ix+1,iz),u),mix(hash(ix,iz+1),hash(ix+1,iz+1),u),v)-1);
}
export const slidingWGSL=`
fn ash_resistance_hash(c:vec2<i32>)->f32{
 var h=(bitcast<u32>(c.x)*374761393u) ^ (bitcast<u32>(c.y)*668265263u) ^ 0x9e3779b9u;
 h=(h^(h>>13u))*1274126177u;h=h^(h>>16u);return f32(h)*(1.0/4294967296.0);
}
fn ash_sliding_threshold(position:vec3<f32>,settings:vec2<f32>)->f32{
 if(settings.x==0.0){return .5;}
 let q=position.xz/settings.y;let c=vec2<i32>(floor(q));let f=fract(q);let u=f*f*(vec2<f32>(3)-2.0*f);
 let n=mix(mix(ash_resistance_hash(c),ash_resistance_hash(c+vec2<i32>(1,0)),u.x),mix(ash_resistance_hash(c+vec2<i32>(0,1)),ash_resistance_hash(c+vec2<i32>(1,1)),u.x),u.y);
 return .5+settings.x*.35*(2.0*n-1.0);
}`;
