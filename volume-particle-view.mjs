// Observation state is separate from carried material and the viewing camera.
export function createParticleViewFrame(){
 let current=null,pinned=null;
 function checked(frame){
  for(const k of ['viewProj','inverse'])if(frame[k]?.length!==16||!Array.from(frame[k]).every(Number.isFinite))throw Error('Invalid particle optical '+k);
  if(frame.size?.length!==2||!frame.size.every(v=>Number.isFinite(v)&&v>0))throw Error('Invalid particle optical size');
  return {viewProj:Array.from(frame.viewProj),inverse:Array.from(frame.inverse),size:[...frame.size]};
 }
 return {
  select(frame,locked=false,manual=null){
   if(typeof locked!=='boolean')throw Error('Particle optical view lock must be boolean');
   const next=checked(frame);
   if(manual)return {...checked(manual),locked:true,manual:true};
   if(locked){pinned??=current??next;return {...pinned,locked:true};}
   pinned=null;current=next;return {...next,locked:false};
  },
  reset(){current=null;pinned=null;},
 };
}
