// Offline appearance preparation for existing mesh/UV layouts. Persistent report
// is caller-owned and is written even when module/input admission fails.
import fs from 'node:fs';
const args=new Map();for(let i=2;i<process.argv.length;i+=2)args.set(process.argv[i],process.argv[i+1]);
const source=args.get('--source'),server=args.get('--server'),path=args.get('--report');
const report={source,server,phase:'admission',startedAt:new Date().toISOString()};
const save=()=>{if(path)fs.writeFileSync(path,JSON.stringify(report,null,2)+'\n');};
try{
  if(!path||!server||!/^[a-f0-9]{64}$/.test(source??''))throw Error('--source, --server and --report are required');save();
  const THREE=await import('three'),{MeshBVH}=await import('three-mesh-bvh'),{prepareMeshTextureLevels}=await import('../lod-texture-generation.mjs');
  const geometries=args.has('--geometry')?args.get('--geometry').split(','):null;
  const sizes=args.has('--sizes')?args.get('--sizes').split(',').map(Number):null;
  await prepareMeshTextureLevels({source,server,THREE,MeshBVH,geometries,sizes,report,onPhase:save});
  if(report.error)throw Error(report.error.message);
}catch(error){report.error??={message:String(error?.message??error),stack:error?.stack};process.exitCode=1;}
finally{report.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({phase:report.phase,status:report.status,error:report.error?.message,geometries:report.geometries?.length??0}));}
