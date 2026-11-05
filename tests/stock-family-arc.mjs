// kaminos-test: node
import assert from 'node:assert/strict';
import * as stock from '../experiments/stock-family/model.mjs';
const near=(a,b,e=2e-6)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);
const arc={center:[.2,-.1],radius:.4,start:-70,sweep:140};
const raw=[],normals=[],expected=[];
// Exact bent stock with tangent legs, including non-axis-aligned normals.
for(const s of [-.2,.01,.2,.6,.4*140*Math.PI/180+.01,1.2])for(const x of [-.08,.08]){
 const turn=Math.max(0,Math.min(s/arc.radius,arc.sweep*Math.PI/180)),a=arc.start*Math.PI/180+turn;
 const extra=s-arc.radius*turn,N=[-Math.sin(a),0,-Math.cos(a)],T=[Math.cos(a),0,-Math.sin(a)];
 raw.push(arc.center[0]+arc.radius*Math.sin(a)+extra*T[0]+x*N[0],.03,arc.center[1]+arc.radius*Math.cos(a)+extra*T[2]+x*N[2]);
 const factor=s>0&&s<arc.radius*arc.sweep*Math.PI/180?1-x/arc.radius:1;
 const n=[N[0]+T[0]/factor,1,N[2]+T[2]/factor],l=Math.hypot(...n);normals.push(...n.map(v=>v/l));expected.push([x,0,s]);
}
const p=new Float32Array(raw),n=new Float32Array(normals),before=p.slice();
const result=stock.fitStockSource(p,n,'z',arc);
for(let i=0;i<raw.length;i+=3){
 near(result.positions[i],expected[i/3][0]/1.4);
 near(result.positions[i+2],(expected[i/3][2]-.5)/1.4);
 for(let k=0;k<3;k++)near(result.normals[i+k],1/Math.sqrt(3),2e-5);
}
assert.deepEqual(p,before,'Fitting must not mutate source bytes');
assert.ok(result.referencePositions,'Curved fit must retain an undeformed reference');
assert.ok(result.restAxial,'Strain must include the original curvature');
near(result.restCurve[0],-.5/1.4);near(result.restCurve[1],(arc.radius*arc.sweep*Math.PI/180-.5)/1.4);
assert.throws(()=>stock.createStockWarp({...result.profile,locks:[[-.2,.2]]},{length:1,bend:0,protect:true},[-.3,.3]),/protected.*rest arc/i);
assert.doesNotThrow(()=>stock.createStockWarp({...result.profile,locks:[[-.5,-.4]]},{length:1,bend:0,protect:true},[-.3,.3]));
assert.throws(()=>stock.deformStock(result.positions,result.normals,{...result.profile,locks:[[-.2,.2]]},{length:1,bend:0,protect:true},result.restAxial,result.restCurve),/protected.*rest arc/i);
assert.doesNotThrow(()=>stock.deformStock(result.positions,result.normals,{...result.profile,locks:[[-.2,.2]]},{length:1,bend:0,protect:false},result.restAxial,result.restCurve));
const straight=stock.deformStock(result.positions,result.normals,result.profile,{length:1,bend:0,protect:false},result.restAxial);
near(straight.metrics.minAxialStretch,1/1.2);
near(straight.metrics.maxAxialStretch,1/.8);
assert.throws(()=>stock.fitStockSource(p,n,'z',{...arc,radius:0}),/arc/i);
assert.throws(()=>stock.fitStockSource(p,n,'z',{...arc,sweep:360}),/arc/i);
assert.throws(()=>stock.validateStockSource({...stock.DEFAULT_RECIPE.source,fit:{axis:'z',arc:{...arc,center:[NaN,0]}}}),/arc/i);
const source={...stock.DEFAULT_RECIPE.source,fit:{axis:'z',arc},profile:result.profile};
assert.deepEqual(stock.validateRecipe(JSON.parse(JSON.stringify({...stock.DEFAULT_RECIPE,source}))).source.fit.arc,arc);
console.log('stock arc: tangent legs, section coordinates, inverse normals, reference, refusal, retention passed');
