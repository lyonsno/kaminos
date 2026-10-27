export const FEATURE = 'decoder3d.sampled';
export const CARRY_TARGETS = [
  {id:'left',position:[-.9,2.75,.8]}, {id:'up',position:[0,3.45,.8]},
  {id:'right',position:[.9,2.75,.8]}, {id:'down',position:[0,2.05,.8]},
].map(target=>({...target,radius:.24,space:'presentation-xy'}));

export function gestureProtocol(mode='neutral') {
  if(!['neutral','turns'].includes(mode))throw Error(`Unknown capture mode: ${mode}`);
  const cues = [];
  const add = (title, detail, seconds, intent, extra = {}) => cues.push({title, detail, seconds, intent, ...extra});
  if(mode==='neutral'){
    add('Find a comfortable carry', 'Palm up. Imagine carrying the cube without turning it.', 6, 'unlabeled');
    add('Settle into neutral', 'Let your hand settle naturally. No need to freeze your fingers.', 4, 'neutral');
    for(const [block,order] of [[1,[0,1,2,3]],[2,[2,0,3,1]]]){
      if(block===2){
        add('Let your hand rest', 'Lower your hand out of view.', 4, 'release', {block});
        add('Find your carry again', 'Raise your hand. Find the same intention: carry, without turning.', 6, 'reacquire', {block});
      }
      for(const index of order){
        const destination=structuredClone(CARRY_TARGETS[index]);
        add(`Carry ${destination.id}`, 'Move the cube into the lit ring without intending to turn it. Settle there comfortably.', 5, 'neutral-carry', {block,destination});
      }
    }
    return cues.map((cue,index)=>({...cue,index}));
  }
  add('Get comfortable', 'Raise your hand. Move it around freely.', 15, 'unlabeled');
  add('Find your neutral', 'Palm up, fingers comfortably cupped around an imaginary cube.', 6, 'neutral');
  add('Carry that shape', 'Keep the same finger shape. Move your whole hand a little.', 8, 'neutral-nuisance');
  for (const [block, seconds] of [[1,5],[2,2]]) {
    for (const direction of block === 1 ? ['right','left'] : ['left','right']) {
      const meta = {block,direction};
      add('Let your hand rest', 'Lower your hand out of view.', 5, 'release', meta);
      add('Find neutral again', 'Raise your hand and recover that comfortable cupped shape.', 6, 'reacquire', meta);
      add(`Prepare to turn ${direction}`, 'Keep the palm comfortable. Let fingers and thumb lead the turn.', 3, 'countdown', meta);
      add(`Turn gently ${direction}`, `Turn the imaginary cube only as far as feels comfortable, over ${seconds} counts.`, seconds, 'move', meta);
      add('Stay there', 'Keep that slight deflection without pushing farther.', block === 1 ? 4 : 7, 'hold', meta);
      add('Return to neutral', `Unwind gently over ${seconds} counts.`, seconds, 'return', meta);
      add('Rest at neutral', 'Let the fingers settle, without lowering the hand.', 4, 'neutral', meta);
    }
  }
  add('Prepare a small reversal', 'Start from your comfortable neutral.', 3, 'countdown', {block:3});
  add('A little right', 'Turn only halfway to your comfortable rightward position.', 4, 'partial-reversal', {block:3,direction:'right'});
  add('Back through neutral', 'Gently continue a little to the left.', 5, 'partial-reversal', {block:3,direction:'left'});
  add('Find neutral', 'Unwind and let your hand settle.', 4, 'return', {block:3});
  add('Your own pace', 'Repeat the gentle turns, holds and returns in your own rhythm.', 18, 'unlabeled', {block:4});
  return cues.map((cue,index)=>({...cue,index}));
}

export function packObservation(result) {
  if (!result?.hasHand) return {layout:[],bytes:null};
  const feature = result.captures?.[FEATURE];
  if (!feature || feature.shape?.join(',') !== '21,256') throw Error('Missing or wrong MobRecon feature shape');
  const fields = [['nativeVertices',[778,3],result.nativeVertices],['nativeUV',[21,2],result.nativeUV],
    ['verticesMeters',[778,3],result.verticesMeters],['cropUV',[21,2],result.cropUV],[FEATURE,[21,256],feature.data]];
  let offset=0;
  const layout=fields.map(([name,shape,data])=>{
    const length=shape.reduce((a,b)=>a*b,1);
    if (!(data instanceof Float32Array) || data.length!==length || !data.every(Number.isFinite)) throw Error(`${name}: finite Float32Array [${shape}] required`);
    const entry={name,shape,offset,length};offset+=length;return entry;
  });
  const floats=new Float32Array(offset);
  fields.forEach(([, ,data],i)=>floats.set(data,layout[i].offset));
  return {layout,bytes:floats.buffer};
}

