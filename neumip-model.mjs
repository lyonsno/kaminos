import {CHART_PREFIX,validateNeumipChart} from './neumip-chart.mjs';
// Author format: straintensor/NeuMIP cpputils/storage_model.h (Cereal PortableBinary).
// Keep the source float32 values and independent authored mip levels intact.
export function readNeumipModel(input) {
  const bytes=input instanceof Uint8Array?input:new Uint8Array(input);
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let at=0;
  const need=n=>{if(!Number.isSafeInteger(n)||n<0||n>bytes.length-at)throw Error(`NeuMIP archive truncated at byte ${at}`);};
  const i32=()=>{need(4);const n=view.getInt32(at,true);at+=4;return n;};
  const count=()=>{need(8);const n=view.getBigUint64(at,true);at+=8;if(n>BigInt(Number.MAX_SAFE_INTEGER))throw Error('NeuMIP count exceeds safe integer capacity');return Number(n);};
  const text=()=>{const n=count();need(n);const s=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(at,at+n));at+=n;return s;};
  const floats=()=>{const n=count();need(n*4);const data=new Float32Array(n);for(let i=0;i<n;i++){const x=view.getFloat32(at,true);at+=4;if(!Number.isFinite(x))throw Error('NeuMIP contains a non-finite value');data[i]=x;}return data;};
  const texture=()=>{const height=i32(),width=i32(),channels=i32(),data=floats();if(height<1||width<1||channels<1||height*width*channels!==data.length)throw Error('NeuMIP texture shape does not match its values');return {height,width,channels,data};};
  need(1);if(bytes[at++]!==1)throw Error('NeuMIP requires a little-endian PortableBinary archive');
  const offset=texture(),architecture=text(),mips=[],levels=count();
  need(levels*20);for(let i=0;i<levels;i++)mips.push(texture());
  const layers=[],numLayers=count();need(numLayers*40);
  for(let i=0;i<numLayers;i++){
    const name=text(),input=i32(),output=i32(),bias=i32(),relu=i32(),weights=floats(),biases=floats();
    if(input<1||output<1||weights.length!==input*output||![0,1].includes(bias)||![0,1].includes(relu)||biases.length!==(bias?output:0))throw Error(`NeuMIP layer shape invalid: ${name}`);
    if(layers.some(x=>x.name===name))throw Error(`NeuMIP duplicate layer ${name}`);
    layers.push({name,input,output,relu:!!relu,weights,biases});
  }
  if(at!==bytes.length)throw Error('NeuMIP archive has trailing bytes');
  if(offset.channels!==6||!mips.length||mips.some((m,i)=>m.channels!==8||(i>0&&(m.width!==Math.max(1,mips[i-1].width>>1)||m.height!==Math.max(1,mips[i-1].height>>1)))))throw Error('Unsupported NeuMIP web-export texture shape');
  const expected={'main':[12,24,24,24,6],'offset_network':[8,24,24,24,1]};
  if(layers.length!==8)throw Error('Unsupported NeuMIP web-export layer count');
  for(const [prefix,widths] of Object.entries(expected))for(let i=0;i<4;i++){
    const l=layers.find(l=>l.name===`${prefix}.mpl${i}`);
    if(!l||l.input!==widths[i]||l.output!==widths[i+1]||l.relu!==(i<3))throw Error(`Unsupported NeuMIP layer shape: ${prefix}.mpl${i}`);
  }
  let tag=architecture,chart;if(tag.startsWith(CHART_PREFIX)){const metadata=JSON.parse(tag.slice(CHART_PREFIX.length));tag=metadata.architecture;if(typeof tag!=='string'||!tag)throw Error('Invalid chart architecture');chart=validateNeumipChart(metadata.chart);}
  return {offset,mips,layers,architecture:tag,...(chart?{chart}:{}),byteLength:bytes.length};
}

export async function loadNeumipModel(url,{signal,sha256}={}) {
  const response=await fetch(url,{signal});if(!response.ok)throw Error(`NeuMIP model HTTP ${response.status}`);
  const bytes=await response.arrayBuffer();
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  if(sha256&&digest!==sha256)throw Error(`NeuMIP model digest mismatch: ${url}`);
  return {...readNeumipModel(bytes),source:{url:response.url,sha256:digest,bytes:bytes.byteLength}};
}

// The same author-format contract is used for newly fitted models. Reloading
// validates the archive before a caller can publish it as a material asset.
export function writeNeumipModel(model) {
  const chunks=[];
  const scalar=(size,write)=>{const a=new Uint8Array(size);write(new DataView(a.buffer));chunks.push(a);};
  const i32=x=>scalar(4,v=>v.setInt32(0,x,true));
  const count=n=>scalar(8,v=>v.setBigUint64(0,BigInt(n),true));
  const text=s=>{const a=new TextEncoder().encode(s);count(a.length);chunks.push(a);};
  const floats=a=>{count(a.length);scalar(a.length*4,v=>{for(let i=0;i<a.length;i++){
    if(!Number.isFinite(a[i]))throw Error('NeuMIP contains a non-finite value');
    v.setFloat32(i*4,a[i],true);
  }});};
  const texture=t=>{i32(t.height);i32(t.width);i32(t.channels);floats(t.data);};
  chunks.push(new Uint8Array([1]));texture(model.offset);text(model.chart?CHART_PREFIX+JSON.stringify({architecture:model.architecture,chart:validateNeumipChart(model.chart)}):model.architecture);
  count(model.mips.length);for(const t of model.mips)texture(t);
  count(model.layers.length);for(const l of model.layers){text(l.name);i32(l.input);i32(l.output);
    i32(l.biases.length?1:0);i32(l.relu?1:0);floats(l.weights);floats(l.biases);}
  const result=new Uint8Array(chunks.reduce((n,a)=>n+a.length,0));let at=0;
  for(const a of chunks){result.set(a,at);at+=a.length;}
  readNeumipModel(result);return result;
}
