// kaminos-test: node
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {execFileSync} from 'node:child_process';

test('empty fixture corpus cannot become successful pixel evidence',()=>{
  // Run the actual probe in a VM. Only I/O and browser infrastructure are
  // injected; production admission, status, report and exit logic execute.
  const script=String.raw`
    import vm from 'node:vm';
    import {readFile} from 'node:fs/promises';
    import path from 'node:path';
    import {createHash} from 'node:crypto';
    const source=await readFile('models/trellis2/probe-alpha-codec.mjs','utf8');
    const hash=createHash('sha256').update('preparation-module').digest('hex');
    const observation={browserLaunches:0,reports:[]};
    const processStub={argv:['node','probe','--repo-root','/source','--out','/evidence','--images','/inputs','--chrome','/independent/chrome','--wrapper']};
    const context=vm.createContext({process:processStub,console:{log(){}},Uint8Array,Array,JSON,Error,Promise});
    const exports={
      'node:fs/promises':{
        mkdir:async()=>{},realpath:async p=>p,
        readFile:async p=>p.endsWith('alpha-preparation-source.json')?JSON.stringify({cases:[]}):'preparation-module',
        writeFile:async(p,body)=>{observation.reports.push({path:p,report:JSON.parse(body)});}
      },
      'node:path':{default:path},'node:crypto':{createHash},
      '../flux2-klein/cdp-harness.mjs':{
        sourceIdentity:()=>({rev:'controlled-source',dirtyFiles:[]}),
        startServer:async()=>({origin:'http://controlled',server:{close:f=>f()}}),
        launchChrome:async()=>{observation.browserLaunches++;return {navigate:async()=>{},evaluate:async()=>hash,close:async()=>{}};}
      }
    };
    const probe=new vm.SourceTextModule(source,{context});
    await probe.link(async name=>{
      const fields=exports[name];if(!fields)throw Error('unexpected dependency '+name);
      return new vm.SyntheticModule(Object.keys(fields),function(){for(const [key,value] of Object.entries(fields))this.setExport(key,value);},{context});
    });
    await probe.evaluate();observation.exitCode=processStub.exitCode;
    console.log(JSON.stringify(observation));
  `;
  const observed=JSON.parse(execFileSync(process.execPath,['--experimental-vm-modules','--input-type=module','-e',script],{encoding:'utf8'}));
  const terminal=observed.reports.at(-1);
  assert.equal(terminal.path,'/evidence/report.json');
  assert.equal(terminal.report.status,'failed','Empty comparisons must not produce successful evidence.');
  assert.match(terminal.report.error.message,/nonempty.*fixture|fixture.*nonempty/);
  assert.equal(observed.exitCode,1);
  assert.equal(observed.browserLaunches,0,'Reject during fixture admission before browser work.');
});
