import assert from 'node:assert/strict';
const core=await import('../glb-animation-preview.mjs').catch(()=>({}));
assert.equal(typeof core.createGLBAnimationPreview,'function','native generated clips need actual playback, not a static registered GLB');
let callback=null;
class Mixer {
  constructor(){this.action={time:0,paused:false,clampWhenFinished:false,setLoop(){return this},play(){return this},stop(){this.time=0;return this}}}
  clipAction(){return this.action}
  update(dt){if(!this.action.paused)this.action.time=Math.min(1,this.action.time+dt)}
  stopAllAction(){this.action.stop()}
  uncacheRoot(){}
}
const root={uuid:'native-root',parent:{}};
const playback=core.createGLBAnimationPreview({THREE:{AnimationMixer:Mixer,LoopOnce:1},requestFrame:f=>(callback=f,1),cancelFrame:()=>{},onDirty:()=>{}});
assert.throws(()=>playback.play(root,[]),/animation clip/,'missing native animation cannot silently become static success');
playback.play(root,[{name:'native-Hound',duration:1}]);
callback(0);callback(400);
assert.equal(playback.state().time,.4);
playback.pause();assert.equal(playback.state().status,'paused');
playback.replay();callback(1000);callback(2200);
assert.equal(playback.state().status,'held','one-shot source sequence holds, not a claimed seamless gait loop');
assert.equal(playback.state().time,1);
root.parent=null;playback.replay();callback(3000);
assert.equal(playback.state().status,'removed');
console.log('GLB animation preview contracts passed');
