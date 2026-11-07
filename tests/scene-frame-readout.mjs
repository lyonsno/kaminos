// kaminos-test: node
import assert from 'node:assert/strict';
import * as timing from '../volume-frame-timing.mjs';
assert.equal(typeof timing.frameSubmissionReadout,'function','visible cadence needs explicit submission and GPU-wait identity');
const previous={now:1000,sceneFrames:10,volumeFrames:20};
const volume={active:true,frameCount:20,lookFreeze:false,simulationPaused:false,
 timing:{queueProbePending:true,queueProbeStartedAt:1100}};
const held=timing.frameSubmissionReadout({previous,now:1500,sceneFrames:70,cpuMs:1,volume:{...volume,lightingSettingsPending:true}});
assert.equal(held.sceneSubmissionsPerSecond,120);
assert.equal(held.flameSubmissionsPerSecond,0);
assert.match(held.text,/120 scene submits\/s/);
assert.match(held.text,/flame held.*lighting pending/);
assert.match(held.text,/GPU pending 400ms/);
assert.doesNotMatch(held.text,/fps/i,'CPU callback/submission counts cannot claim presented FPS');
const paused=timing.frameSubmissionReadout({previous,now:1500,sceneFrames:70,cpuMs:1,volume:{...volume,frameCount:40,lookFreeze:1}});
assert.match(paused.text,/flame paused/);
const running=timing.frameSubmissionReadout({previous,now:1500,sceneFrames:70,cpuMs:1,volume:{...volume,frameCount:40,timing:{queueProbePending:false,queueDoneMs:12}}});
assert.match(running.text,/40 flame submits\/s/);
assert.match(running.text,/last GPU queue 12ms/);
const reset=timing.frameSubmissionReadout({previous,now:1500,sceneFrames:70,cpuMs:1,volume:{...volume,frameCount:2}});
assert.equal(reset.flameSubmissionsPerSecond,null,'a remounted counter has no rate until another sample');
assert.doesNotMatch(reset.text,/-\d/);
const absent=timing.frameSubmissionReadout({previous,now:1500,sceneFrames:70,cpuMs:1,volume:null});
assert.equal(absent.flameSubmissionsPerSecond,null);assert.doesNotMatch(absent.text,/flame|GPU/);
const stopped=timing.frameSubmissionReadout({previous,now:1500,sceneFrames:70,cpuMs:1,volume:{active:false,error:'device lost'}});
assert.match(stopped.text,/flame stopped/);
console.log('PASS visible CPU submissions, held/paused flame and GPU wait remain distinct');
