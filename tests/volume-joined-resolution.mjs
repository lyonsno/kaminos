import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../volume-core.js';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../volume-core.js',import.meta.url),'utf8');
test('joined heat release and inflow admission use the actually opened pressure top',()=>{
  const c={pressureSolver:'converged',projection:1,heatReleaseExpansion:1};
  assert.equal(core.resolveHeatReleaseConfig(c,{surroundingSmoke:true}).effective.admitted,true);
  const d={sourceLaw:'inflow-boundary',inflow:{apertureKind:'disc',center:[0,0],ringRadius:0,bandHalfWidth:.1,halfLength:0,sideAxis:[1,0],inletVelocity:.1,fuelFraction:.5,inletTemperature:1}};
  assert.equal(core.resolveInflowBoundaryConfig(c,d,{grid:64,surroundingSmoke:true}).effective.admitted,true);
  assert.equal(core.resolveHeatReleaseConfig(c).effective.admitted,false);
});
test('driving velocity and its bound represent the same local speed across joined resolutions',()=>{
  for(const grid of [32,64,128]) {
    const units=core.joinedVelocityUnits(grid,true);
    assert.equal(units.cellScale*2/grid,2/32);
    assert.equal(units.referenceGrid,32);
  }
  assert.equal(core.joinedVelocityUnits(64,false).cellScale,1,'standalone saved behavior unchanged');
  assert.match(source,/thermalBuoyancyForce[\s\S]*?hotLift \+ fuelKick - smokeDrag[\s\S]*?joinedVelocityScale/);
  assert.match(source,/return u\.inflow_state\.y[^;]*joinedVelocityScale\(\)/);
  assert.match(source,/maxSpeed =[^;]*joinedVelocityScale\(\)/);
});
