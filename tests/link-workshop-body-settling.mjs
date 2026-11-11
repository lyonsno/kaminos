// kaminos-test: node
import assert from 'node:assert/strict';
import * as T from '../lib/three.core.js';
import {createMechanismController} from '../experiments/link-workshop.experiment.mjs';
import {createWorkbenchFrameService} from '../workbench-scene-host.mjs';
import {createSceneEdits} from '../scene-edit-session.mjs';
import {createBodyDynamics} from '../experiments/link-workshop/body-dynamics.mjs';
import {createSettlingMonitor} from '../experiments/link-workshop/settling.mjs';
const recipe={schema:'kaminos.links.v1',period:3,nodes:[{parent:null,point:[0,0]},{parent:0,length:1,angles:[.4,.4]},{parent:1,length:1,angles:[-.5,-.5]}],pistons:[]};
const scene=new T.Group(),root=new T.Group(),entries=[{id:'mechanism',object:root}];scene.add(root);root.userData.linkMechanism=recipe;
const edits=createSceneEdits({read(){throw Error('Unused');},write(){throw Error('Unused');}});let adapter;
const host={scene:{objects:()=>entries,async open(){return {async attach(o){scene.add(o);return {id:'mechanism',root:o};},redraw(){},readView(){return {};},onFrame(){return ()=>{};},async dispose(){}};}},controls:{document:{defaultView:{kaminosSceneEdits:edits,kaminosSelection:{set(){}}}},components:{register(id,a){adapter=a;return {changed(fn){edits.cancel();fn?.();},dispose(){}};}}}};
const runtime=await createMechanismController({host,inputs:{root,mode:'B'}});
const advance=n=>{for(let i=0;i<n;i++){runtime.advance(1/120);runtime.tick();}};
function carry(){runtime.operations.select({joint:1});const before=runtime.read().recipe,count=edits.state().undoCount;for(let i=1;i<=30;i++){const angle=.4+.15*i/30;runtime.operations.pull({joint:1,mode:'B',point:[Math.cos(angle),Math.sin(angle)]});advance(1);}return {before,count};}
try{
 runtime.operations.dynamics({enabled:true,hydraulicsEnabled:false,gravity:[0,0],jointDamping:.3,settleAfterRelease:true});
 const {before,count}=carry(),held=runtime.read();runtime.operations.releasePull();
 assert.equal(runtime.read().mechanics.phase,'settling','Release must retain dynamic motion around the placed point');
 assert.deepEqual(runtime.read().mechanics.velocities,held.mechanics.velocities,'Release preserves momentum');assert.equal(runtime.read().mechanics.time,held.mechanics.time);
 assert.equal(runtime.read().mechanics.hand,null);assert.ok(runtime.read().mechanics.support,'The released point is an explicit temporary authoring support');assert.equal(edits.state().active,null,'The hand gesture ends immediately');
 const released=runtime.read().recipe;advance(20);assert.notDeepEqual(runtime.read().recipe,released,'The rest continues to accommodate after releasing');
 assert.ok(Math.hypot(...runtime.read().points[1].map((x,k)=>x-held.points[1][k]))<.005,'Settling preserves the placed point');
 for(let i=0;i<2400&&runtime.read().mechanics.phase==='settling';i++)advance(1);
 assert.equal(runtime.read().mechanics.phase,'idle','Dissipating motion eventually sleeps without a duration cut-off');
 const final=runtime.read().recipe;assert.equal(edits.state().undoCount,count+1);advance(20);assert.deepEqual(runtime.read().recipe,final,'Sleeping mechanisms do no further posing work');
 const capture=runtime.operations.exportDynamics();assert.ok(capture.steps.some(s=>s.support&&!s.grab),'The entire settling tail is replayable');assert.equal(capture.finish.reason,'quiet');
 assert.equal(capture.schema,'kaminos.mechanical-pull.v2','A tail with a placed support must not masquerade as the old hand-only recording');
 const replay=createBodyDynamics(capture.recipe,{fraction:1,joint:capture.joint});let replayed;for(const s of capture.steps)replayed=replay.step(s.seconds,{grab:s.grab,support:s.support??null});
 assert.deepEqual(replayed.angles,final.nodes.map(n=>n.parent===null?0:n.angles[1]),'Replay includes the released motion and achieves the exact final pose');
 edits.undo();assert.deepEqual(runtime.read().recipe,before);edits.redo();assert.deepEqual(runtime.read().recipe,final);assert.equal(runtime.read().mechanics.phase,'idle');
 const next=carry();runtime.operations.releasePull();advance(3);const interrupted=runtime.read().recipe;edits.undo();advance(30);assert.deepEqual(runtime.read().recipe,next.before,'Undo during settling stops its writer before restoration');edits.redo();assert.deepEqual(runtime.read().recipe,interrupted);
 carry();runtime.operations.releasePull();advance(3);runtime.operations.select({joint:2});const selected=runtime.read().recipe;advance(30);assert.deepEqual(runtime.read().recipe,selected,'Selecting another component interrupts the tail at its achieved pose');
 carry();runtime.operations.releasePull();advance(3);const target=adapter.target(),at=target.read(),newPoint=runtime.read().points[1];edits.begin(target.id);edits.preview({...at,position:[newPoint[0]-.01,newPoint[1]+.01,0]},{transform:'translate'});advance(1);assert.equal(runtime.read().mechanics.phase,'held','A native re-grab starts its own solve immediately, without inheriting the retired tail');assert.ok(runtime.read().mechanics.time<.02);edits.cancel();
 const playGesture=carry();runtime.operations.releasePull();advance(3);const beforePlay=runtime.read().recipe,frameErrors=[],clock=createWorkbenchFrameService({onError:error=>frameErrors.push(error.message)});
 const stopFrame=clock.onFrame(({deltaSeconds})=>{runtime.advance(deltaSeconds);runtime.tick();});clock.tick(0);runtime.operations.play();const fractionBefore=runtime.read().fraction;clock.tick(1000/120);clock.tick(2000/120);
 assert.deepEqual(frameErrors,[],'Play during a settling tail must not throw and retire the shared mechanism subscription');assert.equal(clock.state().activeSubscriptions,1);assert.equal(runtime.read().playing,true);assert.notEqual(runtime.read().fraction,fractionBefore,'Authored playback continues through the production frame service');assert.equal(runtime.read().mechanics.phase,'idle');assert.deepEqual(runtime.read().recipe,beforePlay,'Entering Play stops the tail at its achieved pose');
 runtime.operations.pause();edits.undo();assert.deepEqual(runtime.read().recipe,playGesture.before);edits.redo();assert.deepEqual(runtime.read().recipe,beforePlay,'Redo retains the achieved pre-play pose');stopFrame();
 carry();runtime.operations.releasePull({cancel:true});assert.equal(runtime.read().mechanics.phase,'idle');assert.equal(edits.state().active,null);
 runtime.operations.dynamics({settleAfterRelease:false});carry();runtime.operations.releasePull();const frozen=runtime.read().recipe;advance(30);assert.deepEqual(runtime.read().recipe,frozen,'The prior freeze-on-release behavior remains selectable');
 const monitor=createSettlingMonitor(),state={activeJoints:[1],pointVelocities:[[0,0],[0,0]],angularVelocities:[0,0],converged:true};
 for(let i=0;i<20;i++)assert.equal(monitor.observe(state,1/120).asleep,false,'A short pause or turning point must not be mistaken for settled motion');
 assert.equal(monitor.observe({...state,pointVelocities:[[0,0],[1,0]]},1/120).quietSeconds,0,'Resumed motion resets the quiet interval');
}finally{edits.clear();await runtime.dispose();}
console.log('Native release settling, close placement support, full tail capture, interruption and one Undo/Redo');
