// Small kinematic manipulation model. No rigid-body/grasp-physics claim.
const point = a => a?.length===3 && Array.from(a).every(Number.isFinite);
const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
export function createHandReachState({target={position:[-.04,.28,-.1],radius:.018},cube={position:[.05,.23,0],size:.045}}={}) {
  let targetState,cubePosition,cubeSize,tracking=false,contact=false,indexTip=null,thumbTip=null,
    pinchPoint=null,pinchDistance=null,pinching=false,grabbed=false,offset=null,armed=false;
  const read=()=>({tracking,contact,indexTip:indexTip?.slice()??null,thumbTip:thumbTip?.slice()??null,
    pinchPoint:pinchPoint?.slice()??null,pinchDistance,pinching,grabbed,cubePosition:cubePosition.slice(),
    target:structuredClone(targetState),cubeSize});
  function setTarget({position,radius}) {
    if(!point(position)||!Number.isFinite(radius)||radius<=0) throw Error('invalid target');
    targetState={position:Array.from(position),radius}; contact=false;
    return cubePosition?read():null;
  }
  function setCube({position,size}) {
    if(!point(position)||!Number.isFinite(size)||size<=0) throw Error('invalid cube');
    cubePosition=Array.from(position);cubeSize=size;grabbed=false;offset=null;
    return read();
  }
  setTarget(target);setCube(cube);
  function lose() {
    tracking=false;contact=false;indexTip=null;thumbTip=null;pinchPoint=null;pinchDistance=null;
    pinching=false;grabbed=false;offset=null;armed=false;
    return read();
  }
  function update({joints,valid}) {
    if(!valid||joints?.length!==63||!Array.from(joints).every(Number.isFinite)) return lose();
    tracking=true;indexTip=Array.from(joints.slice(24,27));thumbTip=Array.from(joints.slice(12,15));
    pinchPoint=indexTip.map((v,i)=>(v+thumbTip[i])/2);pinchDistance=distance(indexTip,thumbTip);
    contact=distance(indexTip,targetState.position)<=targetState.radius;
    const wasPinching=pinching;
    pinching=pinchDistance < (wasPinching ? .04 : .025);
    if(!pinching) {armed=true;grabbed=false;offset=null;}
    if(pinching&&!wasPinching&&armed) {
      armed=false;
      if(pinchPoint.every((v,i)=>Math.abs(v-cubePosition[i])<=cubeSize/2)) {
        grabbed=true;offset=cubePosition.map((v,i)=>v-pinchPoint[i]);
      }
    }
    if(grabbed) cubePosition=pinchPoint.map((v,i)=>v+offset[i]);
    return read();
  }
  function reset() {lose();setTarget(target);setCube(cube);return read();}
  return Object.freeze({read,update,lose,reset,setTarget,setCube});
}
