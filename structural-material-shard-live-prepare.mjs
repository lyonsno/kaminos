import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {prepareStoneFromGlb} from './structural-material-stone-prepare.mjs';
import {stoneSupportNodes,LEGACY_STONE_SOURCE_SHA256} from './structural-material-source-setup.mjs';
const [preparedRoot,asset,out,setupPath]=process.argv.slice(2);
if(!preparedRoot||!asset||!out)throw new Error('usage: node structural-material-shard-live-prepare.mjs PREPARED_ROOT SOURCE.glb OUTPUT_DIR [SOURCE_SETUP.json]');
fs.mkdirSync(out,{recursive:true});const report={status:'running',phase:'input',preparedRoot:path.resolve(preparedRoot),asset:path.resolve(asset),out:path.resolve(out)},save=()=>fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(report,null,2)),hash=b=>createHash('sha256').update(b).digest('hex');save();
try{
 const prepBytes=fs.readFileSync(path.join(preparedRoot,'report.json')),prep=JSON.parse(prepBytes),interiorBytes=fs.readFileSync(prep.input),interior=JSON.parse(interiorBytes),bytes=fs.readFileSync(asset);
 if(prep.status!=='passed'||interior.status!=='passed'||interior.route!=='ftetwild-cpu-wildmeshing-0.4.1'||hash(interiorBytes)!==prep.inputSha256||hash(bytes)!==prep.sourceSha256)throw new Error('Admitted material and matching source required');
 const exteriorBytes=fs.readFileSync(interior.source),exterior=JSON.parse(exteriorBytes);if(hash(exteriorBytes)!==interior.inputSha256||exterior.sourceSha256!==prep.sourceSha256||exterior.status!=='passed')throw new Error('Admitted exterior identity differs');
 const setup=setupPath?JSON.parse(fs.readFileSync(setupPath)):null;
 if(!setup&&prep.sourceSha256!==LEGACY_STONE_SOURCE_SHA256)throw Error('Non-default material requires explicit source asset setup');
 if(setup){if(typeof setup.id!=='string'||!setup.id.trim()||typeof setup.label!=='string'||!setup.label.trim())throw Error('Source asset id and label required');if(setup.support===undefined)throw Error('Explicit specimen support required');stoneSupportNodes(interior.positions,setup.support);}
 report.sourceSha256=prep.sourceSha256;report.preparationSha256=hash(prepBytes);report.material=prep.config;report.model=prep.models.find(m=>m.kind==='graph');
 for(const buffer of Object.values(report.model.buffers)){const b=fs.readFileSync(path.join(preparedRoot,buffer.filename));if(hash(b)!==buffer.sha256||b.length!==buffer.byteLength)throw new Error('Prepared buffer drift');fs.writeFileSync(path.join(out,buffer.filename),b);}
 report.phase='geometry';save();const source=prepareStoneFromGlb(bytes,{size:exterior.size,cellSize:Math.max(...exterior.size)*2,surfaceTolerance:exterior.mechanicalPreparation?.surfaceTolerance??0}),geometry=source.cells[0].geometry;
 report.mechanicalPreparation=source.mechanicalPreparation;
 if(setup){fs.writeFileSync(path.join(out,'source.glb'),bytes);report.sourceAsset={id:setup.id,label:setup.label,url:'./source.glb',sha256:report.sourceSha256,triangles:source.sourceTriangles};report.support=setup.support;}
 const body={positions:interior.positions,tetrahedra:interior.tetrahedra,geometry};const bodyBytes=Buffer.from(JSON.stringify(body));fs.writeFileSync(path.join(out,'body.json'),bodyBytes);report.body={filename:'body.json',sha256:hash(bodyBytes),byteLength:bodyBytes.length};
 report.status='passed';report.phase='complete';report.claim='Admitted interior and recorded mechanical exterior preparation with source identity; no new meshing or material calibration';save();
}catch(e){report.status='failed';report.failure={message:e.message,stack:e.stack};save();process.exitCode=1;}
console.log(JSON.stringify({status:report.status,out:report.out,failure:report.failure?.message}));
