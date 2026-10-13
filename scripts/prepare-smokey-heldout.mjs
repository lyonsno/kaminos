import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {smokeyVariants} from '../volume-smokey-heldout.mjs';

const [store,out]=process.argv.slice(2);
await fs.mkdir(out,{recursive:true});
const report={identity:'smokey-heldout-fixtures-v1',status:'running',phase:'source',store,variants:[]};
const save=()=>fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
await save();
try {
  const sources=[['basin','basins/presets/vsp-73c7fa64b2498e1dc5a24f1feefe79a6c1ce1c1effeb2c90ae318c56b0c75350.json','3c5824c7691b7ff6330235c581a8e1f1fec9b5399828d46ce2e6426bf82d8fcc'],
    ['scene','scenes/dj-with-a-kiln-pretty.kaminos.json','8859aa63f4c8e65beca8d71c099a60e0e458879660e85d7972e2b1363e1947e6']];
  const data={};report.sources=[];
  for(const [name,file,expected] of sources) {
    const bytes=await fs.readFile(path.join(store,file)),hash=createHash('sha256').update(bytes).digest('hex');
    assert.equal(hash,expected,`source ${name} changed`);data[name]=JSON.parse(bytes);
    report.sources.push({name,file,sha256:hash});await fs.writeFile(path.join(out,`source-${name}.json`),bytes);
  }
  report.phase='variants';await save();
  for(const variant of smokeyVariants(data.basin.preset)) {
    const artifact=structuredClone(data.basin),scene=structuredClone(data.scene);
    artifact.preset=variant.preset;
    // Use the serving implementation's canonical hash, including Python numeric serialization.
    const hash=execFileSync('python3',['-c',
      'import json,sys,serve; p=json.load(sys.stdin); s=json.load(open("volume-settings-preset-schema-v2.json")); print(serve._volume_settings_content_hash(p,s))'],
      {input:JSON.stringify(artifact.preset),encoding:'utf8'}).trim();
    assert.match(hash,/^[a-f0-9]{64}$/);
    artifact.presetId=`vsp-${hash}`;artifact.contentHash=`sha256:${hash}`;
    artifact.initialLabel=`smokey held-out ${variant.name}`;
    scene.composition.flame.presetId=artifact.presetId;
    scene.composition.flame.label=artifact.initialLabel;
    const target=path.join(out,variant.name);await fs.mkdir(target,{recursive:true});
    await fs.writeFile(path.join(target,'basin.json'),JSON.stringify(artifact,null,2));
    await fs.writeFile(path.join(target,'scene.kaminos.json'),JSON.stringify(scene,null,2));
    report.variants.push({name:variant.name,factors:variant.factors,path:target,presetId:artifact.presetId});await save();
  }
  report.phase='complete';report.status='observed';
}catch(error){report.status='failed';report.error=String(error.stack||error);process.exitCode=1;}
finally{await save();}
