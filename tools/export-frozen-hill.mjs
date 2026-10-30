// Offline export from an explicit recovered LERMS worktree; no CPU terrain in the browser.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {registerHooks} from 'node:module';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {mlsConfig} from '../mls-juice-contract.mjs';
const {values:a}=parseArgs({options:{'lerms-root':{type:'string'},output:{type:'string'}}});
if(!a['lerms-root']||!a.output)throw Error('--lerms-root and --output are required');
const root=fs.realpathSync(a['lerms-root']),out=path.resolve(a.output);
const commit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
if(execFileSync('git',['status','--porcelain','--','src/terrain','src/contracts/first-vertical.ts'],{cwd:root,encoding:'utf8'}).trim())throw Error('Hill source must be committed');
const hooks=registerHooks({resolve(specifier,context,next){
  if(context.parentURL?.startsWith(pathToFileURL(root+'/src/').href)&&specifier.endsWith('.js')){
    const url=new URL(specifier,context.parentURL),ts=fileURLToPath(url).replace(/\.js$/,'.ts');
    if(fs.existsSync(ts))return next(pathToFileURL(ts).href,context);
  }return next(specifier,context);
}});
const {createHillOfHillsTerrainWithCache,createHillOfHillsLayerTileCache,createHillOfHillsTerrainBuffer}=await import(pathToFileURL(root+'/src/terrain/hill-of-hills.ts'));
// Exact initial recipe of LIVE_TERRAIN_PARAMS in the recovered Horde/Hill composition.
const params={seed:414,width:12,length:15,gridResolutionX:48,gridResolutionZ:60,
  topologyDynamicsMode:'persistent_pressure',topologyPossibilityMode:'phase_recomposed',
  topologyPhaseDurationMs:600,topologyPhaseIntensity:.92,topologyPhaseDriftIntensity:1,topologyPhaseLimit:4,topologyPhaseTimeMs:0};
const terrain=createHillOfHillsTerrainWithCache(createHillOfHillsLayerTileCache(),params,{timestampMs:0,frameId:'hill-initial-frozen-1029',configId:'canonical-live-initial-414'});
const b=createHillOfHillsTerrainBuffer(terrain);hooks.deregister();
const sourceBounds={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};
for(let i=0;i<b.positions.length;i++){
  const axis=i%3;sourceBounds.min[axis]=Math.min(sourceBounds.min[axis],b.positions[i]);sourceBounds.max[axis]=Math.max(sourceBounds.max[axis],b.positions[i]);
}
const target=mlsConfig({gridSize:[192,80,256]}).bounds,span=sourceBounds.max.map((v,i)=>v-sourceBounds.min[i]);
const scale=Math.min((target.max[0]-target.min[0]-.3)/span[0],(target.max[2]-target.min[2]-.3)/span[2],(target.max[1]-.8)/span[1]);
const translation=[-(sourceBounds.min[0]+sourceBounds.max[0])*scale/2,.1-sourceBounds.min[1]*scale,-(sourceBounds.min[2]+sourceBounds.max[2])*scale/2];
const heights=Array.from({length:b.sampleCount},(_,i)=>Math.fround(b.positions[i*3+1]*scale+translation[1]));
const artifact={schema:'kaminos.frozen-hill.v1',source:{repo:'lerms',commit,path:'src/terrain/hill-of-hills.ts',
  recipeSource:'src/lerm-horde-live-runtime-composition.ts:LIVE_TERRAIN_PARAMS',phase:'frozen',sourceTimeMs:0,
  sampleChecksum:b.sampleChecksum,topologyChecksum:b.topologyChecksum,proxyMaterialChecksum:b.proxyMaterialChecksum,params:terrain.params},
  transform:{scale,translation,sourceBounds},grid:{x:b.gridResolution.x,z:b.gridResolution.z,
    min:[sourceBounds.min[0]*scale+translation[0],sourceBounds.min[2]*scale+translation[2]],
    step:[span[0]*scale/(b.gridResolution.x-1),span[2]*scale/(b.gridResolution.z-1)]},
  heights,colors:Array.from(b.colors,v=>v/255)};
mlsConfig({gridSize:[192,80,256],terrain:artifact});
fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(artifact)+'\n');
console.log(JSON.stringify({output:out,source:artifact.source.commit,samples:b.sampleCount,transform:artifact.transform,grid:artifact.grid}));
