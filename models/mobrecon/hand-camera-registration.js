// Camera placement from the released HandMesh utils/vis.py registration objective.
// Its depth-weighted projection residual is linear in translation; eliminate x/y
// analytically, retaining the source's depth bounds and adaptive joint rejection.
const finite = (a, n, name) => {
  if (!a || a.length !== n || !Array.from(a).every(Number.isFinite)) throw Error(`${name} must contain ${n} finite numbers`);
};
export function cameraToOperator([x, y, z]) {
  // Proper rotation (det +1): see the back of a palm-facing-camera right hand,
  // thumb left, rather than horizontally mirroring a camera-facing palm.
  return [-x, .2 - y, z - .6];
}

export function fitCameraTranslation(joints, uv, camera) {
  finite(joints, 63, 'joints'); finite(uv, 42, 'UV');
  const {fx, fy, cx, cy} = camera;
  if (![fx,fy,cx,cy].every(Number.isFinite) || fx<=0 || fy<=0) throw Error('invalid camera');
  let active=Array.from({length:21}, (_,i)=>i), translation=[0,0,.6], passes=0;
  let meanLoss=5;
  // Five passes, threshold2 and minimum13 are the released registration policy.
  while (meanLoss>2 && passes<5) {
    passes++;
    const rows=active.map(i=> {
      const x=joints[i*3], y=joints[i*3+1], z=joints[i*3+2];
      const a=cx-uv[i*2], c=cy-uv[i*2+1];
      return {a,c,b:fx*x+a*z,d:fy*y+c*z};
    });
    const mean=key=>rows.reduce((s,r)=>s+r[key],0)/rows.length;
    const ma=mean('a'), mc=mean('c'), mb=mean('b'), md=mean('d');
    let denominator=0,numerator=0;
    for (const r of rows) {
      denominator+=(r.a-ma)**2+(r.c-mc)**2;
      numerator+=(r.a-ma)*(r.b-mb)+(r.c-mc)*(r.d-md);
    }
    if (!(denominator>Number.EPSILON*Math.max(1,fx*fx+fy*fy))) {
      return {valid:false,reason:'degenerate_landmarks'};
    }
    const z=Math.min(2,Math.max(.3,-numerator/denominator));
    translation=[-(ma*z+mb)/fx,-(mc*z+md)/fy,z];
    const loss=rows.map(r=>Math.abs(fx*translation[0]+r.a*z+r.b+fy*translation[1]+r.c*z+r.d));
    meanLoss=loss.reduce((s,v)=>s+v,0)/loss.length;
    const std=Math.sqrt(loss.reduce((s,v)=>s+(v-meanLoss)**2,0)/loss.length);
    const next=active.filter((_,i)=>loss[i]<meanLoss+std);
    if (next.length<13) break;
    active=next;
  }
  let error=0;
  for (let i=0;i<21;i++) {
    const depth=joints[i*3+2]+translation[2];
    if (!(depth>0)) return {valid:false,reason:'nonpositive_depth'};
    const u=fx*(joints[i*3]+translation[0])/depth+cx;
    const v=fy*(joints[i*3+1]+translation[1])/depth+cy;
    error+=(u-uv[i*2])**2+(v-uv[i*2+1])**2;
  }
  return {valid:true,translation,rmsePx:Math.sqrt(error/21),passes,
    depthAtBound:translation[2]===.3 || translation[2]===2};
}

export async function loadHandRegistration(url, {signal}={}) {
  const response=await fetch(url,{signal});
  if (!response.ok) throw Error(`hand registration ${response.status}: ${url}`);
  const resource=await response.json();
  createHandRegistration(resource);
  return resource;
}

export function createHandRegistration(resource) {
  if (resource?.schema!=='mobrecon.hand-registration.v0' || resource.jointOrder!=='mpii' || resource.vertexCount!==778) {
    throw Error('unsupported hand registration resource');
  }
  finite(resource.regressor,21*778,'regressor');
  if (!resource.source || typeof resource.source!=='object') throw Error('hand registration requires source identity');
  const regressor=Float64Array.from(resource.regressor);
  for (let j=0;j<21;j++) {
    let sum=0; for(let v=0;v<778;v++) sum+=regressor[j*778+v];
    if (Math.abs(sum-1)>1e-5) throw Error('regressor joint weights must sum to one');
  }
  const identity=Object.freeze({route:'mobrecon.camera-registration.cpu-linear.v0',
    source:structuredClone(resource.source), cameraAuthority:'assumed_not_calibrated',
    translationBounds:[.3,2], presentation:'operator-side-rotation-not-reflection'});
  function place(result,{width,height,focalRatio=1}={}) {
    if (!result?.hasHand) return {valid:false,reason:'no_hand',source:result?.identity??null};
    if (!['left','right'].includes(result.handedness)) throw Error('invalid handedness');
    if (![width,height,focalRatio].every(Number.isFinite) || width<=0 || height<=0 || focalRatio<=0) throw Error('invalid camera dimensions or focal ratio');
    finite(result.nativeVertices,778*3,'native vertices'); finite(result.nativeUV,42,'native UV');
    finite(result.cropBox,4,'crop box');
    const [x0,y0,x1,y1]=result.cropBox;
    if (x1<=x0 || y1<=y0) throw Error('invalid crop box');
    const left=result.handedness==='left', vertices=new Float64Array(778*3), uv=new Float64Array(42);
    for(let i=0;i<vertices.length;i++) vertices[i]=result.nativeVertices[i]*.2*(left&&i%3===0?-1:1);
    for(let j=0;j<21;j++) {
      const px=result.nativeUV[j*2]*128;
      uv[j*2]=x0+(left?127-px:px)*(x1-x0)/127;
      uv[j*2+1]=y0+result.nativeUV[j*2+1]*128*(y1-y0)/127;
    }
    const joints=new Float64Array(63);
    for(let j=0;j<21;j++) for(let v=0;v<778;v++) {
      const w=regressor[j*778+v];
      for(let k=0;k<3;k++) joints[j*3+k]+=vertices[v*3+k]*w;
    }
    const focal=Math.max(width,height)*focalRatio;
    const camera={fx:focal,fy:focal,cx:width/2,cy:height/2,width,height,focalRatio,authority:'assumed_not_calibrated'};
    const fit=fitCameraTranslation(joints,uv,camera);
    if (!fit.valid) return {...fit,camera,source:result.identity};
    const cameraVertices=Float32Array.from(vertices,(v,i)=>v+fit.translation[i%3]);
    const worldVertices=new Float32Array(vertices.length), worldJoints=new Float32Array(63);
    for(let v=0;v<778;v++) worldVertices.set(cameraToOperator(cameraVertices.subarray(v*3,v*3+3)),v*3);
    for(let j=0;j<21;j++) worldJoints.set(cameraToOperator(Array.from(joints.subarray(j*3,j*3+3),(v,i)=>v+fit.translation[i])),j*3);
    if (cameraVertices.some((v,i)=>i%3===2 && v<=0)) return {valid:false,reason:'nonpositive_mesh_depth',camera,source:result.identity};
    return {...fit,cameraVertices,worldVertices,worldJoints,camera,source:result.identity,
      handedness:result.handedness,registration:identity,observedUV:uv};
  }
  return Object.freeze({identity,place});
}
