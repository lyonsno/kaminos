// Replaceable BFL prompt/ordered-reference -> editable text operation.
// This adapter owns Transformers.js tensors; callers receive text and provenance.
import {prepareReference} from './reference-policy.mjs';
import {installTextRopeCompatibility} from './text-rope-compat.mjs';
export const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0';
export const BFL_SOURCE_REVISION = '3f3edb52b2c55de0d49feab28598b68f7f8e4830';

export function visionPositions(grid, side=48, merge=2) {
  const [t,h,w]=grid.map(Number);
  if(t!==1) throw Error('Encode one image at a time.');
  if(![h,w].every(v=>Number.isInteger(v)&&v>0&&v%merge===0)) throw Error('Image grid must respect spatial merge blocks.');
  const n=h*w, positionIds=new BigInt64Array(n*2), interpIndices=new BigInt64Array(n*4), interpWeights=new Float32Array(n*4);
  for(let i=0;i<n;i++){
    const row=Math.floor(i/(merge*merge*(w/merge)))*merge+Math.floor(i/merge)%merge;
    const col=(Math.floor(i/(merge*merge))%(w/merge))*merge+i%merge;
    positionIds[i*2]=BigInt(row);positionIds[i*2+1]=BigInt(col);
    // Canonical bilinear, align_corners=True learned-position interpolation.
    const y=Math.fround(Math.fround(row*(side-1))/Math.max(1,h-1)), x=Math.fround(Math.fround(col*(side-1))/Math.max(1,w-1));
    const loY=Math.floor(y),loX=Math.floor(x),hiY=Math.min(side-1,loY+1),hiX=Math.min(side-1,loX+1);
    const dy=y-loY,dx=x-loX;
    interpIndices.set([BigInt(loY*side+loX),BigInt(loY*side+hiX),BigInt(hiY*side+loX),BigInt(hiY*side+hiX)],i*4);
    interpWeights.set([(1-dy)*(1-dx),(1-dy)*dx,dy*(1-dx),dy*dx],i*4);
  }
  return {positionIds,interpIndices,interpWeights};
}
export function penalizeGenerated(ids,promptLength,logits,penalty){
  for(const id of new Set(ids.slice(promptLength))) logits[Number(id)]-=penalty;
}
export function helperMessages(prompt,referenceCount,systems,{mode='expand',systemPrompt}={}){
  if(!Number.isInteger(referenceCount)||referenceCount<0||referenceCount>10) throw Error('BFL accepts up to 10 ordered reference images.');
  if(mode!=='expand'&&mode!=='vlm') throw Error(`Unsupported prompt helper mode: ${mode}`);
  if(!prompt.trim()) throw Error('Enter an image request.');
  if(mode==='vlm'){
    const sys=systemPrompt?.trim()||'You are a helpful assistant.';
    const content=referenceCount?[...Array.from({length:referenceCount},()=>({type:'image'})),{type:'text',text:prompt}]:prompt;
    return [{role:'system',content:sys},{role:'user',content}];
  }
  const task=referenceCount?'i2i':'t2i';
  const content=referenceCount?[...Array.from({length:referenceCount},()=>({type:'image'})),{type:'text',text:`Reference images follow in order (the first image, the second image, ...).\nUser request: ${prompt}\nOutput the caption.`}]:prompt;
  return [{role:'system',content:systems[task]},{role:'user',content}];
}

async function visionFeatureKey(grid,pixels){
  const header=new TextEncoder().encode(`${grid.join('x')}:${pixels.type}:${pixels.dims.join('x')}:`);
  const bytes=new Uint8Array(pixels.data.buffer,pixels.data.byteOffset,pixels.data.byteLength);
  const combined=new Uint8Array(header.byteLength+bytes.byteLength);
  combined.set(header,0);combined.set(bytes,header.byteLength);
  const digest=await globalThis.crypto.subtle.digest('SHA-256',combined);
  return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
}

function lruSet(map,key,value,maxEntries){
  if(map.has(key))map.delete(key);
  map.set(key,value);
  while(map.size>maxEntries)map.delete(map.keys().next().value);
}

