// kaminos-test: node
import assert from 'node:assert/strict';
import {createSceneLightingCadence} from '../scene-lighting-cadence.mjs';
import {opticalParticleSettings} from '../volume-optical-particles.mjs';

const pacer=createSceneLightingCadence({gain:1,softness:0});
assert.equal(pacer.due(0),true,'unmanaged scenes keep existing per-frame preparation');
pacer.configure({enabled:true,intervalMs:200,gain:2});
pacer.configure({gain:3});
assert.equal(pacer.due(0),true);
assert.equal(pacer.begin(0).gain,3,'one solve consumes the latest edit');
pacer.configure({gain:4});
assert.equal(pacer.due(300),false,'unfinished solve blocks additional work even after the cadence');
pacer.complete();
assert.equal(pacer.due(100),false);
assert.equal(pacer.due(200),true);
assert.equal(pacer.begin(200).gain,4);
pacer.configure({enabled:false});
assert.equal(pacer.due(999),false,'off stops preparation, including pending edits');
pacer.configure({enabled:true,gain:5});
assert.equal(pacer.due(999),false,'off/on cannot pile onto an outstanding solve');
pacer.complete();
assert.equal(pacer.begin(999).gain,5);
assert.throws(()=>pacer.configure({intervalMs:-1}),/interval/);
assert.equal(pacer.read().intervalMs,200,'rejected patch changes nothing');
pacer.clear();
assert.equal(pacer.due(999),true);

const flat=opticalParticleSettings().coverage;
assert.deepEqual(flat,{basis:'lifetime',footprint:[[0,1],[1,1]],opacity:[[0,1],[1,1]]});
assert.throws(()=>opticalParticleSettings({coverage:{footprint:[[0,1],[.5,2],[.5,0],[1,1]]}}),/ordered/);
assert.throws(()=>opticalParticleSettings({coverage:{opacity:[[0,1],[1,-1]]}}),/nonnegative/);
const footprint=[[0,1],[.25,0],[1,2]];
const authored=opticalParticleSettings({coverage:{basis:'mixing',footprint}});
footprint[1][1]=7;
assert.equal(authored.coverage.footprint[1][1],0,'caller edits cannot mutate a submitted curve');
assert.equal(authored.coverage.basis,'mixing');