const serial = n => String(n).padStart(8,'0');
const message = cause => String(cause?.message??cause);

// Instructions and observations share a monotonic clock, not a target curve.
// Each observation retains its exact input pixels before the next video frame.
export function createGestureCapture({fetch:request=globalThis.fetch,MediaRecorder:Recorder=globalThis.MediaRecorder,
  now=()=>performance.now(),epoch=()=>performance.timeOrigin,changed=()=>{}}={}) {
  let status='idle',session=null,error=null,recorder=null,videoStopped=null,finishTask=null;
  let tasks=[],frameCount=0,savedFrames=0,videoChunks=0,eventCount=0,pending=0;
  let mode='neutral',cues=gestureProtocol(),cueIndex=0,cueAt=0,startedAt=0,pausedAt=null,protocolComplete=false;
  const endpoint=(action,extra={})=>'/api/iron-gland-capture?'+new URLSearchParams({action,...(session?{id:session.id}:{}),...extra});
  const post=async(action,body,extra={},json=false)=>{
    const response=await request(endpoint(action,extra),{method:'POST',headers:{'Content-Type':json?'application/json':'application/octet-stream'},body:json?JSON.stringify(body):body});
    const value=await response.json();
    if (!response.ok) throw Error(value.error??value.validationErrors?.join('; ')??`capture ${action}: HTTP ${response.status}`);
    return value;
  };
  const read=()=>({status,mode,id:session?.id??null,path:session?.path??null,error,frameCount,savedFrames,pending,videoChunks,eventCount,
    protocolComplete,paused:pausedAt!==null,cue:session?{...cues[cueIndex],atMs:cueAt,
      elapsedSeconds:Math.max(0,((pausedAt??now())-cueAt)/1000),total:cues.length}:null,
    nextCue:session&&status==='recording'&&!protocolComplete?cues[cueIndex+1]??null:null});
  const update=()=>changed(read());
  const failure=cause=>{
    error??=message(cause);update();
    if(status==='recording')queueMicrotask(()=>{void finish('failed',error);});
  };
  const track=work=>{
    pending++;update();
    const task=Promise.resolve().then(work).catch(failure).finally(()=>{pending--;update();});
    tasks.push(task);return task;
  };
  const write=(name,body)=>post('write',body,{name});
  const event=(kind,extra={})=>{
    const entry={kind,atMs:now(),cueIndex,...extra},index=eventCount++;
    return track(()=>write(`events/${serial(index)}.json`,JSON.stringify(entry)));
  };
  function tick() {
    if(status!=='recording'||pausedAt!==null||protocolComplete)return;
    if(now()-cueAt>=cues[cueIndex].seconds*1000){
      // Advance once, at the observed time. A suspended tab cannot perform cues.
      if(cueIndex===cues.length-1){protocolComplete=true;event('protocol-complete');}
      else {cueIndex++;cueAt=now();event('cue',{cue:cues[cueIndex]});}
    }
    update();
  }
  async function begin({stream,identity,settings={},faces,source={kind:'live-camera'},runtime=null,mode:selectedMode='neutral'}={}) {
    if(['starting','recording','saving'].includes(status))throw Error('A capture is already active');
    const protocol=gestureProtocol(selectedMode);
    if(!Recorder)throw Error('Camera recording is unavailable in this browser');
    const mimeType=['video/webm;codecs=vp8','video/webm','video/mp4'].find(type=>Recorder.isTypeSupported(type));
    if(!mimeType)throw Error('No supported camera recording format');
    if(!faces?.length||faces.length%3||!faces.every(i=>Number.isInteger(i)&&i>=0&&i<778))throw Error('Hand topology is unavailable');
    status='starting';session=null;error=null;recorder=null;videoStopped=null;finishTask=null;tasks=[];frameCount=savedFrames=videoChunks=eventCount=pending=0;
    protocolComplete=false;pausedAt=null;cueIndex=0;cues=protocol;mode=selectedMode;update();
    try {
      session=await post('start',{schema:'iron-gland-gesture-capture.v1',identity,settings:{...settings,captureMode:mode},source,runtime,
        camera:stream.getVideoTracks()[0]?.getSettings(),timeOriginMs:epoch(),protocol:cues,
        annotationAuthority:'instructions-only-not-continuous-targets',feature:FEATURE,floatEncoding:'float32-le',videoMimeType:mimeType}, {},true);
      await write('topology.u16',new Uint16Array(faces));
      recorder=new Recorder(stream,{mimeType});
      const extension=mimeType.includes('mp4')?'mp4':'webm';
      videoStopped=new Promise(resolve=>recorder.addEventListener('stop',resolve,{once:true}));
      recorder.addEventListener('dataavailable',({data})=>{if(data?.size){const index=videoChunks++;track(()=>write(`video/${serial(index)}.${extension}`,data));}});
      recorder.addEventListener('error',e=>failure(e.error??Error('Camera recorder failed')));
      startedAt=cueAt=now();status='recording';recorder.start(1000);event('start',{cue:cues[0],videoStartedAtMs:startedAt});update();return read();
    } catch(cause) {
      if(!recorder||recorder.state==='inactive')videoStopped=null;
      failure(cause);await finish('failed',message(cause));throw cause;
    }
  }
  async function observe({canvas,metadata={},infer}) {
    if(status!=='recording')return infer([]);
    tick();
    const index=frameCount++,captureAtMs=now(),cue={...cues[cueIndex],atMs:cueAt,paused:pausedAt!==null,protocolComplete};
    const image=new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('Camera PNG capture failed')),'image/png'));
    // Attach rejection handling now while the independent GPU inference runs.
    image.catch(()=>{});
    const dimensions=[canvas.width,canvas.height];
    let completeObservation;
    const done=new Promise(r=>{completeObservation=r;});tasks.push(done);
    try {
      let result,cause,packed={layout:[],bytes:null};
      try{result=await infer([FEATURE]);packed=packObservation(result);}catch(e){cause=e;failure(e);}
      const data={index,captureAtMs,completedAtMs:now(),video:metadata,dimensions,cue,
        hasHand:!!result?.hasHand,handedness:result?.handedness,cropBox:result?.cropBox,
        acquisition:result?.acquisition,timings:result?.timings,layout:packed.layout,error:cause?message(cause):null};
      track(async()=>{
        await write(`frames/${serial(index)}.png`,await image);
        if(packed.bytes)await write(`frames/${serial(index)}.f32`,packed.bytes);
        await write(`frames/${serial(index)}.json`,JSON.stringify(data));savedFrames++;
      });
      if(cause)throw cause;
      return result;
    } finally {completeObservation();update();}
  }
  function finish(requested='partial',reason='operator-finished') {
    if(finishTask)return finishTask;
    if(!session){status=error?'failed':'idle';update();return Promise.resolve(read());}
    status='saving';update();
    finishTask=(async()=>{
      try {
        if(recorder?.state!=='inactive')recorder?.stop();
        if(videoStopped)await videoStopped;
        await event('finish',{requestedStatus:requested,reason});
        // In-flight inference may register its writes after Finish was pressed.
        let settled=0;
        while(settled<tasks.length){const batch=tasks.slice(settled);settled=tasks.length;await Promise.all(batch);}
        const terminal=error?'failed':requested;
        const manifest=await post('finish',{status:terminal,reason,error,frameCount,videoChunks,eventCount,
          startedAtMs:startedAt,finishedAtMs:now(),protocolComplete}, {},true);
        status=manifest.status;update();
      }catch(cause){error??=message(cause);status='failed';update();}
      return read();
    })();
    return finishTask;
  }
  return {read,begin,observe,finish,tick,
    repeat(){if(status!=='recording')throw Error('No active take');cueAt=now();if(pausedAt!==null)pausedAt=cueAt;protocolComplete=false;event('repeat',{cue:cues[cueIndex]});update();return read();},
    pause(){if(status!=='recording')return read();if(pausedAt===null){pausedAt=now();event('pause');}else{cueAt+=now()-pausedAt;pausedAt=null;event('resume');}update();return read();},
  };
}
