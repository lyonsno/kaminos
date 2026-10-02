import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import { defaultLocalLiquidSetup, localLiquidInletPacket, legacyLocalLiquidEmitterRecord, normalizeLocalLiquidSetup } from '../local-liquid-setup.mjs';

const source = readFileSync(new URL('../local-liquid-host.mjs', import.meta.url), 'utf8');
// Exercise the production host setters without creating GPU resources. The
// browser witness separately checks the real selection and solver route.
const setters = source.slice(source.indexOf('setEmitters(records)'), source.indexOf('setPaused(value)'));
function mountedSource() {
  const authored = defaultLocalLiquidSetup();
  const emitters = [legacyLocalLiquidEmitterRecord({x:0,y:1,z:0,radius:.08,strength:1.15,rate:1200}, 'A'),
    legacyLocalLiquidEmitterRecord({x:1,y:1,z:0,radius:.08,strength:1.15,rate:1200}, 'B')];
  const initialPacket = localLiquidInletPacket(authored, emitters, 1);
  const packets = [];
  const host = runInNewContext(`(() => {
    let authored=setup, authoredEmitters=structuredClone(emitters), sourceGeneration=1;
    let publishedEmitterKey=JSON.stringify(initialPacket.emitters);
    return {${setters} state:()=>({sourceGeneration,authoredEmitters,authored})};
  })()`, {setup:authored, emitters, initialPacket, structuredClone, localLiquidInletPacket, normalizeLocalLiquidSetup,
    solver:{setLiveInletPacket:packet=>packets.push(packet)}});
  return {host,emitters,packets};
}

test('selection-only reconciliation preserves the source generation and release schedule', () => {
  const {host,emitters,packets}=mountedSource();
  for (let i=0;i<8;i++) host.setEmitters(structuredClone(emitters));
  assert.equal(packets.length,0,'unchanged authored emitters must not reset the solver inlet release epoch');
  assert.equal(host.state().sourceGeneration,1);
});

test('label-only changes do not restart emission, but an actual transform and its undo each publish', () => {
  const {host,emitters,packets}=mountedSource();
  const renamed=structuredClone(emitters); renamed[0].label='Selected water';
  host.setEmitters(renamed);
  assert.equal(packets.length,0);
  const moved=structuredClone(renamed); moved[0].transform.position[0]+=.2;
  host.setEmitters(moved);
  host.setEmitters(structuredClone(moved));
  assert.equal(packets.length,1,'duplicate transform events publish once');
  assert.equal(packets[0].packet_id,'kaminos-authored-liquid-2');
  assert.equal(packets[0].emitters[0].origin_world[0],.2);
  host.setEmitters(emitters);
  assert.equal(packets.length,2,'undo must restore the source pose');
});

test('rate, aperture and membership edits still reach the solver', () => {
  const {host,emitters,packets}=mountedSource();
  const edited=structuredClone(emitters); edited[1].localLiquidEmitter.rate=0;
  host.setEmitters(edited);
  assert.equal(packets[0].emitters[1].active,false);
  edited[0].transform.scale=[1.1,1.1,1.1]; host.setEmitters(edited);
  assert.ok(packets[1].emitters[0].radius>packets[0].emitters[0].radius);
  host.setEmitters(edited.slice(0,1));
  assert.equal(packets[2].emitters.length,1);
});

test('rejected source settings leave the previously published source intact', () => {
  const {host,emitters,packets}=mountedSource();
  const invalid=structuredClone(emitters); invalid[0].localLiquidEmitter.rate=NaN;
  assert.throws(()=>host.setEmitters(invalid),/rate/);
  host.setEmitters(emitters);
  assert.equal(packets.length,0);
  assert.equal(host.state().sourceGeneration,1);
});
