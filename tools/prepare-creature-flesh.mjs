import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {validateLiveManifest} from '../hindquarter-live-core.mjs';
import {prepareTorso} from '../experiments/creature-flesh/torso.mjs';
const args=process.argv.slice(2),options=Object.fromEntries(args.reduce((a,v,i)=>i%2===0?[...a,[v,args[i+1]]]:a,[]));
const input=path.resolve(options['--case']??''),out=path.resolve(options['--out']??''),expected=options['--expected-case'];
if(!options['--case']||!options['--out']||!/^[a-f0-9]{64}$/.test(expected??''))throw Error('usage: --case DIRECTORY --expected-case SHA256 --out NEW_DIRECTORY');
let ancestor=out;while(!fs.existsSync(ancestor))ancestor=path.dirname(ancestor);
const sourceRoot=fs.realpathSync(input),resolvedOut=path.resolve(fs.realpathSync(ancestor),path.relative(ancestor,out));
if(resolvedOut===sourceRoot||resolvedOut.startsWith(sourceRoot+path.sep))throw Error('Output must not write into source case');
if(fs.existsSync(path.join(out,'report.json'))||fs.existsSync(path.join(out,'prepared.json')))throw Error('Existing evidence retained; select a new output directory');
fs.mkdirSync(out,{recursive:true});
const report={status:'running',phase:'source-authentication',requested:{input,expected,out},effective:{input:sourceRoot,out:resolvedOut,node:process.execPath,sourceRevision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),dirty:execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim()},assets:{}};
const save=()=>fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
const hash=b=>createHash('sha256').update(b).digest('hex');save();
try{
 const bytes=fs.readFileSync(path.join(input,'manifest.json')),actual=hash(bytes);report.caseSha256=actual;if(actual!==expected)throw Error('Source case hash mismatch');
 const manifest=validateLiveManifest(JSON.parse(bytes)),data={manifest};
 for(const [file,field,Type] of [['rest.bin','rest',Float32Array],['triangles.bin','triangles',Uint32Array],['automatic-weights.bin','weights',Float32Array],['automatic-presets.bin','presets',Float32Array]]){
  const b=fs.readFileSync(path.join(input,file)),spec=manifest.assets[file];report.assets[file]={sha256:hash(b),bytes:b.byteLength};if(report.assets[file].sha256!==spec.sha256||b.byteLength!==spec.bytes)throw Error('Source binary mismatch: '+file);
  const copy=Uint8Array.from(b).buffer;data[field]=new Type(copy);
 }
 report.phase='torso-construction';save();const prepared=prepareTorso(data);prepared.source.caseSha256=actual;
 report.phase='writing';const payload=JSON.stringify(prepared);fs.writeFileSync(path.join(out,'prepared.json'),payload);
 report.status='passed';report.phase='complete';report.prepared={path:path.join(out,'prepared.json'),sha256:hash(payload),bytes:Buffer.byteLength(payload),nodes:prepared.positions.length,tetrahedra:prepared.tetrahedra.length,sourceVertices:manifest.vertices,influencedVertices:prepared.construction.influencedVertices,profile:prepared.construction.profile};save();
}catch(error){report.status='failed';report.failure={phase:report.phase,message:error.message,stack:error.stack};save();process.exitCode=1;}
console.log(JSON.stringify({status:report.status,report:path.join(out,'report.json'),failure:report.failure?.message,prepared:report.prepared&&{sha256:report.prepared.sha256,nodes:report.prepared.nodes,tetrahedra:report.prepared.tetrahedra,sourceVertices:report.prepared.sourceVertices,influencedVertices:report.prepared.influencedVertices}}));
