// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {packetNetworkSettings} from '../volume-packet-network.mjs';
test('common packets expose density, internal material detail and blending independently',()=>{
 const s=packetNetworkSettings({mode:'material-packets',packetWidth:4,materialSubdivisions:2,receiverBlend:1.25,packetSmoothing:1,supportSigmas:3,width:2,sections:8});
 assert.equal(s.mode,'material-packets');assert.equal(s.packetWidth,4);assert.equal(s.materialSubdivisions,2);assert.equal(s.receiverBlend,1.25);assert.equal(s.width,2);assert.equal(s.sections,8);
 assert.equal(packetNetworkSettings().mode,'fine-reference','existing saved recipes retain their fine-reference meaning');
 for(const patch of [{packetWidth:0},{materialSubdivisions:1.5},{receiverBlend:0},{supportSigmas:0},{packetSmoothing:0},{mode:'invented'}])assert.throws(()=>packetNetworkSettings(patch));
});
