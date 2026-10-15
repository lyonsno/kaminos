// kaminos-test: node
// Host orchestration doubles only: no native GPU/conformance claim.
import {spawnSync} from 'node:child_process';
import vm from 'node:vm';
if(!vm.SourceTextModule){const child=spawnSync(process.execPath,['--experimental-vm-modules',import.meta.filename],{stdio:'inherit'});process.exit(child.status??1);}
const {default:fs}=await import('node:fs/promises'),{default:path}=await import('node:path');
const {default:assert}=await import('node:assert/strict'),{test}=await import('node:test');
const crypto=await import('node:crypto');
const sourceUrl=new URL('../replay-captured-shape.mjs',import.meta.url),source=await fs.readFile(sourceUrl,'utf8');
async function exercise(scenario){
  const files=new Map(),exposed={},state={serverClosed:false},options={'repo-root':'/source',capture:'/capture',checkpoints:'/checkpoint',
    'output-dir':'/output',browser:'/independent-browser',puppeteer:'/puppeteer','expected-commit':'expected'};
  const mockedFs={async mkdir(){},async realpath(p){return p;},async mkdtemp(){return '/output/private-profile';},
    async writeFile(p,b){files.set(p,Buffer.isBuffer(b)?b:Buffer.from(b));},async appendFile(p,b){files.set(p,Buffer.concat([files.get(p),b]));},
    async readFile(p){if(files.has(p))return files.get(p);if(String(p).endsWith('capture.json'))return '{}';return Buffer.from('{}');}};
  const page={async exposeFunction(n,f){exposed[n]=f;},async goto(){},async evaluate(){
    // Emulate browser-side observations; the production browser call sites are
    // reviewed separately, while this exercises their real host sink.
    await exposed.__observe?.({backend:{vendor:'apple',isFallbackAdapter:false},effectiveFeatures:['shader-f16'],routeId:'trellis2.saved-shape-mesh-replay'});
    await exposed.__phase('learned-geometry-decoding');
    if(scenario==='decode-failure')throw Error('injected decoder failure');
    for(const name of ['geometry.features','geometry.coordinates','mesh.vertices','mesh.triangles'])await exposed.__save(name,'AQ==',0,1);
    await exposed.__observe?.({decoded:{rows:1,resolution:512,activationStorage:'f16'}});
    if(scenario==='retention-failure')throw Error('injected failure after geometry retention');
    return {backend:{vendor:'apple'},faces:1};}};
  const browser={async version(){return 'test-double';},process(){return{pid:123};},async newPage(){return page;},
    async close(){if(scenario==='close-failure')throw Error('injected browser.close rejection');}};
  const server={listen(...args){args.at(-1)();},address(){return{port:1234};},close(cb){state.serverClosed=true;cb();}};
  const proc={argv:[],exitCode:0};const context=vm.createContext({Buffer,process:proc,console:{log(){}},URL});
  const moduleFor=async(identifier,exports)=>{const m=new vm.SyntheticModule(Object.keys(exports),function(){for(const [k,v]of Object.entries(exports))this.setExport(k,v);},{context,identifier});await m.link(()=>{});await m.evaluate();return m;};
  const imports={
    'node:fs/promises':{default:mockedFs},'node:path':{default:path},'node:http':{default:{createServer:()=>server}},
    'node:util':{parseArgs:()=>({values:options})},'node:crypto':{createHash:crypto.createHash},
    'node:child_process':{execFileSync:(_file,args)=>args[0]==='rev-parse'?'expected':''},
    'node:assert/strict':{default:assert},'./captured-shape-replay-checks.mjs':{admitCapturedShape:async()=>({manifestSha256:'hash'})}};
  const mod=new vm.SourceTextModule(source,{context,identifier:sourceUrl.href,initializeImportMeta(meta){meta.url=sourceUrl.href;},
    importModuleDynamically:async spec=>{assert.equal(spec,'/puppeteer');return moduleFor(spec,{default:{launch:async()=>browser}});}});
  await mod.link(spec=>moduleFor(spec,imports[spec]));let rejection;
  try{await mod.evaluate();}catch(error){rejection=error;}
  return {report:JSON.parse(files.get('/output/report.json')),state,rejection,exitCode:proc.exitCode};
}
test('CSR-1: rejected browser close preserves compute result and still closes server',async()=>{
  const r=await exercise('close-failure');assert.equal(r.report.status,'succeeded');assert.ok(r.report.native);
  assert.equal(r.state.serverClosed,true);assert.equal(r.rejection,undefined);
  assert.match(JSON.stringify(r.report.teardownErrors),/injected browser.close rejection/);assert.equal(r.exitCode,1);
});
for(const phase of ['decode-failure','retention-failure'])test('CSR-2: observed route survives '+phase,async()=>{
  const r=await exercise(phase);assert.equal(r.report.status,'failed');assert.equal(r.state.serverClosed,true);
  assert.equal(r.report.observedNative?.backend.vendor,'apple');assert.equal(r.report.observedNative?.routeId,'trellis2.saved-shape-mesh-replay');
  if(phase==='retention-failure'){assert.equal(r.report.outputs['geometry.features'].complete,true);assert.equal(r.report.observedNative.decoded.resolution,512);}
});
