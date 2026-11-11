// kaminos-test: node
import assert from 'node:assert/strict';
import {EarthSpecimen} from '../earth-specimen.mjs';
import {createMaterialTeacherSource} from '../material-teacher-source.mjs';
assert.throws(()=>createMaterialTeacherSource({kind:'typo'}),/Unknown material source/,'never substitute legacy source for an unknown requested teacher');
const earth=new EarthSpecimen({columns:4,layers:2,grains:1});earth.advance(.04);
const source=createMaterialTeacherSource({kind:'earth-specimen',snapshot:earth.snapshot(),resolution:10});
assert.equal(source.schema,'kaminos.earth-teacher.v1');assert.equal(source.config.snapshot.time,earth.time);
assert.throws(()=>createMaterialTeacherSource({kind:'earth-specimen'}),/schema/i);
assert.equal(createMaterialTeacherSource({cells:3,grains:1,halo:0}).schema,'kaminos.authored-ground-source.v1');
console.log('explicit formed-earth source routing, state identity and legacy source checks pass');
