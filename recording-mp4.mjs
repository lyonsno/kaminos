// Single AVC video track, decode order = presentation order (WebCodecs realtime,
// no B frames). AVC configuration comes from the encoder, never a guessed SPS.
// WebCodecs AVC registration: https://www.w3.org/TR/webcodecs-avc-codec-registration/
const utf8=s=>new TextEncoder().encode(s);
const bytes=(...parts)=>{const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let i=0;for(const p of parts){out.set(p,i);i+=p.length;}return out;};
const zeros=n=>new Uint8Array(n);
const u16=n=>{const b=new Uint8Array(2);new DataView(b.buffer).setUint16(0,n);return b;};
const u32=n=>{const b=new Uint8Array(4);new DataView(b.buffer).setUint32(0,n);return b;};
const u64=n=>{const b=new Uint8Array(8);new DataView(b.buffer).setBigUint64(0,BigInt(n));return b;};
const words=(...n)=>bytes(...n.map(u32));
const box=(name,...p)=>{const payload=bytes(...p);return bytes(u32(payload.length+8),utf8(name),payload);};
const full=(name,v,flags,...p)=>box(name,new Uint8Array([v,flags>>16&255,flags>>8&255,flags&255]),...p);
const matrix=words(0x10000,0,0,0,0x10000,0,0,0,0x40000000);
export function muxAvcMp4({width,height,fps,samples,description}){
 if(!samples.length||!description?.byteLength)throw Error('MP4 needs encoded frames and the encoder AVC configuration');
 if(width>65535||height>65535)throw Error('AVC sample entry cannot describe these dimensions');
 const timescale=1000000,duration=Math.round(samples.length*timescale/fps);
 const durations=samples.map((s,i)=>Math.round((i+1)*timescale/fps)-Math.round(i*timescale/fps));
 if(durations.some(n=>n<1||n>0xffffffff))throw Error('Frame duration cannot be represented by the MP4 timescale');
 const groups=[];for(const d of durations){if(groups.at(-1)?.[1]===d)groups.at(-1)[0]++;else groups.push([1,d]);}
 const ftyp=box('ftyp',utf8('isom'),u32(512),utf8('isomiso2avc1mp41'));
 const total=samples.reduce((n,s)=>n+s.data.byteLength,0),header=total+8<=0xffffffff?bytes(u32(total+8),utf8('mdat')):bytes(u32(1),utf8('mdat'),u64(total+16));
 const avc1=box('avc1',zeros(6),u16(1),zeros(16),u16(width),u16(height),words(0x480000,0x480000,0),u16(1),zeros(32),u16(24),u16(65535),box('avcC',new Uint8Array(description)));
 const stbl=box('stbl',full('stsd',0,0,u32(1),avc1),full('stts',0,0,u32(groups.length),...groups.map(g=>words(...g))),full('stsc',0,0,words(1,1,samples.length,1)),full('stsz',0,0,words(0,samples.length),...samples.map(s=>u32(s.data.byteLength))),full('co64',0,0,u32(1),u64(ftyp.length+header.length)),full('stss',0,0,u32(samples.filter(s=>s.key).length),...samples.flatMap((s,i)=>s.key?[u32(i+1)]:[])));
 const minf=box('minf',full('vmhd',0,1,zeros(8)),box('dinf',full('dref',0,0,u32(1),full('url ',0,1))),stbl);
 const mdia=box('mdia',full('mdhd',1,0,u64(0),u64(0),u32(timescale),u64(duration),u16(0x55c4),u16(0)),full('hdlr',0,0,u32(0),utf8('vide'),zeros(12),utf8('Kaminos video\0')),minf);
 const trak=box('trak',full('tkhd',1,7,u64(0),u64(0),words(1,0),u64(duration),zeros(8),zeros(8),matrix,words(width*65536,height*65536)),mdia);
 const moov=box('moov',full('mvhd',1,0,u64(0),u64(0),u32(timescale),u64(duration),u32(0x10000),u16(0x100),zeros(10),matrix,zeros(24),u32(2)),trak);
 return new Blob([ftyp,header,...samples.map(s=>s.data),moov],{type:'video/mp4'});
}
export async function createRecordingSink({settings,pixels,document=globalThis.document,VideoEncoder=globalThis.VideoEncoder,VideoFrame=globalThis.VideoFrame}){
 if(settings.format==='filmstrip'){
  const columns=Math.min(settings.columns,settings.frames),tileWidth=settings.tileWidth,tileHeight=Math.round(tileWidth*pixels.height/pixels.width),rows=Math.ceil(settings.frames/columns);
  const canvas=document.createElement('canvas');canvas.width=columns*tileWidth;canvas.height=rows*tileHeight;
  const ctx=canvas.getContext('2d');if(!ctx||canvas.width!==columns*tileWidth||canvas.height!==rows*tileHeight)throw Error('Filmstrip dimensions exceed this browser’s canvas capacity');
  return {add(frame,i){ctx.drawImage(frame,i%columns*tileWidth,Math.floor(i/columns)*tileHeight,tileWidth,tileHeight);},async finish(count){
   const result=document.createElement('canvas');result.width=Math.min(columns,count)*tileWidth;result.height=Math.ceil(count/columns)*tileHeight;const context=result.getContext('2d');if(!context)throw Error('Filmstrip canvas allocation failed');context.drawImage(canvas,0,0);
   const blob=await new Promise(resolve=>result.toBlob(resolve,'image/png'));if(!blob)throw Error('Filmstrip exceeds this browser’s PNG capacity');return {blob,frameCount:count,width:result.width,height:result.height,columns:Math.min(columns,count)};
  },dispose(){canvas.width=canvas.height=0;}};
 }
 if(!VideoEncoder||!VideoFrame)throw Error('This browser has no WebCodecs video encoder. Choose PNG filmstrip or use a browser with AVC encoding.');
 const base={width:pixels.width,height:pixels.height,framerate:settings.fps,bitrate:Math.round(pixels.width*pixels.height*settings.fps*.14),latencyMode:'realtime',avc:{format:'avc'}};
 let config;for(const codec of ['avc1.42003e','avc1.420034','avc1.42002a']){try{const tested=await VideoEncoder.isConfigSupported({...base,codec});if(tested.supported){config=tested.config;break;}}catch{}}
 if(!config)throw Error('AVC encoding is unavailable at this size/FPS. Choose PNG filmstrip or another output size.');
 let failure=null,description=null,submitted=0;const samples=[];
 const encoder=new VideoEncoder({error:error=>{failure=error;},output(chunk,metadata){const data=new Uint8Array(chunk.byteLength);chunk.copyTo(data);samples.push({data,key:chunk.type==='key',timestamp:chunk.timestamp});if(metadata?.decoderConfig?.description)description=new Uint8Array(metadata.decoderConfig.description).slice();}});
 encoder.configure(config);
 return {add(canvas,index){if(failure)throw failure;const timestamp=Math.round(index*1000000/settings.fps),duration=Math.round((index+1)*1000000/settings.fps)-timestamp;const frame=new VideoFrame(canvas,{timestamp,duration});try{encoder.encode(frame,{keyFrame:index===0||index%Math.max(1,Math.round(settings.fps*2))===0});submitted++;}finally{frame.close();}},async finish(count){await encoder.flush();if(failure)throw failure;if(samples.length!==count||count!==submitted)throw Error('AVC encoder returned an incomplete sequence');if(samples.some((s,i)=>s.timestamp!==Math.round(i*1000000/settings.fps)))throw Error('AVC encoder reordered frames; this MP4 path requires realtime presentation order');return {blob:muxAvcMp4({...pixels,fps:settings.fps,samples,description}),frameCount:count,codec:config.codec,width:pixels.width,height:pixels.height};},dispose(){if(encoder.state!=='closed')encoder.close();samples.length=0;}};
}
