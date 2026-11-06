import fs from 'node:fs';
import {fitStockSource} from '../experiments/stock-family/model.mjs';
import {validateSectionRecovery} from '../experiments/stock-family/section.mjs';
import {recoverStockSection} from '../experiments/stock-family/section.mjs';

const input=JSON.parse(fs.readFileSync(0,'utf8'));
if(input.operation==='validate-section'){
  validateSectionRecovery(input.recovery);
  process.stdout.write(JSON.stringify({valid:true,schema:input.recovery.schema}));
  process.exit(0);
}
const positions=new Float32Array(input.positions),normals=new Float32Array(input.normals),source=input.source;
if(!positions.length||positions.length!==normals.length||positions.length%3||!positions.every(Number.isFinite)||!normals.every(Number.isFinite))throw Error('Finite matching source geometry required');
let fitted=source.fit?fitStockSource(positions,normals,source.fit.axis??'z',source.fit.arc):{positions,normals,profile:source.profile};
if(input.sectionRecovery!==undefined)fitted=recoverStockSection(fitted,input.sectionRecovery);
process.stdout.write(JSON.stringify({sourceSha256:source.sha256,fit:source.fit??null,
  positions:Array.from(fitted.positions),normals:Array.from(fitted.normals),profile:fitted.profile,
  ...(fitted.sectionRecovery?{sectionRecovery:fitted.sectionRecovery}:{})}));
