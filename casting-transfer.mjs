import {Vector3,Quaternion,Euler} from './lib/three.core.js';
import {checkedStageMold} from './stage-mold.mjs';

// Current stageWordMold layout: lettering above the common runner. This
// fixture-only extraction deliberately leaves the runner in the mold.
export function stageLetterCastings(value){
 const p=checkedStageMold(value);if(p.rows.length!==96)throw Error('Letter release requires the 96-row stage-word mold');
 const w=p.rows[0].length,occupied=x=>p.rows.slice(0,64).some(row=>row[x]==='.'),parts=[];
 for(let x=0;x<w;x++)if(occupied(x)){
  const start=x;while(x+1<w&&occupied(x+1))x++;
  const end=x+1,rows=p.rows.slice(0,64).map(row=>'#'+row.slice(start,end)+'#');
  rows.unshift('#'.repeat(end-start+2));rows.push('#'.repeat(end-start+2));
  parts.push({recipe:{...p,label:p.label+' · piece '+(parts.length+1),rows},offset:[((start+end)/2-w/2)*p.pitch,0,(32-48)*p.pitch],columns:[start,end]});
 }
 if(!parts.length)throw Error('The mold has no letter strokes');return parts;
}
export function castingPickupPose(object,offset){
 object.updateWorldMatrix(true,false);
 const position=object.localToWorld(new Vector3(...offset)),rotation=new Euler().setFromQuaternion(object.getWorldQuaternion(new Quaternion())),scale=object.getWorldScale(new Vector3());
 return {position:position.toArray(),rotation:[rotation.x,rotation.y,rotation.z],scale:scale.toArray()};
}
export function createCastingTransfer({write,arrive=()=>{}}){
 let state=null;
 const pose=p=>{if(!p||!['position','rotation','scale'].every(k=>Array.isArray(p[k])&&p[k].length===3&&p[k].every(Number.isFinite))||p.scale.some(v=>v<=0))throw Error('Transfer needs finite poses with positive scale');return structuredClone(p);};
 return {
  start(from,to,{seconds=4,lift=1}={}){if(state?.moving)throw Error('A casting is already moving');if(!Number.isFinite(seconds)||seconds<=0||!Number.isFinite(lift)||lift<0)throw Error('Invalid transfer duration or lift');state={from:pose(from),to:pose(to),seconds,lift,elapsed:0,moving:true};},
  advance(dt){if(!state?.moving)return;if(!Number.isFinite(dt)||dt<0)throw Error('Invalid transfer time');state.elapsed=Math.min(state.seconds,state.elapsed+dt);const t=state.elapsed/state.seconds,u=t*t*(3-2*t),a=state.from,b=state.to;
   const position=a.position.map((v,i)=>v+(b.position[i]-v)*u);position[1]+=Math.sin(Math.PI*t)*state.lift;
   const q=new Quaternion().setFromEuler(new Euler(...a.rotation)).slerp(new Quaternion().setFromEuler(new Euler(...b.rotation)),u),rotation=new Euler().setFromQuaternion(q);
   const next={position,rotation:[rotation.x,rotation.y,rotation.z],scale:a.scale.map((v,i)=>v+(b.scale[i]-v)*u)};
   write(t===1?structuredClone(b):next);if(t===1){state.moving=false;arrive();}
  },
  cancel(){if(state)state.moving=false;},read:()=>state?structuredClone(state):null,
 };
}
