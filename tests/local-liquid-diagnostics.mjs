// kaminos-test: node
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {test} from 'node:test';
import {defaultLocalLiquidSetup, normalizeLocalLiquidSetup, localLiquidInletPacket} from '../local-liquid-setup.mjs';

const source=readFileSync(new URL('../local-liquid-host.mjs',import.meta.url),'utf8');
// Execute the real host constructor through solver creation, retiring it before
// presentation allocation. This checks the caller policy; the core encoding
// tests and native consumer separately check its effective GPU behavior.
const executable=source.replace(/^import[\s\S]*?from '[^']+';\n/gm,'')
  .replace('export async function createLocalLiquidHost','async function createLocalLiquidHost');

for(const support of ['scene_primitives','retained_analytical_basin']) {
  test(`live inlet host excludes unread energy measurements on ${support}`,async()=>{
    const device={},colliders=[{id:'floor'}],calls=[];
    const create=runInNewContext(executable+'\ncreateLocalLiquidHost;',{
      normalizeLocalLiquidSetup,localLiquidInletPacket,structuredClone,
      SCENE_LIQUID_SUPPORT_ROUTE:'kaminos/fluid/authored-primitive-support-v0',
      SUPPORT:'kaminos/finger-fluid/analytic-support-contact-v0',
      createWebGPUFingerFluidSolver:async options=>{
        calls.push(options);return {destroy(){calls.push('destroy');}};
      },
    });
    const setup={...defaultLocalLiquidSetup(),support,particleCount:2400,densityIterations:3};
    assert.equal(await create({renderer:{backend:{device}},device,setup,
      readColliders:()=>colliders,isCurrent:()=>false}),null);
    assert.equal(calls.length,2);
    assert.equal(calls[1],'destroy');
    const options=calls[0];
    assert.equal(options.energyDiagnosticsMode,'disabled','ordinary inlet water must not request unread per-step measurements');
    assert.equal(options.webgpuDevice,device);
    assert.equal(options.hostFrameComposition,true);
    assert.equal(options.truthScene,'live_hand_inlets');
    assert.equal(options.particleCount,2400);
    assert.equal(options.densityIterations,3);
    assert.equal(options.liveInletPacket.schema,localLiquidInletPacket(setup,[],1).schema);
    assert.equal(options.liveInletPacket.emitters.length,0);
    assert.deepEqual(Array.from(options.sceneColliders),support==='scene_primitives'?colliders:[]);
  });
}
