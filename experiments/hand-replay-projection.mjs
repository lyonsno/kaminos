// Camera-space projection without pose alignment or changes to source geometry.
const vec=(v,n)=>Array.isArray(v)&&v.length===n&&v.every(Number.isFinite);
export function projectionSupport(hand){
 if(hand?.status!=='observed')return {available:false,reason:hand?.reason??'prediction unavailable'};
 const c=hand.camera;
 if(!c)return {available:false,reason:'no source camera metadata'};
 if(c.schema!=='hand-state.source-camera.v1'||c.basis!=='opencv_x_right_y_down_z_forward'||!c.method||!vec(c.imageSize,2)||c.imageSize.some(n=>n<=0)||!vec(c.intrinsics,4)||c.intrinsics.slice(0,2).some(n=>n<=0)||!vec(c.translation,3))return {available:false,reason:'invalid source camera metadata'};
 if(!hand.vertices?.every(v=>vec(v,3)&&v[2]+c.translation[2]>0)||!hand.joints?.every(v=>vec(v,3)&&v[2]+c.translation[2]>0))return {available:false,reason:'camera geometry crosses or lies behind image plane'};
 return {available:true,method:c.method,fitRmsePx:c.fitRmsePx??null};
}
export function projectHand(hand){
 const support=projectionSupport(hand);if(!support.available)throw Error(support.reason);
 const {intrinsics:[fx,fy,cx,cy],translation:t}=hand.camera;
 const project=v=>{const z=v[2]+t[2];return [fx*(v[0]+t[0])/z+cx,fy*(v[1]+t[1])/z+cy,z];};
 return {vertices:hand.vertices.map(project),joints:hand.joints.map(project),camera:hand.camera};
}
export function commonImageBox(frames,reference,imageSize){
 const boxes=frames.map(f=>f.hands[reference]?.cropBox).filter(b=>vec(b,4)&&b[2]>b[0]&&b[3]>b[1]);
 return boxes.length?[Math.min(...boxes.map(b=>b[0])),Math.min(...boxes.map(b=>b[1])),Math.max(...boxes.map(b=>b[2])),Math.max(...boxes.map(b=>b[3]))]:[0,0,...imageSize];
}
export function maskDisagreement(left,right){
 if(!left||!right||left.length!==right.length)throw Error('comparison mask unavailable');
 const rgba=new Uint8ClampedArray(left.length*4),counts={both:0,leftOnly:0,rightOnly:0,neither:0};
 for(let i=0;i<left.length;i++){
  const state=left[i]?(right[i]?'both':'leftOnly'):(right[i]?'rightOnly':'neither');counts[state]++;
  if(state!=='neither')rgba.set(state==='both'?[130,105,160,100]:state==='leftOnly'?[45,190,255,220]:[255,150,60,220],i*4);
 }
 return {rgba,counts};
}
