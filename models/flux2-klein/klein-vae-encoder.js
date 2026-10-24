// AutoencoderKLFlux2 reference-image path, shared by FLUX.2 Klein and FLUX.3:
// posterior mode, 2x2 channel patchification, then the shipped latent batch norm.
// RGB input is channels-last float32 in [-1,1]; reference resolution is independent
// of the generated image. The existing decoder owns shared convolution/norm kernels.
import {KleinVaeDecoder} from './klein-vae.js';
const packShader=`struct P { h:u32,w:u32,eps:f32,z:u32 };
@group(0) @binding(0) var<storage,read> moments:array<f32>;
@group(0) @binding(1) var<storage,read> bn:array<f32>;
@group(0) @binding(2) var<storage,read_write> packed:array<f32>;
@group(0) @binding(3) var<uniform> p:P;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid:vec3<u32>){
 let i=gid.x;if(i>=p.h*p.w*128u){return;}
 let token=i/128u;let c=i%128u;let y=(token/p.w)*2u+(c%4u)/2u;let x=(token%p.w)*2u+c%2u;
 // The first 32 of the 64 posterior channels are means; no stochastic sample.
 let mean=moments[(y*(p.w*2u)+x)*64u+c/4u];
 packed[i]=(mean-bn[c])/sqrt(bn[128u+c]+p.eps);
}`;
export class KleinVaeEncoder extends KleinVaeDecoder {
 async encode(rgb,width,height){
  if(width%16||height%16||width<16||height<16||rgb.length!==width*height*3)throw Error('Reference RGB must match a positive multiple-of-16 image');
  this.allocate(height/16,width/16);
  const input=this.buffer(rgb.byteLength),packed=this.buffer(width/16*height/16*128*4);
  const moments=this.buffer(width/8*height/8*64*this.actBytes);
  let readback;
  try{
   this.device.queue.writeBuffer(input,0,rgb);
   const enc=this.sched,cut=label=>enc.boundary(label,{force:!enc.cooperative});
   let shape=await this.conv(enc,input,this.a,'encoder.conv_in',{Hin:height,Win:width,Cin:3,xType:'f32'}),cur=this.a,other=this.b;
   const swap=async label=>{[cur,other]=[other,cur];await cut(label);};
   for(let d=0;d<4;d++){
    for(let r=0;r<2;r++){shape=await this.resnet(enc,cur,other,`encoder.down_blocks.${d}.resnets.${r}`,shape,[128,256,512,512][d]);await swap(`vae.encoder.down${d}.resnet${r}`);}
    if(d<3){shape=await this.conv(enc,cur,other,`encoder.down_blocks.${d}.downsamplers.0.conv`,{Hin:shape.H,Win:shape.W,Cin:shape.C,down:true});await swap(`vae.encoder.down${d}`);}
   }
   shape=await this.resnet(enc,cur,other,'encoder.mid_block.resnets.0',shape);await swap('vae.encoder.mid0');
   shape=await this.attention(enc,cur,other,'encoder.mid_block.attentions.0',shape);await swap('vae.encoder.attention');
   shape=await this.resnet(enc,cur,other,'encoder.mid_block.resnets.1',shape);await swap('vae.encoder.mid1');
   this.groupNorm(enc,cur,this.t1,'encoder.conv_norm_out',{HW:shape.H*shape.W,C:shape.C,silu:true});
   await this.conv(enc,this.t1,moments,'encoder.conv_out',{Hin:shape.H,Win:shape.W,Cin:shape.C});
   await this.conv(enc,moments,this.a,'quant_conv',{Hin:shape.H,Win:shape.W,Cin:64,cType:'f32'});
   this.dispatch(enc,this.pipeline('reference-pack',packShader),[this.a,this.bn,packed,this.uniform([height/16,width/16,this.f32bits(this.manifest.config.batch_norm_eps),0])],Math.ceil(width/16*height/16*128/256));
   await enc.flush('vae.encoder.end');
   readback=this.device.createBuffer({size:packed.size,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
   const copy=this.device.createCommandEncoder();copy.copyBufferToBuffer(packed,0,readback,0,packed.size);this.device.queue.submit([copy.finish()]);
   const read=async()=>{await readback.mapAsync(GPUMapMode.READ);const result=new Float32Array(readback.getMappedRange().slice(0));readback.unmap();return result;};
   return enc.schedule?.withForeground?await enc.schedule.withForeground('reference-readback',read):await read();
  }finally{moments.destroy();input.destroy();packed.destroy();readback?.destroy();this.release();}
 }
}
