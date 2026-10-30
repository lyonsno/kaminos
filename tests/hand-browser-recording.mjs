// kaminos-test: node
import assert from 'node:assert/strict';
const module=await import('../experiments/hand-browser-recording.mjs').catch(e=>{if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;return {};});
assert.equal(typeof module.startHandRecording,'function','rendered hand motion retention is absent');
let instance,stops=0,fail=false;const chunks=[];
class Recorder{
  static isTypeSupported(){return true;}
  constructor(){instance=this;this.mimeType='video/webm';this.state='inactive';}
  start(){this.state='recording';}
  stop(){this.state='inactive';this.ondataavailable({data:new Blob(['final'])});this.onstop();}
}
const canvas={captureStream:()=>({getTracks:()=>[{stop(){stops++;}}]})};
const recording=module.startHandRecording({canvas,MediaRecorder:Recorder,write:async(bytes,part)=>{if(fail)throw Error('disk unavailable');chunks.push({body:await bytes.text(),part});}});
instance.ondataavailable({data:new Blob(['first'])});
await recording.stop();assert.deepEqual(chunks,[{body:'first',part:0},{body:'final',part:1}]);assert.equal(stops,1);
await recording.stop();assert.equal(stops,1);
const failed=module.startHandRecording({canvas,MediaRecorder:Recorder,write:async()=>{throw Error('disk unavailable');}});
await assert.rejects(failed.stop(),/disk unavailable/);assert.equal(stops,2);
