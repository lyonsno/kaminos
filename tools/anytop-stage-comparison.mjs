import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';

export function validateStageBinary(buffer,info,hash){
  if(hash!==info.binary_sha256)throw Error('Retained stage binary hash changed');
  const count=info.shape.reduce((n,d)=>n*d,1);
  if(buffer.byteLength!==count*4)throw Error('Stage element count differs from source shape');
  return new Float32Array(new Uint8Array(buffer).buffer);
}

async function main(){
  const args=new Map();for(let i=2;i<process.argv.length;i+=2)args.set(process.argv[i],process.argv[i+1]);
  const out=resolve(args.get('--out'));
  mkdirSync(dirname(out),{recursive:true});
  const report={schema:'anytop.kit-stage-comparison.v1',status:'running',phase:'imports',
    requestedProbe:args.get('--probe'),requestedKitRoot:args.get('--kit-root'),
    inferenceBackend:'retained numpy/native CPU; no WebGPU model execution',comparisons:[]};
  const save=()=>writeFileSync(out,JSON.stringify(report,null,2)+'\n');save();
  try{
    const kitRoot=resolve(args.get('--kit-root'));
    const modulePath=resolve(kitRoot,'src/parity-primitives.js');
    const kit=await import(pathToFileURL(modulePath));
    report.kit={root:kitRoot,version:JSON.parse(readFileSync(resolve(kitRoot,'package.json'))).version,
      module:modulePath,sha256:createHash('sha256').update(readFileSync(modulePath)).digest('hex')};
    const probePath=resolve(args.get('--probe'));
    const probe=JSON.parse(readFileSync(probePath));
    report.probe={path:probePath,sha256:createHash('sha256').update(readFileSync(probePath)).digest('hex'),
      sourceRevision:probe.source_revision,status:probe.status};
    if(probe.status!=='complete')throw Error('Incomplete source probe cannot become completed stage comparison');
    const registry=kit.createWebGpuParityCaptureRegistry({runId:report.probe.sha256});
    report.phase='full-stage-comparisons';save();
    for(const source of probe.cases){
      const stages={};
      for(const [name,info] of Object.entries(source.stages)){
        const bytes=readFileSync(info.binary);
        const hash=createHash('sha256').update(bytes).digest('hex');
        stages[name]=validateStageBinary(bytes,info,hash);
        registry.capture(`${source.object}/${source.label}/${name}`,stages[name],{shape:info.shape,layout:info.layout});
      }
      const pairs=[['native_ik_fk','raw_xyz','intentional fixed-length reconstruction'],
        ['rotation_fk','raw_xyz','different predicted representation; decoder authority unresolved'],
        ['bvh_roundtrip_fk','native_ik_fk','serialized native IK roundtrip']];
      if(stages.retained_xyz)pairs.push(['raw_xyz','retained_xyz','same released position decoder replay']);
      for(const [actual,reference,meaning] of pairs){
        const result=registry.compare(`${source.object}/${source.label}/${actual}`,stages[reference]);
        report.comparisons.push({object:source.object,case:source.label,actual,reference,meaning,
          source:source.source,source_sha256:source.source_sha256,shape:source.stages[actual].shape,
          interpretation:'metrics only; not an automatic correctness verdict',result});
      }
      registry.clear();
    }
    report.status='complete';report.phase='complete';save();
    console.log(JSON.stringify({out,kit:report.kit,comparisons:report.comparisons.length,status:report.status}));
  }catch(error){report.status='failed';report.error=String(error.stack||error);save();throw error;}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
