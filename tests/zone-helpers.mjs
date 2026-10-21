// kaminos-test: node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {DEFAULT_VIEWPORT_DISPLAY,checkedViewportDisplay,syncSceneHelperVisibility} from '../viewport-display-settings.mjs';
assert.equal(DEFAULT_VIEWPORT_DISPLAY.zones,true,'Authored zones have no visible helper category');
const zone=new THREE.Group();zone.userData.kaminosHelperKind='zones';
syncSceneHelperVisibility([zone],checkedViewportDisplay({helpers:false}));assert.equal(zone.visible,false);
syncSceneHelperVisibility([zone],checkedViewportDisplay({zones:false}));assert.equal(zone.visible,false);
syncSceneHelperVisibility([zone],checkedViewportDisplay({}));assert.equal(zone.visible,true);
assert.throws(()=>checkedViewportDisplay({zones:'yes'}),/zones/);
console.log('Zone guides are visible, individually toggleable and obey master helpers');
