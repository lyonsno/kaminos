// Regenerate linear-radiance, solid-angle-weighted 128x64 RGBE previews.
// Full maps retain their original bytes. Run from the repository root.
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {RGBELoader} from 'three/examples/jsm/loaders/RGBELoader.js';
import {FloatType} from 'three';
const names=['studio_small_09','kloofendal_48d_partly_cloudy_puresky','empty_warehouse_01','royal_esplanade','moonlit_golf'];
const sha=data=>createHash('sha256').update(data).digest('hex');
const manifest={schema:'kaminos.environment-previews.v1',license:'CC0-1.0',licenseUrl:'https://polyhaven.com/license',method:'128x64 solid-angle-weighted linear radiance box average, RGBE encoding',assets:[]};
for(const name of names){
 const fullFile=`${name}_1k.hdr`,previewFile=`${name}_128.hdr`,bytes=readFileSync(`assets/hdr/${fullFile}`);
 const full=new RGBELoader().setDataType(FloatType).parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
 const w=128,h=64,sx=full.width/w,sy=full.height/h;
 if(!Number.isInteger(sx)||!Number.isInteger(sy))throw Error('Source dimensions must be multiples of preview dimensions');
 const out=Buffer.alloc(w*h*4);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const sum=[0,0,0];let weight=0;
  for(let j=0;j<sy;j++){
   const yy=y*sy+j,area=Math.cos(Math.PI*yy/full.height)-Math.cos(Math.PI*(yy+1)/full.height);
   for(let i=0;i<sx;i++){const offset=(yy*full.width+x*sx+i)*4;for(let c=0;c<3;c++)sum[c]+=full.data[offset+c]*area;weight+=area;}
  }
  const rgb=sum.map(v=>v/weight),max=Math.max(...rgb),offset=(y*w+x)*4;
  if(max>1e-32){const exponent=Math.floor(Math.log2(max))+1,scale=256/2**exponent;for(let c=0;c<3;c++)out[offset+c]=Math.floor(rgb[c]*scale);out[offset+3]=exponent+128;}
 }
 const encoded=Buffer.concat([Buffer.from(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${h} +X ${w}\n`),out]);
 writeFileSync(`assets/hdr/${previewFile}`,encoded);
 manifest.assets.push({fullFile,fullSha256:sha(bytes),fullBytes:bytes.length,previewFile,previewSha256:sha(encoded),previewBytes:encoded.length,width:w,height:h,sourcePageUrl:`https://polyhaven.com/a/${name}`,sourceAssetUrl:`https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/${fullFile}`});
}
writeFileSync('assets/hdr/environment-previews.json',JSON.stringify(manifest,null,2)+'\n');
