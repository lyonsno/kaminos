// kaminos-test: node
import assert from 'node:assert/strict';
import {fitStockSource} from '../experiments/stock-family/model.mjs';
import {recoverStockSection} from '../experiments/stock-family/section.mjs';

const observations=[
  {station:-.5,inner:{center:[0,.5],linear:[2.5,0,0,2.5]},outer:{center:[0,.5],linear:[2,0,0,2]}},
  {station:.5,inner:{center:[0,.5],linear:[1.25,0,0,1.25]},outer:{center:[0,.5],linear:[1,0,0,1]}},
];
const recovery={schema:'kaminos.stock-section.v1',observations,
  nominal:{center:[0,.5],innerRadius:.5,outerRadius:.625}};
const positions=[],normals=[],features=[];
for(const [station,inner,outer]of [[-.5,.4,.5],[.5,.8,1]]){
  for(const [kind,radius,sign]of [['inner',inner,-1],['outer',outer,1]]){
    for(const angle of [-Math.PI,-3*Math.PI/4,-Math.PI/2,-Math.PI/4,0]){
      positions.push(radius*Math.cos(angle),radius*Math.sin(angle),station);
      normals.push(sign*Math.cos(angle),sign*Math.sin(angle),0);
      features.push(kind);
    }
  }
}
const original=new Float32Array(positions),normal=new Float32Array(normals);
const result=fitStockSource(original,normal,'z',undefined,recovery);
for(let i=0;i<features.length;i++){
  const radius=Math.hypot(result.positions[i*3],result.positions[i*3+1]-.5);
  assert.ok(Math.abs(radius-(features[i]==='inner'?.5:.625))<1e-6,
    `${features[i]} at station ${original[i*3+2]} must reach its authored section, got ${radius}`);
  assert.ok(Math.abs(Math.hypot(...result.normals.subarray(i*3,i*3+3))-1)<1e-6);
}
assert.deepEqual(original,new Float32Array(positions),'Recovery must retain the source array');
assert.deepEqual(normal,new Float32Array(normals),'Recovery must retain the source normal array');
assert.ok(result.profile.xMin<=-.625&&result.profile.xMax>=.625,'Recovered bounds must describe the controlled surface');
assert.throws(()=>fitStockSource(original,normal,'z',undefined,{...recovery,observations:[observations[1],observations[0]]}),/ordered|station/i);
assert.throws(()=>fitStockSource(original,normal,'z',undefined,{...recovery,nominal:{...recovery.nominal,outerRadius:.4}}),/radius|radii|thickness/i);

const surface=(point,n)=>({positions:new Float32Array(point),normals:new Float32Array(n),profile:{min:-.5,max:.5,xMin:-2,xMax:2,locks:[]}});
const drifting={schema:'kaminos.stock-section.v1',nominal:{center:[0,0],innerRadius:1,outerRadius:2},observations:[-.5,.5].map(station=>({station,
  inner:{center:[station*.3,0],linear:[1,0,0,1]},outer:{center:[station*.3,0],linear:[.5,0,0,.5]}}))};
const drift=recoverStockSection(surface([1,0,0],[1,0,0]),drifting),length=Math.hypot(1,.3);
assert.ok(Math.abs(drift.normals[0]-1/length)<1e-6&&Math.abs(drift.normals[2]-.3/length)<1e-6,
  'Normals must include the recovered centerline derivative, not only cross-section rotation');
const elliptical={...drifting,observations:[-.5,.5].map(station=>({station,
  inner:{center:[0,0],linear:[2,0,0,1]},outer:{center:[0,0],linear:[1,0,0,.5]}}))};
const ellipse=recoverStockSection(surface([Math.SQRT1_2/2,-Math.SQRT1_2,0],[2/Math.sqrt(5),-1/Math.sqrt(5),0]),elliptical);
assert.ok(Math.abs(ellipse.positions[0]-Math.SQRT1_2)<1e-6&&Math.abs(ellipse.positions[1]+Math.SQRT1_2)<1e-6);
assert.ok(Math.abs(ellipse.normals[0]-Math.SQRT1_2)<1e-6&&Math.abs(ellipse.normals[1]+Math.SQRT1_2)<1e-6);
assert.throws(()=>recoverStockSection(surface([1,0,1],[1,0,0]),drifting),/outside observed/);
assert.throws(()=>recoverStockSection(surface([0,0,0],[1,0,0]),drifting),/hollow center/);
assert.ok(recoverStockSection(surface([1.15,0,1],[1,0,0]),{...drifting,outside:'hold'}).sectionRecovery.minJacobianDeterminant>0);
