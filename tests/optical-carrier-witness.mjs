// kaminos-test: node
import assert from 'node:assert/strict';
import test from 'node:test';
import {verifyOpticalCarrierSnapshot} from '../tools/optical-carrier-witness.mjs';
test('carrier witness rejects fallback, stale mode, missing and nonfinite state',()=>{
 const good={state:{effectiveRoute:'native-3d-compute-fluid-raymarch-v0',backend:'webgpu:apple',opticalParticles:{slots:1,settings:{carrierMode:1},carrier:{rayAcquisition:false,chemistry:false,exchange:false},freshSamples:0,gridAssist:{effective:'off'},raymarchVisible:false}},records:Array(24).fill(0),deformation:Array(12).fill(0)};good.records[3]=1;verifyOpticalCarrierSnapshot(good);
 for(const edit of [s=>s.state.backend='fallback',s=>s.state.effectiveRoute='other',s=>s.state.opticalParticles.settings.carrierMode=0,s=>s.records.pop(),s=>s.deformation.pop(),s=>s.deformation[0]=NaN,s=>s.records[3]=0,s=>s.state.opticalParticles.gridAssist.effective='on']){const copy=structuredClone(good);edit(copy);assert.throws(()=>verifyOpticalCarrierSnapshot(copy));}
});
