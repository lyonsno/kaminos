// Presentation timing is independent of inference and simulation time.
export function createGenerationArrival({duration=2.5,present,place}){
 if(!(duration>0&&Number.isFinite(duration)))throw Error('Arrival duration must be positive');
 let amount=0,direction=0,closed=false;
 const paint=()=>present(amount);
 const check=()=>{if(closed)throw Error('Arrival is closed');};
 paint();
 return {read:()=>({amount,direction,duration}),enter(){check();if(amount===0&&direction!==1)place();direction=1;},exit(){check();direction=-1;},hold(){check();direction=0;},
  seek(value){check();if(!Number.isFinite(value)||value<0||value>1)throw Error('Arrival must be between zero and one');if(amount===0&&value>0)place();amount=value;direction=0;paint();},
  advance(seconds){check();if(!Number.isFinite(seconds)||seconds<0)throw Error('Elapsed time must be nonnegative');if(!direction)return;amount=Math.max(0,Math.min(1,amount+direction*seconds/duration));if(amount===0||amount===1)direction=0;paint();},
  dispose(){if(closed)return;closed=true;direction=0;present(null);}};
}
export function arrivalTranslation({view,center,radius}){
 const direction=view.target.map((x,i)=>x-view.position[i]),length=Math.hypot(...direction);
 const half=Math.atan(Math.tan(view.fov*Math.PI/360)/(view.zoom??1)*Math.min(1,view.aspect));
 if(!(length>0&&radius>0&&half>0&&half<Math.PI/2))throw Error('Arrival needs valid bounds and a perspective view');
 const distance=radius/Math.sin(half)*1.18;
 return {distance,translation:center.map((x,i)=>view.position[i]+direction[i]/length*distance-x)};
}
