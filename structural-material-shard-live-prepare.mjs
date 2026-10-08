import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {prepareStoneFromGlb} from './structural-material-stone-prepare.mjs';
const [preparedRoot,asset,out]=process.argv.slice(2);
if(!preparedRoot||!asset||!out)throw new Error('usage: node structural-material-shard-live-prepare.mjs PREPARED_ROOT SOURCE.glb OUTPUT_DIR');
fs.mkdirSync(out,{recursive:true});const report={status:'running',phase:'input',preparedRoot:path.resolve(preparedRoot),asset:path.resolve(asset),out:path.resolve(out)},save=()=>fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(report,null,2)),hash=b=>createHash('sha256').update(b).digest('hex');save();
try{
 const prepBytes=fs.readFileSync(path.join(preparedRoot,'report.json')),prep=JSON.parse(prepBytes),interiorBytes=fs.readFileSync(prep.input),interior=JSON.parse(interiorBytes),bytes=fs.readFileSync(asset);
 if(prep.status!=='passed'||interior.status!=='passed'||interior.route!=='ftetwild-cpu-wildmeshing-0.4.1'||hash(interiorBytes)!==prep.inputSha256||hash(bytes)!==prep.sourceSha256)throw new Error('Admitted material and matching source required');
 const exteriorBytes=fs.readFileSync(interior.source),exterior=JSON.parse(exteriorBytes);if(hash(exteriorBytes)!==interior.inputSha256||exterior.sourceSha256!==prep.sourceSha256||exterior.status!=='passed')throw new Error('Admitted exterior identity differs');
 report.sourceSha256=prep.sourceSha256;report.preparationSha256=hash(prepBytes);report.material=prep.config;report.model=prep.models.find(m=>m.kind==='graph');
 for(const buffer of Object.values(report.model.buffers)){const b=fs.readFileSync(path.join(preparedRoot,buffer.filename));if(hash(b)!==buffer.sha256||b.length!==buffer.byteLength)throw new Error('Prepared buffer drift');fs.writeFileSync(path.join(out,buffer.filename),b);}
 report.phase='geometry';save();const geometry=prepareStoneFromGlb(bytes,{size:exterior.size,cellSize:Math.max(...exterior.size)*2}).cells[0].geometry;
 const body={positions:interior.positions,tetrahedra:interior.tetrahedra,geometry};const bodyBytes=Buffer.from(JSON.stringify(body));fs.writeFileSync(path.join(out,'body.json'),bodyBytes);report.body={filename:'body.json',sha256:hash(bodyBytes),byteLength:bodyBytes.length};
 report.status='passed';report.phase='complete';report.claim='Exact admitted imported interior and exterior copied for the live consumer, not new meshing or material calibration';save();
}catch(e){report.status='failed';report.failure={message:e.message,stack:e.stack};save();process.exitCode=1;}
console.log(JSON.stringify({status:report.status,out:report.out,failure:report.failure?.message}));