export async function createBrowserPromptHelper({modelUrl,onProgress=()=>{},runtimeUrl=TRANSFORMERS_URL,prepareReferenceImpl=prepareReference,maxCacheEntries=16}={}){
  if(!modelUrl) throw Error('A BFL ONNX model package URL is required.');
  const base=new URL(modelUrl,globalThis.location?.href).href.replace(/\/$/,'');
  if(new URL(base).origin!==globalThis.location.origin)throw Error('Mount the local conversion package on the page origin for this browser trial.');
  // Transformers.js4.2 resolves same-origin packages as paths. Its hub loader
  // deliberately skips direct HTTP URLs, then rejects them as invalid HF IDs.
  const packagePath=new URL(base).pathname;
  const response=await fetch(base+'/provenance.json');
  if(!response.ok) throw Error(`Model provenance HTTP ${response.status}`);
  const provenance=await response.json();
  if(provenance.status!=='complete'||!provenance.source?.endsWith(BFL_SOURCE_REVISION)) throw Error('Package does not identify the exact completed BFL conversion.');
  const systemsResponse=await fetch(base+'/system_prompts.json');
  if(!systemsResponse.ok) throw Error(`BFL prompts HTTP ${systemsResponse.status}`);
  const systems=await systemsResponse.json();
  if(!systems.t2i||!systems.i2i) throw Error('BFL system prompts are incomplete.');
  const tf=await import(runtimeUrl);
  // The route explicitly requests WebGPU; do not turn an unsupported model into
  // a successful result from another backend. Disable duplicate browser disk cache
  // for the local conversion trial; deployment can opt into a published asset cache.
  tf.env.useBrowserCache=false;
  tf.env.allowLocalModels=true;
  onProgress({phase:'processor'});
  const processor=await tf.AutoProcessor.from_pretrained(packagePath);
  if(!processor.tokenizer)throw Error('The browser package must identify Qwen3VLProcessor, including its tokenizer.');
  const templateResponse=await fetch(base+'/chat_template.jinja');
  if(!templateResponse.ok)throw Error(`BFL chat template HTTP ${templateResponse.status}`);
  processor.chat_template=await templateResponse.text();
  if(!processor.chat_template.trim())throw Error('The BFL chat template is empty.');
  let model=null,busy=false,currentVisionStats={hits:0,misses:0};
  const visionFeatureCache=new Map(),preparedReferenceCache=new Map();
  async function load(){
    if(model)return;
    onProgress({phase:'model'});
    let candidate;
    try{
      candidate=await tf.Qwen3_5ForConditionalGeneration.from_pretrained(packagePath,{
      device:'webgpu',dtype:{embed_tokens:'q4f16',vision_encoder:'fp16',decoder_model_merged:'q4f16'},
      // Transformers.js4.2 aggregates progress by fetching local-file metadata
      // through whole GET responses whose bodies it never consumes or cancels.
      // With the authoring page's live streams this can exhaust the HTTP connection pool,
      // blocking model loading and the page lease renewals. Keep phase/elapsed
      // reporting; omit this optional preflight and let real loads read each body.
    });
    for(const [name,session] of Object.entries(candidate.sessions)){
      if(session.config?.device!=='webgpu')throw Error(`${name} did not select the WebGPU session.`);
    }
    installTextRopeCompatibility(candidate);
    // The exported single-image graph takes source-equivalent position inputs.
    // Because all 333 vision_encoder tensors are frozen across base Qwen3.5 and BFL-PUP,
    // per-image post-merger features are cached as typed-array snapshots across resident turns.
    candidate.encode_image=async({pixel_values,image_grid_thw})=>{
      const grids=image_grid_thw.tolist(),features=[];
      let offset=0;
      for(const grid of grids){
        const count=Number(grid[0])*Number(grid[1])*Number(grid[2]);
        const pixels=pixel_values.slice([offset,offset+count],null);
        const cacheKey=await visionFeatureKey(grid,pixels);
        const cached=visionFeatureCache.get(cacheKey);
        if(cached){
          pixels.dispose();
          lruSet(visionFeatureCache,cacheKey,cached,maxCacheEntries);
          currentVisionStats.hits++;
          features.push(new tf.Tensor(cached.type,cached.data.slice(),[...cached.dims]));
        }else{
          const p=visionPositions(grid);
          const feeds={pixel_values:pixels,
            position_ids:new tf.Tensor('int64',p.positionIds,[count,2]),
            interp_indices:new tf.Tensor('int64',p.interpIndices,[count,4]),
            interp_weights:new tf.Tensor('float32',p.interpWeights,[count,4])};
          try{
            const feat=await candidate._encode_input('vision_encoder',feeds,'image_features');
            lruSet(visionFeatureCache,cacheKey,{type:feat.type,data:feat.data.slice(),dims:[...feat.dims]},maxCacheEntries);
            currentVisionStats.misses++;
            features.push(feat);
          }finally{for(const t of Object.values(feeds))t.dispose();}
        }
        offset+=count;
      }
      if(offset!==pixel_values.dims[0])throw Error('Reference grid does not account for all image patches.');
      if(features.length===1)return features[0];
      const merged=tf.cat(features,0);for(const f of features)f.dispose();return merged;
    };
      model=candidate;
    }catch(error){await candidate?.dispose();throw error;}
  }
  return {
    backend:'transformers.js/onnx-webgpu',modelRevision:BFL_SOURCE_REVISION,
    async expand({prompt,images=[],mode='expand',systemPrompt,signal,onText=()=>{}}){
      if(busy)throw Error('The prompt helper is already generating.');
      busy=true;const started=performance.now();let output=null,inputs=null,stopping=null;
      currentVisionStats={hits:0,misses:0};
      try{
        const messages=helperMessages(prompt,images.length,systems,{mode,systemPrompt});
        if(signal?.aborted)throw signal.reason??Error('Prompt expansion cancelled.');
        const text=processor.apply_chat_template(messages,{add_generation_prompt:true,enable_thinking:false});
        const raw=await Promise.all(images.map(async image=>{
          if(typeof image==='string'){
            const prepKey=`${images.length}:${image}`;
            const cachedRaw=preparedReferenceCache.get(prepKey);
            if(cachedRaw){lruSet(preparedReferenceCache,prepKey,cachedRaw,maxCacheEntries);return cachedRaw;}
            const prepared=await prepareReferenceImpl(await tf.RawImage.read(image),images.length,tf.RawImage);
            lruSet(preparedReferenceCache,prepKey,prepared,maxCacheEntries);
            return prepared;
          }
          return prepareReferenceImpl(image instanceof tf.RawImage?image:await tf.RawImage.read(image),images.length,tf.RawImage);
        }));
        // Original attachment order survives preparation and vision concatenation.
        inputs=await processor(text,raw.length?raw:undefined,{padding:false,truncation:false});
        const promptLength=inputs.input_ids.dims[1];
        if(signal?.aborted)throw signal.reason??Error('Prompt expansion cancelled.');
        const modelReused=!!model;await load();
        if(signal?.aborted)throw signal.reason??Error('Prompt expansion cancelled.');
        const presencePenalty=mode==='expand'&&!images.length?1.5:0;
        class GeneratedPresence extends tf.LogitsProcessor{
          _call(ids,logits){
            const vocab=logits.dims.at(-1);
            ids.forEach((row,i)=>penalizeGenerated(row,promptLength,logits.data.subarray(i*vocab,(i+1)*vocab),presencePenalty));
            return logits;
          }
        }
        stopping=new tf.InterruptableStoppingCriteria();
        const abort=()=>stopping.interrupt();signal?.addEventListener('abort',abort,{once:true});
        if(signal?.aborted)abort();
        const generationStarted=performance.now();
        let streamed='';
        try{
          output=await model.generate({...inputs,do_sample:false,max_new_tokens:3584,
            eos_token_id:[248046,248044],logits_processor:[new GeneratedPresence()],
            stopping_criteria:[stopping],return_dict_in_generate:true,
            streamer:new tf.TextStreamer(processor.tokenizer,{skip_prompt:true,skip_special_tokens:true,
              callback_function:part=>{streamed+=part;onText(streamed);}})});
        }finally{signal?.removeEventListener('abort',abort);}
        const ids=output.sequences.tolist()[0].slice(promptLength);
        const expanded=processor.tokenizer.decode(ids,{skip_special_tokens:true}).trim();
        if(signal?.aborted)throw signal.reason??Error('Prompt expansion cancelled.');
        if(!expanded)throw Error('The prompt helper returned empty output.');
        const last=Number(ids.at(-1)),stopReason=[248046,248044].includes(last)?'eos':'output-limit';
        return {modelReused,mode,text:expanded,stopReason,partial:stopReason!=='eos',promptTokens:promptLength,generatedTokens:ids.length,
          generationMs:performance.now()-generationStarted,totalMs:performance.now()-started,
          backend:'transformers.js/onnx-webgpu',modelRevision:BFL_SOURCE_REVISION,modelUrl:base,referenceCount:images.length,
          visionCache:{hits:currentVisionStats.hits,misses:currentVisionStats.misses,entries:visionFeatureCache.size},
          runtimeCompatibility:['Transformers.js4.2 text-only continuation delta'],
          referencePreparation:{sizes:raw.map(image=>[image.width,image.height]),resizer:'browser-canvas',jpegQuality:.92,whiteBackdrop:true},
          sessions:Object.fromEntries(Object.entries(model.sessions).map(([name,s])=>[name,{...s.config,inputNames:s.inputNames,outputNames:s.outputNames}]))};
      }finally{
        if(output?.past_key_values)for(const t of Object.values(output.past_key_values))t?.dispose?.();
        output?.sequences?.dispose?.();
        if(inputs)for(const t of Object.values(inputs))t?.dispose?.();
        busy=false;
      }
    },
    async dispose(){if(busy)throw Error('Cancel the active request before disposing the prompt helper.');visionFeatureCache.clear();preparedReferenceCache.clear();await model?.dispose();model=null;},
  };
}
