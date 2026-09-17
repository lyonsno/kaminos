import { createKimodoProducer, KIMODO_DEFAULT_MAX_IN_FLIGHT_DUTIES } from './artifacts/kimodo-live-flame/lib/producer.js';
import { initGPU } from './artifacts/kimodo-live-flame/lib/gpu.js';
import { createFrontendTelemetry, KIMODO_ROUTE_ID } from './artifacts/kimodo-live-flame/lib/telemetry.js';
import { summarizeFlameSpan, compositionVerdict, motionFrame } from './lib/kimodo-flame-evidence.mjs';
import { createFrameAdmission } from './lib/kimodo-frame-admission.mjs';

const $ = id => document.getElementById(`kimodo-${id}`);
const download = (name, value) => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value)], {type:'application/json'}));
  const a = document.createElement('a'); a.href=url; a.download=name; a.click();
  setTimeout(()=>URL.revokeObjectURL(url), 1000);
};
const ms = n => Number.isFinite(n) ? `${n.toFixed(1)} ms` : 'unmeasured';

export async function mountComposition({prototype, params} = {}) {
  if (!prototype?.debugState) throw new Error('Kimodo composition requires the live volume prototype');
  const root = document.createElement('aside'); root.id='kimodo-flame-hud';
  root.innerHTML=`<style>
    #kimodo-flame-hud{position:fixed;right:14px;top:14px;z-index:10000;width:min(365px,calc(100vw - 56px));max-height:calc(100vh - 56px);overflow:auto;padding:16px;background:rgba(9,16,27,.94);border:1px solid #36526c;border-radius:12px;color:#e4eff9;font:12px system-ui;box-shadow:0 12px 40px #0008}
    #kimodo-flame-hud h1{font-size:18px;margin:0 0 5px}#kimodo-flame-hud p{color:#acbdce;line-height:1.45;margin:5px 0 12px}
    #kimodo-flame-hud label{display:block;margin:7px 0}#kimodo-flame-hud input,#kimodo-flame-hud textarea{box-sizing:border-box;background:#111f30;color:#eef6ff;border:1px solid #3e5267;border-radius:5px;padding:6px;width:100%;font:inherit}
    #kimodo-flame-hud .pair{display:flex;gap:12px}#kimodo-flame-hud .pair label{flex:1}
    #kimodo-flame-hud dl{margin:10px 0;display:grid;grid-template-columns:100px 1fr;gap:6px}#kimodo-flame-hud dt{color:#95aec5}#kimodo-flame-hud dd{margin:0;overflow-wrap:anywhere;font-variant-numeric:tabular-nums}
    #kimodo-flame-hud button{padding:8px;border:1px solid #476b8d;border-radius:6px;background:#1b527e;color:white;cursor:pointer;font:inherit}#kimodo-flame-hud button:disabled{opacity:.45;cursor:default}
    #kimodo-flame-hud progress{width:100%;margin:8px 0}#kimodo-flame-hud canvas{width:100%;height:180px;background:#08121e;border:1px solid #28445d;border-radius:6px;margin-top:10px}
    #kimodo-error{color:#ffa099;white-space:pre-wrap}#kimodo-flame-hud .downloads{display:flex;gap:6px;margin-top:8px}
  </style>
  <h1>Kimodo × live flame</h1>
  <p>Elfinblue + real text-to-motion. Same GPU, two devices, independent queues. External Llama text encoder.</p>
  <label>Prompt<textarea id="kimodo-prompt" rows="2">a person dances</textarea></label>
  <div class="pair"><label>Seconds<input id="kimodo-duration" type="number" min="1" max="18" value="6"></label><label>DDIM steps<input id="kimodo-steps" type="number" min="1" value="100"></label></div>
  <label>Embedding endpoint<input id="kimodo-embed" value="http://127.0.0.1:8098/embed"></label>
  <label>Scheduling <select id="kimodo-scheduling"><option value="telemetry-only">Telemetry only (baseline)</option><option value="frame-admission">Finish pass → fresh flame frame</option></select></label>
  <div class="pair"><button id="kimodo-load">Load Kimodo</button><button id="kimodo-run" disabled>Generate motion</button><button id="kimodo-cancel" disabled>Cancel</button></div>
  <progress id="kimodo-progress" max="100" value="0"></progress>
  <dl><dt>Stage</dt><dd id="kimodo-stage">flame only · model not loaded</dd>
  <dt>Flame</dt><dd id="kimodo-flame">unverified</dd>
  <dt>Page p95</dt><dd id="kimodo-cadence">unmeasured</dd>
  <dt>Boundaries</dt><dd id="kimodo-boundaries">—</dd>
  <dt>GPU queue</dt><dd id="kimodo-queue">no generation</dd>
  <dt>Run</dt><dd id="kimodo-result">—</dd></dl>
  <div id="kimodo-error" role="alert"></div>
  <canvas id="kimodo-motion" width="660" height="360" aria-label="Generated 30-joint motion playback"></canvas>
  <div class="downloads"><button id="kimodo-motion-download" disabled>Motion JSON</button><button id="kimodo-report-download">Evidence JSON</button></div>`;
  document.body.appendChild(root);
  const state = {schema:'kimodo.live-flame-lab.v1',status:'idle',deviceTopology:'same-gpu-two-devices',timeOrigin:performance.timeOrigin,
    source:null,route:{url:location.href,preset:params?.get('settings_preset')},samples:[],runs:[],lastError:null,telemetry:null};
  window.__kimodoLiveFlame=state;
  let producer=null, device=null, controller=null, motion=null, telemetry=null, generation=0, baselineIndex=0, frameId, lastPaint=0, playbackStart=0, closed=false;
  const controls=()=>{const s=prototype.debugState();return {backend:s.backend,effectiveRoute:s.effectiveRoute,controls:s.controls};};
  const sample=()=>{const s=prototype.debugState();const v={t:performance.now(),frameCount:s.frameCount,simStepCount:s.simStepCount,active:s.active,backend:s.backend,error:s.error??null,visibility:document.visibilityState,phase:state.status};state.samples.push(v);return v;};
  function draw(now) {
    const canvas=$('motion'), ctx=canvas.getContext('2d'); ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle='#7d98b0';ctx.font='22px system-ui';
    if (!motion) {ctx.fillText('Generated motion will play here',25,185);return;}
    const frame=motionFrame(now,playbackStart,motion.fps,motion.numFrames);
    const joints=motion.joints[frame], center=joints[0];
    const project=([x,y,z])=>[330+((x-center[0])*.85+(z-center[2])*.53)*130,295-y*130];
    ctx.strokeStyle='#71cfff';ctx.lineWidth=4;ctx.beginPath();
    joints.forEach((j,i)=>{const p=motion.parents[i];if(p<0)return;const a=project(j),b=project(joints[p]);ctx.moveTo(...a);ctx.lineTo(...b);});ctx.stroke();
    ctx.fillStyle='#e2f7ff';joints.forEach(j=>{ctx.beginPath();ctx.arc(...project(j),3,0,Math.PI*2);ctx.fill();});
    ctx.fillStyle='#7d98b0';ctx.font='18px system-ui';ctx.fillText(`frame ${frame+1}/${motion.numFrames} · ${motion.fps} fps`,15,25);
  }
  function tick(now) {
    if(closed)return;
    const s=sample();draw(now);
    if(now-lastPaint>=250){
      const recent=state.samples.filter(s=>s.t>=now-3000);const summary=summarizeFlameSpan(recent);
      $('flame').textContent=`${summary.status} · frame ${s.frameCount ?? '?'} / sim ${s.simStepCount ?? '?'}`;
      $('cadence').textContent=ms(summary.pageCadence.p95Ms);
      if(telemetry){state.telemetry=telemetry.snapshot();const t=state.telemetry;
        $('stage').textContent=`${t.status} · ${t.currentStage} · ${t.progress.step}/${t.progress.numSteps}`;
        $('boundaries').textContent=`${t.scheduler.observedForegroundBoundaryCount}/${t.scheduler.expectedForegroundBoundaryCount} · host submits ${t.scheduler.hostSubmissionCount}`;
        $('progress').value=t.progress.pct;
        const q=t.submission;$('queue').textContent=q?`${q.status} · ${q.completedDutyCount}/${q.submittedDutyCount} · peak ${q.maxObservedInFlightDuties}/${q.maxInFlightDuties} · failed ${q.failedDutyCount} · active ${q.inFlightDutyCount}`:'terminal receipt pending';
      }
      lastPaint=now;
    }
    frameId=requestAnimationFrame(tick);
  }
  frameId=requestAnimationFrame(tick);
  $('report-download').onclick=()=>download('kimodo-flame-evidence.json',state);
  $('motion-download').onclick=()=>download(`kimodo-motion-${motion.generationId}.json`,motion);
  $('cancel').onclick=()=>controller?.abort();
  $('load').onclick=async()=>{
    $('load').disabled=true;$('embed').disabled=true;state.status='loading';$('stage').textContent='loading Kimodo';
    try{
      const resp=await fetch('./artifacts/kimodo-live-flame/manifest.json',{cache:'no-store'});
      if(!resp.ok)throw new Error(`Source manifest unavailable (${resp.status})`);
      state.source=await resp.json();if(state.source.status!=='built')throw new Error('Kimodo library build incomplete');
      const gpu=await initGPU();device=gpu.device;
      producer=await createKimodoProducer({...gpu,assetBase:'./artifacts/kimodo-live-flame/assets',embedUrl:$('embed').value,
        onLoadProgress:({loaded,total})=>{state.loadProgress={loaded,total};$('stage').textContent=`loading weights · ${(loaded/1048576).toFixed(0)} MiB`;if(total)$('progress').value=100*loaded/total;}});
      if(producer.identity.model.weightsHash!==state.source.assets['kimodo.bin'].sha256)throw new Error('Loaded weights differ from source manifest');
      state.producerIdentity=producer.identity;state.status='loaded';baselineIndex=state.samples.length;sample();
      $('stage').textContent='model loaded · flame-only baseline';$('progress').value=0;$('run').disabled=false;$('load').textContent='Model loaded';
    }catch(error){state.status='failed';state.lastError={phase:'load',message:error.message};$('error').textContent=error.message;producer?.dispose();device?.destroy();}
  };
  $('run').onclick=async()=>{
    if(state.status==='running'||!producer)return;
    const steps=Number($('steps').value),duration=Number($('duration').value),prompt=$('prompt').value.trim();
    if(!Number.isSafeInteger(steps)||steps<1||!Number.isFinite(duration)||duration<1||duration>18||!prompt){$('error').textContent='Use a prompt, 1–18 seconds and a positive integer step count.';return;}
    $('run').disabled=true;$('cancel').disabled=false;$('error').textContent='';
    for(const id of ['prompt','steps','duration','scheduling'])$(id).disabled=true;
    const generationId=++generation, t0=performance.now();sample();
    const baselineSamples=state.samples.slice(baselineIndex),runIndex=state.samples.length;
    const record={generationId,prompt,steps,duration,startedAtMs:t0,baseline:summarizeFlameSpan(baselineSamples),baselineSampleRange:[baselineIndex,runIndex],flameStart:controls(),status:'running'};
    state.runs.push(record);state.status='running';sample();controller=new AbortController();
    record.scheduling={mode:$('scheduling').value,topology:'same-gpu-two-devices',events:[]};
    const admit=createFrameAdmission({mode:record.scheduling.mode,queue:device.queue,readFlame:()=>prototype.debugState(),events:record.scheduling.events});
    telemetry=createFrontendTelemetry({generationId,numSteps:steps,requestedMaxInFlightDuties:KIMODO_DEFAULT_MAX_IN_FLIGHT_DUTIES});
    try{
      const result=await producer.generate({prompt,steps,duration,generationId,signal:controller.signal,
        onStage:(name,event)=>telemetry.stage(name,event),onProgress:p=>telemetry.progress(p),foregroundOpportunity:async b=>{telemetry.foreground(b);await admit(b);}});
      // Preserve the generated output even if the evidence verdict is narrower.
      motion=result.motion;playbackStart=performance.now();$('motion-download').disabled=false;
      record.receipt=result.receipt;record.submission=result.submission;record.motion={numFrames:motion.numFrames,numJoints:motion.numJoints,fps:motion.fps};
      record.diagnostics=result.diagnostics;
      telemetry.succeed(result.receipt,result.submission);
      state.status=telemetry.snapshot().status;
    }catch(error){record.diagnostics=error.diagnostics??null;telemetry.fail(error);state.status=telemetry.snapshot().status;state.lastError={phase:error.phase??'generation',message:error.message};record.error=state.lastError;$('error').textContent=error.message;}
    finally{
      sample();record.endedAtMs=performance.now();record.wallMs=record.endedAtMs-t0;record.telemetry=telemetry.snapshot();state.telemetry=record.telemetry;
      record.inferenceSampleRange=[runIndex,state.samples.length];record.inference=summarizeFlameSpan(state.samples.slice(runIndex));record.flameEnd=controls();
      record.status=compositionVerdict({telemetry:record.telemetry,baseline:record.baseline,inference:record.inference,expectedRoute:KIMODO_ROUTE_ID});
      $('result').textContent=`${record.status} · ${(record.wallMs/1000).toFixed(1)} s · baseline/run p95 ${ms(record.baseline.pageCadence.p95Ms)} / ${ms(record.inference.pageCadence.p95Ms)}`;
      if(record.telemetry.failure)$('error').textContent=`${record.telemetry.failure.code??record.telemetry.failure.phase}: ${record.telemetry.failure.message}`;
      baselineIndex=state.samples.length;sample();controller=null;$('cancel').disabled=true;$('run').disabled=false;
      for(const id of ['prompt','steps','duration','scheduling'])$(id).disabled=false;
    }
  };
  addEventListener('pagehide',()=>{closed=true;cancelAnimationFrame(frameId);controller?.abort();if(!controller){producer?.dispose();device?.destroy();}},{once:true});
  return {state};
}
