import assert from 'node:assert/strict';
import * as THREE from '../lib/three.core.js';
const module=await import('../experiments/creature-motion/playback.mjs').catch(()=>({}));
assert.equal(typeof module.createCreatureMotionPlayback,'function','retained creature motion needs shared callable playback operations');
const scene=new THREE.Scene(),root=new THREE.Group(),bone=new THREE.Object3D();
bone.name='pelvis';root.add(bone);scene.add(root);
const clip=new THREE.AnimationClip('retained creature',1,[new THREE.VectorKeyframeTrack('pelvis.position',[0,.5,1],[0,0,0,0,0,.3,0,0,.6])]);
const source={frames:31,fps:30,source_sha256:'a'.repeat(64),retargeted:false,front_surface:'rigid root carry; unpainted'};
let next=0;const callbacks=new Map();
const frame=now=>{const cb=callbacks.values().next().value;assert.equal(typeof cb,'function');callbacks.clear();cb(now);};
const player=module.createCreatureMotionPlayback({THREE,root,clip,source,requestFrame:cb=>(callbacks.set(++next,cb),next),cancelFrame:id=>callbacks.delete(id)});
assert.equal(player.read().status,'paused','opening retained motion must not start inference or an unrequested playback clock');
player.seek(15);assert.ok(Math.abs(bone.position.z-.3)<1e-6,'seeking must apply the actual Three clip pose');
assert.equal(player.read().frame,15);assert.equal(callbacks.size,0);
assert.throws(()=>player.seek(31),/frame/);assert.equal(player.read().frame,15,'invalid seek preserves the chosen pose');
player.resume();const stale=callbacks.values().next().value;player.pause();player.resume();
stale(9000);assert.equal(player.read().frame,15,'a cancelled callback cannot advance a newer playback generation');
player.resume();assert.equal(callbacks.size,1,'resume is single-flight');
frame(1000);frame(1250);assert.ok(Math.abs(bone.position.z-.45)<1e-6);
player.pause();assert.equal(callbacks.size,0);const held=bone.position.z;
player.resume();frame(5000);assert.equal(bone.position.z,held,'paused wall time must not enter the source clock');
frame(5500);assert.equal(player.read().status,'held');assert.ok(Math.abs(bone.position.z-.6)<1e-6);assert.equal(callbacks.size,0);
assert.equal(player.read().frame,30,'end is held, not wrapped into an invented seamless gait');
player.replay();frame(6000);assert.equal(player.read().frame,0);
player.dispose();player.dispose();assert.equal(callbacks.size,0);assert.equal(root.parent,scene,'disposal does not remove unrelated/shared scene resources');
assert.throws(()=>player.resume(),/disposed/);
const untrustedRead=player.read();untrustedRead.source.frames=999;
assert.equal(player.read().source.frames,31,'caller edits of a read cannot mutate retained source identity');
assert.throws(()=>module.createCreatureMotionPlayback({THREE,root,clip,source:{...source,frames:60},requestFrame:()=>1,cancelFrame:()=>{}}),/duration/,'wrong source duration cannot masquerade as the retained motion');
console.log(`Creature replay/pause/seek/hold/disposal on actual Three ${THREE.REVISION}: pass`);

// Actual-library, deterministic host-callback reentry and terminal-publication controls.
const callbackFailures=[];
for(const kind of ['dispose','supersede','held','removed']) {
 const parent=new THREE.Scene(),r=new THREE.Group();r.add(bone.clone());parent.add(r);
 let id=0,armed=false,p,notify=[];const pending=new Map();
 const dirty=()=>{if(!p)return;notify.push(p.read().status);if(armed){armed=false;if(kind==='dispose')p.dispose();if(kind==='supersede'){p.pause();p.resume();}}};
 p=module.createCreatureMotionPlayback({THREE,root:r,clip,source,onDirty:dirty,requestFrame:cb=>(pending.set(++id,cb),id),cancelFrame:n=>pending.delete(n)});
 p.resume();armed=true;
 const fire=now=>{const [key,cb]=pending.entries().next().value;pending.delete(key);cb(now);};
 if(kind==='removed')parent.remove(r);
 fire(0);if(kind==='held')fire(1000);
 try {
  if(kind==='dispose'){assert.equal(p.read().status,'disposed');assert.equal(pending.size,0,'disposal from host notification must leave no scheduled callback');}
  if(kind==='supersede'){assert.equal(pending.size,1,'host pause/resume must leave only the current generation');p.pause();assert.equal(pending.size,0);}
  if(kind==='held'||kind==='removed'){assert.equal(p.read().status,kind);assert.equal(notify.at(-1),kind,'the notification must publish the terminal state');}
 }catch(error){callbackFailures.push(`${kind}: ${error.message}`);}
 p.dispose();
}
assert.deepEqual(callbackFailures,[]);
