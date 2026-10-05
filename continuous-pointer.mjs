// Pointer Lock keeps the OS cursor stationary; only this software cursor wraps.
// Logical coordinates remain unbounded so crossing an edge never reverses edits.
export function beginContinuousPointer(target, point, {move, lost=()=>{}, unavailable=()=>{}}) {
  const doc=target.ownerDocument || globalThis.document, win=doc.defaultView || globalThis.window;
  let active=true, locked=false, pending=false, requested=false, cursor=null;
  let x=point.x, y=point.y;
  const wrap=(value,size)=>size>0?((value%size)+size)%size:value;
  function draw() {
    if(!cursor && doc.createElement) {
      cursor=doc.createElement('div');cursor.className='continuous-drag-cursor';
      cursor.setAttribute('aria-hidden','true');doc.body.append(cursor);
    }
    if(cursor)cursor.style.transform=`translate(${wrap(x,win.innerWidth)}px,${wrap(y,win.innerHeight)}px)`;
  }
  function change() {
    if(doc.pointerLockElement===target) {
      if(!active){doc.exitPointerLock();return;}
      locked=true;draw();
    } else if(locked) {locked=false;stop();lost();}
  }
  function motion(event) {
    if(!active || !locked)return;
    x+=event.movementX || 0;y+=event.movementY || 0;draw();
    move({x,y,dx:event.movementX || 0,dy:event.movementY || 0,event});
  }
  function failure(){if(active)unavailable();}
  function cleanup(){doc.removeEventListener('pointerlockerror',failure);doc.removeEventListener('pointerlockchange',change);doc.removeEventListener('mousemove',motion);}
  function stop() {
    active=false;cursor?.remove();cursor=null;
    if(doc.pointerLockElement===target)doc.exitPointerLock();
    locked=false;
    if(!pending)cleanup();
  }
  doc.addEventListener('pointerlockerror',failure);
  doc.addEventListener('pointerlockchange',change);
  doc.addEventListener('mousemove',motion);
  return {
    get locked(){return locked;},
    request(next=point) {
      if(!active || requested)return;
      requested=true;x=next.x;y=next.y;
      if(!target.requestPointerLock){unavailable();return;}
      pending=true;
      try {
        Promise.resolve(target.requestPointerLock()).catch(()=>{if(active)unavailable();}).finally(()=>{pending=false;if(!active)cleanup();});
      }catch{pending=false;unavailable();}
    },
    stop,
  };
}
