import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {packMicrostructure} from '../neural-microstructure-core.mjs';

const [source,output,regionJSON,cellSizeText]=process.argv.slice(2);
if(!source||!output||!regionJSON||!cellSizeText)throw Error('Usage: node tools/prepare-microstructure.mjs SOURCE OUTPUT REGION_JSON CELL_SIZE');
await fs.mkdir(output,{recursive:true});
const report={schema:'kaminos.microstructure-control.v1',ok:false,phase:'load',source:path.resolve(source),repoRoot:process.cwd(),argv:process.argv,route:'cpu-spatial-crop-exact-fine-disc-payload',colorEncoding:'srgb',neural:false};
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
try{
  report.commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
  report.implementation={};
  for(const name of ['tools/prepare-microstructure.mjs','neural-microstructure-core.mjs'])report.implementation[name]=hash(await fs.readFile(new URL('../'+name,import.meta.url)));
  const meta=JSON.parse(await fs.readFile(path.join(source,'report.json'),'utf8'));
  if(meta.ok!==true||meta.schema!=='trellis-surfel-fields.v1'||meta.stride!==12)throw Error('Successful observed 12-float TRELLIS field required');
  const raw=await fs.readFile(path.join(source,'surfels.f32'));
  const sourceIdBytes=await fs.readFile(path.join(source,'source-ids.u32'));
  report.sourceSHA256=hash(raw);report.sourceCount=meta.count;
  if(report.sourceSHA256!==meta.dataSHA256||raw.byteLength!==meta.count*48)throw Error('Source hash/shape differs from observed report');
  if(sourceIdBytes.byteLength!==meta.count*4)throw Error('Upstream source IDs differ from observed row count');
  const originalIds=new Uint32Array(sourceIdBytes.buffer,sourceIdBytes.byteOffset,meta.count);
  report.sourceIdsSHA256=hash(sourceIdBytes);report.originalSourceCount=meta.sourceCount??meta.count;
  const input=new Float32Array(raw.buffer,raw.byteOffset,raw.byteLength/4),region=JSON.parse(regionJSON);
  if(!Array.isArray(region)||region.length!==6||region.some(v=>!Number.isFinite(v))||[0,1,2].some(a=>region[a]>=region[a+3]))throw Error('Finite min.xyz/max.xyz spatial region required');
  report.regionYUp=region;report.phase='crop';
  const selected=[];
  for(let i=0;i<meta.count;i++)if([0,1,2].every(a=>input[i*12+a]>=region[a]&&input[i*12+a]<=region[a+3]))selected.push(i);
  if(!selected.length)throw Error('Empty selected spatial region');
  const data=new Float32Array(selected.length*12),ids=new Uint32Array(selected.map(i=>originalIds[i]));
  for(let i=0;i<selected.length;i++)data.set(input.subarray(selected[i]*12,selected[i]*12+12),i*12);
  report.phase='pack';const field=packMicrostructure(data,{radius:meta.radius,cellSize:Number(cellSizeText),sourceIds:ids});
  report.phase='write';report.files={};
  for(const [name,array]of [['rows.f32',field.rows],['carriers.f32',field.carriers],['source-ids.u32',field.sourceIds]]){
    const bytes=new Uint8Array(array.buffer,array.byteOffset,array.byteLength);
    await fs.writeFile(path.join(output,name),bytes);report.files[name]={bytes:bytes.byteLength,sha256:hash(bytes)};
  }
  Object.assign(report,{count:field.count,carrierCount:field.carrierCount,radius:field.radius,cellSize:field.cellSize,maxChildren:field.maxChildren,alpha:field.alpha,claimCeiling:'Exact source disc coverage/depth control; no mesh parity, learned compression or performance claim',ok:true,phase:'done'});
}catch(error){report.error=String(error.stack??error);process.exitCode=1;}
finally{await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
